/**
 * Who may create an account. "open": anyone (multi-user SaaS). "staff": only emails in ADMIN_EMAILS (public sites
 * and shops whose visitors never need an account). Recipes set this; change it here if your app needs the other one.
 */
export const SIGN_UP_POLICY: "open" | "staff" = "open";
