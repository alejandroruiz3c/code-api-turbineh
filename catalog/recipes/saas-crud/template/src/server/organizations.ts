import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ROLE_LABEL } from "@/server/role-policy";

/**
 * The organizations (workspaces) a person belongs to, with their role in each — read from better-auth's `member` and
 * `organization` tables. Switching and creating go through better-auth's organization API
 * (src/app/dashboard/account/organizations/actions.ts); this module only reads, for a user id from the session.
 */
export interface MyOrganization {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
}

export async function myOrganizations(userId: string): Promise<MyOrganization[]> {
  const r = await db.execute<{ id: string; name: string; role: string }>(
    sql`select o.id, o.name, m.role
          from member m join organization o on o.id = m."organizationId"
         where m."userId" = ${userId}
         order by m."createdAt" asc, o.name asc`,
  );
  return r.rows.map((o) => ({ ...o, roleLabel: ROLE_LABEL[o.role] ?? o.role }));
}
