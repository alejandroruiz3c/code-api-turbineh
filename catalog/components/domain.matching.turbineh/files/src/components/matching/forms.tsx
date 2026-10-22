"use client";
import { useActionState } from "react";
import {
  createRecordAction,
  saveProfileAction,
  updateRecordAction,
  type MatchingFormState,
} from "@/app/dashboard/matching/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initial: MatchingFormState = { error: null, saved: false };
const area = "w-full rounded-md border border-field px-3 py-2 text-sm";

function Feedback({ state, savedText }: { state: MatchingFormState; savedText: string }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-danger">
        {state.error}
      </p>
    );
  return state.saved ? (
    <p role="status" className="text-sm text-success">
      {savedText}
    </p>
  ) : null;
}

/** The organization's matching profile: one term per line or comma-separated, per dimension. */
export function ProfileForm({
  profile,
  canEdit,
}: {
  profile: {
    sectors: readonly string[];
    activities: readonly string[];
    regions: readonly string[];
    keywords: readonly string[];
  };
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveProfileAction, initial);
  const field = (name: keyof typeof profile, label: string, hint: string) => (
    <div>
      <Label htmlFor={`profile-${name}`}>{label}</Label>
      <textarea
        id={`profile-${name}`}
        name={name}
        rows={3}
        defaultValue={profile[name].join("\n")}
        disabled={!canEdit}
        className={area}
        aria-describedby={`profile-${name}-hint`}
      />
      <p id={`profile-${name}-hint`} className="text-xs text-muted">
        {hint}
      </p>
    </div>
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      {field(
        "sectors",
        "Sectors",
        "e.g. Renewable energy, Health — one per line or comma-separated",
      )}
      {field("activities", "Business activities", "e.g. Engineering, Installation, Consulting")}
      {field("regions", "Geographic coverage", "Regions or countries, e.g. Andalusia, Portugal")}
      {field("keywords", "Interest keywords", "Words or phrases, e.g. solar, battery storage")}
      <Feedback state={state} savedText="Profile saved." />
      {canEdit ? (
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      ) : (
        <p className="text-sm text-muted" data-testid="profile-read-only">
          Only members who manage the organization&apos;s settings can change its profile.
        </p>
      )}
    </form>
  );
}

export interface RecordValues {
  id?: string;
  title: string;
  description: string;
  sector: string | null;
  activity: string | null;
  region: string | null;
  deadline: string | null;
  sourceUrl: string | null;
  status: string;
}

/** Add or edit a record (labels use the app's word for it). */
export function RecordForm({ singular, record }: { singular: string; record?: RecordValues }) {
  const [state, action, pending] = useActionState(
    record?.id ? updateRecordAction : createRecordAction,
    initial,
  );
  const text = (name: keyof RecordValues, label: string, type = "text") => (
    <div>
      <Label htmlFor={`record-${name}`}>{label}</Label>
      <Input
        id={`record-${name}`}
        name={name}
        type={type}
        defaultValue={(record?.[name] as string | null | undefined) ?? ""}
      />
    </div>
  );
  return (
    <form action={action} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {record?.id ? <input type="hidden" name="id" value={record.id} /> : null}
      <div className="md:col-span-2">
        <Label htmlFor="record-title">Title</Label>
        <Input
          id="record-title"
          name="title"
          required
          maxLength={200}
          defaultValue={record?.title ?? ""}
        />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="record-description">Description</Label>
        <textarea
          id="record-description"
          name="description"
          rows={4}
          required
          className={area}
          defaultValue={record?.description ?? ""}
        />
      </div>
      {text("sector", "Sector")}
      {text("activity", "Activity")}
      {text("region", "Region")}
      {text("deadline", "Deadline", "date")}
      {text("sourceUrl", "Source URL", "url")}
      <div>
        <Label htmlFor="record-status">Status</Label>
        <select
          id="record-status"
          name="status"
          defaultValue={record?.status ?? "open"}
          className={area}
        >
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="md:col-span-2 flex flex-col gap-2">
        <Feedback state={state} savedText="Saved." />
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : record?.id ? `Save ${singular}` : `Add ${singular}`}
        </Button>
      </div>
    </form>
  );
}
