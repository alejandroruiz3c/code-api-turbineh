// Server code in the app (e.g. a page or an email): what booking a service costs to secure, from the server's rules.
import { formatMoney } from "@/payments/deposit";
import { dueFor } from "@/payments/service";

export function depositLine(service: string): string {
  const due = dueFor(service);
  return due
    ? `${formatMoney(due.cents, due.currency)} paid by card when booking`
    : "Pay at the visit";
}
