import { env } from "@/env";

export { jsonLd, slugify, xml } from "./text";

/** Absolute URL of a site path (BETTER_AUTH_URL is the public address of the app). */
export const absolute = (path: string) => `${env.BETTER_AUTH_URL.replace(/\/$/, "")}${path}`;
