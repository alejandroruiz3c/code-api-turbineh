import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-24 text-center">
      <h1 className="text-4xl font-bold">__APP_NAME__</h1>
      <p className="text-slate-600">__APP_SUMMARY__</p>
      <div className="flex gap-3">
        <Link className="rounded-md bg-slate-900 px-4 py-2 text-white" href="/sign-up">
          Get started
        </Link>
        <Link className="rounded-md border border-slate-300 px-4 py-2" href="/sign-in">
          Sign in
        </Link>
      </div>
    </main>
  );
}
