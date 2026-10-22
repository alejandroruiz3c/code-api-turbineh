import { headers } from "next/headers";
import { Card } from "@/components/ui/card";
import { entityNav } from "@/entities";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/staff";
import { requireMember } from "@/server/authz";
import { myOrganizations } from "@/server/organizations";

/** Dashboard home: the signed-in user's role and sections. */
export default async function Dashboard() {
  const { role, userId, organizationId } = await requireMember();
  const active = (await myOrganizations(userId)).find((o) => o.id === organizationId);
  const session = await auth.api.getSession({ headers: await headers() });
  const staff = session ? isStaff(session.user) : false;
  return (
    <Card title="Dashboard">
      <p className="mb-2 text-sm text-muted">
        Organization: <span data-testid="organization">{active?.name ?? ""}</span>
      </p>
      <p className="text-sm text-muted">
        Signed in as <span data-testid="role">{role}</span>. {entityNav.length} sections available.
      </p>
      <p className="mt-2 text-sm text-muted">
        Staff access: <span data-testid="staff">{staff ? "yes" : "no"}</span>
        {session && !session.user.emailVerified
          ? " — verify your email address (link sent on sign-up) to unlock staff areas."
          : ""}
      </p>
    </Card>
  );
}
