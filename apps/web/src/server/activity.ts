import type { FlowState } from "@turbineh/shared";
import { latestRepoIntegrations } from "@turbineh/db";
import { stateOfBuild } from "@/lib/states";
import { db } from "./db";

/** One flow of the workspace, as shown in Activity (measured figures only; cost stays internal). */
export interface ActivityItem {
  id: string;
  need: string;
  useCase: string | null;
  state: FlowState;
  createdAt: string;
  seconds: number | null;
  reusedShare: number | null;
  reusedLines: number | null;
  generatedLines: number | null;
  checksPassed: number | null;
  checksTotal: number | null;
  securityFixed: number;
  alerts: number;
  deployed: boolean;
  /** Latest repository integration (pull request) of the flow. */
  pullRequest: { url: string | null; repo: string; verified: boolean; running: boolean } | null;
}

type Row = {
  id: string;
  prompt: string;
  status: string;
  created_at: Date;
  seconds: number | null;
  recipe: string | null;
  metrics: {
    reuse?: { reusedShare?: number; reusedLines?: number; generatedLines?: number };
    handover?: {
      checksPassed?: number;
      checksTotal?: number;
      fixedBeforeDelivery?: number;
      alerts?: number;
    };
    deployment?: unknown;
    delivery?: { kind?: string };
    /** ADR-0065: present when fixes were counted by a re-scan (flows before it only recorded the fixer's claims). */
    audit?: { fixed?: unknown[] };
  } | null;
  has_zip: boolean;
};

export async function workspaceActivity(ownerId: string, limit = 50): Promise<ActivityItem[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, prompt, status, created_at, spec->>'recipe' AS recipe, metrics,
            (artifact->>'zipKey') IS NOT NULL AS has_zip,
            extract(epoch FROM finished_at - claimed_at)::int AS seconds
     FROM builds WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [ownerId, limit],
  );
  const prs = new Map((await latestRepoIntegrations(db, ownerId)).map((p) => [p.build_id, p]));
  return rows.map((r) => {
    const m = r.metrics ?? {};
    const deployed = Boolean(m.deployment);
    const pr = prs.get(r.id);
    const integrated = pr?.state === "integration_verified" || pr?.state === "integrated";
    return {
      id: r.id,
      need: r.prompt,
      useCase: r.recipe,
      state:
        integrated && !deployed
          ? (pr?.state as FlowState)
          : stateOfBuild(r.status, deployed, m.delivery?.kind === "unverified" && r.has_zip),
      createdAt: new Date(r.created_at).toISOString(),
      seconds: r.status === "done" || r.status === "failed" ? r.seconds : null,
      reusedShare: m.reuse?.reusedShare ?? null,
      reusedLines: m.reuse?.reusedLines ?? null,
      generatedLines: m.reuse?.generatedLines ?? null,
      checksPassed: m.handover?.checksPassed ?? null,
      checksTotal: m.handover?.checksTotal ?? null,
      // Only fixes a new scan confirmed (ADR-0065); earlier flows recorded the fixer's claims and are not counted.
      securityFixed: m.audit?.fixed?.length ?? 0,
      alerts: m.handover?.alerts ?? 0,
      deployed,
      pullRequest: pr
        ? {
            url: pr.pr_url,
            repo: pr.repo,
            verified: pr.state === "integration_verified",
            running: pr.status === "queued" || pr.status === "running",
          }
        : null,
    };
  });
}

export interface ActivitySummary {
  flows: number;
  verified: number;
  avgSeconds: number | null;
  avgReusedShare: number | null;
  reusedLines: number;
  securityFixed: number;
}

export function summarize(items: ActivityItem[]): ActivitySummary {
  const done = items.filter((i) => i.state === "verified" || i.state === "deployed");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    flows: items.length,
    verified: done.length,
    avgSeconds: avg(done.map((i) => i.seconds).filter((x): x is number => x !== null)),
    avgReusedShare: avg(done.map((i) => i.reusedShare).filter((x): x is number => x !== null)),
    reusedLines: done.reduce((a, i) => a + (i.reusedLines ?? 0), 0),
    securityFixed: done.reduce((a, i) => a + i.securityFixed, 0),
  };
}
