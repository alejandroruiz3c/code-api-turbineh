import { saveSiteEntry } from "@/app/dashboard/site-pages/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Collection } from "@/site-pages/config";
import type { Entry } from "@/site-pages/service";

/** Staff form of one public entry (site.public-pages.turbineh): content, filter fields and publication. */
export function EntryForm({ c, entry }: { c: Collection; entry?: Entry | null }) {
  const area = "w-full rounded-md border border-field px-3 py-2 text-sm";
  return (
    <form action={saveSiteEntry} className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <input type="hidden" name="collection" value={c.key} />
      <input type="hidden" name="id" value={entry?.id ?? ""} />
      <div>
        <Label htmlFor="se-title">Title</Label>
        <Input id="se-title" name="title" required maxLength={160} defaultValue={entry?.title} />
      </div>
      <div>
        <Label htmlFor="se-slug">Slug (optional)</Label>
        <Input id="se-slug" name="slug" maxLength={120} defaultValue={entry?.slug} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="se-summary">Summary</Label>
        <Input id="se-summary" name="summary" maxLength={300} defaultValue={entry?.summary} />
      </div>
      {c.filters.map((f) => (
        <div key={f.key}>
          <Label htmlFor={`se-${f.key}`}>{f.label}</Label>
          <Input
            id={`se-${f.key}`}
            name={`attr_${f.key}`}
            maxLength={80}
            defaultValue={entry?.attributes[f.key] ?? ""}
          />
        </div>
      ))}
      <div>
        <Label htmlFor="se-image">Image URL</Label>
        <Input
          id="se-image"
          name="imageUrl"
          type="url"
          maxLength={500}
          defaultValue={entry?.imageUrl ?? ""}
        />
      </div>
      <div>
        <Label htmlFor="se-sort">Order</Label>
        <Input id="se-sort" name="sort" type="number" defaultValue={entry?.sort ?? 0} />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="se-body">Text</Label>
        <textarea
          id="se-body"
          name="body"
          rows={6}
          maxLength={20000}
          defaultValue={entry?.body}
          className={area}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="published" defaultChecked={entry?.published ?? false} />{" "}
        Published
      </label>
      <div>
        <Button type="submit">{entry ? "Save" : `Add ${c.label.toLowerCase()}`}</Button>
      </div>
    </form>
  );
}
