import { createZip } from "@turbineh/engine";
import { describe, expect, it } from "vitest";
import { openPullRequest, RepoError } from "./repo-pr";

const zip = createZip([
  {
    path: "booking/manifest.json",
    data: Buffer.from(
      JSON.stringify({
        slug: "booking",
        dependencies: { zod: "4.6.5", next: "16.3.8" },
        environment: ["RESEND_API_KEY"],
      }),
    ),
  },
  { path: "booking/src/index.ts", data: Buffer.from("export const x = 1;\n") },
  { path: "booking/LICENSES/logo.bin", data: Buffer.from([0, 1, 2, 3]) },
]);

/** A fake GitHub that records the calls and answers like the REST API. */
function fakeGitHub(opts: { push?: boolean } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    calls.push({ method, path, body });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (path === "/repos/acme/clinic")
      return json(200, { default_branch: "main", permissions: { push: opts.push ?? true } });
    if (path === "/repos/acme/clinic/git/ref/heads/main")
      return json(200, { object: { sha: "c0" } });
    if (path === "/repos/acme/clinic/git/commits/c0") return json(200, { tree: { sha: "t0" } });
    if (path === "/repos/acme/clinic/contents/package.json")
      return json(200, { content: b64(JSON.stringify({ dependencies: { next: "15.5.4" } })) });
    if (path === "/repos/acme/clinic/contents/.env.example") return json(404, {});
    if (path.endsWith("/git/blobs")) return json(201, { sha: "b1" });
    if (path.endsWith("/git/trees")) return json(201, { sha: "t1" });
    if (path.endsWith("/git/commits")) return json(201, { sha: "c1" });
    if (path.endsWith("/git/refs")) return json(201, {});
    if (path.endsWith("/pulls"))
      return json(201, { html_url: "https://github.com/acme/clinic/pull/7", number: 7 });
    return json(500, { message: `unexpected ${method} ${path}` });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("repository integration (pull request)", () => {
  it("opens one commit on a new branch with the package, new dependencies and settings names", async () => {
    const gh = fakeGitHub();
    const pr = await openPullRequest({
      repo: "acme/clinic",
      token: "ghp_test_token_not_real_000",
      zip,
      planId: "dd345dd0-eef1-4ff7-9b59-26c1241bb4bc",
      need: "Bookings for a clinic",
      fetchImpl: gh.fetchImpl,
    });
    expect(pr).toMatchObject({
      number: 7,
      branch: "turbineh/booking-dd345dd0",
      commit: "c1",
      added: ["zod@4.6.5"],
      settings: ["RESEND_API_KEY"],
    });
    const tree = gh.calls.find((c) => c.path.endsWith("/git/trees"))?.body as {
      base_tree: string;
      tree: { path: string; content?: string; sha?: string }[];
    };
    expect(tree.base_tree).toBe("t0");
    const paths = tree.tree.map((t) => t.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "turbineh/booking/manifest.json",
        "turbineh/booking/src/index.ts",
        "turbineh/booking/LICENSES/logo.bin",
        "package.json",
        ".env.example",
      ]),
    );
    expect(tree.tree.find((t) => t.path.endsWith("logo.bin"))?.sha).toBe("b1");
    const pkg = JSON.parse(tree.tree.find((t) => t.path === "package.json")?.content ?? "{}") as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({ next: "15.5.4", zod: "4.6.5" });
    expect(gh.calls.find((c) => c.path.endsWith("/git/refs"))?.body).toEqual({
      ref: "refs/heads/turbineh/booking-dd345dd0",
      sha: "c1",
    });
    expect(gh.calls.some((c) => c.path.includes("/merge"))).toBe(false);
  });

  it("refuses a repository the token cannot write to, with the next step", async () => {
    const gh = fakeGitHub({ push: false });
    await expect(
      openPullRequest({
        repo: "acme/clinic",
        token: "ghp_test_token_not_real_000",
        zip,
        planId: "p1234567",
        need: "x",
        fetchImpl: gh.fetchImpl,
      }),
    ).rejects.toBeInstanceOf(RepoError);
    expect(gh.calls.some((c) => c.method === "POST")).toBe(false);
  });
});
