import { Card } from "@/components/ui/card";
import { requireMember, requireSession } from "@/server/authz";
import { myOrganizations } from "@/server/organizations";
import { AccountNameForm } from "./name-form";

export const dynamic = "force-dynamic";

/** The signed-in person's account (profile): name, email, their organizations with their role in each. */
export default async function Account() {
  const { organizationId } = await requireMember();
  const me = await requireSession();
  const organizations = await myOrganizations(me.userId);
  return (
    <div className="flex flex-col gap-6">
      <Card title="Your account">
        <dl className="mb-6 grid grid-cols-[8rem_1fr] gap-2 text-sm">
          <dt className="text-muted">Name</dt>
          <dd data-testid="account-name">{me.name}</dd>
          <dt className="text-muted">Email</dt>
          <dd data-testid="account-email">{me.email}</dd>
          <dt className="text-muted">Email verified</dt>
          <dd>{me.emailVerified ? "yes" : "no"}</dd>
        </dl>
        <AccountNameForm name={me.name} />
      </Card>
      <Card title="Your organizations">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1">Organization</th>
              <th className="py-1">Your role</th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((o) => (
              <tr key={o.id} data-testid="account-organization" className="border-t border-line">
                <td className="py-1">
                  {o.name}
                  {o.id === organizationId ? (
                    <span className="ml-2 text-xs text-accent">active</span>
                  ) : null}
                </td>
                <td className="py-1">{o.roleLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
