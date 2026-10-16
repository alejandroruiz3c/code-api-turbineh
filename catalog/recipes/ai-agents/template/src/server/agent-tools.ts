import type { ReadTool } from "@/server/tools";

/**
 * Read-only agent tools generated from the request (e.g. `lookup_order` when the assistant looks up orders by
 * number). The assembler rewrites this file; with no such criterion the list is empty.
 */
export const GENERATED_READ_TOOLS: readonly ReadTool[] = [];
