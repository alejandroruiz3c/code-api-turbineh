import { Table } from "@/components/ui/table";
import { triageConfig } from "@/mail/triage/config";
import { ledgerTotals } from "@/mail/triage/ledger";
import { ledger } from "@/mail/triage/service";
import { currentAdmin, requireMember } from "@/server/authz";
import { changeKind } from "./actions";

export const dynamic = "force-dynamic";

/** Personal finances from invoices and payments in the mailbox (component ai.mail-triage.turbineh). ADMIN_EMAILS only. */
export default async function FinancePage() {
  await requireMember();
  if (!(await currentAdmin())) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Finances</h1>
        <p className="text-muted" role="status">
          Only the mailbox owner can see these finances.
        </p>
      </div>
    );
  }
  const entries = await ledger();
  const totals = ledgerTotals(entries);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Finances</h1>
        <a
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-brand-contrast"
          href="/dashboard/finance/export"
        >
          Download Excel
        </a>
      </div>
      <p className="text-sm text-muted">
        Invoices, receipts and payments found in your mail: income, expenses and investments. Totals
        are computed per currency; correct a type if the assistant got it wrong.
      </p>
      {totals.length === 0 ? (
        <p className="text-muted">Nothing recorded yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" data-testid="finance-totals">
          {totals.map((t) => (
            <section
              key={t.currency}
              className="rounded-lg border border-line bg-panel p-4"
              data-currency={t.currency}
            >
              <h2 className="font-medium">{t.currency}</h2>
              <dl className="mt-2 grid grid-cols-2 gap-1 text-sm">
                {triageConfig.finance.kinds.map((k) => (
                  <div key={k} className="contents">
                    <dt className="capitalize text-muted">{k}</dt>
                    <dd data-total={k}>{t[k]}</dd>
                  </div>
                ))}
                <dt className="text-muted">Net</dt>
                <dd data-total="net">{t.net}</dd>
              </dl>
            </section>
          ))}
        </div>
      )}
      {entries.length > 0 ? (
        <Table head={["Date", "Type", "Amount", "Issuer", "Description", "Email"]}>
          {entries.map((e) => (
            <tr
              key={e.id}
              data-testid="finance-row"
              data-kind={e.kind}
              className="border-b border-line align-top"
            >
              <td className="px-3 py-2">{e.date}</td>
              <td className="px-3 py-2">
                <form action={changeKind} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={e.id} />
                  <label className="sr-only" htmlFor={`kind-${e.id}`}>
                    Type
                  </label>
                  <select
                    id={`kind-${e.id}`}
                    name="kind"
                    defaultValue={e.kind}
                    className="rounded-md border border-field p-1 text-sm"
                  >
                    {triageConfig.finance.kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="text-sm underline">
                    Save
                  </button>
                  {e.corrected ? <span className="text-xs text-muted">corrected</span> : null}
                </form>
              </td>
              <td className="px-3 py-2">
                {e.amount} {e.currency}
              </td>
              <td className="px-3 py-2">{e.issuer}</td>
              <td className="px-3 py-2 text-muted">{e.description}</td>
              <td className="px-3 py-2 text-muted">{e.source}</td>
            </tr>
          ))}
        </Table>
      ) : null}
    </div>
  );
}
