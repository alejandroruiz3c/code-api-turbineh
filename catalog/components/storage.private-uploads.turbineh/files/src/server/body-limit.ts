import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Largest server-action request body (read by next.config.ts), from the upload size limit of
 * storage.private-uploads.turbineh (src/uploads/params.json `maxBytes`) plus room for the other form fields, so a file
 * just over the limit still reaches the code that refuses it with a clear message.
 */
const { maxBytes } = JSON.parse(
  readFileSync(join(process.cwd(), "src/uploads/params.json"), "utf8"),
) as { maxBytes: number };

export const SERVER_ACTION_BODY_LIMIT: number = maxBytes + 1024 * 1024;
