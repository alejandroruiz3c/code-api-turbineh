import type { FlowState } from "@turbineh/shared";

/**
 * Build status → precise product state (never "ready"; PLAN §16.2). A failed gate that still delivered its package is
 * "generated" (delivered, not verified — ADR-0037), never "verified".
 */
export function stateOfBuild(
  status: string,
  deployed: boolean,
  deliveredUnverified = false,
): FlowState {
  if (status === "done") return deployed ? "deployed" : "verified";
  if (status === "failed") return deliveredUnverified ? "generated" : "failed";
  if (status === "queued") return "planned";
  return "generating";
}
