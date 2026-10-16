import { z } from "zod";
import { NETWORKS } from "./networks";
import params from "./params/publish.json";

/**
 * Publishing settings (component social.publish.turbineh), written by TurbineH from the request: the networks posts go
 * to, whether a person who may approve must approve each post before it is scheduled ("human approval before
 * publishing"), and how many attempts a failing publication gets. Validated at start-up.
 */
export const PublishParams = z.object({
  networks: z.array(z.enum(NETWORKS)).min(1).max(NETWORKS.length),
  requireApproval: z.boolean(),
  maxAttempts: z.number().int().min(1).max(10),
});

export const publishConfig = PublishParams.parse(params);
