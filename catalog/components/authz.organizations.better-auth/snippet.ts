// Server: organizations (workspaces), members and invitations on top of better-auth sessions.
import { betterAuth } from "better-auth";
import { organizationClient } from "better-auth/client/plugins";
import { organization } from "better-auth/plugins";
import { createAuthClient } from "better-auth/react";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  emailAndPassword: { enabled: true },
  plugins: [organization()],
});

// Client: create a workspace and make it the active one.
export const authClient = createAuthClient({ plugins: [organizationClient()] });
const created = await authClient.organization.create({ name: "Acme", slug: "acme" });
if (created.data) await authClient.organization.setActive({ organizationId: created.data.id });
