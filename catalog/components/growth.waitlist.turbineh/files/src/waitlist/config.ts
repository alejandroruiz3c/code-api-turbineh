import { z } from "zod";
import params from "./params.json";

/**
 * Waitlist mechanics (component growth.waitlist.turbineh), written by TurbineH from the request: double opt-in,
 * visible positions, referral links and how many positions each confirmed referral is worth, and what staff may do.
 * Validated at start-up.
 */
export const WaitlistParams = z.object({
  doubleOptIn: z.boolean(),
  showPosition: z.boolean(),
  referral: z.object({ enabled: z.boolean(), boost: z.number().int().min(0).max(1000) }),
  ownerCanExport: z.boolean(),
  ownerCanRemove: z.boolean(),
});
export type WaitlistConfig = z.infer<typeof WaitlistParams>;

export const waitlistConfig: WaitlistConfig = WaitlistParams.parse(params);
