/**
 * E2E mock of the TurbineH AI gateway: playwright.config.ts starts every tests/e2e/mocks/<ENV>.(mjs|ts) and points
 * <ENV> (here TURBINEH_AI_URL, plus AI_BASE_URL for OpenAI-compatible calls) to it. It is the scripted mock model of
 * tests/mock-llm (one mock for the whole app; domain components add scripts there).
 */
process.env.MOCK_LLM_PORT = process.env.MOCK_PORT ?? process.env.MOCK_LLM_PORT ?? "4010";
await import("../../mock-llm/run");
export {};
