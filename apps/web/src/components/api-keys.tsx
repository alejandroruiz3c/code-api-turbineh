"use client";
import { useCallback, useEffect, useState } from "react";

interface Key {
  id: string;
  name: string;
  prefix: string;
  daily_quota: number;
  created_at: string;
}

export function ApiKeys() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/v1/keys");
    if (res.status === 401) return setError("Sign in with GitHub to manage your API keys.");
    setKeys(((await res.json()) as { keys: Key[] }).keys);
  }, []);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function create() {
    setError(null);
    setCopied(false);
    const res = await fetch("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const body = (await res.json()) as { key?: string; title?: string; detail?: string };
    if (!res.ok || !body.key)
      return setError(body.detail ?? body.title ?? "Could not create the key.");
    setFresh(body.key);
    setName("");
    await load();
  }

  async function revoke(id: string) {
    await fetch(`/v1/keys/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    await load();
  }

  return (
    <div className="mt-8 flex flex-col gap-6">
      {fresh ? (
        <div role="status" className="rounded-xl border border-amber/60 bg-panel p-4">
          <p className="text-sm text-amber">Copy your key now — it will not be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code
              className="flex-1 overflow-x-auto rounded bg-navy-900 px-3 py-2 font-mono text-sm text-ice-2"
              data-testid="new-key"
            >
              {fresh}
            </code>
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(fresh).then(() => setCopied(true))}
              className="rounded-full border border-line px-3 py-1.5 text-xs text-ice-2 hover:border-teal"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      ) : null}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="key-name" className="sr-only">
          Key name
        </label>
        <input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name, e.g. CI pipeline"
          minLength={2}
          maxLength={60}
          required
          className="flex-1 rounded-full border border-line bg-navy-900 px-4 py-2 text-sm text-ice-2"
        />
        <button
          type="submit"
          className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy"
        >
          Create key
        </button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {(keys ?? []).map((k) => (
          <li
            key={k.id}
            className="flex items-center justify-between rounded-xl border border-line bg-panel/40 px-4 py-3 text-sm"
          >
            <span>
              <span className="text-ice-2">{k.name}</span>{" "}
              <code className="ml-2 text-muted">{k.prefix}…</code>
              <span className="ml-3 text-xs text-muted">
                {k.daily_quota} builds/day · created {k.created_at.slice(0, 10)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => void revoke(k.id)}
              className="text-xs text-bad underline"
            >
              Revoke
            </button>
          </li>
        ))}
        {keys && keys.length === 0 ? <li className="text-sm text-muted">No keys yet.</li> : null}
      </ul>
    </div>
  );
}
