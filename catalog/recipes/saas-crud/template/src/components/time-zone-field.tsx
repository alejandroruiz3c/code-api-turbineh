"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * Hidden form field with the person's own IANA time zone (from the browser), sent next to a datetime-local input so
 * the server stores the right UTC instant (ADR-0054). Server render and no-JavaScript submissions send `fallback`.
 */
export function TimeZoneField({ name, fallback = "UTC" }: { name: string; fallback?: string }) {
  const zone = useSyncExternalStore(
    noSubscription,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || fallback,
    () => fallback,
  );
  return <input type="hidden" name={name} value={zone} />;
}
