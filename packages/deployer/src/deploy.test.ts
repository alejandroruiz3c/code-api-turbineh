import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deployToClient, shopSettings, vercelConfig } from "./deploy.js";
import { safeMessage } from "./vercel.js";

function repo(withJobs: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "deploy-"));
  writeFileSync(
    join(dir, ".env.example"),
    `DATABASE_URL=\nBETTER_AUTH_SECRET=\nBETTER_AUTH_URL=\n${withJobs ? "JOBS_RUNNER_SECRET=\n" : ""}`,
  );
  writeFileSync(join(dir, "package.json"), "{}\n");
  writeFileSync(join(dir, ".gitignore"), ".env.local\n");
  writeFileSync(join(dir, ".env.local"), "SECRET=never-upload-me\n");
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  return dir;
}

afterEach(() => vi.unstubAllGlobals());

describe("deploy for me", () => {
  it("creates the project, sets settings, uploads tracked files only and checks the live app", async () => {
    const dir = repo(true);
    const calls: { method: string; url: string; body?: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        calls.push({ method, url, ...(typeof init.body === "string" ? { body: init.body } : {}) });
        const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
        if (url.includes("/v2/user")) return json({ user: { username: "client" } });
        if (url.includes("/v11/projects")) return json({ id: "prj_1", name: "my-app" });
        if (url.includes("/v10/projects/")) return json({ failed: [] }, 201);
        if (url.includes("/v2/files")) return json({});
        if (url.includes("/v13/deployments") && method === "POST")
          return json({ id: "dpl_1", url: "x" });
        if (url.includes("/v13/deployments/"))
          return json({ readyState: "READY", url: "x", alias: ["my-app.vercel.app"] });
        if (url.startsWith("https://my-app.vercel.app")) return new Response("ok", { status: 200 });
        return json({ error: { message: "unexpected" } }, 500);
      }),
    );
    const steps: string[] = [];
    const r = await deployToClient({
      repoDir: dir,
      slug: "my-app",
      buildId: "b1",
      vercel: { token: "tok_secret_value_1234567890" },
      database: { mode: "url", url: "postgres://u:p@db.example.com/app" },
      onStep: async (s) => void steps.push(s),
    });
    expect(r.url).toBe("https://my-app.vercel.app");
    expect(r.settings).toEqual([
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "JOBS_RUNNER_SECRET",
      "CRON_SECRET",
    ]);
    expect(r.cron).toBe(true);
    const env = JSON.parse(calls.find((c) => c.url.includes("/env"))?.body ?? "[]") as {
      key: string;
      type: string;
    }[];
    expect(env.find((e) => e.key === "DATABASE_URL")?.type).toBe("sensitive");
    const deployBody = JSON.parse(
      calls.find((c) => c.method === "POST" && c.url.includes("/v13/deployments"))?.body ?? "{}",
    ) as {
      files: { file: string }[];
    };
    const files = deployBody.files.map((f) => f.file);
    expect(files).toContain("vercel.json");
    expect(files).not.toContain(".env.local");
    expect(JSON.parse(readFileSync(join(dir, "vercel.json"), "utf8"))).toEqual(vercelConfig(true));
    expect(steps.at(-1)).toContain("responds");
  });

  it("asks for the admin email before creating anything when the app has an admin panel", async () => {
    const dir = repo(false);
    writeFileSync(join(dir, ".env.example"), "DATABASE_URL=\nADMIN_EMAILS=\n");
    const fetchSpy = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ user: { username: "c" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      deployToClient({
        repoDir: dir,
        slug: "x",
        buildId: "b",
        vercel: { token: "t".repeat(24) },
        database: { mode: "url", url: "postgres://u:p@h/db" },
        onStep: async () => {},
      }),
    ).rejects.toThrow(/admin email/);
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).includes("/v11/projects"))).toBe(false);
  });

  it("never repeats credentials in error messages", () => {
    expect(
      safeMessage('{"error":{"message":"bad token vercel_abcdefghijklmnopqrstuvwxyz123"}}'),
    ).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("carries the shop settings chosen at build time, never local defaults or secrets", () => {
    expect(
      shopSettings(
        "DATABASE_URL=postgres://localhost/app\nSHOP_CURRENCY=gbp\nSHOP_CURRENCIES=eur,usd\nSHOP_TAX_MODE=manual\nSTRIPE_SECRET_KEY=\nSHOP_EMPTY=\n",
      ),
    ).toEqual([
      ["SHOP_CURRENCY", "gbp"],
      ["SHOP_CURRENCIES", "eur,usd"],
      ["SHOP_TAX_MODE", "manual"],
    ]);
  });
});
