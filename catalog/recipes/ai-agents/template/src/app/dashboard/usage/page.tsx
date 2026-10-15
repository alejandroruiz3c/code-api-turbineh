import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { usageSummary } from "@/lib/ai/usage";
import { requireMember } from "@/server/authz";

const n = (v: number) => v.toLocaleString("en");

/** AI usage of the workspace over 30 days (requests and tokens; no prices). */
export default async function Usage() {
  const ctx = await requireMember();
  const u = await usageSummary(ctx.organizationId, 30);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">AI usage</h1>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Requests · 30 days">
          <p className="text-2xl font-semibold" data-metric="requests">
            {n(u.requests)}
          </p>
        </Card>
        <Card title="Model calls">
          <p className="text-2xl font-semibold">{n(u.calls)}</p>
        </Card>
        <Card title="Tokens (in / out)">
          <p className="text-2xl font-semibold">
            {n(u.inputTokens)} / {n(u.outputTokens)}
          </p>
        </Card>
      </div>
      <h2 className="text-lg font-semibold">By purpose</h2>
      <Table head={["Purpose", "Requests", "Tokens"]}>
        {u.byPurpose.map((p) => (
          <tr key={p.purpose}>
            <td className="px-3 py-2">{p.purpose}</td>
            <td className="px-3 py-2">{n(p.requests)}</td>
            <td className="px-3 py-2">{n(p.tokens)}</td>
          </tr>
        ))}
      </Table>
      <h2 className="text-lg font-semibold">By day</h2>
      <Table head={["Day", "Requests", "Tokens"]}>
        {u.byDay.map((d) => (
          <tr key={d.day}>
            <td className="px-3 py-2">{d.day}</td>
            <td className="px-3 py-2">{n(d.requests)}</td>
            <td className="px-3 py-2">{n(d.tokens)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
