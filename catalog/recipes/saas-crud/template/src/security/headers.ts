import { CSP_IMG_EXTRA } from "./csp-sources";
import { MEDIA_CAPTURE_SELF } from "./permissions-sources";

/**
 * Permissions-Policy: camera, microphone and screen capture denied unless a recording component allows them to this
 * origin only (src/security/permissions-sources.ts); geolocation always denied.
 */
export function permissionsPolicy(mediaCapture: boolean = MEDIA_CAPTURE_SELF): string {
  const media = mediaCapture ? "(self)" : "()";
  return `camera=${media}, microphone=${media}, display-capture=${media}, geolocation=()`;
}

/** Security Pack · HTTP security headers applied to every route (next.config.ts). */
export function securityHeaders(): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:", ...CSP_IMG_EXTRA].join(" "),
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: permissionsPolicy() },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
