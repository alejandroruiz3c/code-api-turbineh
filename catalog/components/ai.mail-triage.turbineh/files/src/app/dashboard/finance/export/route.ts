import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isStaff } from "@/lib/staff";
import { ledgerWorkbook } from "@/mail/triage/ledger";
import { ledger } from "@/mail/triage/service";

export const dynamic = "force-dynamic";

/** GET /dashboard/finance/export — the finance ledger as an Excel workbook (entries + totals). ADMIN_EMAILS only. */
export async function GET(): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isStaff(session.user, process.env.ADMIN_EMAILS ?? ""))
    return Response.json({ error: "Not found." }, { status: 404 });
  const body = await ledgerWorkbook(
    (await ledger()).map((e) => ({
      date: e.date,
      kind: e.kind,
      amount: e.amount,
      currency: e.currency,
      issuer: e.issuer,
      description: e.description,
      document: e.document,
      source: e.source,
    })),
  );
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="finances-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "cache-control": "no-store",
    },
  });
}
