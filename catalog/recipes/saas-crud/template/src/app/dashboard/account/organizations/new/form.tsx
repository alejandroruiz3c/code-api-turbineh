"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOrganization, type CreateOrganizationState } from "../actions";

/** Name of the new organization; the person becomes its owner and it becomes the active one. */
export function NewOrganizationForm() {
  const [state, action, pending] = useActionState<CreateOrganizationState, FormData>(
    createOrganization,
    { error: null },
  );
  return (
    <form action={action} className="flex max-w-md flex-col gap-4">
      <div>
        <Label htmlFor="organization-name">Organization name</Label>
        <Input id="organization-name" name="name" required minLength={2} maxLength={60} />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
