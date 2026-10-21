import type { SmsStore } from "@/messaging/sms/service";

/** In-memory SmsStore with the Postgres store's rules (a STOP reply is only undone by START), for unit tests. */
export function memoryStore() {
  const consent = new Map<string, { status: "opted_in" | "opted_out"; source: string }>();
  const log: { to: string; status: string; reason: string | null; providerSid: string | null }[] =
    [];
  const store: SmsStore = {
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
    async updateDelivery(sid, status) {
      const row = log.find((r) => r.providerSid === sid);
      if (row) row.status = status;
      return Boolean(row);
    },
  };
  return { store, consent, log };
}
