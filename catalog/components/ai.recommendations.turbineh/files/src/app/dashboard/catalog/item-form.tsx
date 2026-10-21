"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveItem, type ItemState } from "./actions";

export interface ItemFormField {
  key: string;
  label: string;
  type: "integer" | "number" | "text" | "enum";
  options?: string[];
}

export interface ItemFormValues {
  id?: string;
  reference: string;
  title: string;
  description: string;
  price: string;
  location: string;
  verified: boolean;
  active: boolean;
  attributes: Record<string, string | number | null>;
}

/** Staff form of one catalogue record (create or edit); refusals are shown as-is. */
export function ItemForm({
  fields,
  currency,
  initial,
}: {
  fields: ItemFormField[];
  currency: string;
  initial?: ItemFormValues;
}) {
  const [state, action, pending] = useActionState<ItemState, FormData>(saveItem, {
    error: null,
    done: null,
  });
  const p = initial?.id ?? "new";
  return (
    <form action={action} className="grid max-w-2xl grid-cols-2 gap-3">
      <input type="hidden" name="id" value={initial?.id ?? ""} />
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${p}-reference`}>Reference</Label>
        <Input
          id={`${p}-reference`}
          name="reference"
          required
          maxLength={24}
          defaultValue={initial?.reference}
          placeholder="R-101"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${p}-title`}>Title</Label>
        <Input
          id={`${p}-title`}
          name="title"
          required
          maxLength={160}
          defaultValue={initial?.title}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${p}-price`}>Price ({currency})</Label>
        <Input
          id={`${p}-price`}
          name="price"
          type="number"
          min="0"
          step="0.01"
          required
          defaultValue={initial?.price}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${p}-location`}>Location</Label>
        <Input
          id={`${p}-location`}
          name="location"
          required
          maxLength={120}
          defaultValue={initial?.location}
        />
      </div>
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <Label htmlFor={`${p}-attr-${f.key}`}>{f.label}</Label>
          {f.type === "enum" ? (
            <select
              id={`${p}-attr-${f.key}`}
              name={`attr_${f.key}`}
              defaultValue={String(initial?.attributes[f.key] ?? "")}
              className="rounded-md border border-field p-2 text-sm"
            >
              <option value="">—</option>
              {(f.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <Input
              id={`${p}-attr-${f.key}`}
              name={`attr_${f.key}`}
              type={f.type === "text" ? "text" : "number"}
              step={f.type === "number" ? "any" : "1"}
              defaultValue={String(initial?.attributes[f.key] ?? "")}
            />
          )}
        </div>
      ))}
      <div className="col-span-2 flex flex-col gap-1">
        <Label htmlFor={`${p}-description`}>Description</Label>
        <textarea
          id={`${p}-description`}
          name="description"
          maxLength={4000}
          rows={3}
          defaultValue={initial?.description}
          className="rounded-md border border-field p-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="verified" defaultChecked={initial?.verified ?? false} />
        Facts checked (verified): the assistant may recommend it
      </label>
      {initial?.id ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={initial.active} /> Active
        </label>
      ) : null}
      <div className="col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p role="status" className="text-sm text-success">
            {state.done}
          </p>
        ) : null}
      </div>
    </form>
  );
}
