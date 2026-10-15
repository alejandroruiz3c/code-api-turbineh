import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Answer, DecisionIO, SystemOneClient, SystemOneClientConfig } from "./contract.js";

/**
 * The public decision API client handed to the engine (`DecisionIO`): one official SDK client per backend, created
 * with the engine's configuration. Keys come from the server's environment and never leave it.
 */
export function systemOneClient(config: SystemOneClientConfig): SystemOneClient {
  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    defaultModel: config.model,
    timeout: config.timeoutMs,
    logLevel: "off",
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    ...(config.fetch ? { fetch: config.fetch } : {}),
  });
  return {
    async call(request, opts = {}) {
      const res = await client.systemOne(request, {
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      });
      return {
        model: res.model,
        answers: res.answers as Record<string, Answer>,
        usage: res.usage,
      };
    },
  };
}

/** Runtime capabilities given to the engine. */
export const decisionIO: DecisionIO = { systemOne: systemOneClient };
