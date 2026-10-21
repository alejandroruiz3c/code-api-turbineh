// Server code in the app (a server action or a scheduled job): read new mail, triage it through the orchestrator,
// then use the stored triage — the inbox in priority order, the ledger totals and its Excel workbook.
import { ledgerTotals, ledgerWorkbook } from "@/mail/triage/ledger";
import { ledger, syncAndTriage, triagedInbox } from "@/mail/triage/service";

export async function morningReview(): Promise<{ urgent: string[]; totals: string; xlsx: Buffer }> {
  await syncAndTriage();
  const inbox = await triagedInbox({ priority: "urgent" });
  const entries = await ledger();
  const totals = ledgerTotals(entries)
    .map(
      (t) =>
        `${t.currency}: income ${t.income}, expenses ${t.expense}, investments ${t.investment}`,
    )
    .join("; ");
  return { urgent: inbox.map((m) => m.subject), totals, xlsx: await ledgerWorkbook(entries) };
}
