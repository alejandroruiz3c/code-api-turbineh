import Link from "next/link";
import { BRAND } from "@/brand";
import { AssistantWidget } from "@/components/assistant-widget";
import { publicAssistant } from "@/lib/ai/assistant";

/** Home: the public assistant when the app has one (e.g. a booking assistant), and the team's sign-in. */
export default function Home() {
  const assistant = publicAssistant();
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-16 text-center">
      {BRAND.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
        <img src={BRAND.logo} alt="" className="h-16 w-auto" />
      ) : null}
      <h1 className="text-4xl font-bold">__APP_NAME__</h1>
      <p className="text-muted">__APP_SUMMARY__</p>
      {assistant.enabled ? (
        <AssistantWidget title={assistant.title} greeting={assistant.greeting} />
      ) : null}
      <div className="flex gap-3">
        <Link
          className={
            assistant.enabled
              ? "rounded-md border border-field px-4 py-2"
              : "rounded-md bg-brand px-4 py-2 text-brand-contrast"
          }
          href="/sign-up"
        >
          {assistant.enabled ? "Staff sign-up" : "Get started"}
        </Link>
        <Link className="rounded-md border border-field px-4 py-2" href="/sign-in">
          {assistant.enabled ? "Staff sign-in" : "Sign in"}
        </Link>
      </div>
    </main>
  );
}
