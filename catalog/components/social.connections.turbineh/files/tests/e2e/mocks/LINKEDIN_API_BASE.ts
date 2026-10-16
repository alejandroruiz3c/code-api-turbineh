// LinkedIn mock for the offline E2E run (social.connections.turbineh): playwright.config.ts starts it, points
// LINKEDIN_API_BASE and LINKEDIN_AUTH_BASE_URL here and gives the app throwaway LINKEDIN_CLIENT_ID/SECRET.
import { startMock } from "./social/common";
import { linkedinMock } from "./social/linkedin";

await startMock(
  linkedinMock({
    clientId: process.env.LINKEDIN_CLIENT_ID ?? "",
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET ?? "",
  }),
  Number(process.env.MOCK_PORT ?? 12100),
);
