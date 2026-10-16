import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startMock } from "../e2e/mocks/social/common";
import { linkedinMock } from "../e2e/mocks/social/linkedin";
import { metaMock } from "../e2e/mocks/social/meta";
import { xMock } from "../e2e/mocks/social/x";
import { ProviderError } from "@/social/http";
import type { FetchMedia } from "@/social/media";
import {
  accountsFor,
  authorizeUrl,
  exchangeCode,
  pkcePair,
  type ConnectedAccount,
} from "@/social/oauth";
import { publishTo } from "@/social/publishers";

/**
 * Contract tests of publishing (social.publish.turbineh) against the LinkedIn, Meta Graph and X mocks, which check
 * every request the way the documented endpoint does (headers, URNs, fields, uploaded media, tokens) and record it.
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
const jpeg: FetchMedia = async () => ({
  bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]),
  contentType: "image/jpeg",
});
const deps = () => ({ env, fetchMedia: jpeg, pollMs: 1, pollTimes: 3 });

type MockReq = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
};
const requests = async (base: string): Promise<MockReq[]> =>
  (await fetch(`${base}/__mock/requests`)).json() as Promise<MockReq[]>;

async function connect(provider: "linkedin" | "meta" | "x") {
  const pkce = pkcePair();
  const html = await (
    await fetch(authorizeUrl(provider, { state: "s", challenge: pkce.challenge }, env))
  ).text();
  const code =
    new URL(
      (/id="allow" href="([^"]+)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&"),
    ).searchParams.get("code") ?? "";
  const tokens = await exchangeCode(provider, { code, verifier: pkce.verifier }, env);
  for (const a of await accountsFor(provider, tokens, env)) accounts[a.network] = a;
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
  await connect("linkedin");
  await connect("meta");
  await connect("x");
});
afterAll(() => {
  for (const s of servers) s.close();
});

const input = (
  network: "linkedin" | "facebook" | "instagram" | "x",
  text: string,
  imageUrl: string | null = null,
) => {
  const a = accounts[network] as ConnectedAccount;
  return { network, token: a.accessToken, accountId: a.accountId, text, imageUrl };
};

describe("LinkedIn Posts API contract", () => {
  it("LinkedIn: POST /rest/posts with Linkedin-Version and Rest.li 2.0 headers, author urn:li:person, little-text commentary; the post URN comes from x-restli-id", async () => {
    const out = await publishTo(input("linkedin", "Fresh bread (today) #Bakery"), deps());
    expect(out.externalId).toMatch(/^urn:li:share:\d+$/);
    expect(out.externalUrl).toBe(`https://www.linkedin.com/feed/update/${out.externalId}/`);
    const sent = (await requests(env.LINKEDIN_API_BASE as string))
      .filter((r) => r.path === "/rest/posts")
      .at(-1) as MockReq;
    expect(sent.headers["linkedin-version"]).toBe("202609");
    expect(sent.headers["x-restli-protocol-version"]).toBe("2.0.0");
    expect(JSON.parse(sent.body)).toEqual({
      author: "urn:li:person:li-member-1",
      commentary: "Fresh bread \\(today\\) {hashtag|\\#|Bakery}",
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
  });

  it("LinkedIn with an image: Images API initializeUpload, PUT of the bytes, then the post with content.media.id", async () => {
    const out = await publishTo(
      input("linkedin", "With a photo", "https://cdn.example.com/bread.jpg"),
      deps(),
    );
    expect(out.externalId).toMatch(/^urn:li:share:/);
    const log = await requests(env.LINKEDIN_API_BASE as string);
    const init = log.filter((r) => r.path === "/rest/images").at(-1) as MockReq;
    expect(init.query.action).toBe("initializeUpload");
    expect(JSON.parse(init.body)).toEqual({
      initializeUploadRequest: { owner: "urn:li:person:li-member-1" },
    });
    expect(log.some((r) => r.method === "PUT" && r.path.startsWith("/__upload/"))).toBe(true);
    const post = JSON.parse((log.filter((r) => r.path === "/rest/posts").at(-1) as MockReq).body);
    expect(post.content.media.id).toMatch(/^urn:li:image:/);
  });

  it("LinkedIn: a request the API refuses (unsupported version header) is a non-retryable error", async () => {
    const err = await publishTo(input("linkedin", "x"), {
      ...deps(),
      env: { ...env, LINKEDIN_VERSION: "latest" },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).retryable).toBe(false);
  });
});

describe("Meta Graph API contract", () => {
  it("Facebook Page: POST /{page-id}/feed with message and the Page token (appsecret_proof) → page_post id; with an image POST /{page-id}/photos", async () => {
    const text = await publishTo(input("facebook", "Open on Sunday"), deps());
    expect(text.externalId).toMatch(/^page-1_\d+$/);
    const photo = await publishTo(
      input("facebook", "New cake", "https://cdn.example.com/cake.jpg"),
      deps(),
    );
    expect(photo.externalId).toMatch(/^page-1_\d+$/);
    const log = await requests(env.META_GRAPH_API_BASE as string);
    const feed = log.find((r) => r.path === "/v26.0/page-1/feed") as MockReq;
    const form = new URLSearchParams(feed.body);
    expect(form.get("message")).toBe("Open on Sunday");
    expect(form.get("access_token")).toBe(accounts.facebook?.accessToken);
    expect(form.get("appsecret_proof")).toMatch(/^[0-9a-f]{64}$/);
    const photos = new URLSearchParams(
      (log.find((r) => r.path === "/v26.0/page-1/photos") as MockReq).body,
    );
    expect([photos.get("url"), photos.get("caption")]).toEqual([
      "https://cdn.example.com/cake.jpg",
      "New cake",
    ]);
  });

  it("Instagram: container POST /{ig-user-id}/media (image_url, caption), status FINISHED, then POST /media_publish (creation_id)", async () => {
    const out = await publishTo(
      input("instagram", "Croissants #bakery", "https://cdn.example.com/c.jpg"),
      deps(),
    );
    expect(out.externalId).toMatch(/^1789\d+$/);
    const log = await requests(env.META_GRAPH_API_BASE as string);
    const media = new URLSearchParams(
      (log.find((r) => r.path === "/v26.0/ig-1/media") as MockReq).body,
    );
    expect([media.get("image_url"), media.get("caption")]).toEqual([
      "https://cdn.example.com/c.jpg",
      "Croissants #bakery",
    ]);
    const publish = new URLSearchParams(
      (log.find((r) => r.path === "/v26.0/ig-1/media_publish") as MockReq).body,
    );
    expect(publish.get("creation_id")).toMatch(/^container-/);
    await expect(publishTo(input("instagram", "no image"), deps())).rejects.toMatchObject({
      code: "image",
    });
  });

  it("Meta throttling (code 4 / 32 / 613) is retryable", async () => {
    await fetch(`${env.META_GRAPH_API_BASE}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({
        match: "POST /v26.0/page-1/feed",
        status: 400,
        times: 1,
        json: {
          error: { message: "(#32) Page request limit reached", type: "OAuthException", code: 32 },
        },
      }),
    });
    const err = (await publishTo(input("facebook", "throttled"), deps()).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect([err.code, err.retryable]).toEqual(["32", true]);
  });
});

describe("X API v2 contract", () => {
  it("X: POST /2/tweets {text} with the user token → 201 data.id; with an image, POST /2/media/upload (multipart, tweet_image) then media.media_ids", async () => {
    const out = await publishTo(input("x", "Hot bread now"), deps());
    expect(out.externalId).toMatch(/^19\d+$/);
    expect(out.externalUrl).toBe(`https://x.com/i/web/status/${out.externalId}`);
    const withImage = await publishTo(
      input("x", "Look at this loaf", "https://cdn.example.com/loaf.jpg"),
      deps(),
    );
    const log = await requests(env.X_API_BASE as string);
    expect(log.find((r) => r.path === "/2/media/upload")?.headers["content-type"]).toMatch(
      /^multipart\/form-data/,
    );
    const tweets = log
      .filter((r) => r.path === "/2/tweets" && r.method === "POST")
      .map((r) => JSON.parse(r.body));
    expect(tweets[0]).toEqual({ text: "Hot bread now" });
    expect(tweets[1].media.media_ids).toHaveLength(1);
    expect(withImage.externalId).not.toBe(out.externalId);
  });

  it("X: 429 carries the reset time (retryable with that wait); duplicate content (403) is not retried", async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    await fetch(`${env.X_API_BASE}/__mock/fail`, {
      method: "POST",
      body: JSON.stringify({
        match: "POST /2/tweets",
        status: 429,
        times: 1,
        json: { title: "Too Many Requests", detail: "Too Many Requests", status: 429 },
        headers: { "x-rate-limit-reset": String(reset) },
      }),
    });
    const limited = (await publishTo(input("x", "rate limited"), deps()).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(limited.retryable).toBe(true);
    expect(limited.retryAfterMs).toBeGreaterThan(500_000);
    const dup = (await publishTo(input("x", "Hot bread now"), deps()).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect([dup.status, dup.retryable]).toEqual([403, false]);
  });
});
