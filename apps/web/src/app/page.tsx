import Link from "next/link";
import { StateBadge, Stat, pct, secs } from "@/components/ui";
import { summarize, workspaceActivity } from "@/server/activity";
import { getCaller } from "@/server/caller";

export const dynamic = "force-dynamic";

const STEPS = [
  {
    k: "01",
    t: "Understand intent",
    d: "Your need, stack, versions and conventions. What fits, what's missing, what conflicts.",
  },
  {
    k: "02",
    t: "Orchestrate decisions",
    d: "Predicts every task ahead, picks verified components and applies security and AI-safety policy — before anything runs.",
  },
  {
    k: "03",
    t: "Execute tasks",
    d: "Assemble, integrate, verify. Delivered to your repo or as a ZIP, with a clean revert.",
  },
];

const EXAMPLES = [
  "support agent",
  "online store",
  "booking flow",
  "AI classification",
  "client portal",
];

export default async function Home() {
  const caller = await getCaller();
  const items = caller ? await workspaceActivity(caller.ownerId, 5) : [];
  const s = summarize(items);
  return (
    <main className="mx-auto max-w-6xl px-6 pt-10">
      <p className="eyebrow animate-fade-up">YES IF for Builders</p>
      <h1 className="display animate-fade-up mt-4 max-w-3xl text-4xl font-bold text-cream sm:text-5xl">
        Secured software flows.
        <br />
        <span className="text-ice">In seconds. Free and open.</span>
      </h1>
      <p className="animate-fade-up mt-4 max-w-2xl text-muted">
        Go from “I need this capability” to “it's integrated and verified”. Built on audited
        components that already work — your agent writes only the glue.
      </p>

      <form action="/discover" role="search" className="animate-fade-up mt-8 flex max-w-2xl gap-3">
        <label htmlFor="need" className="sr-only">
          What do you need?
        </label>
        <input
          id="need"
          name="q"
          placeholder="What do you need? e.g. a support agent over our help centre"
          className="w-full rounded-full border border-line bg-navy-900/80 px-5 py-3 text-sm text-ice-2 placeholder:text-muted focus:border-teal focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full border border-teal px-5 py-3 text-sm text-teal hover:bg-teal/10"
        >
          Discover
        </button>
        <Link
          href="/flows/new"
          className="whitespace-nowrap rounded-full bg-amber px-5 py-3 text-sm font-semibold text-navy"
        >
          New flow
        </Link>
      </form>
      <p className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
        Try:
        {EXAMPLES.map((e) => (
          <Link
            key={e}
            href={`/discover?q=${encodeURIComponent(e)}`}
            className="rounded-full border border-line px-3 py-0.5 hover:border-teal hover:text-ice-2"
          >
            {e}
          </Link>
        ))}
      </p>

      <section aria-label="How it works" className="mt-14 grid gap-4 md:grid-cols-3">
        {STEPS.map((x, i) => (
          <div
            key={x.k}
            className={`rounded-xl border p-5 ${i === 1 ? "border-ice/60 bg-ice/10" : "border-line bg-panel/30"}`}
          >
            <p className="eyebrow text-teal">
              Step {x.k}
              {i === 1 ? " · the moat" : ""}
            </p>
            <h2 className="display mt-2 text-xl font-semibold text-cream">{x.t}</h2>
            <p className="mt-2 text-sm text-muted">{x.d}</p>
          </div>
        ))}
      </section>
      <p className="mt-4 text-sm text-muted">
        Same engine for people and agents:{" "}
        <Link href="/use#agents" className="text-teal underline-offset-4 hover:underline">
          the CLI
        </Link>{" "}
        speaks to humans and returns structured state to your coding agent.
      </p>

      <section aria-label="Your workspace" className="mt-14">
        <div className="flex items-baseline justify-between">
          <h2 className="display text-2xl font-semibold text-cream">Your workspace</h2>
          <Link href="/activity" className="text-sm text-teal">
            All activity →
          </Link>
        </div>
        {items.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No flows yet. Describe a need above or start with{" "}
            <Link href="/flows/new" className="text-teal underline">
              a new flow
            </Link>
            .
          </p>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat value={`${s.verified}/${s.flows}`} label="Flows verified" accent />
              <Stat value={secs(s.avgSeconds)} label="Average time to a verified package" />
              <Stat value={pct(s.avgReusedShare)} label="Code reused from verified components" />
              <Stat value={String(s.securityFixed)} label="Security issues fixed before delivery" />
            </div>
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
              {items.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/flows/${i.id}`}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-panel/40"
                  >
                    <StateBadge state={i.state} />
                    <span className="min-w-0 flex-1 truncate text-ice-2">{i.need}</span>
                    <span className="text-xs text-muted">{secs(i.seconds)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}
