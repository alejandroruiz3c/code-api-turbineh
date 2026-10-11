"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

const EXAMPLES: { label: string; prompt: string }[] = [
  {
    label: "SaaS with teams",
    prompt:
      "A SaaS for language schools: schools as workspaces with admin and teacher roles; manage students (name, email, level, enrolled on) and courses (title, teacher, weekly hours, price).",
  },
  {
    label: "Landing + waitlist",
    prompt:
      "A landing page for my coffee subscription startup BeanBox with a waitlist form, confirmation email and an admin panel to see signups.",
  },
  {
    label: "Internal tool",
    prompt:
      "An internal tool for our warehouse team to track inventory items (sku, name, quantity, location, reorder level) with search, CSV import and CSV export.",
  },
  {
    label: "Bookings",
    prompt:
      "A booking app for a physiotherapy clinic: therapists set availability, patients book 45-minute slots and get email confirmations.",
  },
  {
    label: "Client portal",
    prompt:
      "A client portal for an accounting firm where clients upload documents and track the status of their tax filing requests.",
  },
];

const KEY = "turbineh:pending-prompt";
const BRAND_KEY = "turbineh:pending-brand";

interface Brand {
  primaryColor?: string;
  font?: string;
  logo?: string;
}

const FONTS: { value: string; label: string }[] = [
  { value: "system", label: "Clean (system)" },
  { value: "geometric", label: "Geometric" },
  { value: "humanist", label: "Humanist" },
  { value: "rounded", label: "Rounded" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Monospace" },
];
const LOGO_MAX = 256 * 1024;

export function PromptBox({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [brand, setBrand] = useState<Brand>({});
  const started = useRef(false);

  const start = useCallback(
    async (text: string, withBrand: Brand) => {
      setBusy(true);
      setError(null);
      const res = await fetch("/v1/builds", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          prompt: text,
          ...(Object.keys(withBrand).length > 0 ? { brand: withBrand } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        build_id?: string;
        detail?: string;
        title?: string;
      };
      if (!res.ok || !body.build_id) {
        setError(body.detail ?? body.title ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      sessionStorage.removeItem(KEY);
      sessionStorage.removeItem(BRAND_KEY);
      router.push(`/build/${body.build_id}`);
    },
    [router],
  );

  // Coming back from GitHub sign-in: resume the prompt the visitor typed before signing in.
  useEffect(() => {
    const saved = sessionStorage.getItem(KEY);
    if (!saved) return;
    const savedBrand = JSON.parse(sessionStorage.getItem(BRAND_KEY) ?? "{}") as Brand;
    // Deferred so the effect itself never sets state synchronously.
    queueMicrotask(() => {
      setPrompt(saved);
      setBrand(savedBrand);
      if (signedIn && params.get("resume") === "1" && !started.current) {
        started.current = true;
        void start(saved, savedBrand);
      }
    });
  }, [signedIn, params, start]);

  const valid = prompt.trim().length >= 20;
  async function submit() {
    if (!valid || busy) return;
    if (!signedIn) {
      sessionStorage.setItem(KEY, prompt.trim());
      sessionStorage.setItem(BRAND_KEY, JSON.stringify(brand));
      await authClient.signIn.social({ provider: "github", callbackURL: "/?resume=1" });
      return;
    }
    await start(prompt.trim(), brand);
  }

  function onLogo(file: File | undefined) {
    setError(null);
    if (!file) return setBrand((b) => ({ ...b, logo: undefined }));
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return setError("Logo: use a PNG, JPEG or WebP image.");
    }
    if (file.size > LOGO_MAX) return setError("Logo: maximum 256 KB.");
    const reader = new FileReader();
    reader.onload = () => setBrand((b) => ({ ...b, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  return (
    <div className="w-full">
      <div className="rounded-2xl border border-line bg-navy-900/70 p-3 shadow-[0_0_80px_-20px_rgba(52,216,196,0.35)] focus-within:border-teal">
        <label htmlFor="prompt" className="sr-only">
          Describe the app you want
        </label>
        <textarea
          id="prompt"
          autoFocus
          rows={4}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder="Describe the app you want — users, data, screens…"
          className="w-full resize-none bg-transparent px-3 py-2 text-lg text-ice-2 placeholder:text-muted/70 focus:outline-none"
        />
        <div className="flex items-center justify-between gap-3 px-2 pb-1">
          <span className="text-xs text-muted">
            {valid ? "⌘ + Enter" : "At least 20 characters"}
          </span>
          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => void submit()}
            className="rounded-full bg-teal px-5 py-2 text-sm font-semibold text-navy transition hover:brightness-110 disabled:opacity-40"
          >
            {busy ? "Starting…" : signedIn ? "Build it" : "Continue with GitHub"}
          </button>
        </div>
      </div>
      <div className="mt-3 text-left">
        <button
          type="button"
          aria-expanded={brandOpen}
          onClick={() => setBrandOpen((o) => !o)}
          className="text-xs text-muted underline-offset-4 hover:text-ice-2 hover:underline"
        >
          {brandOpen ? "− Hide brand" : "+ Add your brand (optional)"}
          {!brandOpen && Object.keys(brand).length > 0 ? " · added" : ""}
        </button>
        {brandOpen ? (
          <div className="mt-3 grid gap-4 rounded-xl border border-line bg-navy-900/50 p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="brand-color" className="block text-xs text-muted">
                Main colour
              </label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  id="brand-color"
                  type="color"
                  value={brand.primaryColor ?? "#0f172a"}
                  onChange={(e) => setBrand((b) => ({ ...b, primaryColor: e.target.value }))}
                  className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent"
                />
                <span className="font-mono text-xs text-ice-2">
                  {brand.primaryColor ?? "default"}
                </span>
              </div>
            </div>
            <div>
              <label htmlFor="brand-font" className="block text-xs text-muted">
                Typeface
              </label>
              <select
                id="brand-font"
                value={brand.font ?? "system"}
                onChange={(e) => setBrand((b) => ({ ...b, font: e.target.value }))}
                className="mt-1 w-full rounded-md border border-line bg-navy-900 px-2 py-2 text-sm text-ice-2"
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="brand-logo" className="block text-xs text-muted">
                Logo (PNG, JPEG or WebP · max 256 KB)
              </label>
              <div className="mt-1 flex items-center gap-2">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
                  <img
                    src={brand.logo}
                    alt="Logo preview"
                    className="h-9 w-auto rounded bg-white/90 p-1"
                  />
                ) : null}
                <input
                  id="brand-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => onLogo(e.target.files?.[0])}
                  className="w-full text-xs text-muted file:mr-2 file:rounded-full file:border-0 file:bg-panel file:px-3 file:py-1 file:text-ice-2"
                />
              </div>
            </div>
            <p className="text-xs text-muted sm:col-span-3">
              Applied to buttons, focus rings, typography and the header of your app. Text colour on
              your brand colour is chosen automatically for readability.
            </p>
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Examples">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => setPrompt(ex.prompt)}
            className="rounded-full border border-line px-3 py-1 text-xs text-muted transition hover:border-teal hover:text-ice-2"
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}
