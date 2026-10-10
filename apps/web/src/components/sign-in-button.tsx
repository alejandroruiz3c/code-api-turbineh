"use client";
import { authClient } from "@/lib/auth-client";

export function SignInButton({
  label = "Continue with GitHub",
  callbackURL = "/",
}: {
  label?: string;
  callbackURL?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void authClient.signIn.social({ provider: "github", callbackURL })}
      className="rounded-full border border-line px-4 py-1.5 text-sm text-ice-2 transition hover:border-teal hover:text-teal"
    >
      {label}
    </button>
  );
}

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => void authClient.signOut().then(() => location.reload())}
      className="text-xs text-muted hover:text-ice-2"
    >
      Sign out
    </button>
  );
}
