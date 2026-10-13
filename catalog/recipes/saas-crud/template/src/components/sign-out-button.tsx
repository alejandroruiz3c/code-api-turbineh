"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/** Ends the session in the browser (better-auth client) and returns to the sign-in page. */
export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="block w-full rounded px-2 py-1 text-left text-sm text-muted hover:bg-subtle"
      onClick={async () => {
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
