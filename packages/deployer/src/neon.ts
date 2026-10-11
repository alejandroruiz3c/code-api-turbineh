import { safeMessage } from "./vercel.js";

const API = "https://console.neon.tech/api/v2";

/** Neon project in the EU (Frankfurt) with its connection string; waits until it accepts connections. */
export async function createNeonDatabase(
  apiKey: string,
  name: string,
): Promise<{ projectId: string; connectionUri: string; region: string }> {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Neon ${res.status}: ${safeMessage(text)}`);
    return JSON.parse(text) as T;
  };
  const region = "aws-eu-central-1";
  // Personal API keys need the organization explicitly; organization keys infer it.
  const orgs = await call<{ organizations?: { id: string }[] }>(
    "GET",
    "/users/me/organizations",
  ).catch(() => ({
    organizations: [],
  }));
  const orgId = orgs.organizations?.[0]?.id;
  const created = await call<{
    project: { id: string };
    connection_uris?: { connection_uri: string }[];
    operations?: { id: string }[];
  }>("POST", "/projects", {
    project: { name, region_id: region, pg_version: 17, ...(orgId ? { org_id: orgId } : {}) },
  });
  const raw = created.connection_uris?.[0]?.connection_uri;
  if (!raw) throw new Error("Neon did not return a connection string");
  // Keep TLS (sslmode=require); drop channel_binding, which not every Postgres driver accepts.
  const parsed = new URL(raw);
  parsed.searchParams.delete("channel_binding");
  if (!parsed.searchParams.has("sslmode")) parsed.searchParams.set("sslmode", "require");
  const uri = parsed.toString();
  for (let i = 0; i < 60; i++) {
    const ops = await call<{ operations: { status: string }[] }>(
      "GET",
      `/projects/${created.project.id}/operations`,
    );
    if (ops.operations.every((o) => o.status === "finished")) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { projectId: created.project.id, connectionUri: uri, region };
}
