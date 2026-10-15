/**
 * The resource decision engine for Node processes (worker, scripts, tests): the private engine when it is installed
 * at <repo>/private/resource-decider (ADR-0058), else the public open fallback. Resolved once at startup; a process
 * that requires the private engine (production) fails here, loudly, when it is missing or does not load.
 *
 * The web app never loads this module: its bundler and test config alias "@turbineh/decider/engine" to the private
 * entry or to `open-engine.ts` (apps/web/resource-decider.config.mjs).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { DecisionEngine } from "./contract.js";
import { openEngine } from "./open.js";
import {
  missingPrivateDecider,
  PRIVATE_DECIDER_ENTRY,
  privateEnginesRequired,
} from "./required.js";

// src/engine.ts and dist/engine.js are both three levels below the repository root.
const entry = new URL(`../../../${PRIVATE_DECIDER_ENTRY}`, import.meta.url);

async function load(): Promise<DecisionEngine> {
  if (existsSync(fileURLToPath(entry))) {
    const mod = (await import(entry.href)) as { engine?: DecisionEngine };
    if (mod.engine?.edition !== "private")
      throw new Error(`${PRIVATE_DECIDER_ENTRY} does not export the private decision engine`);
    return mod.engine;
  }
  if (privateEnginesRequired(process.env)) throw missingPrivateDecider();
  return openEngine;
}

export const engine: DecisionEngine = await load();
