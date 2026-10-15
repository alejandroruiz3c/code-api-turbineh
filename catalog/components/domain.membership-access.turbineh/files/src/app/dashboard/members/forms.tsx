"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMemberRole, inviteMember, type MembersState } from "./actions";

/** Invite by email with a role (and the scope the person belongs to, when the role needs one). */
export function InviteForm({
  roles,
  scopes,
  scopeLabel,
}: {
  roles: { key: string; label: string }[];
  scopes: { id: string; name: string }[];
  scopeLabel: string | null;
}) {
  const [state, action, pending] = useActionState<MembersState, FormData>(inviteMember, null);
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-4" aria-label="Invite">
      <div>
        <Label htmlFor="invite-email">Email</Label>
        <Input id="invite-email" name="email" type="email" required maxLength={320} />
      </div>
      <div>
        <Label htmlFor="invite-role">Role</Label>
        <select
          id="invite-role"
          name="role"
          className="w-full rounded-md border border-field px-3 py-2 text-sm"
        >
          {roles.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {scopeLabel ? (
        <div>
          <Label htmlFor="invite-scope">{scopeLabel}</Label>
          <select
            id="invite-scope"
            name="scopeId"
            className="w-full rounded-md border border-field px-3 py-2 text-sm"
          >
            <option value="">
              None (sees every {scopeLabel.toLowerCase()} if the role allows)
            </option>
            {scopes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Send invitation
        </Button>
      </div>
      {state ? (
        <p
          role="status"
          className={`md:col-span-4 text-sm ${state.ok ? "text-success" : "text-danger"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/** Change a member's role, or remove them. */
export function RoleForm({
  memberId,
  email,
  role,
  roles,
}: {
  memberId: string;
  email: string;
  role: string;
  roles: { key: string; label: string }[];
}) {
  const [state, action, pending] = useActionState<MembersState, FormData>(changeMemberRole, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      <label className="sr-only" htmlFor={`role-${memberId}`}>
        Role of {email}
      </label>
      <select
        id={`role-${memberId}`}
        name="role"
        defaultValue={role}
        className="rounded-md border border-field px-2 py-1 text-sm"
      >
        {roles.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
        <option value="__remove">Remove from workspace</option>
      </select>
      <Button type="submit" disabled={pending} className="px-3 py-1">
        Save
      </Button>
      {state ? (
        <span role="status" className={`text-xs ${state.ok ? "text-success" : "text-danger"}`}>
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
