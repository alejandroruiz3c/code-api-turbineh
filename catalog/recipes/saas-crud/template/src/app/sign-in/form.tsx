"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/** Sign-in form: email and password, then `next` (a same-site path) or the dashboard. */
export function SignInForm({ next }: { next: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const res = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (res.error) {
      setError("Invalid email or password");
      return;
    }
    router.push(next ?? "/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Card title="Sign in">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit">Sign in</Button>
          {next ? (
            <p className="text-sm text-muted">
              No account yet?{" "}
              <Link
                className="text-accent underline"
                href={`/sign-up?next=${encodeURIComponent(next)}`}
              >
                Create one
              </Link>
            </p>
          ) : null}
        </form>
      </Card>
    </main>
  );
}
