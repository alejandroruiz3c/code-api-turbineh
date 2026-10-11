import { createHash } from "node:crypto";

/** Minimal Vercel REST client (documented endpoints: v11 projects, v10 env, v2 files, v13 deployments). */
export class Vercel {
  constructor(
    private readonly token: string,
    private readonly teamId?: string,
  ) {}

  private url(path: string, query: Record<string, string> = {}): string {
    const q = new URLSearchParams({ ...query, ...(this.teamId ? { teamId: this.teamId } : {}) });
    const s = q.toString();
    return `https://api.vercel.com${path}${s ? `?${s}` : ""}`;
  }

  private async call<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url(path, query), {
        method,
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new VercelError(res.status, safeMessage(text));
      return (text ? JSON.parse(text) : {}) as T;
    }
  }

  /** Who the token belongs to (validates the token). */
  async user(): Promise<{ username: string }> {
    const r = await this.call<{ user: { username: string } }>("GET", "/v2/user");
    return r.user;
  }

  async createProject(name: string): Promise<{ id: string; name: string }> {
    return this.call("POST", "/v11/projects", {
      name,
      framework: "nextjs",
      installCommand: "pnpm install --frozen-lockfile",
      // Migrations run inside the client's own build (the database URL never reaches TurbineH machines).
      buildCommand: "pnpm db:migrate && pnpm build",
    });
  }

  async setEnv(
    projectId: string,
    vars: { key: string; value: string; sensitive: boolean }[],
  ): Promise<void> {
    const r = await this.call<{ failed?: { error: { key?: string; message: string } }[] }>(
      "POST",
      `/v10/projects/${encodeURIComponent(projectId)}/env`,
      vars.map((v) => ({
        key: v.key,
        value: v.value,
        type: v.sensitive ? "sensitive" : "encrypted",
        target: ["production"],
      })),
      { upsert: "true" },
    );
    if (r.failed?.length)
      throw new Error(`could not set ${r.failed.map((f) => f.error.key ?? "?").join(", ")}`);
  }

  async uploadFile(bytes: Buffer): Promise<string> {
    const sha = createHash("sha1").update(bytes).digest("hex");
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.url("/v2/files"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(bytes.length),
          "x-vercel-digest": sha,
        },
        body: new Uint8Array(bytes),
      });
      if (res.ok) return sha;
      if (res.status === 429 && attempt < 4) {
        await new Promise((r) => setTimeout(r, 2 ** attempt * 2000));
        continue;
      }
      throw new VercelError(res.status, safeMessage(await res.text()));
    }
  }

  async deploy(
    project: string,
    files: { file: string; sha: string; size: number }[],
  ): Promise<{ id: string; url: string }> {
    return this.call(
      "POST",
      "/v13/deployments",
      {
        name: project,
        project,
        target: "production",
        files,
        projectSettings: { framework: "nextjs" },
      },
      { skipAutoDetectionConfirmation: "1" },
    );
  }

  async deployment(
    id: string,
  ): Promise<{ readyState: string; url: string; alias?: string[]; errorMessage?: string }> {
    return this.call("GET", `/v13/deployments/${encodeURIComponent(id)}`);
  }

  async deleteProject(idOrName: string): Promise<void> {
    await this.call("DELETE", `/v9/projects/${encodeURIComponent(idOrName)}`);
  }
}

export class VercelError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Vercel ${status}: ${message}`);
  }
}

/** Error text without anything that looks like a credential. */
export function safeMessage(text: string): string {
  let msg = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    msg = j.error?.message ?? text;
  } catch {
    /* plain text */
  }
  return msg.replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]").slice(0, 300);
}
