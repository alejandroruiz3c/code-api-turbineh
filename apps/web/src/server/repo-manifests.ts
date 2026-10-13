import { MANIFEST_FILES } from "@turbineh/engine";

const MAX_FILE_BYTES = 400_000;

/**
 * Reads only the manifest files of a GitHub repository (package.json, lockfiles, framework config…) to detect its
 * stack — never source code. Public repositories need no token; private ones use the token the user provides, which
 * is used for these requests only and never stored.
 */
export async function repoManifests(
  fullName: string,
  ref: string | undefined,
  token?: string,
): Promise<Record<string, string>> {
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(fullName))
    throw new Error("invalid repository name");
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "turbineh",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const api = `https://api.github.com/repos/${fullName}`;
  const info = await fetch(api, { headers, signal: AbortSignal.timeout(10_000) });
  if (!info.ok)
    throw new Error(
      info.status === 404
        ? "repository not found (or private without a token)"
        : `GitHub ${info.status}`,
    );
  const branch =
    ref ?? ((await info.json()) as { default_branch?: string }).default_branch ?? "main";
  const tree = await fetch(`${api}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!tree.ok) throw new Error(`GitHub ${tree.status} reading the file tree`);
  const paths = new Set(
    ((await tree.json()) as { tree?: { path: string }[] }).tree?.map((t) => t.path) ?? [],
  );
  const wanted = MANIFEST_FILES.filter((f) => paths.has(f));
  const files: Record<string, string> = {};
  await Promise.all(
    wanted.map(async (f) => {
      const res = await fetch(`${api}/contents/${f}?ref=${encodeURIComponent(branch)}`, {
        headers: { ...headers, Accept: "application/vnd.github.raw" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return;
      const text = await res.text();
      if (text.length <= MAX_FILE_BYTES) files[f] = text;
    }),
  );
  return files;
}
