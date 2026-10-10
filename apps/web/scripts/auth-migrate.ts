/** Creates/updates the auth tables (user, session, account, verification) in the platform database. */
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/server/auth";

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
console.log("auth migrations applied");
process.exit(0);
