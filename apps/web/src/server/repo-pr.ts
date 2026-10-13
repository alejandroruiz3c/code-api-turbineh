import {
  appendEnvExampleText,
  mergeDependenciesText,
  packageFiles,
  packageManifest,
} from "@turbineh/engine";

/**
 * Repository integration (PLAN §16, P5): the capability package delivered as a pull request on the user's GitHub
 * repository, with the same changes `turbineh apply` makes locally (package under `turbineh/<slug>/`, only missing
 * dependencies, settings documented by name) in one commit on a new branch. Uses the token the user provides for these
 * requests only; it is never stored. Nothing is merged: the user reviews the pull request.
 */
export const REPO_NAME = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export class RepoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly action: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

function github(token: string, fetchImpl: Fetch) {
  return async <T>(method: string, path: string, body?: unknown): Promise<T | null> => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "turbineh",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) {
      const detail = ((await res.json().catch(() => null)) as { message?: string } | null)?.message;
      if (res.status === 401)
        throw new RepoError(401, "GitHub rejected the token.", "Pass a valid GitHub token.");
      if (res.status === 403 || res.status === 404)
        throw new RepoError(
          403,
          "The token cannot write to this repository.",
          "Use a token with contents and pull request write access to the repository.",
        );
      if (res.status === 422 && path.endsWith("/git/refs"))
        throw new RepoError(
          409,
          "The integration branch already exists in the repository.",
          "Review the open pull request, or delete the branch and try again.",
        );
      throw new RepoError(
        502,
        `GitHub answered ${res.status}${detail ? `: ${detail}` : ""}.`,
        "Try again in a moment.",
      );
    }
    return (await res.json()) as T;
  };
}

const isText = (data: Buffer) =>
  !data.includes(0) && Buffer.from(data.toString("utf8")).equals(data);

export interface PullRequestInput {
  repo: string;
  base?: string;
  token: string;
  zip: Buffer;
  planId: string;
  need: string;
  fetchImpl?: Fetch;
}

export interface PullRequestResult {
  url: string;
  number: number;
  branch: string;
  commit: string;
  slug: string;
  added: string[];
  settings: string[];
}

export async function openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
  if (!REPO_NAME.test(input.repo))
    throw new RepoError(422, "Invalid repository name.", "Use the form owner/name.");
  const manifest = packageManifest(input.zip);
  if (!manifest) throw new RepoError(409, "The package has no manifest.", "Generate it again.");
  const gh = github(input.token, input.fetchImpl ?? fetch);
  const repo = `/repos/${input.repo}`;
  const info = await gh<{ default_branch: string; permissions?: { push?: boolean } }>("GET", repo);
  if (!info)
    throw new RepoError(
      404,
      `Repository ${input.repo} not found.`,
      "Check the name and that the token can see it.",
    );
  if (info.permissions && !info.permissions.push)
    throw new RepoError(
      403,
      "The token cannot write to this repository.",
      "Use a token with write access.",
    );
  const base = input.base ?? info.default_branch;
  const ref = await gh<{ object: { sha: string } }>(
    "GET",
    `${repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  if (!ref) throw new RepoError(404, `Branch ${base} not found.`, "Pass an existing base branch.");
  const head = await gh<{ tree: { sha: string } }>("GET", `${repo}/git/commits/${ref.object.sha}`);
  const read = async (path: string) => {
    const f = await gh<{ content?: string; encoding?: string }>(
      "GET",
      `${repo}/contents/${path}?ref=${encodeURIComponent(base)}`,
    );
    return f?.content ? Buffer.from(f.content, "base64").toString("utf8") : null;
  };

  const tree: { path: string; mode: "100644"; type: "blob"; content?: string; sha?: string }[] = [];
  for (const f of packageFiles(input.zip, manifest.slug)) {
    if (isText(f.data))
      tree.push({ path: f.path, mode: "100644", type: "blob", content: f.data.toString("utf8") });
    else {
      const blob = await gh<{ sha: string }>("POST", `${repo}/git/blobs`, {
        content: f.data.toString("base64"),
        encoding: "base64",
      });
      if (blob) tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }
  const pkg = mergeDependenciesText(await read("package.json"), manifest.dependencies);
  if (pkg.added.length && pkg.text)
    tree.push({ path: "package.json", mode: "100644", type: "blob", content: pkg.text });
  const env = appendEnvExampleText(
    (await read(".env.example")) ?? "",
    manifest.environment,
    manifest.slug,
  );
  if (env.missing.length)
    tree.push({ path: ".env.example", mode: "100644", type: "blob", content: env.text });

  const newTree = await gh<{ sha: string }>("POST", `${repo}/git/trees`, {
    base_tree: head?.tree.sha,
    tree,
  });
  const commit = await gh<{ sha: string }>("POST", `${repo}/git/commits`, {
    message: `feat(turbineh): integrate ${manifest.slug} (plan ${input.planId.slice(0, 8)})`,
    tree: newTree?.sha,
    parents: [ref.object.sha],
  });
  if (!commit) throw new RepoError(502, "GitHub did not create the commit.", "Try again.");
  const branch = `turbineh/${manifest.slug}-${input.planId.slice(0, 8)}`;
  await gh("POST", `${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha });
  const pr = await gh<{ html_url: string; number: number }>("POST", `${repo}/pulls`, {
    title: `TurbineH: ${manifest.slug}`,
    head: branch,
    base,
    body: [
      `Verified capability package for: ${input.need}`,
      "",
      `- Package: \`turbineh/${manifest.slug}/\` (code, tests, example, docs)`,
      pkg.added.length ? `- Dependencies added: ${pkg.added.join(", ")}` : "- No new dependencies",
      env.missing.length
        ? `- Settings documented in .env.example (set the values yourself): ${env.missing.join(", ")}`
        : "- No new settings",
      "",
      `Wire it in following \`turbineh/${manifest.slug}/agent/INTEGRATE.md\`, then run the project's checks. Nothing is merged automatically.`,
    ].join("\n"),
  });
  if (!pr) throw new RepoError(502, "GitHub did not open the pull request.", "Try again.");
  return {
    url: pr.html_url,
    number: pr.number,
    branch,
    commit: commit.sha,
    slug: manifest.slug,
    added: pkg.added,
    settings: env.missing,
  };
}

/** The user's repositories the token can write to (for choosing where to integrate). */
export async function writableRepos(
  token: string,
  fetchImpl: Fetch = fetch,
): Promise<{ fullName: string; private: boolean; defaultBranch: string }[]> {
  const gh = github(token, fetchImpl);
  const list =
    (await gh<
      {
        full_name: string;
        private: boolean;
        default_branch: string;
        permissions?: { push?: boolean };
      }[]
    >(
      "GET",
      "/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member",
    )) ?? [];
  return list
    .filter((r) => r.permissions?.push !== false)
    .map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch }));
}
