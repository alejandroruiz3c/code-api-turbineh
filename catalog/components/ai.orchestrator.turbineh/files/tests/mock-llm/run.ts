import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startMockLlm, type MockScript } from "./mock";

/** `tsx tests/mock-llm/run.ts`: loads every script in tests/mock-llm/scripts and listens on MOCK_LLM_PORT. */
const dir = join(import.meta.dirname, "scripts");
const scripts: MockScript[] = [];
for (const file of readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .sort()) {
  const mod = (await import(pathToFileURL(join(dir, file)).href)) as { default?: MockScript };
  if (mod.default) scripts.push(mod.default);
}
const port = Number(process.env.MOCK_LLM_PORT ?? 4010);
const { url } = await startMockLlm(scripts, port);
console.log(`mock model on ${url} (${scripts.map((s) => s.id).join(", ") || "no scripts"})`);
