"use client";
import { useCallback, useEffect, useState } from "react";
import {
  productApi,
  type GithubStatus,
  type RepoAnalysisResponse,
  type RepoItem,
} from "@/lib/product-api";

/**
 * Connect GitHub (optional) → pick a repository → see the analysis (PLAN §16 P5). Used by the new-flow wizard and
 * by the result screen's "Integrate into repository".
 */
export function useGithub() {
  const [status, setStatus] = useState<GithubStatus | null>(null);
  const reload = useCallback(async () => {
    const r = await productApi.github();
    setStatus(r.ok ? r.data : { connected: false });
  }, []);
  useEffect(() => {
    queueMicrotask(() => void reload());
  }, [reload]);
  return { status, reload };
}

const connectUrl = (priv: boolean, returnTo: string) =>
  `/api/github/connect?${priv ? "private=1&" : ""}return=${encodeURIComponent(returnTo)}`;

export function GithubConnect({
  status,
  returnTo,
  onChange,
}: {
  status: GithubStatus | null;
  returnTo: string;
  onChange: () => void;
}) {
  if (!status) return <p className="text-xs text-muted">Checking GitHub…</p>;
  if (status.connected)
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded-full border border-teal/60 px-3 py-1 text-teal">
          GitHub connected · {status.login}
          {status.private_repos ? " · private repositories too" : " · public repositories"}
        </span>
        {!status.private_repos && status.via === "oauth" ? (
          <a href={connectUrl(true, returnTo)} className="text-ice-2 underline">
            Also allow private repositories
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => void productApi.disconnectGithub().then(onChange)}
          className="text-muted underline hover:text-bad"
        >
          Disconnect GitHub
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4 text-sm">
      <p className="text-ice-2">
        Connect GitHub to analyse a repository and receive the capability as a pull request. It is
        optional: you can always download the ZIP instead.
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href={connectUrl(false, returnTo)}
          className="rounded-full bg-teal px-4 py-2 text-sm font-semibold text-navy"
        >
          Connect GitHub (public repositories)
        </a>
        <a
          href={connectUrl(true, returnTo)}
          className="rounded-full border border-teal px-4 py-2 text-sm text-teal"
        >
          Connect GitHub (include private repositories)
        </a>
      </div>
      <p className="text-xs text-muted">
        Why two options: GitHub only lets an app open pull requests on private repositories with its
        broad <code>repo</code> permission (read and write code of every repository you can access).
        For public repositories the narrower <code>public_repo</code> is enough. TurbineH writes
        only to a new <code>turbineh/…</code> branch of the repository you pick, never merges, and
        stores the access encrypted; disconnect at any time.
      </p>
    </div>
  );
}

/** Repository search with private/public badges. */
export function RepoPicker({
  value,
  onPick,
}: {
  value: string;
  onPick: (fullName: string) => void;
}) {
  const [q, setQ] = useState("");
  const [repos, setRepos] = useState<RepoItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      void productApi.repos(q).then((r) => {
        if (r.ok) {
          setRepos(r.data.repos);
          setError(null);
        } else setError(r.error?.action ?? "Repositories could not be listed.");
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="repo-search" className="text-xs text-muted">
        Repository
      </label>
      <input
        id="repo-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your repositories"
        className="w-full rounded-md border border-line bg-navy-900 px-3 py-2 text-sm"
      />
      {error ? <p className="text-xs text-bad">{error}</p> : null}
      <ul className="max-h-64 overflow-y-auto rounded-md border border-line" role="listbox">
        {(repos ?? []).slice(0, 30).map((r) => (
          <li key={r.full_name}>
            <button
              type="button"
              role="option"
              aria-selected={value === r.full_name}
              onClick={() => onPick(r.full_name)}
              className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-panel/40 ${value === r.full_name ? "bg-teal/10" : ""}`}
            >
              <span className="font-mono text-ice-2">{r.full_name}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] ${r.private ? "border-amber/60 text-amber" : "border-line text-muted"}`}
              >
                {r.private ? "private" : "public"}
              </span>
              {r.description ? (
                <span className="truncate text-xs text-muted">{r.description}</span>
              ) : null}
            </button>
          </li>
        ))}
        {repos && repos.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted">No repository you can write to matches.</li>
        ) : null}
        {!repos && !error ? <li className="px-3 py-2 text-xs text-muted">Loading…</li> : null}
      </ul>
    </div>
  );
}

/** What the analysis found: stack, conventions, conflicts and decisions. */
export function RepoAnalysisView({ fullName }: { fullName: string }) {
  const [data, setData] = useState<RepoAnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      setData(null);
      setError(null);
    });
    void productApi.analysis(fullName).then((r) => {
      if (!alive) return;
      if (r.ok) setData(r.data);
      else setError(r.error ? `${r.error.message} → ${r.error.action}` : "Analysis failed.");
    });
    return () => {
      alive = false;
    };
  }, [fullName]);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data)
    return (
      <p className="text-xs text-muted" role="status">
        Analysing {fullName} (configuration files only, nothing is cloned)…
      </p>
    );
  const a = data.analysis;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4 text-sm">
      <p className="text-cream">
        {a.framework.name ?? a.language} {a.framework.version ?? ""}
        {a.framework.router
          ? ` · ${a.framework.router === "app+pages" ? "App + Pages Router" : `${a.framework.router === "app" ? "App" : "Pages"} Router`}`
          : ""}
        {a.appPath ? ` · app in ${a.appPath}` : ""}
        {a.packageManager.name ? ` · ${a.packageManager.name}` : ""}
        <span
          className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] ${data.private ? "border-amber/60 text-amber" : "border-line text-muted"}`}
        >
          {data.private ? "private" : "public"}
        </span>
      </p>
      <ul className="list-disc pl-5 text-xs text-ice-2">
        {a.conventions.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {data.conflicts.length ? (
        <div>
          <p className="text-xs text-amber">Differences to handle (decided in the plan):</p>
          <ul className="list-disc pl-5 text-xs text-ice-2">
            {data.conflicts.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!data.can_push ? (
        <p className="text-xs text-bad">
          The connected account cannot write to this repository: a pull request is not possible.
        </p>
      ) : null}
    </div>
  );
}
