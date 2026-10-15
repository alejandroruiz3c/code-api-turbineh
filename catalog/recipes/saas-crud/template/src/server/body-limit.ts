/**
 * Largest server-action request body (Next.js `serverActions.bodySizeLimit`, read by next.config.ts). Next's default is
 * 1 MB; apps that accept uploads raise it here (storage.private-uploads.turbineh replaces this file with its size limit
 * from src/uploads/params.json). Every upload is still checked in code against its own limit.
 */
export const SERVER_ACTION_BODY_LIMIT: number = 1024 * 1024;
