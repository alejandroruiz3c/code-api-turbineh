import { SUPPORTED_STACK } from "@turbineh/shared";
import type { BuildSpec } from "./build-spec.js";

/**
 * General requirements (ADR-0069): parts of a request that are not functions of the app — that it runs, that it is
 * verified, sample data, good coding practices, how it looks, that data persists, or a stack. The compiler writes them
 * as acceptance criteria ("the application must be in a runnable state", "the UI displays a cyberpunk aesthetic"), but
 * no function test can prove them and none should: counted as functional requirements they made a request the library
 * covers look 0 % covered (the scope gate's functional floor, ADR-0063 §4) and refused our own example prompts.
 *
 * Deterministic and precise: a criterion is general only when it names one of these qualities and no function (a
 * criterion that creates, edits, books, pays… something stays functional, its stack words removed by the canonical
 * mapping). Each general requirement is listed in the plan with how it is handled — honestly: sample data is not
 * included, a named visual style is not generated, the stack is TurbineH's.
 */
export type GeneralKind =
  | "runnable"
  | "verified"
  | "sample-data"
  | "good-practices"
  | "look-and-feel"
  | "persistence"
  | "stack";

export interface GeneralRequirement {
  requirement: string;
  kind: GeneralKind;
  /** How TurbineH handles it, in plain words (shown in the plan). */
  how: string;
}

export const GENERAL_HOW: Record<GeneralKind, string> = {
  runnable:
    "Every package is built and run in the TurbineH sandbox before delivery (lint, typecheck, unit and end-to-end tests); the report says what passed.",
  verified:
    "Every package is verified in the TurbineH sandbox (lint, typecheck, unit and end-to-end tests); the report says what passed.",
  "sample-data":
    "Not included: the app starts empty (no demo records). Each function's end-to-end test creates its own records in the sandbox.",
  "good-practices":
    "Applied by construction: strict TypeScript, linting, verified catalogue components, the Security Pack and a test for every advertised function, checked by the sandbox gate.",
  "look-and-feel":
    "The look follows the brand you set (colours, fonts, logo: the brand step on the web, `brand` in the API). A named style or custom visual effects are not generated as functions.",
  persistence:
    "Data is stored in PostgreSQL (Drizzle), a real database: it persists across reloads and restarts.",
  stack: `New apps are built on ${SUPPORTED_STACK}.`,
};

/** A function the criterion asks for: then it is not general (the function is measured; stack words are ignored). */
const FUNCTION =
  /\b(creat|add|edit|updat|modif|renam|delet|remov|archiv|restor|book|reserv|cancel|pay|charg|send|email|upload|import|export|search|filter|sort|assign|comment|invite|approv|publish|schedul|move|drag|track|classif|summar|extract|answer|ask|escalat|chat|submit|review|register|sign)\w*/i;

const RULES: { kind: GeneralKind; pattern: RegExp }[] = [
  {
    kind: "sample-data",
    pattern:
      /\b(sample|demo|dummy|seed(ed)?|placeholder|pre-?populated|pre-?filled|pre-?loaded)\s+(data|records?|entries|content|datasets?|items?|statistics|values|rows)\b|\bpre-?populated\b|\b(see|sees|view|views|shows?|displays?|contains?|includes?|with)\s+(\w+\s+)?sample\b/i,
  },
  {
    kind: "verified",
    pattern:
      /\bverified in (the )?(turbineh )?sandbox\b|\b(in|within|inside) the turbineh sandbox\b|\b(all |its |the )?tests? (must )?pass(es)?\b/i,
  },
  {
    kind: "runnable",
    pattern:
      /\brunnable\b|\b(app|application|project)\b[^.]{0,40}\b(runs?|starts?|launch(es)?|boots?|compiles?)\b[^.]{0,30}\b(without (any )?errors?|successfully|out of the box|locally)\b/i,
  },
  {
    kind: "good-practices",
    pattern:
      /\b(best|good|buenas) ((coding|development|web|software|engineering|de|desarrollo) ){0,3}(practi\w*|pr[aá]cti\w*)|\bclean code\b|\bcode quality\b|\bcoding standards\b|\bmaintainab\w*\b|\bwell[- ]structured\b|\bmodular (architecture|code)\b/i,
  },
  {
    kind: "look-and-feel",
    pattern:
      /\b(aesthetic\w*|look and feel|visual (style|design|identity|transitions?|effects?|feedback)|(smooth|css|ui|hover|page|nice|beautiful|fancy) (transitions?|effects?|animations?)|transitions? and effects?|animations?|animated|colou?r (scheme|palette)|cyberpunk|neon|minimalist|sleek|stylish|modern (design|look|ui)|responsive (design|layout)|typography)\b/i,
  },
  {
    kind: "persistence",
    pattern:
      /\b(any|all|every)\b[^.]{0,40}\b(crud|operation|change|data)\w*\b[^.]{0,60}\b(persist\w*|saved|stored|kept|remain\w*)\b|\b(data|changes)\b[^.]{0,30}\b(persist\w*|remain\w*)\b[^.]{0,40}\b(refresh\w*|reload\w*|restart\w*)|\b(refresh\w*|reload\w*|restart\w*)\b[^.]{0,30}\b(browser|page|app\w*)\b[^.]{0,80}\b(retriev\w*|restor\w*|still (there|shown|listed|visible)|remain\w*|persist\w*)\b/i,
  },
];

/** The kind of general requirement a criterion states, or null when it is (or includes) a function. */
export function generalKind(criterion: string): GeneralKind | null {
  // "Performs any CRUD operation" names no single function; "accesses the audit logs" is where sample entries show.
  const named = criterion.replace(/\bcrud operations?\b|\baudit logs?\b/gi, " ");
  if (FUNCTION.test(named)) return null;
  return RULES.find((r) => r.pattern.test(criterion))?.kind ?? null;
}

/** Stacks and storage a request may name that TurbineH does not build with (new apps: SUPPORTED_STACK only). */
const OTHER_STACK: readonly [label: string, re: RegExp][] = [
  [
    "plain HTML/CSS/JavaScript",
    /\b(html ?5?|vanilla (js|javascript)|plain (html|javascript|js))\b/i,
  ],
  ["Bootstrap", /\bbootstrap\b/i],
  ["jQuery", /\bjquery\b/i],
  ["SQLite", /\bsqlite\b/i],
  ["a JSON file", /\b(json files?|archivos? json|ficheros? json|en (un )?json)\b/i],
  ["browser storage (localStorage)", /\b(local ?storage|session ?storage|indexed ?db)\b/i],
  ["MySQL", /\bmysql\b/i],
  ["MongoDB", /\bmongo ?db\b/i],
  ["Firebase", /\bfirebase\b/i],
  ["PHP", /\bphp\b/i],
  ["Laravel", /\blaravel\b/i],
  ["WordPress", /\bword ?press\b/i],
  ["Python", /\bpython\b/i],
  ["Django", /\bdjango\b/i],
  ["Flask", /\bflask\b/i],
  ["Ruby on Rails", /\b(ruby|rails)\b/i],
  ["Java", /\bjava\b(?!script)/i],
  [".NET", /\b(\.net|asp\.net|c#)(?=\s|$|[,.;])/i],
  ["Vue", /\bvue(\.?js)?\b/i],
  ["Angular", /\bangular\b/i],
  ["Svelte", /\bsvelte\b/i],
  ["Express", /\bexpress(\.?js)?\b(?! (checkout|delivery|shipping))/i],
];

const STORAGE = new Set([
  "SQLite",
  "a JSON file",
  "browser storage (localStorage)",
  "MySQL",
  "MongoDB",
  "Firebase",
]);

/**
 * What the request asks for that is not TurbineH's stack, and what the person gets instead (shown in the plan). A
 * request is never refused for its stack: the app is built on the supported stack and the plan says so.
 */
export function stackNote(prompt: string): { asked: string[]; note: string } | null {
  const asked = OTHER_STACK.filter(([, re]) => re.test(prompt)).map(([label]) => label);
  if (asked.length === 0) return null;
  const storage = asked.filter((a) => STORAGE.has(a));
  const list = asked.join(", ");
  return {
    asked,
    note:
      `You asked for ${list}. TurbineH builds new apps on its supported stack only (${SUPPORTED_STACK}): you get a ` +
      `complete Next.js app (React screens styled with Tailwind CSS), not ${list} code.` +
      (storage.length
        ? ` Your data is persisted for real in PostgreSQL, a database, instead of ${storage.join(" or ")}.`
        : ""),
  };
}

/**
 * Moves general requirements out of the acceptance criteria (they are listed with how each is handled), and records
 * the stack note. Idempotent. The functional criteria that remain are what the scope gate and the tests measure.
 */
export function separateGeneral(
  spec: BuildSpec,
  prompt = "",
): { spec: BuildSpec; general: GeneralRequirement[]; stack: ReturnType<typeof stackNote> } {
  const general: GeneralRequirement[] = [];
  const functional = spec.acceptance_criteria.filter((c) => {
    const kind = generalKind(c);
    if (!kind) return true;
    general.push({ requirement: c, kind, how: GENERAL_HOW[kind] });
    return false;
  });
  const stack = stackNote(prompt);
  if (stack)
    general.push({
      requirement: `Stack asked: ${stack.asked.join(", ")}`,
      kind: "stack",
      how: stack.note,
    });
  const previous = spec.general_requirements ?? [];
  const all = [
    ...previous,
    ...general.filter((g) => !previous.some((p) => p.requirement === g.requirement)),
  ];
  return {
    spec:
      all.length === 0
        ? spec
        : { ...spec, acceptance_criteria: functional, general_requirements: all },
    general: all as GeneralRequirement[],
    stack,
  };
}
