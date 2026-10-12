/**
 * Web app on Vercel (region cdg1): project, encrypted env vars, domain and the IONOS CNAME. Idempotent. Secrets come
 * from .env.local and are never printed.
 *
 *   npx tsx infra/staging/web.ts <step>                 production: software.turbineh.com
 *   TARGET=staging npx tsx infra/staging/web.ts <step>  staging: staging.software.turbineh.com (ADR-0022)
 *   steps: project | env | domain | dns | all
 *
 * .env.local names: production uses the legacy STAGING_* names; staging uses STG_* (falls back to shared values).
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
const STAGING = process.env.TARGET === "staging";
const PROJECT = STAGING ? "code-frontiers-web-staging" : "code-frontiers-web";
const DOMAIN = STAGING ? "staging.software.turbineh.com" : "software.turbineh.com";
const BUCKET = STAGING ? "code-frontiers-artifacts-staging" : "code-frontiers-artifacts";
/** Environment-specific value: STG_<name> on staging, <legacy production name> otherwise. */
const pick = (stg: string, prod: string) => (STAGING ? need(stg) : need(prod));
/** Optional shared settings (Deploy-for-me sign-in): STG_<name> on staging, <name> on production. */
const optional = (name: string): Record<string, string> => {
  const v = process.env[STAGING ? `STG_${name}` : name];
  return v ? { [name]: v } : {};
};
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
    DATABASE_URL: pick("STG_DATABASE_URL", "STAGING_DATABASE_URL"),
    DATABASE_CA_CERT: need("STAGING_DATABASE_CA_CERT"),
    DATABASE_POOL_MAX: "3",
    BETTER_AUTH_SECRET: pick("STG_BETTER_AUTH_SECRET", "STAGING_BETTER_AUTH_SECRET"),
    BETTER_AUTH_URL: `https://${DOMAIN}`,
    // GitHub OAuth apps accept one callback domain: staging needs its own app (STG_GITHUB_CLIENT_*).
    GITHUB_CLIENT_ID:
      process.env.STG_GITHUB_CLIENT_ID && STAGING
        ? need("STG_GITHUB_CLIENT_ID")
        : need("GITHUB_CLIENT_ID"),
    GITHUB_CLIENT_SECRET:
      process.env.STG_GITHUB_CLIENT_SECRET && STAGING
        ? need("STG_GITHUB_CLIENT_SECRET")
        : need("GITHUB_CLIENT_SECRET"),
    DELIVERY_TOKEN_KEY: pick("STG_DELIVERY_TOKEN_KEY", "STAGING_DELIVERY_TOKEN_KEY"),
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://s3.fr-par.scw.cloud",
    S3_REGION: "fr-par",
    S3_BUCKET: BUCKET,
    S3_ACCESS_KEY_ID: need("SCW_ACCESS_KEY"),
    S3_SECRET_ACCESS_KEY: need("SCW_SECRET_KEY"),
    DAILY_COST_CAP_EUR: STAGING ? "20" : "100",
    USER_DAILY_BUILDS: "10",
    ...optional("OPS_ADMIN_EMAILS"),
    ...optional("VERCEL_INTEGRATION_SLUG"),
    ...optional("VERCEL_INTEGRATION_CLIENT_ID"),
    ...optional("VERCEL_INTEGRATION_CLIENT_SECRET"),
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
