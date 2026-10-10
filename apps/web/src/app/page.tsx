import { Suspense } from "react";
import { PromptBox } from "@/components/prompt-box";
import { currentUser } from "@/server/session";

const STEPS = [
  {
    k: "01",
    t: "Select",
    d: "JEV picks audited components for every capability your app needs — in one batched decision.",
  },
  {
    k: "02",
    t: "Verify",
    d: "Your app is built, tested end-to-end and security-scanned in an isolated sandbox with no network.",
  },
  {
    k: "03",
    t: "Deliver",
    d: "Download it, or push it as a private repository to your own GitHub in one click.",
  },
];

export default async function Home() {
  const user = await currentUser();
  return (
    <main className="mx-auto max-w-3xl px-6 pt-16 text-center">
      <p className="eyebrow animate-fade-up">Code · API · beta</p>
      <h1 className="display animate-fade-up mt-5 text-5xl font-bold text-cream sm:text-6xl">
        Describe your app.
        <br />
        Get a <span className="text-teal">verified</span> repo.
      </h1>
      <p className="animate-fade-up mx-auto mt-5 max-w-xl text-muted">
        We select audited, security-reviewed components instead of generating everything — then
        build, test and scan your app before you get it.
      </p>
      <div className="animate-fade-up mt-10">
        <Suspense>
          <PromptBox signedIn={Boolean(user)} />
        </Suspense>
      </div>
      <section aria-label="How it works" className="mt-24 grid gap-6 text-left sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.k} className="rounded-xl border border-line bg-panel/40 p-5">
            <p className="eyebrow text-teal">{s.k}</p>
            <h2 className="display mt-2 text-xl font-semibold text-cream">{s.t}</h2>
            <p className="mt-2 text-sm text-muted">{s.d}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
