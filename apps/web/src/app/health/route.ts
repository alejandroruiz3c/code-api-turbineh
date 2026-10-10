import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const ok = await db.query("SELECT 1").then(
    () => true,
    () => false,
  );
  return Response.json({ ok, service: "code-api-turbineh" }, { status: ok ? 200 : 503 });
}
