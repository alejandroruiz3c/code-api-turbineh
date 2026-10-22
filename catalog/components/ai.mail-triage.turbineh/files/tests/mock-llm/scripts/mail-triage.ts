import type { MockScript } from "../mock";

/**
 * Scripted model behaviour for mailbox triage (component ai.mail-triage.turbineh): it reads the email passed as a
 * document and answers the triage task with the structured output a real model would give, so E2E tests exercise the
 * orchestrator call, schema validation, the ledger and the digest without internet. Rules are keyword-based and only
 * cover the phrasings the tests use.
 */
const has = (re: RegExp, text: string) => re.test(text);

function money(text: string): { amount: string; currency: string } | null {
  const m =
    /(?:total|amount|importe|paid|received|payment of|dividend of)[^\d€$£]{0,30}([€$£])?\s?(\d{1,9}(?:[.,]\d{2})?)\s*(EUR|USD|GBP|€|\$|£)?/i.exec(
      text,
    );
  if (!m) return null;
  const symbol = (m[1] ?? m[3] ?? "EUR").toUpperCase();
  const currency =
    symbol === "€" ? "EUR" : symbol === "$" ? "USD" : symbol === "£" ? "GBP" : symbol;
  return { amount: (m[2] ?? "0").replace(",", "."), currency };
}

const script: MockScript = {
  id: "mail-triage",
  rules: [],
  structured: ({ task, context }) => {
    if (!/^Triage this email/.test(task)) return null;
    // Only the email (the request's document), never the app's task text.
    const email = /Context:\n([\s\S]*?)\nJSON_SCHEMA:/.exec(context)?.[1] ?? context;
    const subject = /Subject: (.*)/.exec(email)?.[1] ?? "";
    const from = /From: (.*)/.exec(email)?.[1] ?? "";
    const date =
      /\b(20\d{2}-\d{2}-\d{2})\b/.exec(email)?.[1] ?? new Date().toISOString().slice(0, 10);
    const issuer = from.replace(/<.*>/, "").trim() || "Unknown";
    // The message body: after the header lines.
    const text = email.slice(email.indexOf("\n\n") + 2);
    const doc = `Subject: ${subject}\n${text}`;
    const amount = money(text);
    if (amount && has(/\binvoice|\bbill\b|receipt|factura/i, doc))
      return {
        category: "finance",
        priority: has(/\b(overdue|due today|final notice)\b/i, doc) ? "urgent" : "high",
        reason: "Invoice to pay.",
        finance: {
          document: "invoice",
          kind: "expense",
          ...amount,
          date,
          issuer,
          description: subject,
        },
      };
    if (amount && has(/\b(salary|payroll|payment received|you received|transfer received)\b/i, doc))
      return {
        category: "finance",
        priority: "normal",
        reason: "Payment received.",
        finance: {
          document: "payment",
          kind: "income",
          ...amount,
          date,
          issuer,
          description: subject,
        },
      };
    if (amount && has(/\b(dividend|shares|fund|brokerage|portfolio|contribution)\b/i, doc))
      return {
        category: "finance",
        priority: "normal",
        reason: "Investment movement.",
        finance: {
          document: "statement",
          kind: "investment",
          ...amount,
          date,
          issuer,
          description: subject,
        },
      };
    if (has(/\b(urgent|asap|today|deadline)\b/i, doc))
      return {
        category: "action",
        priority: "urgent",
        reason: "Asks for action today.",
        finance: null,
      };
    if (has(/\b(please (reply|confirm|review)|can you|could you)\b/i, doc))
      return {
        category: "work",
        priority: "high",
        reason: "Waiting for your reply.",
        finance: null,
      };
    if (has(/\b(unsubscribe|newsletter)\b/i, doc))
      return { category: "newsletter", priority: "low", reason: "Newsletter.", finance: null };
    return { category: "other", priority: "normal", reason: "No action needed.", finance: null };
  },
};

export default script;
