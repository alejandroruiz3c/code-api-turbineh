import type { MockScript } from "../mock";

/**
 * Rules shared by every AI app. Domain components add tests/mock-llm/scripts/<domain>.ts next to this file; a rule
 * fires only when the request offers its tool.
 */
const script: MockScript = { id: "general", rules: [] };
export default script;
