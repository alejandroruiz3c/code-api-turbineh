/**
 * The social networks of the social.* components and where their APIs live. Base URLs come from the environment so the
 * offline E2E run points them at local mocks (tests/e2e/mocks/*_API_BASE.ts); production uses the defaults below.
 * Versions are pinned and overridable: LinkedIn's Posts API needs a `Linkedin-Version: YYYYMM` header (each version is
 * supported about a year), Meta's Graph API a `vNN.0` path prefix.
 */
export const NETWORKS = ["linkedin", "facebook", "instagram", "x"] as const;
export type Network = (typeof NETWORKS)[number];

/** OAuth providers: one Meta grant (Facebook Login for Business) connects Facebook Pages and their Instagram accounts. */
export const PROVIDERS = ["linkedin", "meta", "x"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const providerOf = (n: Network): Provider =>
  n === "facebook" || n === "instagram" ? "meta" : n;

export const NETWORK_LABEL: Record<Network, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook Page",
  instagram: "Instagram",
  x: "X",
};

export const PROVIDER_LABEL: Record<Provider, string> = {
  linkedin: "LinkedIn",
  meta: "Facebook & Instagram",
  x: "X",
};

export const isNetwork = (v: unknown): v is Network =>
  typeof v === "string" && (NETWORKS as readonly string[]).includes(v);
export const isProvider = (v: unknown): v is Provider =>
  typeof v === "string" && (PROVIDERS as readonly string[]).includes(v);

type Env = Record<string, string | undefined>;
const trim = (u: string) => u.replace(/\/+$/, "");

/** Where each provider's endpoints live (read on every call, so tests can point them at mocks). */
export function endpoints(env: Env = process.env) {
  const metaVersion = env.META_GRAPH_VERSION || "v26.0";
  return {
    linkedin: {
      auth: trim(env.LINKEDIN_AUTH_BASE_URL || "https://www.linkedin.com"),
      api: trim(env.LINKEDIN_API_BASE || "https://api.linkedin.com"),
      version: env.LINKEDIN_VERSION || "202609",
    },
    meta: {
      auth: `${trim(env.META_AUTH_BASE_URL || "https://www.facebook.com")}/${metaVersion}`,
      api: `${trim(env.META_GRAPH_API_BASE || "https://graph.facebook.com")}/${metaVersion}`,
    },
    x: {
      auth: trim(env.X_AUTH_BASE_URL || "https://x.com"),
      api: trim(env.X_API_BASE || "https://api.x.com"),
    },
  };
}

/** App credentials of a provider, or null when it is not configured (its Connect button explains what to set). */
export function credentials(
  provider: Provider,
  env: Env = process.env,
): { clientId: string; clientSecret: string } | null {
  const [id, secret] = {
    linkedin: [env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET],
    meta: [env.META_APP_ID, env.META_APP_SECRET],
    x: [env.X_CLIENT_ID, env.X_CLIENT_SECRET],
  }[provider];
  return id && secret ? { clientId: id, clientSecret: secret } : null;
}

export const CREDENTIAL_ENV: Record<Provider, [string, string]> = {
  linkedin: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
  meta: ["META_APP_ID", "META_APP_SECRET"],
  x: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
};

/**
 * Scopes requested per provider (what publishing and basic metrics need). Some need the platform's approval before
 * they work for accounts other than the app's own developers — see docs/components/social.connections.turbineh.md.
 */
export const SCOPES: Record<Provider, string[]> = {
  // Sign In with LinkedIn (OpenID Connect) for the member id + Share on LinkedIn (self-serve) to post as the member.
  linkedin: ["openid", "profile", "w_member_social"],
  // Facebook Login for Business: Pages (list, post, read engagement) and Instagram professional accounts (publish,
  // insights). Advanced access to each needs Meta's App Review.
  meta: [
    "pages_show_list",
    "pages_manage_posts",
    "pages_read_engagement",
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_insights",
    "business_management",
  ],
  // OAuth 2.0 Authorization Code with PKCE; offline.access returns a refresh token (access tokens last 2 hours).
  x: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
};

/** The app's public origin, for OAuth redirect URIs (APP_URL, else BETTER_AUTH_URL). */
export function appOrigin(env: Env = process.env): string {
  return trim(env.APP_URL || env.BETTER_AUTH_URL || "http://localhost:3000");
}

export const redirectUri = (provider: Provider, env: Env = process.env) =>
  `${appOrigin(env)}/api/social/oauth/${provider}/callback`;
