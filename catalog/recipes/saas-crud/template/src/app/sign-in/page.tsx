import { safeNext } from "@/lib/safe-next";
import { SignInForm } from "./form";

/** Sign in with email and password; resumes the user's workspace (or goes back to `next`, a path of this site). */
export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <SignInForm next={safeNext(next)} />;
}
