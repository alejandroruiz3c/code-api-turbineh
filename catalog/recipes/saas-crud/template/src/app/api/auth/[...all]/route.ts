import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

/** better-auth HTTP endpoints (sign-in, sign-up, sign-out, sessions, organizations). */
export const { GET, POST } = toNextJsHandler(auth);
