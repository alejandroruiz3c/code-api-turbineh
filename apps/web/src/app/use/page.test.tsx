import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { USE_CASES } from "@turbineh/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UsePage from "./page";

const html = renderToStaticMarkup(<UsePage />);
/** Visible text, entities decoded: what a reader (or an agent copying a snippet) sees. */
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&amp;/g, "&");

const CLI = join(dirname(fileURLToPath(import.meta.url)), "../../../../../packages/cli/dist/turbineh.mjs");

describe("/use page", () => {
  it("renders the four sections with headings and landmarks", () => {
    expect(html).toContain("<main");
    expect(html).toContain('aria-label="On this page"');
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const id of ["people", "agents", "api", "build"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`aria-labelledby="${id}-title"`);
    }
  });

  it("labels every copy button", () => {
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(5);
    for (const b of buttons) expect(b).toMatch(/aria-label="Copy [^"]+"/);
  });

  it("lists every use case from the catalogue recipes (not hard-coded)", () => {
    expect(USE_CASES.length).toBeGreaterThan(0);
    for (const u of USE_CASES) expect(text).toContain(u.name);
  });

  it("never names the decider or model vendors, and never shows a token value", () => {
    expect(text).not.toMatch(
      /\b(JEV|TypeSafe|quyet|OpenAI|Anthropic|Mistral|Qwen|Llama|DeepSeek|Gemini|GPT-\d)/i,
    );
    expect(text).not.toMatch(/tbh_[A-Za-z0-9]/);
  });

  it("shows only commands and flags that exist in the CLI help", () => {
    expect(existsSync(CLI), "build the CLI first: pnpm --filter @turbineh/cli run build").toBe(
      true,
    );
    // Without VITEST in its environment: the CLI skips main() under vitest.
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "VITEST"));
    const help = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8", env }).stdout;
    expect(help).toContain("turbineh build");
    const lines = text.split("\n").filter((l) => /(^|[\s(|])turbineh [a-z]/.test(l));
    const seen = new Set<string>();
    for (const line of lines) {
      for (const m of line.matchAll(/(?:^|[\s(|`])turbineh ([a-z]+)(?: (github))?/g)) {
        const cmd = m[2] ? `turbineh ${m[1]} ${m[2]}` : `turbineh ${m[1]}`;
        seen.add(cmd);
        expect(help, `command "${cmd}" is not in the CLI help`).toContain(cmd);
      }
      // Flags on a line that runs turbineh (curl, gh and other tools' flags are on their own lines).
      const cmdPart = line.slice(line.search(/turbineh [a-z]/)).split("#")[0] ?? "";
      for (const f of cmdPart.matchAll(/\s(--[a-z][a-z-]*)/g))
        expect(help, `flag "${f[1]}" (in: ${line.trim()}) is not in the CLI help`).toContain(f[1]);
    }
    for (const must of [
      "turbineh init",
      "turbineh build",
      "turbineh resume",
      "turbineh left",
      "turbineh verify",
      "turbineh apply",
      "turbineh connect github",
      "turbineh mcp",
    ])
      expect(seen, must).toContain(must);
  });
});
