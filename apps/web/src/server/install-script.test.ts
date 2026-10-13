import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "../app/install.sh/route";

describe("GET /install.sh", () => {
  it("installs a wrapper bound to the serving origin and prints runnable next steps", async () => {
    const script = await GET(new Request("https://staging.example.test/install.sh")).text();
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
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const wrapper = readFileSync(join(root, ".turbineh/bin/turbineh"), "utf8");
    expect(wrapper).toContain('export TURBINEH_INSTALL_URL="https://staging.example.test"');
    // Not on PATH here: the next steps use the full path.
    expect(r.stdout).toContain(`${root}/.turbineh/bin/turbineh init --agent claude`);
    expect(r.stdout).toContain("build '<what to build>'");
  });
});
