import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/install.sh/route";
import { installScript } from "./install-script";

/** What the curl stub "downloads". */
const CLI = "// cli\n";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function runInstaller(script: string) {
  const root = mkdtempSync(join(tmpdir(), "install-"));
  const bin = join(root, "stub");
  mkdirSync(bin);
  // curl stub: writes the "CLI" to the -o path instead of downloading.
  writeFileSync(
    join(bin, "curl"),
    '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then echo "// cli" > "$2"; fi; shift; done\n',
  );
  chmodSync(join(bin, "curl"), 0o755);
  writeFileSync(join(root, "install.sh"), script);
  const r = spawnSync("sh", [join(root, "install.sh")], {
    env: {
      HOME: root,
      PATH: [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    } as unknown as NodeJS.ProcessEnv,
    encoding: "utf8",
  });
  return { root, r };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("install.sh (ADR-0055: pinned version, SHA-256 verified)", () => {
  const release = { version: "0.1.0", file: "turbineh-0.1.0.mjs", sha256: sha(CLI) };

  it("installs a wrapper bound to the serving origin after verifying the checksum", () => {
    const { root, r } = runInstaller(installScript("https://staging.example.test", release));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(root, ".turbineh/bin/turbineh.mjs"), "utf8")).toBe(CLI);
    const wrapper = readFileSync(join(root, ".turbineh/bin/turbineh"), "utf8");
    expect(wrapper).toContain('export TURBINEH_INSTALL_URL="https://staging.example.test"');
    expect(r.stdout).toContain("SHA-256 verified");
    // Not on PATH here: the next steps use the full path; login never takes the token as an argument.
    expect(r.stdout).toContain(`${root}/.turbineh/bin/turbineh init --agent claude`);
    expect(r.stdout).toContain("build '<what to build>'");
    expect(r.stdout).not.toContain("login <");
  });

  it("refuses a download whose checksum does not match, and installs nothing", () => {
    const { root, r } = runInstaller(
      installScript("https://staging.example.test", { ...release, sha256: "0".repeat(64) }),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("checksum mismatch");
    expect(existsSync(join(root, ".turbineh/bin/turbineh.mjs"))).toBe(false);
    expect(existsSync(join(root, ".turbineh/bin/turbineh"))).toBe(false);
  });

  it("serves the pinned script from the published release, and fails closed without one", async () => {
    // No public/cli in this working directory: the release comes from the origin.
    vi.spyOn(process, "cwd").mockReturnValue(mkdtempSync(join(tmpdir(), "web-")));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(release)),
    );
    const ok = await GET(new Request("https://staging.example.test/install.sh"));
    expect(ok.status).toBe(200);
    const script = await ok.text();
    expect(script).toContain(`SHA256="${release.sha256}"`);
    expect(script).toContain('FILE="turbineh-0.1.0.mjs"');
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    const none = await GET(new Request("https://staging.example.test/install.sh"));
    expect(none.status).toBe(503);
    expect(await none.text()).toContain("exit 1");
  });
});
