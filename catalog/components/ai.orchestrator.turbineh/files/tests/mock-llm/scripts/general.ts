import type { MockScript } from "../mock";

/**
 * Rules shared by every AI app. Domain components add tests/mock-llm/scripts/<domain>.ts next to this file; a rule
 * fires only when the request offers its tool.
 */
const script: MockScript = {
  id: "general",
  rules: [
    // A person is asked for: hand the conversation over (ai-agents' escalate_to_human).
    {
      tool: "escalate_to_human",
      when: /\b(human|a (real )?person|someone from (the|your) team|escalat\w*)\b/i,
      args: () => ({}),
    },
  ],
};
export default script;
