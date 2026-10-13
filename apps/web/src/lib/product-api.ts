import type {
  CapabilitySummary,
  EnvironmentInput,
  FlowResult,
  Plan,
  ProductError,
} from "@turbineh/shared";

/**
 * Typed client of the product engine (PLAN §16.4) for the browser. Same contract as the API and the CLI. Endpoints
 * that are not deployed yet answer `{ ok: false, missing: true }`, so screens can fall back gracefully.
 */
export interface GithubStatus {
  connected: boolean;
  login?: string;
  private_repos?: boolean;
  via?: "oauth" | "token";
}

export interface RepoItem {
  full_name: string;
  private: boolean;
  default_branch: string;
  description: string | null;
  pushed_at: string | null;
}

export interface RepoAnalysisResponse {
  repo: string;
  private: boolean;
  can_push: boolean;
  default_branch: string;
  analysis: {
    appPath: string;
    language: string;
    framework: { name: string | null; version: string | null; router: string | null };
    packageManager: { name: string | null };
    conventions: string[];
  };
  conflicts: string[];
  decisions: { topic: string; choice: string; why: string }[];
  compatible: boolean;
}

export interface IntegrationCheckView {
  name: string;
  ok: boolean | null;
  detail: string;
  action?: string;
}

export interface RepoIntegration {
  id: string;
  repo: string;
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  state: string | null;
  branch: string | null;
  pull_request: { url: string; number: number; draft: boolean | null } | null;
  result: {
    checks?: IntegrationCheckView[];
    reviewerSetup?: string[];
    limits?: string[];
    decisions?: { topic: string; choice: string; why: string }[];
  };
  error: ProductError | null;
  created_at: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; missing: boolean; status: number; error: ProductError | null };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    return {
      ok: false,
      missing: false,
      status: 0,
      error: {
        code: "network",
        message: "The service could not be reached.",
        action: "Check your connection and try again.",
      },
    };
  }
  if (res.ok) return { ok: true, data: (await res.json()) as T };
  const body = (await res.json().catch(() => null)) as
    (Partial<ProductError> & { title?: string; detail?: string }) | null;
  return {
    ok: false,
    missing: res.status === 404 || res.status === 405,
    status: res.status,
    error: body
      ? {
          code: body.code ?? `http_${res.status}`,
          message: body.message ?? body.title ?? "The request did not succeed.",
          action: body.action ?? body.detail ?? "Try again in a moment.",
          ...(body.resume ? { resume: body.resume } : {}),
        }
      : null,
  };
}

export const productApi = {
  search: async (q: string): Promise<ApiResult<CapabilitySummary[]>> => {
    const r = await call<{ results: CapabilitySummary[] } | CapabilitySummary[]>(
      `/v1/capabilities?q=${encodeURIComponent(q)}`,
    );
    if (r.ok) return { ok: true, data: Array.isArray(r.data) ? r.data : r.data.results };
    // Fallback while the engine endpoint lands: the product area's own catalog search.
    const f = await call<{ results: CapabilitySummary[] }>(
      `/api/discover?q=${encodeURIComponent(q)}`,
    );
    return f.ok ? { ok: true, data: f.data.results } : f;
  },
  plan: (need: string, environment: EnvironmentInput) =>
    call<Plan>("/v1/plans", { method: "POST", body: JSON.stringify({ need, environment }) }),
  generate: (planId: string) =>
    call<{ id: string; state: string }>(`/v1/plans/${encodeURIComponent(planId)}/generate`, {
      method: "POST",
      body: JSON.stringify({ approve: true }), // the wizard enables this only after every decision is approved
    }),
  flow: (id: string) =>
    call<Plan & { result?: FlowResult | null }>(`/v1/plans/${encodeURIComponent(id)}`),
  github: () => call<GithubStatus>("/v1/github"),
  disconnectGithub: () => call<{ removed: boolean }>("/v1/github", { method: "DELETE" }),
  repos: (q: string) => call<{ repos: RepoItem[] }>(`/v1/repos?q=${encodeURIComponent(q)}`),
  analysis: (fullName: string) =>
    call<RepoAnalysisResponse>(
      `/v1/repos/${fullName.split("/").map(encodeURIComponent).join("/")}/analysis`,
    ),
  pullRequest: (planId: string, repo: string) =>
    call<{ integration: RepoIntegration }>(`/v1/plans/${encodeURIComponent(planId)}/pull-request`, {
      method: "POST",
      body: JSON.stringify({ repo }),
    }),
  integrations: (planId: string) =>
    call<{ integrations: RepoIntegration[] }>(
      `/v1/plans/${encodeURIComponent(planId)}/pull-request`,
    ),
  /** Today's build path (kept for the demo while the engine lands). */
  startBuild: (prompt: string) =>
    call<{ build_id: string }>("/v1/builds", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ prompt }),
    }),
};

/** Exact text the user copies for their coding agent (PLAN §16, owner wording). */
export const AGENT_INSTRUCTIONS =
  "Integrate this package into the project following agent/INTEGRATE.md. Check compatibility, keep the existing conventions and run the included verifications. Explain any pending adaptation.";
