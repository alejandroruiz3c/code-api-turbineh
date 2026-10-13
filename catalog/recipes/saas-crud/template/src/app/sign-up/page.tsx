"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/** Create an account and its first workspace (sign-up policy in src/lib/sign-up-policy.ts). */
export default function SignUp() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const workspace = String(form.get("workspace") ?? "");
    const signUp = await authClient.signUp.email({ name, email, password });
    if (signUp.error) {
      setError(signUp.error.message ?? "Sign-up failed");
      setPending(false);
      return;
    }
    const slug = `${workspace
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
    const org = await authClient.organization.create({ name: workspace, slug });
    if (org.error || !org.data) {
      setError(org.error?.message ?? "Could not create the workspace");
      setPending(false);
      return;
    }
    await authClient.organization.setActive({ organizationId: org.data.id });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Card title="Create your account">
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={80} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required minLength={10} />
          </div>
          <div>
            <Label htmlFor="workspace">Workspace name</Label>
            <Input id="workspace" name="workspace" required maxLength={60} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
