import { safeNext } from "@/lib/safe-next";
import { SignUpForm } from "./form";

/** Create an account (and a workspace, unless the person is joining one through an invitation link). */
export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { next } = await searchParams;
  return <SignUpForm next={safeNext(next)} />;
}
