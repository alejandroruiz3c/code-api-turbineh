import { createHmac } from "node:crypto";
import { consentPage, form, token, type Handler, type MockRequest, type Reply } from "./common";

/**
 * Meta Graph API mock, recorded from developers.facebook.com (Graph API v26.0, 2026-10). Paths carry the version prefix
 * (/vNN.0/…); the dialog is served for META_AUTH_BASE_URL too.
 *  - Facebook Login: GET /dialog/oauth (scope or config_id), GET /oauth/access_token (code → short-lived token;
 *    grant_type=fb_exchange_token → long-lived), DELETE /{user-id}/permissions → { success: true }.
 *  - GET /me, GET /me/accounts (Pages with access_token and instagram_business_account).
 *  - Pages: POST /{page-id}/feed (message) → { id: "<page>_<post>" }; POST /{page-id}/photos (url, caption) →
 *    { id, post_id }.
 *  - Instagram: POST /{ig-user-id}/media (image_url, caption) → { id }; GET /{container}?fields=status_code;
 *    POST /{ig-user-id}/media_publish (creation_id) → { id }.
 *  - Metrics: GET /{post-id}?fields=shares,reactions.summary(total_count)…,comments.summary(total_count)…;
 *    GET /{ig-media-id}?fields=like_count,comments_count; GET /{ig-media-id}/insights?metric=views,shares.
 * The access token travels as `access_token` (query or form) with `appsecret_proof` (HMAC-SHA256 of the token with
 * the app secret), which this mock verifies. Errors: { error: { message, type, code, error_subcode, fbtrace_id } }.
 */
export interface MetaMockOptions {
  appId: string;
  appSecret: string;
}

const err = (status: number, code: number, message: string, type = "OAuthException"): Reply => ({
  status,
  json: { error: { message, type, code, fbtrace_id: "AmockTrace" } },
});

const USER = { id: "fb-user-1", name: "Grace Hopper" };
const PAGE = { id: "page-1", name: "Sunny Bakery" };
const IG = { id: "ig-1", username: "sunnybakery" };

export function metaMock(o: MetaMockOptions): Handler {
  const codes = new Map<string, { redirect: string }>();
  const shortTokens = new Set<string>();
  const userTokens = new Set<string>();
  const pageTokens = new Set<string>();
  const containers = new Map<string, { caption: string; image: string }>();
  const fbPosts = new Set<string>();
  const igMedia = new Set<string>();
  let seq = 0;

  const params = (req: MockRequest) => ({
    ...req.query,
    ...(req.method === "POST" ? form(req.body) : {}),
  });
  const proofOk = (p: Record<string, string>) =>
    p.appsecret_proof ===
    createHmac("sha256", o.appSecret)
      .update(p.access_token ?? "")
      .digest("hex");

  return (req) => {
    const m = /^\/v\d+\.\d+(\/.*)$/.exec(req.path);
    if (!m) return err(400, 2500, "Unknown path components");
    const path = m[1] as string;
    const p = params(req);
    if (req.method === "GET" && path === "/dialog/oauth") {
      if (p.client_id !== o.appId || !p.redirect_uri || !p.state || p.response_type !== "code")
        return { status: 400, html: "Invalid App ID or redirect" };
      if (!p.config_id && !(p.scope ?? "").split(",").includes("pages_manage_posts"))
        return { status: 400, html: "missing scope" };
      const code = token("fb-code");
      codes.set(code, { redirect: p.redirect_uri });
      return consentPage(p.redirect_uri, p.state, code, "Facebook: allow access to your Pages?");
    }
    if (req.method === "GET" && path === "/oauth/access_token") {
      if (p.client_id !== o.appId || p.client_secret !== o.appSecret)
        return err(400, 1, "Error validating client secret.");
      if (p.grant_type === "fb_exchange_token") {
        if (!shortTokens.has(p.fb_exchange_token ?? ""))
          return err(400, 190, "Invalid OAuth access token.");
        const long = token("fb-user-long");
        userTokens.add(long);
        return {
          status: 200,
          json: { access_token: long, token_type: "bearer", expires_in: 5183944 },
        };
      }
      const c = codes.get(p.code ?? "");
      if (!c || c.redirect !== p.redirect_uri)
        return err(
          400,
          100,
          "Error validating verification code. Please make sure your redirect_uri is identical",
        );
      codes.delete(p.code ?? "");
      const short = token("fb-user-short");
      shortTokens.add(short);
      return { status: 200, json: { access_token: short, token_type: "bearer", expires_in: 5183 } };
    }
    const tok = p.access_token ?? "";
    const isUser = userTokens.has(tok);
    const isPage = pageTokens.has(tok);
    if (!isUser && !isPage)
      return err(400, 190, "Invalid OAuth access token - Cannot parse access token");
    if (!proofOk(p))
      return err(
        400,
        100,
        "Invalid appsecret_proof provided in the API argument",
        "GraphMethodException",
      );
    if (req.method === "GET" && path === "/me") return { status: 200, json: USER };
    if (req.method === "GET" && path === "/me/accounts") {
      if (!isUser) return err(400, 100, "Tried accessing nonexisting field (accounts)");
      const pageToken = token("fb-page");
      pageTokens.add(pageToken);
      return {
        status: 200,
        json: {
          data: [
            {
              id: PAGE.id,
              name: PAGE.name,
              access_token: pageToken,
              category: "Bakery",
              category_list: [{ id: "1", name: "Bakery" }],
              tasks: ["ANALYZE", "ADVERTISE", "MODERATE", "CREATE_CONTENT", "MANAGE"],
              instagram_business_account: { id: IG.id, username: IG.username },
            },
          ],
          paging: { cursors: { before: "b", after: "a" } },
        },
      };
    }
    if (req.method === "DELETE" && path === `/${USER.id}/permissions`) {
      if (!isUser) return err(400, 100, "A user access token is required");
      userTokens.clear();
      pageTokens.clear();
      return { status: 200, json: { success: true } };
    }
    if (req.method === "POST" && path === `/${PAGE.id}/feed`) {
      if (!isPage)
        return err(
          403,
          200,
          "(#200) The user hasn't authorized the application to perform this action",
        );
      if (!p.message) return err(400, 100, "(#100) The parameter message or link is required");
      const id = `${PAGE.id}_${1000 + ++seq}`;
      fbPosts.add(id);
      return { status: 200, json: { id } };
    }
    if (req.method === "POST" && path === `/${PAGE.id}/photos`) {
      if (!isPage) return err(403, 200, "(#200) Permissions error");
      if (!/^https:\/\//.test(p.url ?? "")) return err(400, 324, "(#324) Requires upload file");
      const n = 1000 + ++seq;
      fbPosts.add(`${PAGE.id}_${n}`);
      return { status: 200, json: { id: `photo-${n}`, post_id: `${PAGE.id}_${n}` } };
    }
    if (req.method === "POST" && path === `/${IG.id}/media`) {
      if (!isPage)
        return err(403, 10, "(#10) Application does not have permission for this action");
      if (!/^https:\/\//.test(p.image_url ?? ""))
        return err(400, 9004, "Only photo or video can be accepted as media type.");
      if ([...(p.caption ?? "")].length > 2200)
        return err(400, 100, "(#100) The caption is too long");
      const id = `container-${++seq}`;
      containers.set(id, { caption: p.caption ?? "", image: p.image_url ?? "" });
      return { status: 200, json: { id } };
    }
    if (req.method === "POST" && path === `/${IG.id}/media_publish`) {
      if (!isPage)
        return err(403, 10, "(#10) Application does not have permission for this action");
      if (!containers.has(p.creation_id ?? ""))
        return err(400, 9007, "The media is not ready for publishing");
      containers.delete(p.creation_id ?? "");
      const id = `1789${String(++seq).padStart(10, "0")}`;
      igMedia.add(id);
      return { status: 200, json: { id } };
    }
    const id = path.slice(1).split("/")[0] ?? "";
    if (req.method === "GET" && containers.has(id) && p.fields === "status_code")
      return { status: 200, json: { status_code: "FINISHED", id } };
    if (req.method === "GET" && fbPosts.has(id) && !path.endsWith("/insights"))
      return {
        status: 200,
        json: {
          id,
          shares: { count: 2 },
          reactions: { data: [], summary: { total_count: 9, viewer_reaction: "NONE" } },
          comments: { data: [], summary: { order: "ranked", total_count: 5, can_comment: true } },
        },
      };
    if (req.method === "GET" && igMedia.has(id) && path === `/${id}`)
      return { status: 200, json: { id, like_count: 21, comments_count: 6 } };
    if (req.method === "GET" && igMedia.has(id) && path === `/${id}/insights`) {
      const metrics = (p.metric ?? "").split(",");
      if (metrics.includes("impressions"))
        return err(
          400,
          100,
          "(#100) impressions metric is no longer supported for media created after July 2, 2024",
        );
      const values: Record<string, number> = { views: 340, shares: 4, reach: 290 };
      return {
        status: 200,
        json: {
          data: metrics.map((name) => ({
            name,
            period: "lifetime",
            values: [{ value: values[name] ?? 0 }],
            title: name,
            id: `${id}/insights/${name}/lifetime`,
          })),
        },
      };
    }
    return err(
      400,
      100,
      `Unsupported ${req.method} request (mock: ${path})`,
      "GraphMethodException",
    );
  };
}
