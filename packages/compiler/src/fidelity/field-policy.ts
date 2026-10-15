/**
 * Field policy of generated apps (ADR-0054), by code: which entity fields are secrets (never generated as columns,
 * forms, tables, CSV, props or logs), which hold workflow state (never typed in a form: only server actions move them)
 * and which hold tenant ids (owned by the server, never a field). One classifier for the compiler, the assembler and
 * every recipe, so the same name is treated the same way everywhere.
 */

/** Words of a field name ("accessToken", "refresh_token", "API key" → ["access", "token"], …). */
export function fieldWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-\s.]+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

/** A word that alone makes the field a secret. */
const SECRET_WORDS = new Set([
  "secret",
  "secrets",
  "password",
  "passwords",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "apikey",
  "privatekey",
  "cvv",
  "cvc",
  "pin",
]);
/** Two consecutive words that make the field a secret ("api key", "private key", "client secret"). */
const SECRET_PAIRS = new Set([
  "api key",
  "private key",
  "access key",
  "secret key",
  "signing key",
  "encryption key",
  "session key",
  "license key",
  "recovery code",
  "recovery codes",
  "backup code",
  "backup codes",
  "otp secret",
  "totp secret",
  "card number",
  "security code",
]);
/** Word before "token(s)" that keeps it a counter, not a credential ("tokens used", "token count"). */
const TOKEN_COUNTERS = new Set([
  "count",
  "counts",
  "used",
  "usage",
  "limit",
  "limits",
  "budget",
  "max",
  "min",
  "total",
  "input",
  "output",
  "prompt",
  "completion",
  "estimated",
  "per",
]);

export type SensitiveReason = "secret" | "credential" | "token" | "password";

/**
 * Whether a field holds a secret or credential (token, secret, password, API key, refresh token, private key, card
 * security code…). Secrets are never generated as CRUD: no column, form field, table cell, CSV column, prop or log.
 */
export function sensitiveField(name: string): SensitiveReason | null {
  const w = fieldWords(name);
  if (w.length === 0) return null;
  for (const x of w) {
    if (x.startsWith("password") || x === "passwd" || x === "passphrase") return "password";
    if (SECRET_WORDS.has(x)) return x.startsWith("credential") ? "credential" : "secret";
  }
  for (let i = 0; i + 1 < w.length; i++) {
    if (SECRET_PAIRS.has(`${w[i]} ${w[i + 1]}`)) return "secret";
  }
  const t = w.findIndex((x) => x === "token" || x === "tokens");
  if (t >= 0) {
    const after = w[t + 1];
    // "tokenCount", "tokensUsed", "tokenLimit": a number about tokens, not a credential.
    if (after && TOKEN_COUNTERS.has(after)) return null;
    if (w[t - 1] && TOKEN_COUNTERS.has(w[t - 1] ?? "")) return null;
    return "token";
  }
  return null;
}

/** Last words that make a field the record's workflow state ("status", "approvalStatus", "stage"). */
const STATE_WORDS = new Set(["status", "stage"]);
/** "state" alone is often an address part ("state", "billingState"); only "workflowState", "orderState"… are state. */
const ADDRESS_WORDS = new Set([
  "us",
  "home",
  "billing",
  "shipping",
  "address",
  "mailing",
  "province",
]);
/** Lifecycle verbs whose timestamp / actor / flag only a transition may set ("publishedAt", "approvedBy", "isPaid"). */
const LIFECYCLE = new Set([
  "approved",
  "rejected",
  "published",
  "unpublished",
  "archived",
  "completed",
  "closed",
  "verified",
  "paid",
  "submitted",
  "reviewed",
  "cancelled",
  "canceled",
  "signed",
  "resolved",
  "delivered",
  "shipped",
  "refunded",
  "accepted",
  "declined",
]);
const LIFECYCLE_SUFFIX = new Set(["at", "on", "by", "date", "time"]);

export type StateFieldKind = "state" | "lifecycle";

/**
 * Whether a field is workflow state the user does not type: the status (or stage, approval status) of a record, and
 * the timestamps, actors and flags of its lifecycle (publishedAt, approvedBy, isPaid). Forms never contain them;
 * only a server action changes them (a role-gated transition), so a member cannot approve their own request by
 * editing a form.
 */
export function stateField(name: string): StateFieldKind | null {
  const w = fieldWords(name);
  const last = w.at(-1) ?? "";
  if (STATE_WORDS.has(last)) return "state";
  if (last === "state" && w.length >= 2 && !ADDRESS_WORDS.has(w[0] ?? "")) return "state";
  const core = w[0] === "is" || w[0] === "has" ? w.slice(1) : w;
  if (core.length === 1 && LIFECYCLE.has(core[0] ?? "")) return "lifecycle";
  if (core.length === 2 && LIFECYCLE.has(core[0] ?? "") && LIFECYCLE_SUFFIX.has(core[1] ?? ""))
    return "lifecycle";
  return null;
}

/** Tenant ids the server owns: a generated app never has a form field or a column for them besides organizationId. */
const TENANT_FIELDS = new Set([
  "organization",
  "organization id",
  "organisation",
  "organisation id",
  "org",
  "org id",
  "tenant",
  "tenant id",
  "workspace",
  "workspace id",
]);

export function tenantField(name: string): boolean {
  return TENANT_FIELDS.has(fieldWords(name).join(" "));
}

/** One field the generator does not build as CRUD, and why (reported to the user as "not covered", with an id). */
export interface ExcludedField {
  /** Stable id for reports: SEC-<entity>-<field>. */
  id: string;
  entity: string;
  field: string;
  reason: SensitiveReason;
  /** What the app does instead, in plain words. */
  note: string;
}

/** Secret fields of the spec's entities (deterministic, in declaration order). */
export function excludedSensitiveFields(
  entities: readonly { name: string; fields: readonly { name: string }[] }[],
): ExcludedField[] {
  const out: ExcludedField[] = [];
  for (const e of entities) {
    for (const f of e.fields) {
      const reason = sensitiveField(f.name);
      if (!reason) continue;
      out.push({
        id: `SEC-${fieldWords(e.name).join("-")}-${fieldWords(f.name).join("-")}`.toUpperCase(),
        entity: e.name,
        field: f.name,
        reason,
        note:
          reason === "password"
            ? "Passwords are handled only by sign-in (hashed by the auth component); a record never stores one."
            : "Secrets and third-party credentials are never stored by generated CRUD (no column, form, table, CSV, props or logs). Storing them needs encryption at rest with a write-only input: not covered by this build.",
      });
    }
  }
  return out;
}
