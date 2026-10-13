import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProductError, ProjectPreferences } from "@turbineh/shared";

export const VERSION = "0.1.0";
export const DEFAULT_URL = "https://software.turbineh.com";

/** A CLI failure carries the same actionable ProductError the API returns. */
export class CliError extends Error {
  constructor(
    readonly error: ProductError,
    readonly exitCode = 1,
  ) {
    super(error.message);
  }
}

export const fail = (code: string, message: string, action: string, resume?: string): never => {
  throw new CliError({ code, message, action, ...(resume ? { resume } : {}) });
};

// ── user config (~/.config/turbineh/config.json, mode 600) ─────────────────────────────────────────────────

const userConfigPath = () =>
  join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "turbineh", "config.json");

export interface UserConfig {
  token?: string;
  url?: string;
}

export function readUserConfig(): UserConfig {
  try {
    return JSON.parse(readFileSync(userConfigPath(), "utf8")) as UserConfig;
  } catch {
    return {};
  }
}

export function writeUserConfig(c: UserConfig): string {
  const p = userConfigPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  chmodSync(p, 0o600);
  return p;
}

export function token(): string {
  const t = process.env.TURBINEH_TOKEN ?? readUserConfig().token;
  if (!t)
    fail(
      "unauthorized",
      "No access token configured.",
      "Run `turbineh login <token>` (or set TURBINEH_TOKEN) with the token from your invitation.",
    );
  return t as string;
}

/** TURBINEH_URL › `login --url` › the server the CLI was installed from (install.sh) › production. */
export const baseUrl = () =>
  (
    process.env.TURBINEH_URL ??
    readUserConfig().url ??
    process.env.TURBINEH_INSTALL_URL ??
    DEFAULT_URL
  ).replace(/\/$/, "");

// ── project (.turbineh/project.json) ───────────────────────────────────────────────────────────────────────

export interface IntegrationEntry {
  id: string;
  planId: string;
  slug: string;
  branch: string;
  commit: string;
  state: "integrated" | "integration_verified" | "reverted";
  at: string;
  /** Folder of the capability in the project (adapted placement); default turbineh/<slug>. */
  dir?: string;
}

/** A `turbineh build` still running or not written yet (resumable with `turbineh resume`). */
export interface PendingBuild {
  id: string;
  /** app = complete application into an empty folder; repo = capability adapted into this project. */
  target: "app" | "repo";
  need: string;
  startedAt: string;
}

export interface ProjectFile {
  workspace: string;
  preferences: ProjectPreferences;
  lastPlan?: string;
  pending?: PendingBuild;
  /** Every `turbineh build` written here (id = plan/build id on the server). */
  builds?: { id: string; target: "app" | "repo"; commit: string; at: string }[];
  integrations: IntegrationEntry[];
}

export const projectPath = (cwd: string) => join(cwd, ".turbineh", "project.json");

export function readProject(cwd: string): ProjectFile | null {
  const p = projectPath(cwd);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ProjectFile;
}

export function writeProject(cwd: string, p: ProjectFile): void {
  mkdirSync(join(cwd, ".turbineh"), { recursive: true });
  writeFileSync(projectPath(cwd), `${JSON.stringify(p, null, 2)}\n`);
}

/** The project file, created with defaults when missing (each project is its own workspace). */
export function ensureProject(cwd: string): ProjectFile {
  return (
    readProject(cwd) ?? {
      workspace: randomUUID(),
      preferences: {
        changePolicy: { autoApply: "never", allowDependencyChanges: true, allowNewEnv: true },
      },
      integrations: [],
    }
  );
}
