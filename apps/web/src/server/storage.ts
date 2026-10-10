import { join } from "node:path";
import { storageFromEnv } from "@turbineh/storage";

/** Same storage the worker writes to (local folder in development, S3 in staging/production). */
export const storage = storageFromEnv(
  process.env,
  process.env.LOCAL_ARTIFACTS_DIR ?? join(process.cwd(), "../../artifacts"),
);
