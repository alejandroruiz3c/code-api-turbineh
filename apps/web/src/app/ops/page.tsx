import { aiUsageByApp, opsSnapshot } from "@turbineh/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCaller } from "@/server/caller";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { aiUsageEur, isOps } from "@/server/ops";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Operations — CODE-API-TURBINEH",
  robots: { index: false },
};

const eur = (n: number | null) => (n == null ? "—" : `€${n.toFixed(n < 0.1 ? 4 : 2)}`);
const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)} %`);

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** Internal operations panel (PLAN §9): TurbineH staff only — clients get a 404 and never see cost data. */
export default async function OpsPage() {
  if (!isOps(await getCaller())) notFound();
  const [s, ai] = await Promise.all([opsSnapshot(db), aiUsageByApp(db)]);
  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <p className="eyebrow">Internal · staff only</p>
      <h1 className="mt-2 text-3xl font-semibold text-white">Operations</h1>
      <p className="mt-2 text-sm text-muted">
        Live from the production database. Refresh to update.
      </p>

      <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          label="Builds · last hour"
          value={String(s.builds.lastHour)}
          hint={`${s.builds.perMinuteLastHour}/min`}
        />
        <Card label="Builds · 24 h" value={String(s.builds.last24h)} />
        <Card
          label="Green · 24 h"
          value={pct(s.green24h.rate)}
          hint={`${s.green24h.done} done · ${s.green24h.failed} failed`}
        />
        <Card
          label="Avg build time · 24 h"
          value={s.avgDurationS24h == null ? "—" : `${s.avgDurationS24h} s`}
        />
        <Card label="Queue" value={String(s.queue.queued)} hint={`${s.queue.running} running`} />
        <Card
          label="Workers alive"
          value={String(s.workers.length)}
          hint={
            s.workers.map((w) => `${w.id.replace(/-\d+$/, "")} (${w.running})`).join(" · ") ||
            "none"
          }
        />
        <Card
          label="Cost today"
          value={eur(s.cost.todayEur)}
          hint={`${s.cost.buildsToday} builds · cap €${env.DAILY_COST_CAP_EUR}`}
        />
        <Card label="Avg cost per build · 7 d" value={eur(s.cost.avgPerBuildEur7d)} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-white">By worker · 24 h</h2>
        <table className="mt-3 w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2">Worker</th>
              <th>Builds</th>
              <th>Avg time</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {s.byWorker24h.map((w) => (
              <tr key={w.worker} className="border-t border-line">
                <td className="py-2 text-ice-2">{w.worker}</td>
                <td>{w.builds}</td>
                <td>{w.avgDurationS == null ? "—" : `${w.avgDurationS} s`}</td>
                <td className={w.failed ? "text-bad" : ""}>{w.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-white">AI gateway usage · 7 d</h2>
        {ai.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No AI usage yet.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2">App</th>
                <th>Model</th>
                <th>Calls</th>
                <th>Tokens in / out</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {ai.map((u) => (
                <tr key={`${u.appId}-${u.model}`} className="border-t border-line">
                  <td className="py-2 text-ice-2">{u.name}</td>
                  <td>{u.model}</td>
                  <td>{u.calls}</td>
                  <td>
                    {u.inputTokens} / {u.outputTokens}
                  </td>
                  <td>{eur(aiUsageEur(u.model, u.inputTokens, u.outputTokens))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-white">Recent failures · 24 h</h2>
        {s.recentFailures.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {s.recentFailures.map((f) => (
              <li key={f.id} className="rounded-lg border border-line p-3">
                <span className="text-muted">{f.at.slice(0, 16).replace("T", " ")} UTC</span> ·{" "}
                <code className="text-ice-2">{f.id.slice(0, 8)}</code> ·{" "}
                {f.worker?.replace(/-\d+$/, "") ?? "—"} ·{" "}
                <span className="text-bad">{f.error ?? "verification failed"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
