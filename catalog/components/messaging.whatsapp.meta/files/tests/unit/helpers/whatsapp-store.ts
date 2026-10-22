import type { WhatsAppStore } from "@/messaging/whatsapp/service";

/** In-memory WhatsAppStore with the Postgres store's rules (STOP only undone by START), for unit tests. */
export function memoryWhatsAppStore() {
  const consent = new Map<string, { status: "opted_in" | "opted_out"; source: string }>();
  const log: { to: string; status: string; reason: string | null; providerId: string | null }[] =
    [];
  const store: WhatsAppStore = {
    async consentOf(phone) {
      return consent.get(phone)?.status ?? null;
    },
    async setConsent(phone, status, source) {
      const now = consent.get(phone);
      if (status === "opted_in" && now?.status === "opted_out" && !source.startsWith("keyword:"))
        return false;
      consent.set(phone, { status, source });
      return true;
    },
    async record(row) {
      log.push(row);
    },
    async updateDelivery(id, status) {
      const row = log.find((r) => r.providerId === id);
      if (row) row.status = status;
      return Boolean(row);
    },
  };
  return { store, consent, log };
}
