// X API v2 mock for the offline E2E run (social.connections.turbineh): playwright.config.ts starts it, points
// X_API_BASE and X_AUTH_BASE_URL here and gives the app throwaway X_CLIENT_ID/SECRET.
import { startMock } from "./social/common";
import { xMock } from "./social/x";

await startMock(
  xMock({
    clientId: process.env.X_CLIENT_ID ?? "",
    clientSecret: process.env.X_CLIENT_SECRET ?? "",
  }),
  Number(process.env.MOCK_PORT ?? 12100),
);
