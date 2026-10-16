"use client";

import { useActionState, useState } from "react";
import { composePostsAction, type ComposeState } from "@/app/dashboard/social/posts/actions";
import { TimeZoneField } from "@/components/time-zone-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RULES, textLength } from "@/social/limits";
import type { Network } from "@/social/networks";

export interface ComposerAccount {
  id: string;
  network: Network;
  label: string;
}

/**
 * Post composer (social.publish.turbineh): one text for every chosen account, with an optional version per network;
 * each network's count is shown live and checked again on the server (nothing is cut silently).
 */
export function Composer({
  accounts,
  initialKey,
  requireApproval,
}: {
  accounts: ComposerAccount[];
  initialKey: string;
  requireApproval: boolean;
}) {
  const [state, action, pending] = useActionState<ComposeState, FormData>(composePostsAction, null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [versions, setVersions] = useState<Partial<Record<Network, string>>>({});
  // Controlled, so a refused submission keeps what was typed (React resets uncontrolled fields after an action).
  const [imageUrl, setImageUrl] = useState("");
  const [when, setWhen] = useState("");
  const networks = [
    ...new Set(accounts.filter((a) => chosen.includes(a.id)).map((a) => a.network)),
  ];
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={state?.nextKey ?? initialKey} />
      <TimeZoneField name="timeZone" />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-muted">Accounts</legend>
        {accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="connectionIds"
              value={a.id}
              checked={chosen.includes(a.id)}
              onChange={(e) =>
                setChosen((c) => (e.target.checked ? [...c, a.id] : c.filter((x) => x !== a.id)))
              }
            />
            {a.label}
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor="post-text">Text</Label>
        <textarea
          id="post-text"
          name="text"
          rows={5}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full rounded-md border border-field px-3 py-2 text-sm focus:outline-brand"
        />
      </div>
      {networks.map((n) => {
        const body = versions[n] ?? text;
        const used = textLength(body, n);
        const over = used > RULES[n].maxLength;
        return (
          <div key={n}>
            <Label htmlFor={`version-${n}`}>{RULES[n].label} version (optional)</Label>
            <textarea
              id={`version-${n}`}
              name={`version_${n}`}
              rows={3}
              value={versions[n] ?? ""}
              placeholder={`Leave empty to use the text above on ${RULES[n].label}`}
              onChange={(e) => setVersions((v) => ({ ...v, [n]: e.target.value }))}
              className="w-full rounded-md border border-field px-3 py-2 text-sm focus:outline-brand"
            />
            <p
              className={`text-xs ${over ? "text-danger" : "text-muted"}`}
              data-testid={`count-${n}`}
            >
              {RULES[n].label}: {used}/{RULES[n].maxLength}
              {RULES[n].imageRequired ? " · image required" : ""}
            </p>
          </div>
        );
      })}
      <div>
        <Label htmlFor="post-image">
          Image URL (public https://, optional except on Instagram)
        </Label>
        <Input
          id="post-image"
          name="imageUrl"
          type="url"
          placeholder="https://…/image.jpg"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="post-when">Publish at</Label>
        <Input
          id="post-when"
          name="scheduledLocal"
          type="datetime-local"
          required
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="submit" disabled={pending}>
          {requireApproval ? "Submit for approval" : "Schedule"}
        </Button>
        <button
          type="submit"
          name="intent"
          value="draft"
          disabled={pending}
          className="rounded-md border border-line px-4 py-2 text-sm"
        >
          Save draft
        </button>
      </div>
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
