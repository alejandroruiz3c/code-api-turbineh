/**
 * Recipe + component combinations, assembled exactly as the pipeline assembles them (ADR-0037 §D4). A change to one
 * catalog component can break another one only when both are assembled together (66af3182: a bookings-domain E2E
 * test broke against the ai-agents recipe's staff default). `verify:recipe` and CI check every combination, so such a
 * regression is caught before main, not in a client build.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { assemble, mergedRecipe, recipeChain, type SelectedComponent } from "@turbineh/assembler";
import { readParamsDecl, validateParams } from "@turbineh/catalog";
import { ALWAYS_ON, detectDomains, extractPalette, type BuildSpec } from "@turbineh/compiler";
import type { CandidateCard } from "@turbineh/selector";
import { loadCatalog } from "./catalog-source.js";

/**
 * One representative request per domain component: the request that makes the compiler select it. A new domain
 * component adds its probe here (checked by `combinations.test.ts`).
 */
export const DOMAIN_PROBES: Record<string, string> = {
  "domain.bookings.turbineh":
    'Build an AI booking assistant for "Flex Physio", a physiotherapy clinic with three physiotherapists and 45-minute ' +
    "sessions (Monday–Friday 09:00–19:00, Europe/Madrid). Patients chat with the assistant in plain language to: check " +
    "availability, book a session with a chosen or any physiotherapist, reschedule, cancel (not later than 24 hours " +
    "before), and ask common questions (prices: first visit 60 €, follow-up 50 €; address; what to bring). The assistant " +
    "must use tools over the clinic's real data (availability, create/move/cancel booking, find booking by email) and " +
    "never invent a slot; it confirms details before booking and sends a confirmation email. Staff sign in to see and " +
    "manage the bookings. The assistant's language model is reached through an OpenAI-compatible endpoint configured by " +
    "environment variables; tests must use a local mock of that endpoint (no internet in tests). Protect it against " +
    "prompt injection and abuse (input limits, rate limits).",
};

export interface Combination {
  /** "ai-agents" or "ai-agents+domain.bookings.turbineh". */
  name: string;
  recipe: string;
  prompt: string;
  /** Native components assembled with the recipe besides what the pipeline selects by code (ADR-0041). */
  with?: string[];
  /** Request parameters per component (what the compiler writes to its params file); defaults otherwise. */
  params?: Record<string, Record<string, unknown>>;
  /** Entities of the spec (generated CRUD), when the combination needs some. */
  entities?: BuildSpec["entities"];
}

/**
 * Recipe + component combinations shown assembled and verified (ADR-0041): the business patterns the learning round
 * found missing (bench/frontiers/ANALYSIS.md §12, G1), each with the request it comes from and the parameters a
 * compiler would write for it. `verify:recipe <name>` runs one; `--all` runs them all.
 */
const STAGES = ["thrown", "trimmed", "bisque_fired", "glazed", "glaze_fired", "ready", "sold"];
const stageLabel = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");

export const COMPONENT_COMBINATIONS: Omit<Combination, "name">[] = [
  {
    // Kilnwise (learning round, tracker): stages with date and person, per-stage limits, history not editable.
    recipe: "tracker",
    with: ["domain.workflow.turbineh"],
    prompt:
      'Build "Kilnwise", a production tracker for a ceramics studio. Visual identity: terracotta `#C2522D`, sand ' +
      "`#EFE6DA`, dark brown text. Each piece goes through stages (thrown, trimmed, bisque fired, glazed, glaze fired, " +
      "ready, sold) with the date and the person for every change. Alerts when a piece has been in a stage longer than " +
      "the stage's limit. Every stage change is recorded and cannot be edited afterwards.",
    params: {
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "piece",
            label: "Piece",
            plural: "Pieces",
            initial: "thrown",
            dueDate: false,
            createRoles: ["*"],
            states: STAGES.map((key) => ({
              key,
              label: stageLabel(key),
              limitHours:
                { thrown: 48, trimmed: 72, bisque_fired: 120, glazed: 72, glaze_fired: 96 }[key] ??
                null,
              final: key === "sold",
            })),
            transitions: STAGES.slice(0, -1).map((from, i) => ({
              from: [from],
              to: STAGES[i + 1] as string,
              label: `Mark ${stageLabel(STAGES[i + 1] as string).toLowerCase()}`,
              roles: ["*"],
            })),
          },
        ],
      },
    },
  },
  {
    // Fieldnote (learning round, saas-crud): roles owner/editor/viewer, invitations, audit log visible to owners.
    recipe: "saas-crud",
    with: ["domain.membership-access.turbineh", "domain.audit-log.turbineh"],
    prompt:
      'Build "Fieldnote", a small SaaS where teams keep a library of customer interview notes. Visual identity: white ' +
      "background, ink text `#1B1F3B`, violet accents `#6C4CF1`, rounded cards. Teams sign up, create a workspace and " +
      "invite teammates by email with roles (owner, editor, viewer: viewers cannot edit). Every change is recorded in " +
      "an audit log visible to owners.",
    entities: [
      {
        name: "Note",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "customerCompany", type: "string", required: true },
          { name: "interviewDate", type: "date", required: true },
          { name: "tags", type: "string", required: false },
          { name: "body", type: "text", required: true },
        ],
      },
    ],
    params: {
      "domain.membership-access.turbineh": {
        roles: [
          {
            key: "owner",
            label: "Owner",
            can: [
              "read",
              "create",
              "update",
              "delete",
              "manage_members",
              "view_audit",
              "see_all_scopes",
            ],
          },
          {
            key: "editor",
            label: "Editor",
            can: ["read", "create", "update", "delete", "see_all_scopes"],
          },
          { key: "viewer", label: "Viewer", can: ["read", "see_all_scopes"] },
        ],
        defaultRole: "viewer",
        inviteRoles: ["editor", "viewer"],
        invitationDays: 7,
        scope: null,
      },
    },
  },
  {
    // Ledgerline (learning round, client-portal): staff/client roles, a client sees only their company, private
    // uploads (PDF/JPG/PNG up to 10 MB) downloadable by that client and staff, document requests pending → received →
    // approved with due dates, staff emailed when a client uploads.
    recipe: "client-portal",
    with: [
      "domain.membership-access.turbineh",
      "storage.private-uploads.turbineh",
      "domain.workflow.turbineh",
    ],
    prompt:
      'Build a client portal for "Ledgerline", a small accounting firm. Visual identity: deep green `#0B3D2E`, cream ' +
      "background `#F7F3EA`, gold highlights `#C9A227`. Staff create client accounts and invite each client by email; a " +
      "client only ever sees their own company. Clients upload documents (PDF/JPG/PNG up to 10 MB, stored privately, " +
      "downloadable only by that client and staff), see a list of document requests with due dates and statuses " +
      "(pending, received, approved), and exchange messages with the firm per request. Staff see all clients, change " +
      "statuses and get an email when a client uploads (log it when no email provider is configured).",
    params: {
      "domain.membership-access.turbineh": {
        roles: [
          {
            key: "owner",
            label: "Owner",
            can: [
              "read",
              "create",
              "update",
              "delete",
              "manage_members",
              "view_audit",
              "see_all_scopes",
            ],
          },
          {
            key: "staff",
            label: "Staff",
            can: ["read", "create", "update", "delete", "manage_members", "see_all_scopes"],
          },
          { key: "client", label: "Client", can: ["read", "create"] },
        ],
        defaultRole: "client",
        inviteRoles: ["staff", "client"],
        invitationDays: 7,
        scope: { kind: "company", label: "Company", plural: "Companies" },
      },
      "storage.private-uploads.turbineh": {
        maxBytes: 10 * 1024 * 1024,
        types: ["pdf", "jpg", "png"],
        maxFilesPerRecord: 20,
        notifyOnUpload: true,
      },
      "domain.workflow.turbineh": {
        workflows: [
          {
            key: "request",
            label: "Document request",
            plural: "Document requests",
            initial: "pending",
            dueDate: true,
            createRoles: ["owner", "staff"],
            states: [
              { key: "pending", label: "Pending", limitHours: null, final: false },
              { key: "received", label: "Received", limitHours: 72, final: false },
              { key: "approved", label: "Approved", limitHours: null, final: true },
            ],
            transitions: [
              {
                from: ["pending"],
                to: "received",
                label: "Mark received",
                roles: ["owner", "staff"],
              },
              { from: ["received"], to: "approved", label: "Approve", roles: ["owner", "staff"] },
              { from: ["received"], to: "pending", label: "Ask again", roles: ["owner", "staff"] },
            ],
          },
        ],
      },
    },
  },
];

/** Every recipe alone, every recipe a domain component's probe selects it for, and COMPONENT_COMBINATIONS. */
export function combinations(repoRoot: string): Combination[] {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const recipes = readdirSync(recipesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(recipesDir, d.name, "recipe.yaml")))
    .map((d) => d.name)
    .sort();
  const out: Combination[] = recipes.map((recipe) => ({ name: recipe, recipe, prompt: "" }));
  for (const recipe of recipes) {
    for (const [component, prompt] of Object.entries(DOMAIN_PROBES)) {
      if (detectDomains(prompt, recipe).some((d) => d.component === component)) {
        out.push({ name: `${recipe}+${component}`, recipe, prompt });
      }
    }
  }
  for (const c of COMPONENT_COMBINATIONS)
    out.push({ ...c, name: [c.recipe, ...(c.with ?? [])].join("+") });
  return out;
}

/** The minimal spec used for template checks (no models involved). */
export function checkSpec(
  recipe: string,
  prompt: string,
  entities: BuildSpec["entities"] = [],
): BuildSpec {
  return {
    recipe: recipe as BuildSpec["recipe"],
    out_of_scope_reason: null,
    closest_recipe: null,
    app_name: "Recipe Check",
    slug: "recipe-check",
    summary: `Verification of the ${recipe} recipe template.`,
    roles: ["owner"],
    entities,
    pages: [{ path: "/", purpose: "Home", auth_required: false }],
    capabilities: ["security.headers", "data.validation"],
    acceptance_criteria: [
      "Owner signs in and reaches the dashboard",
      "Anonymous users are sent to sign-in",
      "Every action checks the workspace",
    ],
    site: null,
    palette: extractPalette(prompt),
  };
}

/**
 * Native components the pipeline vendors for this recipe and request, chosen by code as the pipeline does: the
 * recipe's required components, the detected domain components, native components for the recipe's default and
 * always-on capabilities, their `requires`, and `extra` ids (--with).
 */
export function nativeSelection(
  repoRoot: string,
  recipe: string,
  prompt: string,
  extra: string[] = [],
): { selected: SelectedComponent[]; domains: ReturnType<typeof detectDomains> } {
  const recipesDir = join(repoRoot, "catalog/recipes");
  const merged = mergedRecipe(recipeChain(recipesDir, recipe));
  const catalog = loadCatalog(join(repoRoot, "catalog/components"), { cards: "oneliner" });
  const approved = (c: CandidateCard) => c.status === "approved";
  const native = (c: CandidateCard) => c.pkg.name.startsWith("turbineh/");
  const domains = detectDomains(prompt, recipe, "Recipe Check");
  const ids = new Set<string>([
    ...Object.values(merged.requiredComponents ?? {}),
    ...domains.map((d) => d.component),
    ...extra,
  ]);
  const provided = new Set(merged.providedCapabilities ?? []);
  for (const cap of [...merged.defaultCapabilities, ...ALWAYS_ON]) {
    if (provided.has(cap)) continue;
    const c = catalog.find((x) => approved(x) && native(x) && x.provides.includes(cap));
    if (c) ids.add(c.id);
  }
  // Requirements between components (e.g. the orchestrator requires the AI Safety Pack).
  for (let changed = true; changed;) {
    changed = false;
    for (const id of [...ids]) {
      for (const r of catalog.find((x) => x.id === id)?.requires ?? []) {
        if (!ids.has(r) && catalog.some((x) => x.id === r)) {
          ids.add(r);
          changed = true;
        }
      }
    }
  }
  const selected = [...ids].map((id): SelectedComponent => {
    const c = catalog.find((x) => x.id === id);
    if (!c) throw new Error(`unknown component ${id}`);
    return {
      capability: c.provides[0] ?? id.split(".").slice(0, 2).join("."),
      component: c,
      why: { pBest: 1, covers: 1, risk: 0 },
    };
  });
  return { selected, domains };
}

/** Assembles one combination into `outDir` the way the pipeline does. */
export function assembleCombination(
  repoRoot: string,
  c: Pick<Combination, "recipe" | "prompt" | "with" | "params" | "entities">,
  outDir: string,
  extra: string[] = [],
): { components: string[]; domains: string[] } {
  const { selected, domains } = nativeSelection(repoRoot, c.recipe, c.prompt, [
    ...(c.with ?? []),
    ...extra,
  ]);
  // Parameters of the combination (what the compiler would extract from the request), written like detected domains.
  const componentsDir = join(repoRoot, "catalog/components");
  const given = Object.entries(c.params ?? {}).map(([component, params]) => {
    const errors = validateParams(join(componentsDir, component), params);
    if (errors.length) throw new Error(`${component} params: ${errors.join("; ")}`);
    const decl = readParamsDecl(join(componentsDir, component));
    return {
      id: component,
      capability: component.split(".").slice(0, 2).join("."),
      component,
      recipes: [c.recipe],
      paramsFile: decl?.file ?? "",
      params,
      providedEntities: decl?.entities ?? [],
      assumptions: [],
    };
  });
  const all = [...domains, ...given];
  assemble({
    buildId: "recipe-check",
    recipesDir: join(repoRoot, "catalog/recipes"),
    recipe: c.recipe,
    outDir,
    spec: checkSpec(c.recipe, c.prompt, c.entities ?? []),
    selected,
    gaps: [],
    domains: all,
  });
  return {
    components: selected.map((s) => s.component.id),
    domains: domains.map((d) => d.component),
  };
}
