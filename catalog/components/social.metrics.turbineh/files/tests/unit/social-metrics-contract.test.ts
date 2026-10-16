import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMock } from "../e2e/mocks/social/common";
import { linkedinMock } from "../e2e/mocks/social/linkedin";
import { metaMock } from "../e2e/mocks/social/meta";
import { xMock } from "../e2e/mocks/social/x";
import { ProviderError } from "@/social/http";
import { fetchMetrics } from "@/social/metrics-api";
import {
  accountsFor,
  authorizeUrl,
  exchangeCode,
  pkcePair,
  type ConnectedAccount,
} from "@/social/oauth";
import { publishTo } from "@/social/publishers";

/**
 * Contract tests of engagement metrics (social.metrics.turbineh) against the LinkedIn, Meta Graph and X mocks: each
 * network's documented read endpoint and fields, and null (not 0) for what a network does not report.
 */
const servers: Server[] = [];
const env: Record<string, string> = {
  APP_URL: "https://app.example.com",
  LINKEDIN_CLIENT_ID: "li-id",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  META_APP_ID: "meta-id",
  META_APP_SECRET: "meta-secret",
  X_CLIENT_ID: "x-id",
  X_CLIENT_SECRET: "x-secret",
};
const accounts: Record<string, ConnectedAccount> = {};

async function connect(provider: "linkedin" | "meta" | "x") {
  const pkce = pkcePair();
  const html = await (
    await fetch(authorizeUrl(provider, { state: "s", challenge: pkce.challenge }, env))
  ).text();
  const code =
    new URL(
      (/id="allow" href="([^"]+)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&"),
    ).searchParams.get("code") ?? "";
  for (const a of await accountsFor(
    provider,
    await exchangeCode(provider, { code, verifier: pkce.verifier }, env),
    env,
  ))
    accounts[a.network] = a;
}

beforeAll(async () => {
  const mocks: [Parameters<typeof startMock>[0], string[]][] = [
    [
      linkedinMock({ clientId: "li-id", clientSecret: "li-secret" }),
      ["LINKEDIN_API_BASE", "LINKEDIN_AUTH_BASE_URL"],
    ],
    [
      metaMock({ appId: "meta-id", appSecret: "meta-secret" }),
      ["META_GRAPH_API_BASE", "META_AUTH_BASE_URL"],
    ],
    [xMock({ clientId: "x-id", clientSecret: "x-secret" }), ["X_API_BASE", "X_AUTH_BASE_URL"]],
  ];
  for (const [handler, vars] of mocks) {
    const s = await startMock(handler, 0);
    servers.push(s);
    const a = s.address();
    for (const v of vars) env[v] = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  }
  for (const p of ["linkedin", "meta", "x"] as const) await connect(p);
});
afterAll(() => {
  for (const s of servers) s.close();
});

async function published(network: "linkedin" | "facebook" | "instagram" | "x") {
  const a = accounts[network] as ConnectedAccount;
  const out = await publishTo(
    {
      network,
      token: a.accessToken,
      accountId: a.accountId,
      text: `metrics ${network}`,
      imageUrl: network === "instagram" ? "https://cdn.example.com/a.jpg" : null,
    },
    { env, pollMs: 1 },
  );
  return { token: a.accessToken, id: out.externalId };
}

describe("engagement metrics per network", () => {
  it("fetches likes, comments, shares and impressions per published post where each network's API gives them (null otherwise)", async () => {
    const li = await published("linkedin");
    expect(await fetchMetrics("linkedin", li.token, li.id, { env })).toEqual({
      likes: 15,
      comments: 4,
      shares: null,
      impressions: null,
    });
    const fb = await published("facebook");
    expect(await fetchMetrics("facebook", fb.token, fb.id, { env })).toEqual({
      likes: 9,
      comments: 5,
      shares: 2,
      impressions: null,
    });
    const ig = await published("instagram");
    expect(await fetchMetrics("instagram", ig.token, ig.id, { env })).toEqual({
      likes: 21,
      comments: 6,
      shares: 4,
      impressions: 340,
    });
    const x = await published("x");
    expect(await fetchMetrics("x", x.token, x.id, { env })).toEqual({
      likes: 15,
      comments: 2,
      shares: 4,
      impressions: 512,
    });
  });

  it("uses each network's documented read endpoint and fields", async () => {
    const reqs = async (base: string) =>
      (await (await fetch(`${base}/__mock/requests`)).json()) as {
        method: string;
        path: string;
        query: Record<string, string>;
        headers: Record<string, string>;
      }[];
    const li = (await reqs(env.LINKEDIN_API_BASE as string)).find((r) =>
      r.path.startsWith("/rest/socialMetadata/"),
    );
    expect(li?.path).toMatch(/^\/rest\/socialMetadata\/urn%3Ali%3Ashare%3A\d+$/);
    expect(li?.headers["linkedin-version"]).toBe("202609");
    const meta = await reqs(env.META_GRAPH_API_BASE as string);
    expect(meta.find((r) => /^\/v26\.0\/page-1_\d+$/.test(r.path))?.query.fields).toBe(
      "shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
    );
    expect(meta.find((r) => r.path.endsWith("/insights"))?.query.metric).toBe("views,shares");
    const x = (await reqs(env.X_API_BASE as string)).find(
      (r) => r.method === "GET" && r.path === "/2/tweets",
    );
    expect(x?.query["tweet.fields"]).toBe("public_metrics");
  });

  it("a refused token is reported as unauthorized (the connection is then marked expired)", async () => {
    const err = (await fetchMetrics("x", "not-a-token", "1", { env }).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.unauthorized).toBe(true);
  });
});
