import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { login, type Ctx } from "./commands.js";
import { CliError } from "./context.js";
import { readHidden, readStdin } from "./secret-input.js";

let home = "";
const env = { ...process.env };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "turbineh-login-"));
  process.env.XDG_CONFIG_HOME = home;
  delete process.env.TURBINEH_TOKEN;
  process.env.TURBINEH_URL = "https://api.example.test";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [] })),
  );
});
afterEach(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

const ctx = (
  over: Partial<Ctx> & { interactive?: boolean; piped?: string; typed?: string },
): Ctx & { warnings: string[] } => {
  const warnings: string[] = [];
  return {
    cwd: home,
    args: [],
    flags: {},
    json: false,
    confirm: async () => false,
    secrets: {
      interactive: over.interactive ?? false,
      stdin: async () => over.piped ?? "",
      hidden: async () => over.typed ?? "",
      warn: (m) => warnings.push(m),
    },
    warnings,
    ...over,
  };
};

const saved = () =>
  JSON.parse(readFileSync(join(home, "turbineh", "config.json"), "utf8")) as { token: string };

describe("turbineh login (ADR-0055: the token never goes through the shell history)", () => {
  it("asks for the token without echo on a terminal", async () => {
    const r = await login(ctx({ interactive: true, typed: "tok-typed" }));
    expect(saved().token).toBe("tok-typed");
    expect(r.data).toMatchObject({ source: "prompt" });
    expect(statSync(join(home, "turbineh", "config.json")).mode & 0o777).toBe(0o600);
  });

  it("reads the token from stdin with --with-token, and refuses --with-token on a terminal", async () => {
    await login(ctx({ flags: { "with-token": true }, piped: "tok-piped" }));
    expect(saved().token).toBe("tok-piped");
    await expect(
      login(ctx({ flags: { "with-token": true }, interactive: true })),
    ).rejects.toBeInstanceOf(CliError);
  });

  it("uses TURBINEH_TOKEN from the environment", async () => {
    process.env.TURBINEH_TOKEN = "tok-env";
    const r = await login(ctx({}));
    expect(saved().token).toBe("tok-env");
    expect(r.data).toMatchObject({ source: "TURBINEH_TOKEN" });
  });

  it("still accepts a positional token, with a deprecation warning", async () => {
    const c = ctx({ args: ["tok-arg"] });
    const r = await login(c);
    expect(saved().token).toBe("tok-arg");
    expect(r.data).toMatchObject({ source: "argument (deprecated)" });
    expect(c.warnings.join(" ")).toMatch(/Deprecated.*shell history/);
  });

  it("fails with what to do when no token can be read (not a terminal, nothing piped)", async () => {
    await expect(login(ctx({}))).rejects.toThrow(/No token given/);
  });
});

describe("secret input", () => {
  it("reads a hidden line in raw mode, with backspace, and restores the terminal", async () => {
    const input = Object.assign(new PassThrough(), {
      isRaw: false,
      setRawMode: vi.fn(),
    }) as unknown as NodeJS.ReadStream;
    const output = new PassThrough();
    let echoed = "";
    output.on("data", (d) => (echoed += String(d)));
    const p = readHidden("Token: ", { input, output });
    input.write("abX\u007fc\r");
    expect(await p).toBe("abc");
    expect(echoed).not.toContain("abc");
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  it("reads everything piped on stdin, trimmed", async () => {
    const s = new PassThrough();
    s.end("tok\n");
    expect(await readStdin(s)).toBe("tok");
  });
});
