/** Pure client-portal rules (recipe client-portal), unit-tested in tests/unit/portal.test.ts. */
import type { Role } from "@/server/authz";

export const STATUSES = ["submitted", "in_review", "needs_info", "completed"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  submitted: "Submitted",
  in_review: "In review",
  needs_info: "Needs information",
  completed: "Completed",
};

const NEXT: Record<Status, Status[]> = {
  submitted: ["in_review", "needs_info", "completed"],
  in_review: ["needs_info", "completed"],
  needs_info: ["in_review", "completed"],
  completed: [],
};

/** Only owners and admins move a request, and only along the allowed transitions. */
export function canTransition(role: Role, from: Status, to: Status): boolean {
  return (role === "owner" || role === "admin") && NEXT[from].includes(to);
}

export const nextStatuses = (from: Status) => NEXT[from];

export const isStatus = (v: string): v is Status => (STATUSES as readonly string[]).includes(v);

/** Clients see their own requests; owners and admins see every request of the workspace. */
export const seesAll = (role: Role) => role === "owner" || role === "admin";

export const FILE_LIMITS = { maxBytes: 5 * 1024 * 1024, maxFilesPerRequest: 10 } as const;

/**
 * File type from the content (magic bytes), never from the name or the browser: PDF, PNG, JPEG, WebP and plain
 * text/CSV. Everything else (HTML, SVG, executables, archives) is rejected.
 */
export function sniffType(bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  const head = bytes.subarray(0, 4096);
  const printable = head.every(
    (b) => b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b !== 0x7f),
  );
  const text = new TextDecoder().decode(head).toLowerCase();
  if (head.length > 0 && printable && !/<\s*(html|script|svg|!doctype|\?xml)/.test(text))
    return "text/plain";
  return null;
}

/** Safe file name for storage and Content-Disposition: no paths, no control characters, bounded length. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^\.+/, "")
    .trim();
  return (cleaned || "file").slice(0, 120);
}
