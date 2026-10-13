import { describe, expect, it, vi } from "vitest";

vi.mock("./caller", () => ({ getCaller: vi.fn() }));
vi.mock("./db", () => ({ db: {} }));
vi.mock("./storage", () => ({ storage: {} }));

const { privateWorkspace, githubWorkspaceProblem } = await import("./product");

describe("GitHub only in private workspaces", () => {
  it("accepts random workspace ids, accounts and API keys", () => {
    expect(privateWorkspace("invite:3f2b8c1e-5d4a-4e7b-9a10-2c3d4e5f6a7b")).toBe(true);
    expect(privateWorkspace("user_123")).toBe(true);
    expect(privateWorkspace("staging-smoke")).toBe(true);
  });

  it("refuses the shared default and guessable names under the invitation token", () => {
    expect(privateWorkspace("invite:api-default")).toBe(false);
    expect(privateWorkspace("invite:bench-frontiers")).toBe(false);
    expect(privateWorkspace("invite:my-company-ws")).toBe(false);
  });

  it("answers with an actionable 403", async () => {
    const r = githubWorkspaceProblem({
      kind: "access",
      ownerId: "invite:api-default",
      workspaceId: "api-default",
    });
    expect(r?.status).toBe(403);
    const body = (await r?.json()) as { code: string; action: string };
    expect(body.code).toBe("github_needs_private_workspace");
    expect(body.action).toContain("turbineh init");
  });
});
