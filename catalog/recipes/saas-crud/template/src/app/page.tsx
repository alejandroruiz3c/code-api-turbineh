import Link from "next/link";
import { BRAND } from "@/brand";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      {BRAND.logo ? (
        // eslint-disable-next-line @next/next/no-img-element -- static brand asset, no optimizer
        <img src={BRAND.logo} alt="" className="h-16 w-auto" />
      ) : null}
      <h1 className="text-4xl font-bold">__APP_NAME__</h1>
      <p className="text-slate-600">__APP_SUMMARY__</p>
      <div className="flex gap-3">
        <Link className="rounded-md bg-brand px-4 py-2 text-brand-contrast" href="/sign-up">
          Get started
        </Link>
        <Link className="rounded-md border border-slate-300 px-4 py-2" href="/sign-in">
          Sign in
        </Link>
      </div>
    </main>
  );
}
