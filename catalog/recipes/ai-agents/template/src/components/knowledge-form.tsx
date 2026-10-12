"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addKnowledge, type KnowledgeState } from "@/app/dashboard/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Indexing…" : "Add document"}
    </Button>
  );
}

export function KnowledgeForm() {
  const [state, action] = useActionState<KnowledgeState, FormData>(addKnowledge, {
    error: null,
    added: null,
  });
  return (
    <form action={action} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="kb-title">Title</Label>
        <Input id="kb-title" name="title" required maxLength={160} />
      </div>
      <div>
        <Label htmlFor="kb-text">Text</Label>
        <textarea
          id="kb-text"
          name="text"
          rows={6}
          className="w-full rounded-md border border-slate-300 p-2 text-sm"
        />
      </div>
      <div>
        <Label htmlFor="kb-file">Or upload a .txt / .md file</Label>
        <input
          id="kb-file"
          name="file"
          type="file"
          accept=".txt,.md,.markdown,text/plain,text/markdown"
        />
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.added ? (
        <p role="status" className="text-sm text-emerald-700">
          Added “{state.added}”.
        </p>
      ) : null}
      <div>
        <Submit />
      </div>
    </form>
  );
}
