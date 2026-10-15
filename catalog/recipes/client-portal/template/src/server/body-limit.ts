/**
 * Largest server-action request body (read by next.config.ts): request files up to 5 MB go through server actions
 * (the limit is enforced again in src/server/portal.ts). storage.private-uploads.turbineh replaces this file.
 */
export const SERVER_ACTION_BODY_LIMIT: number = 6 * 1024 * 1024;
