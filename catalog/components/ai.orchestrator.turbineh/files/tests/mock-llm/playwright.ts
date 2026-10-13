/**
 * Playwright wiring of the scripted mock model (component ai.orchestrator.turbineh): tests never reach the internet.
 * The app under test talks to it as an OpenAI-compatible endpoint (AI_BASE_URL) and as the decision endpoint.
 */
export const MOCK_LLM_PORT = Number(process.env.MOCK_LLM_PORT ?? 4010);

export const mockLlmWebServer = {
  command: "pnpm exec tsx tests/mock-llm/run.ts",
  url: `http://127.0.0.1:${MOCK_LLM_PORT}/health`,
  env: { MOCK_LLM_PORT: String(MOCK_LLM_PORT) },
  timeout: 30_000,
  reuseExistingServer: false,
};

/** Environment for the app's web server: every model and decision call goes to the local mock. */
export const mockLlmEnv: Record<string, string> = {
  AI_BASE_URL: `http://127.0.0.1:${MOCK_LLM_PORT}/v1`,
  AI_API_KEY: "mock-key",
  AI_MODEL: "mock-model",
  TURBINEH_AI_URL: `http://127.0.0.1:${MOCK_LLM_PORT}`,
  TURBINEH_AI_TOKEN: "mock-token",
};
