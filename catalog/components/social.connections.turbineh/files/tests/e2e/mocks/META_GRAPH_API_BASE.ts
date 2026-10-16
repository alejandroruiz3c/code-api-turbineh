// Meta Graph API mock for the offline E2E run (social.connections.turbineh): playwright.config.ts starts it, points
// META_GRAPH_API_BASE and META_AUTH_BASE_URL here and gives the app throwaway META_APP_ID/SECRET.
import { startMock } from "./social/common";
import { metaMock } from "./social/meta";

await startMock(
  metaMock({ appId: process.env.META_APP_ID ?? "", appSecret: process.env.META_APP_SECRET ?? "" }),
  Number(process.env.MOCK_PORT ?? 12100),
);
