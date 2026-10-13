/**
 * Extra image sources allowed by the Content-Security-Policy (src/security/headers.ts). Empty: images come only from
 * this app. A recipe that shows images by URL (e.g. product image URLs, https only) adds "https:" here.
 */
export const CSP_IMG_EXTRA: readonly string[] = [];
