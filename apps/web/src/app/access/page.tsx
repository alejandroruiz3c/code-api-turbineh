import type { Metadata } from "next";
import { Logo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Access — YES IF for Builders",
  robots: { index: false },
};

/** Invitation gate: the only page visible without the access token. */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next = "/", error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6">
      <Logo />
      <h1 className="mt-8 text-3xl font-semibold text-white">Invitation access</h1>
      <p className="mt-2 text-sm text-muted">
        Verified software capabilities, ready to integrate. Enter the access token from your
        invitation.
      </p>
      <form action="/api/access" method="post" className="mt-8 flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label htmlFor="token" className="text-xs text-muted">
          Access token
        </label>
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          required
          autoFocus
          className="rounded-md border border-line bg-navy-900 px-3 py-2.5 text-sm text-white"
        />
        {error ? (
          <p role="alert" className="text-sm text-bad">
            That token is not valid. Check your invitation.
          </p>
        ) : null}
        <button
          type="submit"
          className="mt-2 rounded-full bg-amber px-5 py-2.5 text-sm font-semibold text-navy"
        >
          Enter
        </button>
      </form>
      <p className="mt-8 text-xs text-muted">
        Not invited yet?{" "}
        <a className="text-teal underline" href="https://api.turbineh.com">
          Join the waitlist
        </a>
      </p>
    </main>
  );
}
