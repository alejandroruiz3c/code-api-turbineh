import {
  componentSummary,
  ERRORS,
  productText,
  USE_CASES,
  summarizeUseCase,
} from "@turbineh/engine";
import { db } from "@/server/db";
import { catalog, productProblem, requireCaller } from "@/server/product";

export const dynamic = "force-dynamic";

/**
 * GET /v1/capabilities/{id} — inspect a use case (its verified components, sections, requirements) or a component
 * (manifest: what it does and does not, licence, evidence, security scan).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const caller = await requireCaller();
  if (caller instanceof Response) return caller;
  const { id } = await ctx.params;
  const all = await catalog();
  const useCase = USE_CASES.find((u) => u.id === id);
  if (useCase) {
    const components = all.filter((c) => c.useCases?.includes(id));
    return Response.json({
      capability: summarizeUseCase(useCase, components.length),
      sections: useCase.sections,
      capabilities: useCase.capabilities,
      components: components.map(({ id: cid, version, license, provides, does }) => ({
        id: cid,
        version,
        license,
        provides,
        does: productText(does),
      })),
    });
  }
  const entry = all.find((c) => c.id === id);
  if (!entry) return productProblem(404, ERRORS.notFound(`Capability ${id}`));
  const res = await db.query<{ manifest: Record<string, unknown> }>(
    "SELECT manifest FROM components WHERE id = $1",
    [id],
  );
  const m = (res.rows[0]?.manifest ?? {}) as {
    capability?: { does?: string; does_not?: string; use_cases?: string[] };
    quality?: unknown;
    security?: unknown;
    license?: unknown;
    evidence?: { claim: string; origin: string }[];
  };
  return Response.json({
    capability: componentSummary({ ...entry, does: productText(entry.does) }),
    does: productText(m.capability?.does ?? entry.does),
    doesNot: productText(m.capability?.does_not ?? ""),
    useCases: m.capability?.use_cases ?? [],
    license: m.license ?? entry.license,
    quality: m.quality ?? null,
    security: m.security ?? null,
    evidence: (m.evidence ?? []).map((e) => ({ claim: productText(e.claim), origin: e.origin })),
  });
}
