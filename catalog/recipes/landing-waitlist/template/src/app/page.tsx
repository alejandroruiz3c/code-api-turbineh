import Link from "next/link";
import { WaitlistForm } from "./waitlist/form";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center gap-8 px-6 py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">__APP_NAME__</h1>
      <p className="text-lg text-slate-600">__APP_SUMMARY__</p>
      <WaitlistForm />
      <Link className="text-sm text-slate-500 underline" href="/sign-in">
        Admin sign-in
      </Link>
    </main>
  );
}
