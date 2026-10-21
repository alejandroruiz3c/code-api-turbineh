import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { recommendationItems } from "@/db/schema";
import { recommendationConfig as cfg } from "@/recommendations/config";
import { currentAdmin, requireMember } from "@/server/authz";
import { ItemForm } from "../item-form";

export const dynamic = "force-dynamic";

/** Edit one catalogue record (component ai.recommendations.turbineh). ADMIN_EMAILS only. */
export default async function EditItem({ params }: { params: Promise<{ id: string }> }) {
  await requireMember();
  if (!(await currentAdmin())) return <p role="status">Only staff can manage the catalogue.</p>;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [r] = await db
    .select()
    .from(recommendationItems)
    .where(eq(recommendationItems.id, id.data));
  if (!r) notFound();
  return (
    <div className="flex flex-col gap-4">
      <Link className="text-sm underline" href="/dashboard/catalog">
        ← Back
      </Link>
      <h1 className="text-2xl font-semibold">
        {r.reference} · {r.title}
      </h1>
      <p className="text-sm text-muted">
        {r.verified
          ? `Verified by ${r.verifiedBy ?? "staff"} on ${r.verifiedAt?.toISOString().slice(0, 10) ?? "—"}.`
          : "Not verified: the assistant does not recommend it."}
      </p>
      <ItemForm
        fields={cfg.fields}
        currency={r.currency}
        initial={{
          id: r.id,
          reference: r.reference,
          title: r.title,
          description: r.description,
          price: r.price,
          location: r.location,
          verified: r.verified,
          active: r.active,
          attributes: r.attributes ?? {},
        }}
      />
    </div>
  );
}
