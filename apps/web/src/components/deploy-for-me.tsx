"use client";
import { useCallback, useEffect, useState } from "react";

interface Deployment {
  status: "queued" | "running" | "done" | "failed";
  step: string | null;
  result: { url: string; vercelProject: string } | null;
  error: string | null;
}

interface Connection {
  enabled: boolean;
  connected: boolean;
  label: string | null;
}
type Connections = { vercel: Connection };

const NOTICE: Record<string, string> = {
  connected: "Connected. You can deploy now.",
  cancelled: "Sign-in cancelled. You can try again or paste a token instead.",
  error: "We could not complete the sign-in. Try again or paste a token instead.",
};

const STEPS = [
  "Checking your Vercel access",
  "Creating your database",
  "Creating your Vercel project",
  "Configuring settings and secrets",
  "Uploading your app",
  "Building and going live",
  "Checking that your app responds",
  "Updating your documents",
];

/** Optional "Deploy for me" (ADR-0017): into the client's own Vercel account and database. */
export function DeployForMe({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<Connections | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pasteVercel, setPasteVercel] = useState(false);
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [vercelToken, setVercelToken] = useState("");
  const [teamId, setTeamId] = useState("");
  const [dbMode, setDbMode] = useState<"neon" | "url">("neon");
  const [dbSecret, setDbSecret] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const res = await fetch(`/v1/builds/${id}/deploy-app`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      deployment: Deployment | null;
      connections?: Connections;
    };
    setDeployment(body.deployment);
    if (body.connections) setConnections(body.connections);
    return body.deployment;
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => void poll());
  }, [poll]);

  // Back from "Connect Vercel": reopen the window with the outcome.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get("deploy");
    if (!outcome) return;
    queueMicrotask(() => {
      setOpen(true);
      setNotice(NOTICE[outcome] ?? null);
    });
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  const vercelSignIn = Boolean(connections?.vercel.enabled) && !pasteVercel;

  useEffect(() => {
    if (!deployment || (deployment.status !== "queued" && deployment.status !== "running")) return;
    const t = setTimeout(async () => {
      const d = await poll();
      if (d?.status === "done") onDone();
    }, 3000);
    return () => clearTimeout(t);
  }, [deployment, poll, onDone]);

  async function submit() {
    setError(null);
    const res = await fetch(`/v1/builds/${id}/deploy-app`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(vercelSignIn
          ? { vercel_connection: true }
          : {
              vercel_token: vercelToken.trim(),
              ...(teamId.trim() ? { vercel_team_id: teamId.trim() } : {}),
            }),
        database: dbMode === "neon" ? { neon_api_key: dbSecret.trim() } : { url: dbSecret.trim() },
        ...(adminEmail.trim() ? { admin_email: adminEmail.trim() } : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { detail?: string; title?: string };
    if (!res.ok) return setError(body.detail ?? body.title ?? "Could not start the deployment.");
    // Credentials leave the browser state as soon as they are sent.
    setVercelToken("");
    setDbSecret("");
    await poll();
  }

  const live = deployment?.status === "done" ? deployment.result : null;
  const running = deployment?.status === "queued" || deployment?.status === "running";

  if (live) {
    return (
      <a
        href={live.url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-full bg-amber px-5 py-2 text-sm font-semibold text-navy"
      >
        ● Live — open your app ↗
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-amber/70 px-4 py-2 text-sm text-amber hover:bg-amber/10"
      >
        {running ? "Deploying…" : "Deploy for me"}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="deploy-title"
          className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-navy/80 p-4 backdrop-blur-sm"
        >
          <div className="mt-10 w-full max-w-xl rounded-2xl border border-line bg-panel p-6 text-ice-2 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Optional</p>
                <h2 id="deploy-title" className="mt-1 text-xl font-semibold text-white">
                  Put your app online for you
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="text-muted hover:text-white"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-sm text-muted">
              We deploy it into <b className="text-ice-2">your own accounts</b> — you own everything
              and we keep no access. Your package is updated with the live address and the few steps
              left for you.
            </p>

            {running || deployment?.status === "failed" ? (
              <div className="mt-5">
                <ol className="flex flex-col gap-2 text-sm">
                  {STEPS.map((s) => {
                    const idx = STEPS.findIndex((x) =>
                      deployment?.step?.startsWith(x.split(" ")[0] ?? ""),
                    );
                    const me = STEPS.indexOf(s);
                    const state =
                      deployment?.status === "failed" && me === idx
                        ? "bad"
                        : me < idx
                          ? "done"
                          : me === idx
                            ? "now"
                            : "todo";
                    return (
                      <li key={s} className="flex items-center gap-3">
                        <span
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 rounded-full ${state === "done" ? "bg-teal" : state === "now" ? "animate-pulse-dot bg-amber" : state === "bad" ? "bg-bad" : "bg-line"}`}
                        />
                        <span className={state === "todo" ? "text-muted" : "text-ice-2"}>{s}</span>
                      </li>
                    );
                  })}
                </ol>
                {deployment?.status === "failed" ? (
                  <div className="mt-4 rounded-lg border border-bad/50 p-3 text-sm">
                    <p className="text-bad">{deployment.error}</p>
                    <button
                      type="button"
                      onClick={() => setDeployment(null)}
                      className="mt-2 text-xs underline"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 text-xs text-muted" role="status">
                    {deployment?.step ?? "Queued"}… you can close this window, it keeps going.
                  </p>
                )}
              </div>
            ) : (
              <form
                className="mt-5 flex flex-col gap-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <fieldset className="rounded-xl border border-line p-4">
                  <legend className="px-1 text-sm font-semibold text-white">
                    1 · Hosting — Vercel
                  </legend>
                  {vercelSignIn ? (
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                      {connections?.vercel.connected ? (
                        <span className="text-teal">✓ Connected · {connections.vercel.label}</span>
                      ) : (
                        <a
                          href={`/deploy/vercel/connect?build=${id}`}
                          className="rounded-full bg-white px-4 py-2 font-semibold text-navy"
                        >
                          ▲ Connect Vercel
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setPasteVercel(true)}
                        className="text-xs text-muted underline"
                      >
                        Paste a token instead
                      </button>
                    </div>
                  ) : (
                    <>
                      <label htmlFor="vt" className="mt-1 block text-xs text-muted">
                        Access token —{" "}
                        <a
                          className="text-teal underline"
                          href="https://vercel.com/account/settings/tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          create one
                        </a>{" "}
                        (set expiration to 1 day)
                      </label>
                      <input
                        id="vt"
                        type="password"
                        autoComplete="off"
                        required
                        value={vercelToken}
                        onChange={(e) => setVercelToken(e.target.value)}
                        className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm"
                      />
                      <details className="mt-2 text-xs text-muted">
                        <summary className="cursor-pointer">Deploy into a team (optional)</summary>
                        <input
                          aria-label="Vercel team ID"
                          placeholder="team_…"
                          value={teamId}
                          onChange={(e) => setTeamId(e.target.value)}
                          className="mt-2 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm"
                        />
                      </details>
                    </>
                  )}
                </fieldset>

                <fieldset className="rounded-xl border border-line p-4">
                  <legend className="px-1 text-sm font-semibold text-white">2 · Database</legend>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="db"
                        checked={dbMode === "neon"}
                        onChange={() => setDbMode("neon")}
                      />{" "}
                      Create one for me (Neon, EU)
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="db"
                        checked={dbMode === "url"}
                        onChange={() => setDbMode("url")}
                      />{" "}
                      I have a PostgreSQL database
                    </label>
                  </div>
                  <label htmlFor="dbs" className="mt-3 block text-xs text-muted">
                    {dbMode === "neon" ? (
                      <>
                        Neon API key —{" "}
                        <a
                          className="text-teal underline"
                          href="https://console.neon.tech/app/settings/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          create one
                        </a>{" "}
                        (free plan available)
                      </>
                    ) : (
                      "Connection string (postgres://…)"
                    )}
                  </label>
                  <input
                    id="dbs"
                    type="password"
                    autoComplete="off"
                    required
                    value={dbSecret}
                    onChange={(e) => setDbSecret(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm"
                  />
                </fieldset>

                <div>
                  <label htmlFor="adm" className="block text-xs text-muted">
                    Admin email (required for websites and shops with an admin panel)
                  </label>
                  <input
                    id="adm"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    className="mt-1 w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm"
                  />
                </div>

                <label className="flex items-start gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5"
                    required
                  />
                  I authorise TurbineH to create a project and a database in my accounts. Access is
                  used once, encrypted while in use and deleted when the deployment ends.
                </label>
                {notice ? (
                  <p role="status" className="text-sm text-teal">
                    {notice}
                  </p>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-bad">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={!consent || (vercelSignIn && !connections?.vercel.connected)}
                  className="rounded-full bg-amber px-5 py-2.5 text-sm font-semibold text-navy disabled:opacity-40"
                >
                  Deploy now
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
