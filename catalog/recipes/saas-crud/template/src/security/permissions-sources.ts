/**
 * Browser features the Permissions-Policy header (src/security/headers.ts) allows to this app's own pages. Default:
 * none — camera, microphone and screen capture are denied everywhere. A component that records them (e.g.
 * media.screen-recording.turbineh) ships this file with `true`, which allows them to this origin only ("(self)"),
 * never to embedded third parties.
 */
export const MEDIA_CAPTURE_SELF: boolean = false;
