// WhatsApp Cloud API mock for the offline E2E run (messaging.whatsapp.meta): playwright.config.ts starts it, points
// WHATSAPP_API_BASE here and gives the app throwaway WHATSAPP_ACCESS_TOKEN / PHONE_NUMBER_ID / APP_SECRET; statuses
// are posted to the app's webhook (WHATSAPP_MOCK_WEBHOOK_URL).
import { DEFAULT_TEMPLATES, startWhatsAppMock } from "./messaging/whatsapp-mock";

await startWhatsAppMock(
  {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET ?? "",
    templates: DEFAULT_TEMPLATES,
    webhookUrl: process.env.WHATSAPP_MOCK_WEBHOOK_URL ?? null,
  },
  Number(process.env.MOCK_PORT ?? 12100),
);
