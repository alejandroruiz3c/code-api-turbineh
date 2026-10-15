import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table } from "@/components/ui/table";
import { membershipConfig as cfg } from "@/membership/config";
import { grantableRoles } from "@/membership/rules";
import { listInvitations, listMembers, listScopes } from "@/membership/service";
import { ROLE_LABEL } from "@/server/role-policy";
import { scopeOptions, SCOPE_LABEL } from "@/server/record-access";
import { can, requireMember } from "@/server/authz";
import { addScopeMember, createAccessScope, revokeMemberInvitation } from "./actions";
import { InviteForm, RoleForm } from "./forms";

/** Members of the workspace: roles, invitations by email and per-record scopes (managers); your own access (others). */
export default async function MembersPage() {
  const ctx = await requireMember();
  const roleLabel = (k: string) => ROLE_LABEL[k] ?? k;
  const mine = await scopeOptions(ctx);
  const yourAccess = (
    <Card title="Your access">
      <p className="text-sm">
        Your role: <span data-testid="my-role">{roleLabel(ctx.role)}</span>
      </p>
      {SCOPE_LABEL ? (
        <p className="mt-2 text-sm" data-testid="my-scopes">
          {cfg.scope?.plural}:{" "}
          {can(ctx.role, "see_all_scopes") ? "all" : mine.map((s) => s.name).join(", ") || "none"}
        </p>
      ) : null}
    </Card>
  );
  if (!can(ctx.role, "manage_members")) {
    return (
      <div className="flex flex-col gap-6">
        {yourAccess}
        <p role="alert" className="text-sm text-muted">
          Only members who manage the workspace can invite people or change roles.
        </p>
      </div>
    );
  }
  const [members, invitations, scopes] = await Promise.all([
    listMembers(ctx.organizationId),
    listInvitations(ctx.organizationId),
    SCOPE_LABEL ? listScopes(ctx.organizationId) : Promise.resolve([]),
  ]);
  const grantable = grantableRoles(cfg, ctx.role).map((key) => ({ key, label: roleLabel(key) }));
  return (
    <div className="flex flex-col gap-6">
      {yourAccess}
      <Card title="Invite someone">
        <InviteForm roles={grantable} scopes={scopes} scopeLabel={SCOPE_LABEL} />
      </Card>
      <Card title="Members">
        <Table head={["Name", "Email", "Role"]}>
          {members.map((m) => (
            <tr key={m.id} className="border-b border-line" data-testid="member-row">
              <td className="px-3 py-2">{m.name}</td>
              <td className="px-3 py-2">{m.email}</td>
              <td className="px-3 py-2">
                {m.userId === ctx.userId ? (
                  <span>{roleLabel(m.role)} (you)</span>
                ) : (
                  <RoleForm memberId={m.id} email={m.email} role={m.role} roles={grantable} />
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="Pending invitations">
        {invitations.length === 0 ? (
          <p className="text-sm text-muted">No pending invitations.</p>
        ) : (
          <Table head={["Email", "Role", "Expires", ""]}>
            {invitations.map((i) => (
              <tr key={i.id} className="border-b border-line" data-testid="invitation-row">
                <td className="px-3 py-2">{i.email}</td>
                <td className="px-3 py-2">{roleLabel(i.role)}</td>
                <td className="px-3 py-2">{i.expiresAt.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">
                  <form action={revokeMemberInvitation}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" className="bg-danger px-3 py-1 text-danger-contrast">
                      Revoke
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {SCOPE_LABEL ? (
        <Card title={cfg.scope?.plural ?? "Scopes"}>
          <p className="mb-3 text-sm text-muted">
            Members whose role cannot see every {SCOPE_LABEL.toLowerCase()} see only the records of
            the {cfg.scope?.plural.toLowerCase()} they belong to.
          </p>
          <form action={createAccessScope} className="mb-4 flex items-end gap-2">
            <div>
              <Label htmlFor="scope-name">New {SCOPE_LABEL.toLowerCase()}</Label>
              <Input id="scope-name" name="name" required maxLength={120} />
            </div>
            <Button type="submit">Add {SCOPE_LABEL.toLowerCase()}</Button>
          </form>
          <Table head={[SCOPE_LABEL, "Members", "Add a member"]}>
            {scopes.map((s) => (
              <tr key={s.id} className="border-b border-line" data-testid="scope-row">
                <td className="px-3 py-2">{s.name}</td>
                <td className="px-3 py-2">{s.members.join(", ") || "—"}</td>
                <td className="px-3 py-2">
                  <form action={addScopeMember} className="flex gap-2">
                    <input type="hidden" name="scopeId" value={s.id} />
                    <label className="sr-only" htmlFor={`scope-add-${s.id}`}>
                      Member email for {s.name}
                    </label>
                    <Input id={`scope-add-${s.id}`} name="email" type="email" required />
                    <Button type="submit" className="px-3 py-1">
                      Add
                    </Button>
                  </form>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
