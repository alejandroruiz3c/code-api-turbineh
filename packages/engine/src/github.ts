import {
  analyseRepo,
  firstReadList,
  isReadable,
  pickAppPath,
  secondReadList,
  type RepoAnalysis,
} from "./repo-analysis.js";

/**
 * Minimal GitHub REST client for the repository integration (PLAN §16 P5), shared by the API and the worker. The
 * token is passed per call and never logged or echoed: error messages carry GitHub's status and message only.
 */
export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
export const BRANCH_NAME = /^(?!.*\.\.)(?!\/)[A-Za-z0-9._/-]{1,200}(?<!\/)$/;

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly action: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export interface GitHub {
  <T>(method: string, path: string, body?: unknown): Promise<T | null>;
  raw(path: string, accept: string): Promise<Response>;
}

export function github(token: string | null, fetchImpl: Fetch = fetch): GitHub {
  const headers = (accept = "application/vnd.github+json") => ({
    Accept: accept,
    "User-Agent": "turbineh",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  /**
   * Network errors (connection reset, DNS, timeouts) are retried with backoff when repeating is safe: reads,
   * updates and content-addressed writes (blobs, trees, commits); creating a ref or a PR is not repeated blindly.
   */
  const send = async (method: string, path: string, init: RequestInit): Promise<Response> => {
    const safe =
      method !== "POST" || /\/git\/(blobs|trees|commits)$/.test(path) || path === "/graphql";
    for (let attempt = 0; ; attempt++) {
      try {
        return await fetchImpl(`https://api.github.com${path}`, init);
      } catch (e) {
        if (!safe || attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, [2000, 5000, 10000][attempt] ?? 10000));
      }
    }
  };
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T | null> => {
    for (let attempt = 0; ; attempt++) {
      const res = await send(method, path, {
        method,
        headers: { ...headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const limited =
        res.status === 429 ||
        (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
      if (limited && attempt < 2) {
        const wait = Number(res.headers.get("retry-after") ?? 5 * (attempt + 1));
        await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000));
        continue;
      }
      if (res.status === 404 && method === "GET") return null;
      if (res.status === 204) return {} as T;
      if (!res.ok) {
        const detail = ((await res.json().catch(() => null)) as { message?: string } | null)
          ?.message;
        if (res.status === 401)
          throw new GitHubError(
            401,
            "GitHub no longer accepts the connection.",
            "Connect GitHub again (the authorization was revoked or expired).",
          );
        if (limited)
          throw new GitHubError(
            429,
            "GitHub's rate limit was reached.",
            "Try again in a few minutes.",
          );
        if (res.status === 403 || res.status === 404)
          throw new GitHubError(
            403,
            `GitHub refused ${method} ${path.split("?")[0]}${detail ? `: ${detail}` : ""}.`,
            "Check that the connected account can write to this repository (for private repositories, connect with private access).",
          );
        throw new GitHubError(
          res.status === 422 ? 422 : 502,
          `GitHub answered ${res.status}${detail ? `: ${detail}` : ""}.`,
          "Try again in a moment.",
        );
      }
      return (await res.json()) as T;
    }
  };
  const fn = call as GitHub;
  fn.raw = (path: string, accept: string) =>
    send("GET", path, {
      headers: headers(accept),
      redirect: "follow",
      signal: AbortSignal.timeout(180_000),
    });
  return fn;
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
  description: string | null;
  pushedAt: string | null;
}

interface GhRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  pushed_at: string | null;
  permissions?: { push?: boolean };
}

const toInfo = (r: GhRepo): RepoInfo => ({
  fullName: r.full_name,
  private: r.private,
  defaultBranch: r.default_branch,
  canPush: r.permissions?.push !== false,
  description: r.description,
  pushedAt: r.pushed_at,
});

export async function repoInfo(gh: GitHub, fullName: string): Promise<RepoInfo> {
  if (!REPO_NAME.test(fullName))
    throw new GitHubError(422, "Invalid repository name.", "Use the form owner/name.");
  const r = await gh<GhRepo>("GET", `/repos/${fullName}`);
  if (!r)
    throw new GitHubError(
      404,
      `Repository ${fullName} not found.`,
      "Check the name; for a private repository, connect GitHub with private access.",
    );
  return toInfo(r);
}

/** Repositories the connected account can write to, most recently pushed first; `q` filters by name. */
export async function listRepos(gh: GitHub, q = "", pages = 3): Promise<RepoInfo[]> {
  const out: RepoInfo[] = [];
  for (let page = 1; page <= pages; page++) {
    const list =
      (await gh<GhRepo[]>(
        "GET",
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      )) ?? [];
    out.push(...list.map(toInfo));
    if (list.length < 100) break;
  }
  const needle = q.trim().toLowerCase();
  return out
    .filter((r) => r.canPush)
    .filter((r) => !needle || r.fullName.toLowerCase().includes(needle));
}

/** File list of a branch (paths only) — the recursive tree, truncated by GitHub for very large repositories. */
export async function repoPaths(
  gh: GitHub,
  fullName: string,
  ref: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const tree = await gh<{ tree?: { path: string; type: string }[]; truncated?: boolean }>(
    "GET",
    `/repos/${fullName}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  if (!tree) throw new GitHubError(404, `Branch ${ref} not found.`, "Pick an existing branch.");
  return {
    paths: (tree.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path),
    truncated: Boolean(tree.truncated),
  };
}

const MAX_FILE_BYTES = 300_000;

/** Reads text files of a branch; secrets and env files are refused by name, whatever the caller asks. */
export async function readFiles(
  gh: GitHub,
  fullName: string,
  ref: string,
  paths: string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await Promise.all(
    paths.filter(isReadable).map(async (p) => {
      const res = await gh.raw(
        `/repos/${fullName}/contents/${p.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`,
        "application/vnd.github.raw",
      );
      if (!res.ok) return;
      const text = await res.text();
      if (text.length <= MAX_FILE_BYTES) files[p] = text;
    }),
  );
  return files;
}

/**
 * Analysis of a GitHub repository through the API: paths, then root manifests and workspace package.json files,
 * then the application's configuration. No clone, no source beyond configuration and database-client modules, never
 * an env file's content.
 */
export async function analyseGitHubRepo(
  gh: GitHub,
  fullName: string,
  opts: { ref?: string; appPath?: string } = {},
): Promise<{ analysis: RepoAnalysis; info: RepoInfo; files: Record<string, string> }> {
  const info = await repoInfo(gh, fullName);
  const ref = opts.ref ?? info.defaultBranch;
  const { paths, truncated } = await repoPaths(gh, fullName, ref);
  const first = await readFiles(gh, fullName, ref, firstReadList(paths));
  const appPath = pickAppPath(first, opts.appPath);
  const second = await readFiles(gh, fullName, ref, secondReadList(paths, appPath, first));
  const files = { ...first, ...second };
  const analysis = analyseRepo({ repo: fullName, ref, paths, files, appPath });
  if (truncated)
    analysis.conventions.push(
      "Very large repository: GitHub listed part of the file tree; the analysis may miss files.",
    );
  return { analysis, info, files };
}
