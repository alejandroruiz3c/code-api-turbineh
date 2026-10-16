import { bearer, consentPage, form, json, token, type Handler, type Reply } from "./common";

/**
 * LinkedIn mock, recorded from LinkedIn's official docs (learn.microsoft.com/linkedin, 2026-10):
 *  - OAuth 2.0 3-legged: GET /oauth/v2/authorization, POST /oauth/v2/accessToken (form; access_token, expires_in
 *    5184000, scope; no refresh token unless the app has programmatic refresh). Served for LINKEDIN_AUTH_BASE_URL too.
 *  - GET /v2/userinfo (OpenID Connect: sub, name).
 *  - POST /rest/posts (Linkedin-Version: YYYYMM, X-Restli-Protocol-Version: 2.0.0) → 201, empty body, x-restli-id.
 *  - POST /rest/images?action=initializeUpload → value.uploadUrl + value.image; PUT the bytes to uploadUrl.
 *  - GET /rest/socialMetadata/{urn} → reactionSummaries, commentSummary.
 * Errors use LinkedIn's shape { status, serviceErrorCode, code, message }.
 */
export interface LinkedInMockOptions {
  clientId: string;
  clientSecret: string;
  member?: { sub: string; name: string };
}

const err = (status: number, code: string, message: string): Reply => ({
  status,
  json: { status, serviceErrorCode: status * 100, code, message },
});

export function linkedinMock(o: LinkedInMockOptions): Handler {
  const member = o.member ?? { sub: "li-member-1", name: "Ada Lovelace" };
  const codes = new Map<string, { redirect: string }>();
  const tokens = new Set<string>();
  const images = new Map<string, { uploaded: boolean }>();
  const posts = new Map<string, { commentary: string }>();
  let seq = 0;

  const restHeaders = (h: Record<string, string>) =>
    /^\d{6}$/.test(h["linkedin-version"] ?? "") && h["x-restli-protocol-version"] === "2.0.0";

  return (req, ctx) => {
    const { method, path } = req;
    if (method === "GET" && path === "/oauth/v2/authorization") {
      const q = req.query;
      if (q.response_type !== "code" || q.client_id !== o.clientId || !q.redirect_uri || !q.state)
        return { status: 400, html: "invalid_request" };
      if (!(q.scope ?? "").split(" ").includes("w_member_social"))
        return { status: 400, html: "missing scope" };
      const code = token("li-code");
      codes.set(code, { redirect: q.redirect_uri });
      return consentPage(q.redirect_uri, q.state, code, "LinkedIn: allow access?");
    }
    if (method === "POST" && path === "/oauth/v2/accessToken") {
      const f = form(req.body);
      if (f.client_id !== o.clientId || f.client_secret !== o.clientSecret)
        return {
          status: 401,
          json: { error: "invalid_client", error_description: "Client authentication failed" },
        };
      if (f.grant_type === "refresh_token")
        return {
          status: 400,
          json: {
            error: "invalid_request",
            error_description:
              "The provided authorization grant or refresh token is invalid, expired or revoked",
          },
        };
      const c = codes.get(f.code ?? "");
      if (f.grant_type !== "authorization_code" || !c || c.redirect !== f.redirect_uri)
        return {
          status: 400,
          json: {
            error: "invalid_request",
            error_description:
              "Unable to retrieve access token: appid/redirect uri/code verifier does not match authorization code",
          },
        };
      codes.delete(f.code ?? "");
      const access = token("li-access");
      tokens.add(access);
      return {
        status: 200,
        json: {
          access_token: access,
          expires_in: 5184000,
          scope: "openid,profile,w_member_social",
        },
      };
    }
    // Upload URLs handed out by initializeUpload.
    if (method === "PUT" && path.startsWith("/__upload/")) {
      const urn = `urn:li:image:${path.slice("/__upload/".length)}`;
      if (!tokens.has(bearer(req) ?? ""))
        return err(401, "EMPTY_ACCESS_TOKEN", "Invalid access token");
      if (!images.has(urn) || req.body.length === 0)
        return err(400, "INVALID_UPLOAD", "Unknown upload");
      images.set(urn, { uploaded: true });
      return { status: 201 };
    }
    if (!tokens.has(bearer(req) ?? ""))
      return err(401, "EMPTY_ACCESS_TOKEN", "Empty oauth2 access token");
    if (method === "GET" && path === "/v2/userinfo")
      return {
        status: 200,
        json: {
          sub: member.sub,
          name: member.name,
          given_name: member.name.split(" ")[0],
          locale: { country: "US", language: "en" },
        },
      };
    if (path.startsWith("/rest/") && !restHeaders(req.headers))
      return err(
        400,
        "VERSION_MISSING",
        "A version must be present. Please specify a version by adding the LinkedIn-Version header",
      );
    if (method === "POST" && path === "/rest/images" && req.query.action === "initializeUpload") {
      const b = json(req.body);
      const owner = (b?.initializeUploadRequest as { owner?: string } | undefined)?.owner;
      if (owner !== `urn:li:person:${member.sub}`)
        return err(403, "ACCESS_DENIED", "Not enough permissions to upload for this owner");
      const id = `C4D${++seq}`;
      images.set(`urn:li:image:${id}`, { uploaded: false });
      return {
        status: 200,
        json: {
          value: {
            uploadUrlExpiresAt: Date.now() + 3_600_000,
            uploadUrl: `${ctx.origin}/__upload/${id}`,
            image: `urn:li:image:${id}`,
          },
        },
      };
    }
    if (method === "POST" && path === "/rest/posts") {
      const b = json(req.body);
      if (!b) return err(400, "MALFORMED", "Body is not JSON");
      const missing = [
        "author",
        "commentary",
        "visibility",
        "distribution",
        "lifecycleState",
      ].filter((k) => b[k] === undefined);
      if (missing.length)
        return err(
          422,
          "MISSING_FIELD",
          `Field Value validation failed in REQUEST_BODY: Data Processing Exception while processing fields [/${missing[0]}]`,
        );
      if (b.author !== `urn:li:person:${member.sub}`)
        return err(403, "ACCESS_DENIED", "Not enough permissions to post as this author");
      const d = b.distribution as Record<string, unknown>;
      if (
        d?.feedDistribution !== "MAIN_FEED" ||
        !Array.isArray(d.targetEntities) ||
        !Array.isArray(d.thirdPartyDistributionChannels)
      )
        return err(422, "INVALID_FIELD", "distribution is invalid");
      if (
        b.lifecycleState !== "PUBLISHED" ||
        !["PUBLIC", "CONNECTIONS", "LOGGED_IN"].includes(String(b.visibility))
      )
        return err(422, "INVALID_FIELD", "lifecycleState/visibility invalid");
      if (typeof b.commentary !== "string" || [...b.commentary].length > 3000)
        return err(400, "FIELD_LENGTH_TOO_LONG", "commentary is too long");
      const media = (b.content as { media?: { id?: string } } | undefined)?.media;
      if (media && !images.get(media.id ?? "")?.uploaded)
        return err(422, "INVALID_URN_TYPE", "Image not uploaded");
      const urn = `urn:li:share:7${String(++seq).padStart(18, "0")}`;
      posts.set(urn, { commentary: b.commentary });
      return { status: 201, headers: { "x-restli-id": urn } };
    }
    if (method === "GET" && path.startsWith("/rest/socialMetadata/")) {
      const urn = decodeURIComponent(path.slice("/rest/socialMetadata/".length));
      if (!posts.has(urn)) return err(404, "NOT_FOUND", "Not found");
      return {
        status: 200,
        json: {
          reactionSummaries: {
            LIKE: { reactionType: "LIKE", count: 12 },
            PRAISE: { reactionType: "PRAISE", count: 3 },
          },
          commentSummary: { count: 4, topLevelCount: 3 },
          commentsState: "OPEN",
          entity: urn,
        },
      };
    }
    return err(404, "NOT_FOUND", `No mock for ${method} ${path}`);
  };
}
