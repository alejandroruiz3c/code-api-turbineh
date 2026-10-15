/**
 * The orchestration engine the gateway runs (ADR-0053). This module is the public default (the open minimal
 * fallback). When the private engine is installed at private/agent-orchestrator, the web app's bundler and test config
 * alias "@turbineh/orchestration/engine" to it instead; production builds require it.
 */
export { openEngine as engine } from "./open.js";
