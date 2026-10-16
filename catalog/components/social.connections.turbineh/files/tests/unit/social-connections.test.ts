import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken, parseKey, TokenKeyError } from "@/social/crypto";
import { ProviderError, providerReason, redact } from "@/social/http";
import { authorizeUrl, pkcePair } from "@/social/oauth";
import { SCOPES } from "@/social/networks";

/**
 * Social connections (social.connections.turbineh), without a database or network: token encryption at rest, the
 * OAuth URLs each provider documents, PKCE, and how provider errors are classified and cleaned before storage.
 */
const key = randomBytes(32);
const binding = {
  organizationId: "org-1",
  network: "x",
  accountId: "x-user-1",
  kind: "access" as const,
};
const env = {
  APP_URL: "https://app.example.com",
  LINKEDIN_CLIENT_ID: "li-id",
  LINKEDIN_CLIENT_SECRET: "li-secret",
  META_APP_ID: "meta-id",
  META_APP_SECRET: "meta-secret",
  X_CLIENT_ID: "x-id",
  X_CLIENT_SECRET: "x-secret",
};

describe("tokens are encrypted at rest", () => {
  it("social tokens are stored encrypted with AES-256-GCM: the ciphertext never contains the token and decrypts only with the key and its own row", () => {
    const plain = `x-access-${randomBytes(12).toString("hex")}`;
    const sealed = encryptToken(plain, binding, key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(plain);
    expect(encryptToken(plain, binding, key)).not.toBe(sealed); // fresh IV every time
    expect(decryptToken(sealed, binding, [key])).toBe(plain);
    // Another key, another workspace, another account or another kind of token: refused.
    expect(() => decryptToken(sealed, binding, [randomBytes(32)])).toThrow(TokenKeyError);
    expect(() => decryptToken(sealed, { ...binding, organizationId: "org-2" }, [key])).toThrow(
      TokenKeyError,
    );
    expect(() => decryptToken(sealed, { ...binding, accountId: "other" }, [key])).toThrow(
      TokenKeyError,
    );
    expect(() => decryptToken(sealed, { ...binding, kind: "refresh" }, [key])).toThrow(
      TokenKeyError,
    );
    // A tampered ciphertext is refused (authenticated encryption).
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[3] as string, "base64url");
    ct[0] = (ct[0] ?? 0) ^ 1;
    expect(() =>
      decryptToken([parts[0], parts[1], parts[2], ct.toString("base64url")].join("."), binding, [
        key,
      ]),
    ).toThrow(TokenKeyError);
  });

  it("a rotated key still decrypts through the previous key; the key must be 32 bytes", () => {
    const old = randomBytes(32);
    const sealed = encryptToken("t", binding, old);
    expect(decryptToken(sealed, binding, [key, old])).toBe("t");
    expect(parseKey(key.toString("base64"))?.equals(key)).toBe(true);
    expect(parseKey(key.toString("hex"))?.equals(key)).toBe(true);
    expect(parseKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseKey("")).toBeNull();
  });
});

describe("OAuth 2.0 per provider", () => {
  it("X uses Authorization Code with PKCE (S256); LinkedIn and Meta use the authorization code flow with the documented scopes", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));

    const x = new URL(authorizeUrl("x", { state: "s1", challenge }, env));
    expect(`${x.origin}${x.pathname}`).toBe("https://x.com/i/oauth2/authorize");
    expect(Object.fromEntries(x.searchParams)).toMatchObject({
      response_type: "code",
      client_id: "x-id",
      redirect_uri: "https://app.example.com/api/social/oauth/x/callback",
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "tweet.read tweet.write users.read media.write offline.access",
    });
    expect(() => authorizeUrl("x", { state: "s1" }, env)).toThrow(/PKCE/);

    const li = new URL(authorizeUrl("linkedin", { state: "s2" }, env));
    expect(`${li.origin}${li.pathname}`).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(li.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(li.searchParams.get("code_challenge")).toBeNull();

    const meta = new URL(authorizeUrl("meta", { state: "s3" }, env));
    expect(`${meta.origin}${meta.pathname}`).toBe("https://www.facebook.com/v26.0/dialog/oauth");
    expect(meta.searchParams.get("scope")).toBe(SCOPES.meta.join(","));
    const business = new URL(
      authorizeUrl("meta", { state: "s3" }, { ...env, META_LOGIN_CONFIG_ID: "cfg-1" }),
    );
    expect(business.searchParams.get("config_id")).toBe("cfg-1");
    expect(business.searchParams.get("scope")).toBeNull();
  });

  it("a provider without app credentials cannot be connected", () => {
    expect(() =>
      authorizeUrl("linkedin", { state: "s" }, { APP_URL: "https://a.example" }),
    ).toThrow(ProviderError);
  });
});

describe("provider errors", () => {
  it("rate limits, server errors and lost requests are retryable; refused tokens and other client errors are not", () => {
    expect(new ProviderError("x", 429, null, "Too Many Requests").retryable).toBe(true);
    expect(new ProviderError("linkedin", 503, null, "unavailable").retryable).toBe(true);
    expect(new ProviderError("x", 0, null, "TimeoutError").retryable).toBe(true);
    expect(
      new ProviderError("facebook", 400, "4", "Application request limit reached").retryable,
    ).toBe(true);
    expect(new ProviderError("instagram", 400, "100", "Invalid parameter").retryable).toBe(false);
    expect(new ProviderError("x", 403, "Forbidden", "duplicate content").retryable).toBe(false);
    expect(new ProviderError("x", 401, null, "Unauthorized").unauthorized).toBe(true);
    expect(
      new ProviderError("facebook", 400, "190", "Invalid OAuth access token").unauthorized,
    ).toBe(true);
  });

  it("tokens and secrets never reach a stored or shown error message", () => {
    const leaked = `access_token=EAAB${"x".repeat(40)} client_secret=abc Bearer ${"y".repeat(40)}`;
    const cleaned = redact(leaked);
    expect(cleaned).not.toContain("x".repeat(40));
    expect(cleaned).not.toContain("y".repeat(40));
    expect(cleaned).not.toContain("abc");
    expect(new ProviderError("x", 400, null, leaked).message).not.toContain("x".repeat(40));
  });

  it("reads Meta, X, LinkedIn and OAuth error bodies", () => {
    expect(
      providerReason({ error: { message: "Invalid OAuth access token.", code: 190 } }),
    ).toEqual({ code: "190", message: "Invalid OAuth access token." });
    expect(
      providerReason({ title: "Forbidden", detail: "duplicate content", status: 403 }),
    ).toEqual({ code: "Forbidden", message: "duplicate content" });
    expect(
      providerReason({
        status: 422,
        serviceErrorCode: 100,
        code: "MISSING_FIELD",
        message: "missing",
      }),
    ).toEqual({ code: "100", message: "missing" });
    expect(providerReason({ error: "invalid_request", error_description: "bad code" })).toEqual({
      code: "invalid_request",
      message: "bad code",
    });
  });
});
