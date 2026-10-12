/**
 * Staging on Scaleway fr-par (ADR-0006): SSH key, private artefact bucket, managed Postgres (pgvector) and the
 * worker instance. Idempotent: existing resources (matched by name) are reused. Secrets come from .env.local and
 * are never printed.
 *
 *   pnpm --filter @turbineh/infra run provision -- <step>
 *   steps: ssh-key | bucket | db | instance | status (production) · staging-bucket | staging-db (ADR-0022)
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { loadLocalEnv } from "@turbineh/shared";

loadLocalEnv();
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing in .env.local`);
  return v;
};
const SECRET = need("SCW_SECRET_KEY");
const PROJECT = need("SCW_PROJECT_ID");
const REGION = "fr-par";
const ZONE = "fr-par-1";
const NAME = "code-frontiers-staging";
const BUCKET = "code-frontiers-artifacts";
// Staging (ADR-0022): its own bucket and its own database inside the same managed instance (no extra cost).
const STAGING_BUCKET = "code-frontiers-artifacts-staging";
const STAGING_DB = "turbineh_staging";

async function scw<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.scaleway.com${path}`, {
    method,
    headers: { "X-Auth-Token": SECRET, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function sshKey(): Promise<void> {
  const pub = readFileSync(join(homedir(), ".ssh/id_ed25519_turbineh_staging.pub"), "utf8").trim();
  const list = await scw<{ ssh_keys: { name: string; id: string }[] }>(
    "GET",
    `/iam/v1alpha1/ssh-keys?project_id=${PROJECT}`,
  );
  const found = list.ssh_keys.find((k) => k.name === NAME);
  if (found) return console.log(`ssh key exists (${found.id})`);
  const k = await scw<{ id: string }>("POST", "/iam/v1alpha1/ssh-keys", {
    name: NAME,
    public_key: pub,
    project_id: PROJECT,
  });
  console.log(`ssh key created (${k.id})`);
}

async function bucket(name = BUCKET): Promise<void> {
  const BUCKET = name;
  const s3 = new S3Client({
    region: REGION,
    endpoint: `https://s3.${REGION}.scw.cloud`,
    credentials: { accessKeyId: need("SCW_ACCESS_KEY"), secretAccessKey: SECRET },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    console.log("bucket exists");
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    console.log("bucket created");
  }
  await s3
    .send(
      new PutPublicAccessBlockCommand({
        Bucket: BUCKET,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      }),
    )
    .then(
      () => console.log("public access blocked"),
      () =>
        console.log(
          "public access block not supported; bucket is private by default (no public ACL set)",
        ),
    );
}

async function db(): Promise<void> {
  const list = await scw<{
    instances: {
      id: string;
      name: string;
      status: string;
      endpoints: { ip: string; port: number }[];
    }[];
  }>("GET", `/rdb/v1/regions/${REGION}/instances?project_id=${PROJECT}&name=${NAME}`);
  const found = list.instances.find((i) => i.name === NAME);
  if (found)
    return console.log(
      `db exists (${found.status}) ${found.endpoints[0]?.ip ?? ""}:${found.endpoints[0]?.port ?? ""}`,
    );
  const password = need("STAGING_DB_PASSWORD");
  const created = await scw<{ id: string }>("POST", `/rdb/v1/regions/${REGION}/instances`, {
    project_id: PROJECT,
    name: NAME,
    engine: "PostgreSQL-16",
    node_type: "db-dev-s",
    user_name: "turbineh",
    password,
    is_ha_cluster: false,
    disable_backup: false,
    volume_type: "sbs_5k",
    volume_size: 10_000_000_000,
    tags: ["code-frontiers", "staging"],
  });
  console.log(`db creating (${created.id}); run 'status' until ready`);
}

async function instance(): Promise<void> {
  const list = await scw<{
    servers: { id: string; name: string; state: string; public_ip: { address: string } | null }[];
  }>("GET", `/instance/v1/zones/${ZONE}/servers?project=${PROJECT}&name=${NAME}`);
  const found = list.servers.find((s) => s.name === NAME);
  if (found)
    return console.log(`instance exists (${found.state}) ${found.public_ip?.address ?? ""}`);
  const images = await scw<{ local_images: { id: string; arch: string; type: string }[] }>(
    "GET",
    `/marketplace/v2/local-images?image_label=ubuntu_noble&zone=${ZONE}&per_page=50`,
  );
  const local = images.local_images.find((l) => l.arch === "x86_64" && l.type === "instance_sbs");
  if (!local) throw new Error("ubuntu_noble image not found");
  // Preference order; new accounts have per-type quotas, so fall back to the next equivalent type.
  const types = [
    "POP2-HC-16C-32G",
    "COMPUTE3-X16C-32G",
    "BASIC3-X16C-32G",
    "POP2-HC-8C-16G",
    "COMPUTE3-X8C-16G",
    "BASIC3-X8C-16G",
    "GP1-S",
    "PRO2-M",
    "PRO2-S",
    "PRO2-XS",
    "DEV1-XL",
    "DEV1-L",
    "PLAY2-MICRO",
  ];
  let s: { server: { id: string } } | undefined;
  for (const commercial_type of types) {
    try {
      s = await scw<{ server: { id: string } }>("POST", `/instance/v1/zones/${ZONE}/servers`, {
        name: NAME,
        project: PROJECT,
        commercial_type,
        image: local.id,
        dynamic_ip_required: true,
        tags: ["code-frontiers", "staging"],
        volumes: { "0": { size: 100_000_000_000, volume_type: "sbs_volume" } },
      });
      console.log(`instance type ${commercial_type}`);
      break;
    } catch (err) {
      if (!String(err).includes("quotas_exceeded") && !String(err).includes("not available"))
        throw err;
      console.log(`${commercial_type}: quota or availability exceeded, trying next`);
    }
  }
  if (!s) throw new Error("no instance type available within the account quotas");
  await scw("POST", `/instance/v1/zones/${ZONE}/servers/${s.server.id}/action`, {
    action: "poweron",
  });
  console.log(`instance created and powering on (${s.server.id})`);
}

async function status(): Promise<void> {
  const d = await scw<{
    instances: { name: string; status: string; endpoints: { ip: string; port: number }[] }[];
  }>("GET", `/rdb/v1/regions/${REGION}/instances?project_id=${PROJECT}&name=${NAME}`);
  const s = await scw<{
    servers: { name: string; state: string; public_ip: { address: string } | null }[];
  }>("GET", `/instance/v1/zones/${ZONE}/servers?project=${PROJECT}&name=${NAME}`);
  console.log(
    JSON.stringify(
      {
        db: d.instances.map((i) => ({ status: i.status, endpoint: i.endpoints[0] })),
        instance: s.servers.map((x) => ({ state: x.state, ip: x.public_ip?.address })),
      },
      null,
      2,
    ),
  );
}

/** Staging database in the production instance: separate data, same engine and extensions. */
async function stagingDb(): Promise<void> {
  const list = await scw<{ instances: { id: string; name: string }[] }>(
    "GET",
    `/rdb/v1/regions/${REGION}/instances?project_id=${PROJECT}&name=${NAME}`,
  );
  const inst = list.instances.find((i) => i.name === NAME);
  if (!inst) throw new Error("database instance not found; run 'db' first");
  const dbs = await scw<{ databases: { name: string }[] }>(
    "GET",
    `/rdb/v1/regions/${REGION}/instances/${inst.id}/databases?name=${STAGING_DB}`,
  );
  if (dbs.databases.some((d) => d.name === STAGING_DB)) console.log("staging database exists");
  else {
    await scw("POST", `/rdb/v1/regions/${REGION}/instances/${inst.id}/databases`, {
      name: STAGING_DB,
    });
    console.log("staging database created");
  }
  await scw("PUT", `/rdb/v1/regions/${REGION}/instances/${inst.id}/privileges`, {
    database_name: STAGING_DB,
    user_name: "turbineh",
    permission: "all",
  });
  console.log("privileges set");
}

const steps: Record<string, () => Promise<void>> = {
  "ssh-key": sshKey,
  bucket: () => bucket(),
  db,
  "staging-bucket": () => bucket(STAGING_BUCKET),
  "staging-db": stagingDb,
  instance,
  status,
};
const step = process.argv.slice(2).find((a) => a !== "--") ?? "status";
const fn = steps[step];
if (!fn) throw new Error(`unknown step ${step}`);
await fn();
