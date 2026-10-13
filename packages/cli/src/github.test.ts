import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apply, type Ctx } from "./commands.js";
import { connect, originRepo } from "./github.js";
import { parse } from "./index.js";

const PLAN = "6f1c2d3e-0000-4000-8000-000000000001";
let cwd: string;
const ctx = (args: string[], flags: Record<string, string | boolean> = {}): Ctx => ({
  cwd,
  args,
  flags,
  json: true,
  confirm: async () => true,
});

beforeEach(() => {
  process.env.TURBINEH_TOKEN = "FRONTIERS_TEST";
  process.env.TURBINEH_POLL_MS = "1";
  process.env.TURBINEH_URL = "https://example.test";
  cwd = mkdtempSync(join(tmpdir(), "gh-"));
});

describe("turbineh and GitHub", () => {
  it("parses --pr --repo --base", () => {
    expect(parse(["apply", "p1", "--pr", "--repo", "acme/web", "--base", "main"])).toEqual({
      cmd: "apply",
      args: ["p1"],
      flags: { pr: true, repo: "acme/web", base: "main" },
    });
  });

  it("reads owner/name from the origin remote", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:acme/web-app.git"], { cwd });
    expect(originRepo(cwd)).toBe("acme/web-app");
  });

  it("connect github: one-time link, then waits until the workspace is connected (no token printed)", async () => {
    let polls = 0;
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        calls.push(`${init.method ?? "GET"} ${path}`);
        if (path === "/v1/github/connect")
          return Response.json(
            {
              url: "https://example.test/api/github/connect?ticket=t",
              code: "ABCD-2345",
              expires_in: 600,
            },
            { status: 201 },
          );
        polls++;
        return Response.json(polls < 3 ? { connected: false } : { connected: true, login: "octo" });
      }),
    );
    const r = await connect(ctx(["github"], { open: false }));
    expect(r).toMatchObject({ ok: true, state: "connected" });
    expect(calls[0]).toBe("POST /v1/github/connect");
    expect(JSON.stringify(r)).not.toContain("FRONTIERS_TEST");
  });

  it("apply --pr: starts the integration and reports the verified pull request", async () => {
    let jobPolls = 0;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        if (path === `/v1/plans/${PLAN}`)
          return Response.json({ id: PLAN, state: "verified", plan: null, result: { errors: [] } });
        if (path.endsWith("/pull-request") && init.method === "POST") {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json(
            { integration: { id: "in_1", status: "queued", phase: "queued" } },
            { status: 202 },
          );
        }
        jobPolls++;
        return Response.json({
          integrations: [
            jobPolls < 2
              ? { id: "in_1", status: "running", phase: "verifying", result: {}, error: null }
              : {
                  id: "in_1",
                  repo: "acme/web",
                  status: "done",
                  phase: "done",
                  state: "integration_verified",
                  pull_request: {
                    url: "https://github.com/acme/web/pull/7",
                    number: 7,
                    draft: false,
                  },
                  result: {
                    checks: [{ name: "Type check", ok: true, detail: "2s" }],
                    reviewerSetup: ["Set `TURBINEH_AI_TOKEN`."],
                  },
                  error: null,
                },
          ],
        });
      }),
    );
    const r = await apply(ctx([PLAN], { pr: true, repo: "acme/web" }));
    expect(bodies[0]).toEqual({ repo: "acme/web" });
    expect(r).toMatchObject({ ok: true, state: "integration_verified" });
  });
});
