/**
 * Web app on Vercel (software.turbineh.com, region cdg1): project, encrypted env vars, domain and the IONOS CNAME.
 * Idempotent. Secrets come from .env.local and are never printed.
 *
 *   npx tsx infra/staging/web.ts <step>   (steps: project | env | domain | dns | all)
 */
import { loadLocalEnv } from "@turbineh/shared";

loadLocalEnv();
const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing in .env.local`);
  return v;
};
const TOKEN = need("VERCEL_TOKEN");
const TEAM = "team_BBQ9Gyb31uDAzUkxSLx2AJqs";
const PROJECT = "code-frontiers-web";
const DOMAIN = "software.turbineh.com";
const IONOS_ZONE = "5df240aa-e57f-11f0-8802-0a5864440b1b";

async function vercel<T>(method: string, path: string, body?: unknown): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.vercel.com${path}${sep}teamId=${TEAM}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok && res.status !== 409)
    throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

async function project(): Promise<void> {
  const existing = await fetch(`https://api.vercel.com/v9/projects/${PROJECT}?teamId=${TEAM}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const settings = {
    framework: "nextjs",
    rootDirectory: "apps/web",
    installCommand: "pnpm install --frozen-lockfile",
    buildCommand: "cd ../.. && pnpm turbo run build --filter=@turbineh/web...",
  };
  if (existing.ok) {
    await vercel("PATCH", `/v9/projects/${PROJECT}`, settings);
    return console.log("project updated");
  }
  await vercel("POST", "/v11/projects", { name: PROJECT, ...settings });
  console.log("project created");
}

async function env(): Promise<void> {
  const vars: Record<string, string> = {
    DATABASE_URL: need("STAGING_DATABASE_URL"),
    DATABASE_CA_CERT: need("STAGING_DATABASE_CA_CERT"),
    DATABASE_POOL_MAX: "3",
    BETTER_AUTH_SECRET: need("STAGING_BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: `https://${DOMAIN}`,
    GITHUB_CLIENT_ID: need("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET: need("GITHUB_CLIENT_SECRET"),
    DELIVERY_TOKEN_KEY: need("STAGING_DELIVERY_TOKEN_KEY"),
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://s3.fr-par.scw.cloud",
    S3_REGION: "fr-par",
    S3_BUCKET: "code-frontiers-artifacts",
    S3_ACCESS_KEY_ID: need("SCW_ACCESS_KEY"),
    S3_SECRET_ACCESS_KEY: need("SCW_SECRET_KEY"),
    DAILY_COST_CAP_EUR: "100",
    USER_DAILY_BUILDS: "10",
  };
  const body = Object.entries(vars).map(([key, value]) => ({
    key,
    value,
    type: "encrypted",
    target: ["production", "preview"],
  }));
  await vercel("POST", `/v10/projects/${PROJECT}/env?upsert=true`, body);
  console.log(`env upserted (${body.length} variables)`);
}

async function domain(): Promise<void> {
  await vercel("POST", `/v10/projects/${PROJECT}/domains`, { name: DOMAIN });
  console.log(`domain ${DOMAIN} attached`);
}

async function dns(): Promise<void> {
  const key = need("IONOS_DNS_API_KEY");
  const zone = (await (
    await fetch(`https://api.hosting.ionos.com/dns/v1/zones/${IONOS_ZONE}?recordName=${DOMAIN}`, {
      headers: { "X-API-Key": key },
    })
  ).json()) as { records?: { type: string; content: string }[] };
  if ((zone.records ?? []).length > 0)
    return console.log(
      `dns record exists: ${zone.records?.map((r) => `${r.type} ${r.content}`).join(", ")}`,
    );
  const res = await fetch(`https://api.hosting.ionos.com/dns/v1/zones/${IONOS_ZONE}/records`, {
    method: "POST",
    headers: { "X-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify([
      {
        name: DOMAIN,
        type: "CNAME",
        content: "cname.vercel-dns.com",
        ttl: 3600,
        prio: 0,
        disabled: false,
      },
    ]),
  });
  if (!res.ok) throw new Error(`IONOS ${res.status} ${(await res.text()).slice(0, 200)}`);
  console.log(`dns CNAME ${DOMAIN} → cname.vercel-dns.com created`);
}

const steps: Record<string, () => Promise<void>> = {
  project,
  env,
  domain,
  dns,
  all: async () => {
    await project();
    await env();
    await domain();
    await dns();
  },
};
const step = process.argv.slice(2).find((a) => a !== "--") ?? "all";
const fn = steps[step];
if (!fn) throw new Error(`unknown step ${step}`);
await fn();
