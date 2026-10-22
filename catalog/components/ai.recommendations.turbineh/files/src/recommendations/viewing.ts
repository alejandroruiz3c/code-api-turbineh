import type { AnyAgentTool } from "@/lib/ai/agent";

/**
 * Viewings of a catalogue record (component ai.recommendations.turbineh). Without a booking domain in the app there is
 * nothing to book: no tool, no viewings. With domain.bookings.turbineh this file is replaced by the book_viewing tool
 * (files-with/domain.bookings.turbineh).
 */
export const VIEWINGS_ENABLED = false;

export const VIEWING_TOOLS: AnyAgentTool[] = [];

/** Staff list: viewings per record reference (none without bookings). */
export async function viewingsByItem(): Promise<
  { item: string; appointment: string; when: string; customer: string }[]
> {
  return [];
}
