// Twilio Messages API mock for the offline E2E run (messaging.sms.twilio): playwright.config.ts starts it, points
// TWILIO_API_BASE here and gives the app throwaway TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER.
import { startTwilioMock } from "./messaging/twilio-mock";

await startTwilioMock(
  {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? "",
    authToken: process.env.TWILIO_AUTH_TOKEN ?? "",
    from: process.env.TWILIO_FROM_NUMBER ?? null,
  },
  Number(process.env.MOCK_PORT ?? 12100),
);
