import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { staticScan } from "./verify.js";

/** Runs only where the pinned Semgrep image is already present (worker hosts, local); CI skips it. */
const semgrepAvailable = (() => {
  try {
    execFileSync("docker", ["image", "inspect", "semgrep/semgrep:1.178.0"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      const out = execFileSync("docker", ["images", "-q", "semgrep/semgrep"], { encoding: "utf8" });
      return out.trim().length > 0;
    } catch {
      return false;
    }
  }
})();

function app(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ai-rule-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

describe.skipIf(!semgrepAvailable)("AI enforcement rules (ADR-0028)", () => {
  it(
    "rejects direct model calls and model SDKs outside the orchestrator",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        "src/app/chat/actions.ts": 'import OpenAI from "openai";\nexport const c = new OpenAI();\n',
        "src/server/summary.ts":
          'export const r = () => fetch("https://api.example.com/v1/chat/completions", { method: "POST" });\n',
        // The hand-written OpenAI-compatible client a coding agent wrote in the Capability B run.
        "src/clinic/llm.ts":
          'export const c = (cfg: { LLM_BASE_URL: string }) =>\n  fetch(`${cfg.LLM_BASE_URL.replace(/\\/$/, "")}/chat/completions`, { method: "POST" });\n',
        "src/server/decide.ts":
          'import { TypeSafeClient } from "@typesafe-ai/sdk";\nexport const t = TypeSafeClient;\n',
        "package.json": '{ "dependencies": { "@typesafe-ai/sdk": "0.6.0" } }\n',
      });
      const findings = (await staticScan(dir)) ?? [];
      const hits = findings
        .filter((f) => f.rule.startsWith("turbineh.ai-"))
        .map((f) => `${f.rule} ${f.path}`);
      expect(hits).toEqual(
        expect.arrayContaining([
          "turbineh.ai-direct-model-call src/app/chat/actions.ts",
          "turbineh.ai-direct-model-call src/server/summary.ts",
          "turbineh.ai-direct-model-call src/clinic/llm.ts",
          "turbineh.ai-direct-model-call src/server/decide.ts",
          "turbineh.ai-sdk-dependency package.json",
        ]),
      );
    },
  );

  it(
    "allows the orchestrator's own transport (plain requests to the gateway, no SDK)",
    { timeout: 300_000 },
    async () => {
      const dir = app({
        "src/lib/ai/models.ts":
          'export const chat = (base: string) => fetch(`${base}/chat/completions`, { method: "POST" });\n',
        "src/lib/ai/decider.ts":
          'export const d = (base: string) => fetch(`${base}/v1/systemone`, { method: "POST" });\n',
        "src/app/page.tsx":
          'import { orchestrate } from "@/lib/ai/orchestrator";\nexport const o = orchestrate;\n',
        "src/lib/ai/agent.ts":
          'import { chatWithTools } from "./models";\nexport const runAgent = () => chatWithTools("m", [], []);\n',
        "tests/mock-llm/mock.ts":
          'export const path = (u: string) => u.endsWith("/chat/completions");\n',
        "package.json": '{ "dependencies": { "zod": "4.6.5" } }\n',
      });
      const findings = (await staticScan(dir)) ?? [];
      expect(findings.filter((f) => f.rule.startsWith("turbineh.ai-"))).toEqual([]);
    },
  );
});
