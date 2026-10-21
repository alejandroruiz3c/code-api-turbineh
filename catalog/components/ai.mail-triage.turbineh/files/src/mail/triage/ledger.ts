import ExcelJS from "exceljs";
import { FINANCE_KINDS, type FinanceKind } from "./config";

/**
 * Personal finance ledger from emails (component ai.mail-triage.turbineh): totals per type (income, expense,
 * investment) and currency computed by code in cents (never by a model, never in floating point), and the Excel
 * workbook (exceljs) with an "Entries" sheet and a "Totals" sheet. Amounts of different currencies are never added
 * together.
 */
export interface LedgerEntry {
  date: string;
  kind: FinanceKind;
  amount: string;
  currency: string;
  issuer: string;
  description: string;
  document: string;
  /** Subject of the email it comes from. */
  source: string;
}

export interface LedgerTotal {
  currency: string;
  income: string;
  expense: string;
  investment: string;
  /** income − expense − investment. */
  net: string;
  count: number;
}

const cents = (amount: string): bigint => {
  const [int = "0", dec = ""] = amount.split(".");
  return BigInt(int) * 100n + BigInt((dec + "00").slice(0, 2));
};
const decimal = (c: bigint): string => {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  return `${neg ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
};

export function ledgerTotals(entries: readonly LedgerEntry[]): LedgerTotal[] {
  const by = new Map<string, Record<FinanceKind, bigint> & { count: number }>();
  for (const e of entries) {
    const t = by.get(e.currency) ?? { income: 0n, expense: 0n, investment: 0n, count: 0 };
    t[e.kind] += cents(e.amount);
    t.count += 1;
    by.set(e.currency, t);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, t]) => ({
      currency,
      income: decimal(t.income),
      expense: decimal(t.expense),
      investment: decimal(t.investment),
      net: decimal(t.income - t.expense - t.investment),
      count: t.count,
    }));
}

const KIND_LABEL: Record<FinanceKind, string> = {
  income: "Income",
  expense: "Expense",
  investment: "Investment",
};

/** The workbook as an .xlsx buffer: entries (oldest first) and totals per type and currency. */
export async function ledgerWorkbook(
  entries: readonly LedgerEntry[],
  title = "Personal finances",
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.title = title;
  wb.creator = "TurbineH mailbox triage";
  const sheet = wb.addWorksheet("Entries");
  sheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "kind", width: 12 },
    { header: "Amount", key: "amount", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "Currency", key: "currency", width: 10 },
    { header: "Issuer", key: "issuer", width: 28 },
    { header: "Description", key: "description", width: 40 },
    { header: "Document", key: "document", width: 12 },
    { header: "Email", key: "source", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date)))
    sheet.addRow({ ...e, kind: KIND_LABEL[e.kind], amount: Number(e.amount) });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const totals = wb.addWorksheet("Totals");
  totals.columns = [
    { header: "Currency", key: "currency", width: 10 },
    ...FINANCE_KINDS.map((k) => ({
      header: KIND_LABEL[k],
      key: k,
      width: 14,
      style: { numFmt: "#,##0.00" },
    })),
    { header: "Net", key: "net", width: 14, style: { numFmt: "#,##0.00" } },
    { header: "Entries", key: "count", width: 10 },
  ];
  totals.getRow(1).font = { bold: true };
  for (const t of ledgerTotals(entries))
    totals.addRow({
      currency: t.currency,
      income: Number(t.income),
      expense: Number(t.expense),
      investment: Number(t.investment),
      net: Number(t.net),
      count: t.count,
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
