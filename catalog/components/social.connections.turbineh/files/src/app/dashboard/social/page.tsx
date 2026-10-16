import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { can, requireMember } from "@/server/authz";
import { connectionsConfig } from "@/social/config";
import { listConnections, setupProblem } from "@/social/connections";
import { NETWORK_LABEL, PROVIDER_LABEL, isNetwork } from "@/social/networks";
import { disconnectAccount } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  active: "Connected",
  expired: "Expired — connect again",
  revoked: "Disconnected",
};

/** Social accounts of the workspace (social.connections.turbineh): connect with OAuth, see status, disconnect. */
export default async function SocialAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireMember();
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string).slice(0, 300) : null);
  const manage = can(ctx.role, "configure");
  const rows = await listConnections(ctx.organizationId);
  return (
    <div className="flex flex-col gap-6">
      {one("error") ? (
        <p role="alert" className="rounded-md border border-line bg-subtle p-3 text-sm text-danger">
          {one("error")}
        </p>
      ) : null}
      {one("connected") ? (
        <p
          role="status"
          className="rounded-md border border-line bg-subtle p-3 text-sm text-success"
        >
          Connected {one("connected")} account(s).
        </p>
      ) : null}
      {one("disconnected") ? (
        <p
          role="status"
          className="rounded-md border border-line bg-subtle p-3 text-sm text-success"
        >
          Account disconnected
          {one("disconnected") === "revoked" ? " and access revoked at the provider" : ""}.
          {one("note") ? ` ${one("note")}` : ""}
        </p>
      ) : null}
      <Card title="Social accounts">
        <p className="mb-4 text-sm text-muted">
          Accounts this workspace publishes to. Access tokens are stored encrypted and are never
          shown.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No account connected yet.</p>
        ) : (
          <Table head={["Network", "Account", "Status", "Connected", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line" data-testid="social-connection">
                <td className="px-3 py-2">
                  {isNetwork(r.network) ? NETWORK_LABEL[r.network] : r.network}
                </td>
                <td className="px-3 py-2">{r.accountName}</td>
                <td className="px-3 py-2">
                  {STATUS[r.status] ?? r.status}
                  {r.lastError ? (
                    <span className="block text-xs text-muted">{r.lastError}</span>
                  ) : null}
                </td>
                <td className="px-3 py-2">{r.connectedAt.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">
                  {manage ? (
                    <form action={disconnectAccount}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm text-danger underline">
                        Disconnect {r.accountName}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Connect an account">
        {manage ? (
          <ul className="flex flex-col gap-3">
            {connectionsConfig.providers.map((p) => {
              const problem = setupProblem(p);
              return (
                <li key={p} className="flex flex-wrap items-center gap-3">
                  {problem ? (
                    <span className="text-sm text-muted">
                      {PROVIDER_LABEL[p]}: {problem}
                    </span>
                  ) : (
                    // A plain link: the consent page is on the provider's site.
                    <a
                      href={`/api/social/oauth/${p}/start`}
                      className="inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast hover:opacity-90"
                    >
                      Connect {PROVIDER_LABEL[p]}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Ask a workspace owner or admin to connect accounts.</p>
        )}
      </Card>
    </div>
  );
}
