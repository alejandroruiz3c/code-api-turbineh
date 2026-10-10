/**
 * Plain-language description of each capability. Decider questions name ONE concrete need in simple words
 * (ADR-0010) instead of a capability id or a demanding "fully provides" claim.
 */
export const CAPABILITY_LABELS: Record<string, string> = {
  "auth.session": "user sign-up, sign-in and sessions",
  "auth.oauth": "sign-in with an external provider such as Google or GitHub",
  "authz.roles": "user roles and permission checks",
  "authz.organizations": "organizations or workspaces that group users",
  "data.orm": "storing and querying records in a SQL database",
  "data.validation": "validating user input against a schema",
  "data.pagination": "splitting long lists of records into pages",
  "data.csv-import": "importing records from CSV files",
  "data.csv-export": "exporting records to CSV files",
  "ui.table": "showing records in a table",
  "ui.form": "forms with inputs to create or edit data",
  "ui.layout": "page layout and navigation building blocks",
  "ui.calendar": "a calendar or time-slot view",
  "ui.charts": "charts and graphs",
  "files.upload": "uploading files",
  "email.transactional": "sending emails to users",
  "payments.checkout": "online payments or subscriptions",
  "jobs.queue": "running work in the background",
  "jobs.scheduler": "running tasks at scheduled times",
  "observability.logging": "logs and audit trails",
  "ops.rate-limit": "limiting how many requests a user can make",
  "ops.idempotency": "preventing the same action from running twice",
  "security.headers": "HTTP security headers",
};

export const capabilityLabel = (cap: string) => CAPABILITY_LABELS[cap] ?? cap;
