import { headers } from "next/headers";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { membershipConfig as cfg } from "@/membership/config";
import { checkInvitation } from "@/membership/rules";
import { invitationByToken, workspaceName } from "@/membership/service";
import { AcceptForm } from "./accept-form";

type Props = { params: Promise<{ token: string }> };

/** Invitation link: sign up or sign in with the invited email, then accept (once, before it expires). */
export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const inv = await invitationByToken(token);
  const session = await auth.api.getSession({ headers: await headers() });
  const check = checkInvitation(inv, inv?.email ?? "");
  const next = encodeURIComponent(`/invite/${token}`);
  const roleLabel = cfg.roles.find((r) => r.key === inv?.role)?.label ?? inv?.role ?? "";
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Card title="Workspace invitation">
        {!inv || !check.ok ? (
          <p role="alert" className="text-sm text-muted">
            {check.ok || check.reason === "invalid" || check.reason === "wrong-email"
              ? "This invitation is not valid."
              : check.reason === "used"
                ? "This invitation was already used."
                : "This invitation has expired. Ask for a new one."}
          </p>
        ) : (
          <div className="flex flex-col gap-4 text-sm">
            <p>
              You are invited to <strong>{await workspaceName(inv.organizationId)}</strong> as{" "}
              <strong data-testid="invite-role">{roleLabel}</strong> ({inv.email}).
            </p>
            {session ? (
              session.user.email.toLowerCase() === inv.email ? (
                <AcceptForm token={token} />
              ) : (
                <p role="alert" className="text-danger">
                  You are signed in as {session.user.email}. Sign out and sign in with {inv.email}{" "}
                  to accept.
                </p>
              )
            ) : (
              <div className="flex gap-3">
                <Link
                  className="rounded-md bg-brand px-4 py-2 text-brand-contrast"
                  href={`/sign-up?next=${next}`}
                >
                  Create account
                </Link>
                <Link
                  className="rounded-md border border-field px-4 py-2"
                  href={`/sign-in?next=${next}`}
                >
                  Sign in
                </Link>
              </div>
            )}
          </div>
        )}
      </Card>
    </main>
  );
}
