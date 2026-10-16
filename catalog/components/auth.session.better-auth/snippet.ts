// Server (src/lib/auth.ts): email and password sessions stored in PostgreSQL.
import { betterAuth } from "better-auth";
import { nextCookies, toNextJsHandler } from "better-auth/next-js";
import { createAuthClient } from "better-auth/react";
import { Pool } from "pg";

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  plugins: [nextCookies()],
});

// Route handler (src/app/api/auth/[...all]/route.ts).
export const { GET, POST } = toNextJsHandler(auth);

// Client (src/lib/auth-client.ts): sign in from a React component.
export const authClient = createAuthClient();
await authClient.signIn.email({ email: "ana@example.com", password: "correct horse battery" });
