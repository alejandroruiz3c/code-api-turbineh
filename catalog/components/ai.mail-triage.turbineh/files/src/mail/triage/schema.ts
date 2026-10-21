import { z } from "zod";
import { FINANCE_KINDS, PRIORITIES, type FinanceKind, type MailTriageConfig } from "./config";

/**
 * The structured answer the orchestrator must return for each email (component ai.mail-triage.turbineh). The schema
 * is sent with the request and the answer is validated against it by the orchestrator; amounts, currencies and dates
 * are then checked again by code (`financeFrom`) before anything reaches the ledger.
 */
export const DOCUMENTS = ["invoice", "receipt", "payment", "statement", "other"] as const;

export function triageSchema(cfg: Pick<MailTriageConfig, "categories" | "finance">) {
  const [first, ...rest] = cfg.categories;
  const finance = z.object({
    document: z.enum(DOCUMENTS),
    kind: z.enum(
      cfg.finance.kinds.length
        ? (cfg.finance.kinds as [FinanceKind, ...FinanceKind[]])
        : FINANCE_KINDS,
    ),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    issuer: z.string().trim().min(1).max(200),
    description: z.string().trim().max(300),
  });
  return z.object({
    category: z.enum([first ?? "other", ...rest] as [string, ...string[]]),
    priority: z.enum(PRIORITIES),
    reason: z.string().trim().min(1).max(300),
    finance: finance.nullable(),
  });
}
export type TriageOutput = z.infer<ReturnType<typeof triageSchema>>;

export interface FinanceEntryInput {
  document: (typeof DOCUMENTS)[number];
  kind: FinanceKind;
  /** Decimal string with at most two decimals, e.g. "1250.00". */
  amount: string;
  currency: string;
  /** YYYY-MM-DD. */
  date: string;
  issuer: string;
  description: string;
}

const CURRENCIES = new Set(
  typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [],
);

/**
 * The ledger entry of a validated answer, or why it is refused: positive amount, a real ISO 4217 currency, a real
 * calendar date not more than a year ahead, a kind the app records. Deterministic.
 */
export function financeFrom(
  out: TriageOutput,
  cfg: Pick<MailTriageConfig, "finance">,
  now = new Date(),
): { entry: FinanceEntryInput | null; refused: string | null } {
  const f = out.finance;
  if (!f || !cfg.finance.enabled) return { entry: null, refused: null };
  if (!cfg.finance.kinds.includes(f.kind))
    return { entry: null, refused: `kind ${f.kind} is not recorded` };
  if (!(Number(f.amount) > 0)) return { entry: null, refused: "amount must be positive" };
  if (CURRENCIES.size > 0 && !CURRENCIES.has(f.currency))
    return { entry: null, refused: `unknown currency ${f.currency}` };
  const d = new Date(`${f.date}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== f.date)
    return { entry: null, refused: `invalid date ${f.date}` };
  if (d.getTime() > now.getTime() + 366 * 86_400_000)
    return { entry: null, refused: `date ${f.date} is too far ahead` };
  const [int = "0", dec = ""] = f.amount.split(".");
  return {
    entry: {
      document: f.document,
      kind: f.kind,
      amount: `${int.replace(/^0+(?=\d)/, "")}.${dec.padEnd(2, "0")}`,
      currency: f.currency,
      date: f.date,
      issuer: f.issuer.trim(),
      description: f.description.trim(),
    },
    refused: null,
  };
}
