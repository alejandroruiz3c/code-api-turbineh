"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendContact, type ContactState } from "./actions";

export function ContactForm() {
  const [state, action, pending] = useActionState<ContactState, FormData>(sendContact, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <div>
        <Label htmlFor="c-name">Name</Label>
        <Input id="c-name" name="name" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="c-email">Email</Label>
        <Input id="c-email" name="email" type="email" required />
      </div>
      <div>
        <Label htmlFor="c-company">Company (optional)</Label>
        <Input id="c-company" name="company" maxLength={160} />
      </div>
      <div>
        <Label htmlFor="c-message">Message</Label>
        <textarea
          id="c-message"
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <input
        name="website"
        tabIndex={-1}
        autoComplete="off"
        className="hidden"
        aria-hidden="true"
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send message"}
      </Button>
      {state ? (
        <p role="status" className={state.ok ? "text-green-700" : "text-red-600"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
