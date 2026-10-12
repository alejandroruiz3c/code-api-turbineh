import type { FlowState } from "@turbineh/shared";

/** Build status → precise product state (never "ready"; PLAN §16.2). */
export function stateOfBuild(status: string, deployed: boolean): FlowState {
  if (status === "done") return deployed ? "deployed" : "verified";
  if (status === "failed") return "failed";
  if (status === "queued") return "planned";
  return "generating";
}
