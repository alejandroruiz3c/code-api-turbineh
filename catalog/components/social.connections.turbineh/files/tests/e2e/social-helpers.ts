import { expect, type APIRequestContext, type Page } from "@playwright/test";
import pg from "pg";

/**
 * Shared steps of the social.* E2E suites: connect the mock providers through their consent pages, call the protected
 * runner routes, read the provider mocks' request logs and query the database. Everything runs offline against the
 * mocks playwright.config.ts starts (tests/e2e/mocks/*_API_BASE.ts).
 */
export const PROVIDER_BUTTON = {
  linkedin: "Connect LinkedIn",
  meta: "Connect Facebook & Instagram",
  x: "Connect X",
} as const;

/** Connects a provider the way a person does: the Connect link, the provider's consent page, "Allow". */
export async function connect(page: Page, provider: keyof typeof PROVIDER_BUTTON): Promise<void> {
  await page.goto("/dashboard/social");
  await page.getByRole("link", { name: PROVIDER_BUTTON[provider] }).click();
  await page.getByRole("link", { name: "Allow" }).click();
  await expect(page).toHaveURL(/\/dashboard\/social\?connected=\d+/);
}

/** Connects every provider that has no active account yet. */
export async function connectAll(page: Page): Promise<void> {
  const rows = await query<{ network: string }>(
    "select network from social_connections where status = 'active'",
  );
  const have = new Set(rows.map((r) => r.network));
  if (!have.has("linkedin")) await connect(page, "linkedin");
  if (!have.has("facebook") || !have.has("instagram")) await connect(page, "meta");
  if (!have.has("x")) await connect(page, "x");
}

export async function query<T>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

/** Calls a protected runner route with the run's CRON_SECRET. */
export async function runRoute<T>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.post(path, {
    headers: { "x-cron-secret": process.env.CRON_SECRET ?? "" },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as T;
}

export type MockRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
};

export async function mockRequests(
  request: APIRequestContext,
  baseEnv: string,
): Promise<MockRequest[]> {
  return (await (
    await request.get(`${process.env[baseEnv]}/__mock/requests`)
  ).json()) as MockRequest[];
}

/** Makes the provider mock answer the next `times` calls matching "METHOD /path" with `status`. */
export async function failNext(
  request: APIRequestContext,
  baseEnv: string,
  match: string,
  status: number,
  times = 1,
): Promise<void> {
  await request.post(`${process.env[baseEnv]}/__mock/fail`, {
    data: { match, status, times, json: { error: "unavailable" } },
  });
}
