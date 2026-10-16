import { createHash } from "node:crypto";
import { bearer, consentPage, form, json, token, type Handler, type Reply } from "./common";

/**
 * X API v2 mock, recorded from docs.x.com (2026-10):
 *  - OAuth 2.0 Authorization Code with PKCE: GET /i/oauth2/authorize (served for X_AUTH_BASE_URL too; S256 only here),
 *    POST /2/oauth2/token (form; confidential client = HTTP Basic; authorization_code with code_verifier, or
 *    refresh_token — refresh tokens rotate), POST /2/oauth2/revoke (token). Access tokens: expires_in 7200.
 *  - GET /2/users/me → { data: { id, name, username } }.
 *  - POST /2/tweets { text, media?: { media_ids } } → 201 { data: { id, text, edit_history_tweet_ids } }; duplicate
 *    text → 403.
 *  - POST /2/media/upload (multipart: media, media_category=tweet_image) → { data: { id, media_key, … } }.
 *  - GET /2/tweets?ids=…&tweet.fields=public_metrics → data[].public_metrics.
 * Errors: problem details { title, detail, type, status }; 429 carries x-rate-limit-* headers.
 */
export interface XMockOptions {
  clientId: string;
  clientSecret: string;
}

const problem = (status: number, title: string, detail: string): Reply => ({
  status,
  json: { title, detail, type: "about:blank", status },
});

export function xMock(o: XMockOptions): Handler {
  const codes = new Map<string, { redirect: string; challenge: string }>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const tweets = new Map<string, string>();
  const media = new Set<string>();
  let seq = 0;
  const basicOk = (h: string | undefined) =>
    h ===
    `Basic ${Buffer.from(`${encodeURIComponent(o.clientId)}:${encodeURIComponent(o.clientSecret)}`).toString("base64")}`;
  const issue = () => {
    const a = token("x-access");
    const r = token("x-refresh");
    access.add(a);
    refresh.add(r);
    return {
      status: 200,
      json: {
        token_type: "bearer",
        expires_in: 7200,
        access_token: a,
        scope: "tweet.read tweet.write users.read media.write offline.access",
        refresh_token: r,
      },
    };
  };

  return (req) => {
    const { method, path } = req;
    if (method === "GET" && path === "/i/oauth2/authorize") {
      const q = req.query;
      if (q.response_type !== "code" || q.client_id !== o.clientId || !q.redirect_uri || !q.state)
        return { status: 400, html: "invalid_request" };
      if (q.code_challenge_method !== "S256" || !q.code_challenge)
        return { status: 400, html: "PKCE required" };
      const scopes = (q.scope ?? "").split(" ");
      if (!scopes.includes("tweet.write") || !scopes.includes("offline.access"))
        return { status: 400, html: "missing scope" };
      const code = token("x-code");
      codes.set(code, { redirect: q.redirect_uri, challenge: q.code_challenge });
      return consentPage(q.redirect_uri, q.state, code, "X: authorize app?");
    }
    if (method === "POST" && path === "/2/oauth2/token") {
      if (!basicOk(req.headers.authorization))
        return {
          status: 401,
          json: {
            error: "unauthorized_client",
            error_description: "Missing valid authorization header",
          },
        };
      const f = form(req.body);
      if (f.grant_type === "refresh_token") {
        if (!refresh.delete(f.refresh_token ?? ""))
          return {
            status: 400,
            json: {
              error: "invalid_request",
              error_description: "Value passed for the token was invalid.",
            },
          };
        return issue();
      }
      const c = codes.get(f.code ?? "");
      const verifierOk =
        c &&
        createHash("sha256")
          .update(f.code_verifier ?? "")
          .digest("base64url") === c.challenge;
      if (
        f.grant_type !== "authorization_code" ||
        !c ||
        c.redirect !== f.redirect_uri ||
        !verifierOk
      )
        return {
          status: 400,
          json: {
            error: "invalid_request",
            error_description: "Value passed for the authorization code was invalid.",
          },
        };
      codes.delete(f.code ?? "");
      return issue();
    }
    if (method === "POST" && path === "/2/oauth2/revoke") {
      if (!basicOk(req.headers.authorization))
        return { status: 401, json: { error: "unauthorized_client" } };
      const t = form(req.body).token ?? "";
      access.delete(t);
      refresh.delete(t);
      return { status: 200, json: { revoked: true } };
    }
    if (!access.has(bearer(req) ?? "")) return problem(401, "Unauthorized", "Unauthorized");
    if (method === "GET" && path === "/2/users/me")
      return {
        status: 200,
        json: { data: { id: "x-user-1", name: "Sunny Bakery", username: "sunnybakery" } },
      };
    if (method === "POST" && path === "/2/media/upload") {
      const ct = req.headers["content-type"] ?? "";
      if (
        !ct.startsWith("multipart/form-data") ||
        !/name="media_category"\r\n\r\ntweet_image/.test(req.body) ||
        !/name="media"/.test(req.body)
      )
        return problem(
          400,
          "Invalid Request",
          "One or more parameters to your request was invalid.",
        );
      const id = `18${String(++seq).padStart(17, "0")}`;
      media.add(id);
      return {
        status: 200,
        json: {
          data: { id, media_key: `3_${id}`, size: req.body.length, expires_after_secs: 86400 },
        },
      };
    }
    if (method === "POST" && path === "/2/tweets") {
      const b = json(req.body);
      const text = typeof b?.text === "string" ? b.text : "";
      if (!text && !b?.media)
        return problem(
          400,
          "Invalid Request",
          "One or more parameters to your request was invalid.",
        );
      const ids = ((b?.media as { media_ids?: string[] } | undefined)?.media_ids ?? []) as string[];
      if (ids.some((i) => !media.has(i)))
        return problem(400, "Invalid Request", "Your media IDs are invalid.");
      if ([...tweets.values()].includes(text))
        return problem(
          403,
          "Forbidden",
          "You are not allowed to create a Tweet with duplicate content.",
        );
      const id = `19${String(++seq).padStart(17, "0")}`;
      tweets.set(id, text);
      return { status: 201, json: { data: { id, text, edit_history_tweet_ids: [id] } } };
    }
    if (method === "GET" && path === "/2/tweets") {
      const fields = req.query["tweet.fields"] ?? req.query["post.fields"] ?? "";
      const ids = (req.query.ids ?? "").split(",").filter((i) => tweets.has(i));
      return {
        status: 200,
        json: {
          data: ids.map((id) => ({
            id,
            text: tweets.get(id),
            ...(fields.includes("public_metrics")
              ? {
                  public_metrics: {
                    retweet_count: 3,
                    reply_count: 2,
                    like_count: 15,
                    quote_count: 1,
                    bookmark_count: 0,
                    impression_count: 512,
                  },
                }
              : {}),
          })),
        },
      };
    }
    return problem(404, "Not Found Error", `No mock for ${method} ${path}`);
  };
}
