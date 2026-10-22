/**
 * Browser features the Permissions-Policy header (src/security/headers.ts) allows to this app's own pages. The
 * recorder of media.screen-recording.turbineh captures the screen, the camera and the microphone, so they are allowed
 * to this origin only ("(self)"), never to embedded third parties; geolocation stays denied.
 */
export const MEDIA_CAPTURE_SELF: boolean = true;
