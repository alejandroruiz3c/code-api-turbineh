import { z } from "zod";
import { PROVIDERS } from "./networks";
import params from "./params/connections.json";

/**
 * Which providers this app connects (component social.connections.turbineh), written by TurbineH from the request
 * ("connect LinkedIn and X"): LinkedIn, Meta (Facebook Pages + their Instagram professional accounts) and X.
 * Validated at start-up.
 */
export const ConnectionsParams = z.object({
  providers: z.array(z.enum(PROVIDERS)).min(1).max(PROVIDERS.length),
});

export const connectionsConfig = ConnectionsParams.parse(params);
