/**
 * Per-turn latency split of agent-brain runs (ADR-0043): confirmation turns (the person's explicit yes to a pending
 * action, answered from a template since ADR-0043) versus every other turn, so a speed-up of the confirmation turn is
 * not mistaken for a speed-up of the rest. Also per-call latency and the gateway's hedges.
 *
 *   pnpm --filter @turbineh/bench exec tsx agent-brain/split.ts label1 label2 …
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { conversations } from "../agent-decisions/clinic";

interface Row {
  id: string;
  ms: number[];
  replies: string[];
  meter: { calls: { kind: string; model: string; ms: number; hedged?: string }[] };
}
const CONFIRM = /\b(yes|go ahead|confirm|book it|move it|cancel it)\b/i;
const scripts = new Map(conversations().map((c) => [c.id, c.turns]));
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};
const sec = (ms: number) => (ms / 1000).toFixed(2);
const dist = (xs: number[]) =>
  `${sec(pct(xs, 50))} / ${sec(pct(xs, 90))} / ${sec(pct(xs, 95))} / ${sec(pct(xs, 100))}`;

const lines = [
  "| Run | Confirmation turns | Other turns | Other turns p50 / p90 / p95 / max s | Chat calls | Chat call p50 / p90 / p95 / max s | Hedges fired (won) |",
  "|---|---|---|---|---|---|---|",
];
for (const label of process.argv.slice(2)) {
  const { rows } = JSON.parse(
    readFileSync(join(import.meta.dirname, "runs", `${label}.json`), "utf8"),
  ) as { rows: Row[] };
  const confirm: number[] = [];
  const other: number[] = [];
  for (const r of rows) {
    const turns = scripts.get(r.id) ?? [];
    r.ms.forEach((ms, t) => {
      const asked = /Shall I go ahead\?/.test(r.replies[t - 1] ?? "");
      const yes = t >= turns.length || CONFIRM.test(turns[t] ?? "");
      (asked && yes ? confirm : other).push(ms);
    });
  }
  const chat = rows.flatMap((r) => r.meter.calls.filter((c) => c.kind === "chat"));
  const fired = chat.filter((c) => c.hedged === "primary-won" || c.hedged === "hedge-won");
  lines.push(
    `| ${label} | ${confirm.length} (p50 ${sec(pct(confirm, 50))} s) | ${other.length} | ${dist(other)} | ${chat.length} | ${dist(chat.map((c) => c.ms))} | ${fired.length} (${fired.filter((c) => c.hedged === "hedge-won").length}) |`,
  );
}
console.log(lines.join("\n"));
