import type {
  DetectedStack,
  FileChange,
  PlanAction,
  PlanLeftItem,
  PlanOutcome,
} from "@turbineh/shared";
import { frameworkLabel, languageLabel, major, TARGET_STACK } from "./stack.js";

/**
 * What a plan gives the person, in plain words, with one-click next actions (ADR-0050). Deterministic: it depends
 * only on the stack and the kind of plan. Messages follow one rule: what happened, what it means, what to do.
 */

const ACTIONS = {
  generateApp: {
    id: "generate",
    label: "Generate the complete app",
    detail:
      "Builds the new project and verifies it in our sandbox (build, tests, end-to-end, security). You download it or put it online in your own accounts.",
  },
  buildNext: {
    id: "build_nextjs_app",
    label: "Build a complete Next.js app instead",
    detail:
      "Switches the plan to Next.js, our main path: one complete app — screens, server code, database and sign-in — ready to run.",
  },
  connectRepo: {
    id: "connect_repo",
    label: "Add it to my repository",
    detail:
      "Connect GitHub and pick the repository: TurbineH adapts the code to your conventions and opens a pull request verified inside your project.",
  },
  uploadFiles: {
    id: "upload_files",
    label: "Upload my project's files",
    detail:
      "Select your project folder: only manifests (package.json, tsconfig, framework config) are read, to fit the plan to your stack.",
  },
} as const satisfies Record<string, PlanAction>;

const generateFor = (label: string, detail: string): PlanAction => ({
  id: "generate",
  label,
  detail,
});

/** Facts about the versions a new app is built on, when the person typed different ones. */
function versionNotes(stack: DetectedStack): string[] {
  const notes: string[] = [];
  const next = major(stack.versions.next);
  if (Number.isFinite(next) && next !== Number(TARGET_STACK.versions.next))
    notes.push(
      `The app is built on Next.js ${TARGET_STACK.versions.next}, the version it is verified on (you entered ${stack.versions.next}).`,
    );
  const node = major(stack.versions.node);
  if (Number.isFinite(node) && node < 20)
    notes.push(
      `It needs Node.js 20 or later to run (you entered ${stack.versions.node}); install Node.js 24 LTS.`,
    );
  return notes;
}

export function planOutcome(stack: DetectedStack, kind: "use_case" | "component"): PlanOutcome {
  const js = stack.language === "typescript" || stack.language === "javascript";
  const fw = frameworkLabel(stack.framework);
  if (stack.source !== "declared") {
    const where = stack.source === "repo" ? "your repository" : "your project";
    return {
      kind: "project_changes",
      title:
        kind === "use_case"
          ? `A verified capability adapted to ${where}`
          : `Verified components for ${where}`,
      meaning:
        stack.source === "repo"
          ? "TurbineH generates and verifies the package, then adapts it to your repository's conventions and opens a pull request that is checked inside your project. Nothing is merged without you."
          : "TurbineH generates and verifies the package for your stack. Apply it with `turbineh apply` (or your coding agent) and check it in your project with `turbineh verify`.",
      notes: [],
      actions: [
        generateFor(
          "Generate & verify",
          "Builds the package and verifies it in our sandbox before anything touches your project.",
        ),
        ACTIONS.buildNext,
      ],
    };
  }
  if (kind === "component")
    return {
      kind: "server_modules",
      title: "Verified components for your new project",
      meaning:
        "No complete app template matches this need, so you get the certified TypeScript modules that cover it, with examples and tests. Add them to a Next.js or Node.js project, or build a complete Next.js app instead.",
      notes: versionNotes(stack),
      actions: [
        generateFor("Generate the components", "Packages the certified modules with examples."),
        ACTIONS.buildNext,
        ACTIONS.connectRepo,
      ],
    };
  if (js && (!stack.framework || stack.framework === "nextjs"))
    return {
      kind: "complete_app",
      title: "A complete Next.js app, built for you",
      meaning:
        "A new project with its screens, server code, database, sign-in and tests, verified in our sandbox. You download it or put it online in your own accounts; you only add the settings listed in the plan.",
      notes: versionNotes(stack),
      actions: [ACTIONS.generateApp, ACTIONS.connectRepo, ACTIONS.uploadFiles],
    };
  if (js)
    return {
      kind: "server_modules",
      title: `For ${fw}: a complete Next.js app whose server code you can reuse`,
      meaning: `TurbineH builds Next.js apps; it does not write ${fw} code. You get a complete, verified Next.js app. Its server code under src/ (data access, validation, business rules) is plain TypeScript you can import into ${fw}. Its screens are Next.js pages: ${fw} does not use them, so you rebuild them in ${fw} or run the Next.js app next to yours.`,
      notes: [
        `What you do in ${fw}: import the modules from src/server, src/db and src/lib, and call them from your routes.`,
        ...versionNotes(stack),
      ],
      actions: [
        ACTIONS.buildNext,
        generateFor(
          `Generate it to reuse in ${fw}`,
          `Builds the same complete Next.js app; you take its server modules into your ${fw} app.`,
        ),
        ACTIONS.connectRepo,
      ],
    };
  const lang = languageLabel(stack.language);
  return {
    kind: "separate_service",
    title: `For ${lang}: a complete Next.js app that runs next to your code`,
    meaning: `TurbineH builds TypeScript apps, so nothing is written in ${lang}${fw ? ` or ${fw}` : ""}. You get a complete, verified Next.js app that runs as its own service; your ${lang} code calls it over HTTP if it needs to.`,
    notes: versionNotes(stack),
    actions: [
      ACTIONS.buildNext,
      generateFor(
        "Generate it as a separate service",
        `Builds the complete Next.js app; you run it next to your ${lang} code.`,
      ),
    ],
  };
}

/** Files of a new, standalone project (a declared stack): what the person receives, not changes to their code. */
export function standaloneFiles(slug: string): FileChange[] {
  return [
    {
      path: `${slug}/src/app/`,
      action: "add",
      why: "Screens and API routes (Next.js App Router)",
    },
    {
      path: `${slug}/src/server/ · src/db/ · src/lib/`,
      action: "add",
      why: "Server code: data access, validation and business rules",
    },
    { path: `${slug}/drizzle/`, action: "add", why: "Database migrations (PostgreSQL)" },
    {
      path: `${slug}/tests/`,
      action: "add",
      why: "Unit and end-to-end tests that already passed in our sandbox",
    },
    {
      path: `${slug}/README.md · DEPLOY.md`,
      action: "add",
      why: "How to run it locally and put it online",
    },
    {
      path: `${slug}/AGENTS.md · turbineh.json`,
      action: "add",
      why: "What is done (with the test that proves it), what is left and where, for you or your coding agent",
    },
    {
      path: `${slug}/.env.example`,
      action: "add",
      why: "Settings you provide (names only, never secrets)",
    },
  ];
}

const WHERE_LEFT = "AGENTS.md › What is left (the generated app) names the file for each one";

/** Gaps and uncovered parts as "what is left", each with where it is implemented. */
export function leftItems(input: {
  gaps: string[];
  notCovered: string[];
  label?: (capability: string) => string;
}): PlanLeftItem[] {
  const label = input.label ?? ((c: string) => c);
  return [
    ...input.gaps.map((g) => ({
      part: label(g),
      why: "No verified component covers it yet: the Backup Coder may write it during generation. That code is not catalogue-verified; only this build's checks cover it.",
      where: `Generated code marked \`turbineh:generated-backup\` — ${WHERE_LEFT}`,
    })),
    ...input.notCovered.map((n) => ({
      part: n,
      why: "Not built automatically by this plan.",
      where: WHERE_LEFT,
    })),
  ];
}

/** Acceptance criteria no shipped test proves yet: listed as what is left (they never block generation). */
export function openCriteriaLeft(
  criteria: { criterion: string; status: "covered" | "open" }[] | undefined,
): PlanLeftItem[] {
  return (criteria ?? [])
    .filter((c) => c.status === "open")
    .map((c) => ({
      part: c.criterion,
      why: "No test shipped with the selected parts proves it yet, so it is not promised as done.",
      where: `Check it in the app, then add a test — ${WHERE_LEFT}`,
    }));
}
