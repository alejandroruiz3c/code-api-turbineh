/**
 * Does a test prove an acceptance criterion? (ADR-0035, ADR-0039). Precision first: a false "met" is worse than
 * "open" — a coding agent trusts it and skips the work. Deterministic, never a model. A test proves a criterion only
 * when its title (plus its key assertions, when known) exercises the criterion's subject, action and expected outcome:
 *   1. negation — a criterion that says something must NOT happen ("cannot", "denies", "rejects"…) is proven only by a
 *      test that itself checks a refusal;
 *   2. actor — every role the criterion names (viewer, editor, guest, customer…) must be the test's actor or appear
 *      in it;
 *   3. coverage — every salient word of the criterion (after stemming, synonyms and generic words) must appear in the
 *      test. Anything else stays "open".
 */

const NEGATION =
  /\b(cannot|can ?not|can't|couldn't|not|never|no longer|unable|denie[sd]|deny|denial|refuse[sd]?|refusal|reject(s|ed)?|forbid(s|den)?|block(s|ed)?|prevent(s|ed)?|disallow(s|ed)?|unauthori[sz]ed|unauthenticated|without (permission|access)|non-[a-z]+|only)\b/i;

/** Role and actor words; "user" is generic (anyone) and never constrains a test. */
const ROLES = [
  "owner",
  "admin",
  "administrator",
  "editor",
  "viewer",
  "member",
  "teammate",
  "guest",
  "visitor",
  "anonymous",
  "customer",
  "client",
  "patient",
  "staff",
  "manager",
  "shopper",
  "buyer",
  "seller",
  "employee",
];

/** Words that carry no checkable content of their own. */
const GENERIC = new Set(
  (
    "a an and are as at be been being by can could do does for from given has have he her his i if in into is it its " +
    "of on or our she should so than that the their them then there these they this those to was we were what when " +
    "which who will with would you your must able any all each every also just via upon after before same one " +
    "user users person people someone system app application page screen view see sees seen show shows shown display " +
    "displayed visible appear appears list correct correctly successful successfully success work works working " +
    "time new data information item items file files use uses using " +
    // Narrative and UI mechanics of Given/When/Then criteria (ADR-0043): how a person gets there, not what is checked.
    "click button press tap enter bar area section specific specifically particular certain relevant correspond " +
    "accordingly immediately proceed complet process receiv brows navigat initiat attempt already current initial " +
    "reflect contain detail level statu databas redirect authenticat consol get gets got"
  ).split(" "),
);

/** Canonical stems for words that mean the same action. */
const SYNONYMS: Record<string, string> = {
  add: "creat",
  ad: "creat",
  creat: "creat",
  new: "creat",
  edit: "edit",
  updat: "edit",
  modify: "edit",
  modifi: "edit",
  remov: "delet",
  delet: "delet",
  sign: "sign",
  log: "sign",
  login: "sign",
  signin: "sign",
  logout: "signout",
  signout: "signout",
  download: "export",
  export: "export",
  upload: "import",
  import: "import",
  // ADR-0043: same action or object, different words (learning-round criteria vs the tests that prove them).
  chang: "edit",
  adjust: "edit",
  increas: "edit",
  decreas: "edit",
  refus: "refus",
  reject: "refus",
  deny: "refus",
  deni: "refus",
  prevent: "refus",
  block: "refus",
  doubl: "overlap",
  conflict: "overlap",
  clash: "overlap",
  purchas: "order",
  buy: "order",
  paid: "pay",
  sent: "send",
  subtotal: "total",
  shopper: "shop",
  shopp: "shop",
  term: "search",
  query: "search",
  keyword: "search",
  calculat: "comput",
  cancellation: "cancel",
  appointment: "book",
  reservation: "book",
  reserv: "book",
};

const SUFFIX = /(ment|ing|ed|es|s)$/;

function stem(w: string): string {
  // "-ment"/"-ing" under another suffix too, so "payments" and "payment", "decremented" and "decrement",
  // "bookings" and "booking" share a stem.
  const once = w.replace(/(ies)$/, "y").replace(SUFFIX, "");
  const s = (once.length > 6 ? once.replace(/(ment|ing)$/, "") : once)
    .replace(/([bdglmnprt])\1$/, "$1")
    .replace(/(.{3,})e$/, "$1");
  return SYNONYMS[s] ?? SYNONYMS[once] ?? SYNONYMS[w] ?? s;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b(sign|log)[- ](in|out|up)\b/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Salient stems: content words minus generic words, as stems with synonyms folded. */
export function salientStems(text: string): Set<string> {
  return new Set(
    words(text)
      .filter((w) => w.length > 1 && !GENERIC.has(w) && !/^\d+$/.test(w))
      .map(stem)
      .filter((s) => s.length > 1 && !GENERIC.has(s)),
  );
}

const rolesIn = (text: string): Set<string> =>
  new Set(
    words(text)
      .map((w) => w.replace(/s$/, ""))
      .filter((w) => ROLES.includes(w)),
  );

export interface ProofCandidate {
  /** The test title, e.g. "owner edits a note and sees the change". */
  title: string;
  /** Key assertions of the test body (expect(...) lines, visible texts), when known. */
  assertions?: string[];
}

export interface ProofVerdict {
  proven: boolean;
  /** Why it is not proven (empty when proven). */
  reason: string;
}

/** The refusal and actor checks alone (used to veto a decider's match). */
export function proofVeto(criterion: string, test: ProofCandidate): string {
  const testText = [test.title, ...(test.assertions ?? [])].join("\n");
  if (
    NEGATION.test(criterion) &&
    !NEGATION.test(testText) &&
    !/toBeDisabled|not\.to|403|401/.test(testText)
  )
    return "the criterion requires a refusal the test does not check";
  const testRoles = rolesIn(testText);
  const missing = [...rolesIn(criterion)].filter((r) => !testRoles.has(r));
  if (missing.length > 0) return `the test does not act as ${missing.join(", ")}`;
  return "";
}

export function proofVerdict(criterion: string, test: ProofCandidate): ProofVerdict {
  const veto = proofVeto(criterion, test);
  if (veto) return { proven: false, reason: veto };
  const have = salientStems([test.title, ...(test.assertions ?? [])].join("\n"));
  const uncovered = [...salientStems(criterion)].filter((s) => !have.has(s));
  if (uncovered.length > 0)
    return { proven: false, reason: `not exercised by the test: ${uncovered.join(", ")}` };
  return { proven: true, reason: "" };
}
