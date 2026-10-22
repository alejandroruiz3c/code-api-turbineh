import { z } from "zod";
import params from "./params.json";

/**
 * Mailbox triage settings (component ai.mail-triage.turbineh), written by TurbineH from the request: the categories
 * the classifier may use (a closed list: every answer is validated against it), whether invoices and payments go to
 * the finance ledger, and the daily digest. Validated at start-up.
 */
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const FINANCE_KINDS = ["income", "expense", "investment"] as const;
export type FinanceKind = (typeof FINANCE_KINDS)[number];

export const MailTriageParams = z.object({
  categories: z
    .array(z.string().regex(/^[a-z][a-z-]{1,23}$/))
    .min(2)
    .max(16)
    .refine((c) => new Set(c).size === c.length, "categories must be unique"),
  finance: z.object({
    enabled: z.boolean(),
    kinds: z.array(z.enum(FINANCE_KINDS)).min(1),
    defaultCurrency: z.string().regex(/^[A-Z]{3}$/),
  }),
  digest: z.object({
    enabled: z.boolean(),
    at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timeZone: z.string().min(1),
    minPriority: z.enum(["urgent", "high", "normal"]),
    max: z.number().int().min(1).max(50),
  }),
  syncEveryMinutes: z.number().int().min(5).max(1440),
});
export type MailTriageConfig = z.infer<typeof MailTriageParams>;

export const triageConfig: MailTriageConfig = MailTriageParams.parse(params);

/** urgent < high < normal < low (lower sorts first). */
export const priorityRank = (p: string): number => {
  const i = (PRIORITIES as readonly string[]).indexOf(p);
  return i < 0 ? PRIORITIES.length : i;
};
