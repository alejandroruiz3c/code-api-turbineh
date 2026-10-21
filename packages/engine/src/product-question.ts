import { summarizeUseCase } from "./search.js";
import type { UseCase } from "./types.js";
import { USE_CASES } from "./use-cases.generated.js";

/**
 * Questions about TurbineH itself ("what can you do?", "¿qué puedo hacer contigo?") are not requests to build anything
 * (ADR-0069). They get a help answer — the covered use cases, each with a concrete example request — and never create
 * a flow, a failed build or an uncovered-demand row. Deterministic and precision first: only a whole message that is
 * one of these questions qualifies; anything that names a product to build ("help desk app where customers open
 * tickets", "a FAQ page", "what can you do app for kids") is a request and follows the normal path.
 */

/** Lowercase, without accents, inverted marks and surrounding punctuation; greetings and "please" dropped. */
export function normalizeQuestion(text: string): string {
  let t = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[¿¡?!.,;:()"'`´]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t
    .replace(
      /^(hi|hello|hey|hola|buenas|buenos dias|buenas tardes|buenas noches|ok|okay|vale)( there)?\s+/,
      "",
    )
    .replace(/\s+(please|pls|por favor|thanks|thank you|gracias)$/, "")
    .trim();
  return t;
}

const WHO = "(you|turbineh|this|this tool|this app|this platform|this service|the tool)";
const WITH_YOU = `(with (you|turbineh|this|it)|here|for me)`;
const THINGS =
  "(apps?|applications?|things|software|products?|websites?|sites?|use cases?|kinds? of apps?)";

/** Whole-message patterns (after `normalizeQuestion`). */
const QUESTIONS: readonly RegExp[] = [
  // English
  /^(help|help me|\?|menu|usage|what now)$/,
  new RegExp(`^what (can|could) (you|turbineh|it) (do|build|make|create)( for me)?$`),
  new RegExp(`^what (can|could) (i|we) (do|build|make|create|ask)( ${WITH_YOU})?$`),
  new RegExp(`^what (do|does) ${WHO} do$`),
  new RegExp(`^what (is|are) ${WHO}$`),
  new RegExp(`^who are you$`),
  new RegExp(`^how (does|do) ${WHO} work$`),
  new RegExp(`^how (do|can) (i|we) (use|start with|get started with) ${WHO}$`),
  new RegExp(`^(what|how) can you help( me)? with$`),
  new RegExp(`^(can you|could you) help( me)?$`),
  new RegExp(
    `^what (kinds? of |sort of |types? of )?${THINGS} (can|could|do) (you|i|we) (build|make|create|do)( ${WITH_YOU})?$`,
  ),
  new RegExp(`^(show me )?(some )?examples$`),
  // Spanish
  /^(ayuda|ayudame|necesito ayuda)$/,
  new RegExp(
    `^que (puedo|podemos|podria) (hacer|construir|crear|pedir)( (contigo|con turbineh|con esto|aqui|aca))?$`,
  ),
  /^que (sabes|puedes|podes) hacer$/,
  /^que (haces|eres|es (esto|turbineh))$/,
  /^quien eres$/,
  /^como (funciona|funcionas|se usa|te uso|uso (esto|turbineh))( (esto|turbineh))?$/,
  /^en que (me )?(puedes|podes) ayudar(me)?$/,
  /^(me )?(puedes|podes) ayudar(me)?$/,
  new RegExp(
    `^que (tipo de |tipos de |clase de )?(apps?|aplicaciones|cosas|software|productos|webs?|sitios) (puedes|puedo|podemos|sabes) (hacer|crear|construir)( (contigo|con turbineh|aqui))?$`,
  ),
  /^(dame |muestrame )?(algunos )?ejemplos$/,
];

/** True when the whole message is a question about TurbineH, not a request to build something. */
export function isProductQuestion(text: string): boolean {
  if (text.length > 160) return false;
  const t = normalizeQuestion(text);
  if (!t || t.split(" ").length > 12) return false;
  return QUESTIONS.some((re) => re.test(t));
}

export interface ProductHelpUseCase {
  id: string;
  name: string;
  /** What it builds (the catalogue text). */
  does: string;
  /** A request the library covers, ready to send as is. */
  example: string;
}

export interface ProductHelp {
  title: string;
  message: string;
  useCases: ProductHelpUseCase[];
  /** Pointer to the verified components (built on their own when chosen explicitly). */
  components: string;
  next: string;
}

/** The body every surface returns for a product question (`kind: "help"`): nothing is built or recorded. */
export interface ProductHelpResponse {
  kind: "help";
  help: ProductHelp;
}

const plain = (description: string) => description.replace(/\s*\(ADR-\d+\)\s*$/, "").trim();

/**
 * Example requests shown with the help answer: each use case's catalogue example (`summarizeUseCase(u).example`, the one
 * source of example prompts, also shown by search and Discover). Every one must pass the scope gate as covered (CI guard
 * of the examples we show).
 */
export const HELP_EXAMPLES: readonly { useCase: string; prompt: string }[] = USE_CASES.map((u) => ({
  useCase: u.id,
  prompt: summarizeUseCase(u).example,
}));

/** The help answer, from the use cases (never drifts from the catalogue). */
export function productHelp(useCases: readonly UseCase[] = USE_CASES): ProductHelp {
  return {
    title: "What TurbineH builds",
    message:
      "TurbineH builds new, complete web apps for the use cases below from verified components, and checks them in its sandbox (lint, types, unit, build, end-to-end and security). Describe the app you need — or start from one of the examples. Nothing was built for this question.",
    useCases: useCases.map((u) => ({
      id: u.id,
      name: u.name,
      does: plain(u.description),
      example: summarizeUseCase(u).example,
    })),
    components:
      "Verified components can also be built on their own: search them on /catalog, GET /v1/capabilities?q=…, `turbineh search <need>` or the MCP `search` tool, then pass their ids as `components`.",
    next: 'Describe the app to build, e.g. `turbineh build "<one of the examples>"`, POST /v1/plans {"need": "…"} or the MCP `build` tool.',
  };
}

export const productHelpResponse = (): ProductHelpResponse => ({
  kind: "help",
  help: productHelp(),
});
