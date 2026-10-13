import { asc } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/db/client";
import { bookingResources } from "@/db/schema";
import { bookingConfig as cfg } from "@/bookings/config";
import { faqEntries, listResources } from "@/bookings/service";
import { currentAdmin, requireMember } from "@/server/authz";
import { addQuestion, saveAnswer, saveResource } from "../actions";

export const dynamic = "force-dynamic";

/** Team and the assistant's answers (component domain.bookings.turbineh). ADMIN_EMAILS only. */
export default async function BookingSettings() {
  await requireMember();
  if (!(await currentAdmin())) {
    return <p role="status">Only staff can change these settings.</p>;
  }
  await listResources();
  const [team, faq] = await Promise.all([
    db.select().from(bookingResources).orderBy(asc(bookingResources.sort)),
    faqEntries(),
  ]);
  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{cfg.resource.plural}</h1>
        {team.map((r) => (
          <form key={r.id} action={saveResource} className="flex items-end gap-3">
            <input type="hidden" name="id" value={r.id} />
            <div className="flex flex-col gap-1">
              <Label htmlFor={`r-${r.id}`}>Name</Label>
              <Input id={`r-${r.id}`} name="name" defaultValue={r.name} required maxLength={80} />
            </div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" name="active" defaultChecked={r.active} /> Bookable
            </label>
            <Button type="submit">Save</Button>
          </form>
        ))}
        <form action={saveResource} className="flex items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="r-new">Add {cfg.resource.singular.toLowerCase()}</Label>
            <Input id="r-new" name="name" required maxLength={80} />
          </div>
          <Button type="submit">Add</Button>
        </form>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Answers the assistant may give</h2>
        <p className="text-sm text-slate-600">
          Empty answers are reported as &quot;not published yet&quot;: the assistant never makes
          them up.
        </p>
        {faq.map((f) => (
          <form key={f.id} action={saveAnswer} className="flex flex-col gap-1">
            <input type="hidden" name="id" value={f.id} />
            <Label htmlFor={`f-${f.id}`}>{f.topic}</Label>
            <textarea
              id={`f-${f.id}`}
              name="answer"
              defaultValue={f.answer ?? ""}
              maxLength={1000}
              rows={2}
              className="rounded-md border border-slate-300 p-2 text-sm"
            />
            <div>
              <Button type="submit">Save answer</Button>
            </div>
          </form>
        ))}
        <form action={addQuestion} className="flex flex-col gap-1">
          <Label htmlFor="f-topic">New topic</Label>
          <Input id="f-topic" name="topic" required minLength={2} maxLength={120} />
          <Label htmlFor="f-answer">Answer</Label>
          <textarea
            id="f-answer"
            name="answer"
            maxLength={1000}
            rows={2}
            className="rounded-md border border-slate-300 p-2 text-sm"
          />
          <div>
            <Button type="submit">Add topic</Button>
          </div>
        </form>
      </section>
    </div>
  );
}
