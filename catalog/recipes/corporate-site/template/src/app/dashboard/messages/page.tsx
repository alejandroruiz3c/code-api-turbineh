import { count, desc } from "drizzle-orm";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { db } from "@/db/client";
import { contactMessages } from "@/db/schema";
import { PAGE_SIZE, parsePage } from "@/lib/pagination";
import { requireAdmin } from "@/server/admin";
import { markHandled } from "./actions";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Messages({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin();
  const { page, offset, limit } = parsePage((await searchParams).page);
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select()
      .from(contactMessages)
      .orderBy(desc(contactMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(contactMessages),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Card title={`Messages (${total})`}>
      <ul className="flex flex-col gap-4">
        {rows.map((m) => (
          <li
            key={m.id}
            className={`rounded-lg border p-4 ${m.handled ? "border-slate-100 opacity-60" : "border-slate-300"}`}
          >
            <p className="font-medium">
              {m.name} ·{" "}
              <a className="underline" href={`mailto:${m.email}`}>
                {m.email}
              </a>
              {m.company ? ` · ${m.company}` : ""}
            </p>
            <p className="text-xs text-slate-500">
              {m.createdAt.toISOString().slice(0, 16).replace("T", " ")}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{m.message}</p>
            {m.handled ? null : (
              <form action={markHandled} className="mt-2">
                <input type="hidden" name="id" value={m.id} />
                <button className="text-sm underline" type="submit">
                  Mark as handled
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <nav aria-label="Pagination" className="mt-4 flex gap-3 text-sm">
        {page > 1 ? <Link href={`/dashboard/messages?page=${page - 1}`}>Previous</Link> : null}
        <span>
          Page {page} of {pages}
        </span>
        {page < pages ? <Link href={`/dashboard/messages?page=${page + 1}`}>Next</Link> : null}
      </nav>
    </Card>
  );
}
