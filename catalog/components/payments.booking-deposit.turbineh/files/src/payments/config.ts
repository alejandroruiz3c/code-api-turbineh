import { DepositParams, type DepositConfig } from "./deposit";
import params from "./booking-deposit.json";

/** The payment step's params (src/payments/booking-deposit.json), validated at start-up: a wrong value fails loudly. */
export const depositConfig: DepositConfig = DepositParams.parse(params);
