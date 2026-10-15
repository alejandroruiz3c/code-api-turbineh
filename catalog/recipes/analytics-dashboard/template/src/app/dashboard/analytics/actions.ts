"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db/client";
import { dataPoints, datasets } from "@/db/schema";
import { CSV_LIMITS, parseCsv } from "@/lib/csv";
import { UserFacingError } from "@/security/errors";
import { rateLimit } from "@/security/rate-limit";
import { can, requireMember } from "@/server/authz";

const pointSchema = z.object({
  day: z.iso.date(),
  category: z.string().trim().min(1).max(80).default("General"),
  value: z.coerce.number().finite().min(-1e13).max(1e13),
});

async function ownDataset(id: string) {
  const ctx = await requireMember();
  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, id), eq(datasets.organizationId, ctx.organizationId)));
  if (!ds) throw new UserFacingError("Dataset not found.");
  return { ctx, ds };
}

export async function createDataset(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create"))
    throw new UserFacingError("You are not allowed to create datasets.");
  const input = z
    .object({ name: z.string().trim().min(2).max(120), unit: z.string().trim().max(24).optional() })
    .parse(Object.fromEntries(formData));
  const [row] = await db
    .insert(datasets)
    .values({ organizationId: ctx.organizationId, name: input.name, unit: input.unit ?? "" })
    .returning({ id: datasets.id });
  revalidatePath("/dashboard/analytics");
  if (row) redirect(`/dashboard/analytics/${row.id}`);
}

export async function addPoint(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to add data.");
  const { ds } = await ownDataset(z.uuid().parse(formData.get("datasetId")));
  const p = pointSchema.parse({
    day: formData.get("day"),
    category: formData.get("category") || undefined,
    value: formData.get("value"),
  });
  await db.insert(dataPoints).values({
    organizationId: ctx.organizationId,
    datasetId: ds.id,
    day: p.day,
    category: p.category,
    value: p.value.toFixed(2),
  });
  revalidatePath(`/dashboard/analytics/${ds.id}`);
}

/** CSV with columns date, category, value (category optional). Bounded size and rows; every row validated. */
export async function importPoints(formData: FormData): Promise<void> {
  const ctx = await requireMember();
  if (!can(ctx.role, "create")) throw new UserFacingError("You are not allowed to import data.");
  if (!(await rateLimit(`import:analytics:${ctx.userId}`, 5)))
    throw new UserFacingError("Too many imports. Try again later.");
  const { ds } = await ownDataset(z.uuid().parse(formData.get("datasetId")));
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a CSV file.");
  if (file.size > CSV_LIMITS.maxBytes) throw new UserFacingError("The CSV file is too large.");
  const rows = parseCsv(await file.text());
  const valid = rows
    .map((r) =>
      pointSchema.safeParse({
        day: r.date ?? r.day,
        category: r.category || undefined,
        value: r.value,
      }),
    )
    .filter((r) => r.success)
    .map((r) => r.data);
  if (valid.length > 0) {
    await db.insert(dataPoints).values(
      valid.map((p) => ({
        organizationId: ctx.organizationId,
        datasetId: ds.id,
        day: p.day,
        category: p.category,
        value: p.value.toFixed(2),
      })),
    );
  }
  revalidatePath(`/dashboard/analytics/${ds.id}`);
  redirect(
    `/dashboard/analytics/${ds.id}?imported=${valid.length}&rejected=${rows.length - valid.length}`,
  );
}
