import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { OWNER_EMAIL } from "./helpers";

/**
 * Status workflow (component domain.workflow.turbineh), driven by the app's own definition (src/workflow/params.json):
 * each title states the criterion it proves. The E2E owner is the workspace owner and the creator of its records.
 */
type Wf = {
  key: string;
  label: string;
  initial: string;
  states: { key: string; label: string; limitHours: number | null; final: boolean }[];
  transitions: { from: string[]; to: string; label: string; roles: string[] }[];
};
const wf = (JSON.parse(readFileSync("src/workflow/params.json", "utf8")) as { workflows: Wf[] })
  .workflows[0]!;
const label = (k: string) => wf.states.find((s) => s.key === k)?.label ?? k;
const ownerMay = (t: Wf["transitions"][number]) =>
  t.roles.some((r) => r === "owner" || r === "*" || r === "creator");
const isFinal = (k: string) => wf.states.find((s) => s.key === k)?.final ?? false;
const ownerMoves = (from: string) =>
  isFinal(from) ? [] : wf.transitions.filter((t) => t.from.includes(from) && ownerMay(t));
const today = () => new Date().toISOString().slice(0, 10);

/** Owner-allowed path from the initial state to `target` (breadth-first), or null. */
function pathTo(target: string): Wf["transitions"] | null {
  const queue: [string, Wf["transitions"]][] = [[wf.initial, []]];
  const seen = new Set([wf.initial]);
  while (queue.length) {
    const [state, path] = queue.shift()!;
    if (state === target) return path;
    for (const t of ownerMoves(state))
      if (!seen.has(t.to)) {
        seen.add(t.to);
        queue.push([t.to, [...path, t]]);
      }
  }
  return null;
}

async function createRecord(page: Page, title: string): Promise<string> {
  await page.goto(`/dashboard/workflow/${wf.key}`);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: `Create ${wf.label.toLowerCase()}` }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/workflow/${wf.key}/[0-9a-f-]{36}$`));
  return page.url().split("/").pop()!;
}

async function move(page: Page, t: Wf["transitions"][number]) {
  await page.getByRole("button", { name: t.label, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Status changed.");
  await expect(page.getByTestId("current-state")).toHaveText(label(t.to));
}

test.describe.serial("status workflow", () => {
  const title = `E2E ${wf.label} ${Date.now()}`;
  let id = "";

  test("a new record starts in the initial status and its history records who created it and when", async ({
    page,
  }) => {
    id = await createRecord(page, title);
    await expect(page.getByTestId("current-state")).toHaveText(label(wf.initial));
    const first = page.getByTestId("history").locator("li").first();
    await expect(first).toContainText(`Created as ${label(wf.initial)}`);
    await expect(first).toContainText(OWNER_EMAIL);
    await expect(first).toContainText(today());
  });

  test("a status change the workflow does not allow is refused by the server", async ({ page }) => {
    const reachable = new Set(ownerMoves(wf.initial).map((t) => t.to));
    const forbidden = wf.states
      .map((s) => s.key)
      .find((k) => k !== wf.initial && !reachable.has(k));
    test.skip(!forbidden || reachable.size === 0, "every status is reachable from the initial one");
    await page.goto(`/dashboard/workflow/${wf.key}/${id}`);
    // Tamper with the form: ask the server for a status the definition does not allow from here.
    const button = page.getByRole("button", {
      name: ownerMoves(wf.initial)[0]!.label,
      exact: true,
    });
    await button.evaluate((el, value) => el.setAttribute("value", value), forbidden!);
    await button.click();
    await expect(page.getByRole("status")).toContainText("cannot go from");
    await expect(page.getByTestId("current-state")).toHaveText(label(wf.initial));
  });

  test("only the allowed transitions are offered, and each change is recorded with who and when", async ({
    page,
  }) => {
    const moves = ownerMoves(wf.initial);
    test.skip(moves.length === 0, "the owner has no transition from the initial status");
    await page.goto(`/dashboard/workflow/${wf.key}/${id}`);
    const offered = await page
      .getByRole("form", { name: "Change status" })
      .getByRole("button")
      .allInnerTexts();
    expect(offered.sort()).toEqual(moves.map((t) => t.label).sort());
    await move(page, moves[0]!);
    const last = page.getByTestId("history").locator("li").last();
    await expect(last).toContainText(`${label(wf.initial)} → ${label(moves[0]!.to)}`);
    await expect(last).toContainText(OWNER_EMAIL);
    await expect(last).toContainText(today());
  });

  test("status history cannot be changed or deleted, not even directly in the database", async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query("update workflow_events set to_state = 'tampered' where item_id = $1", [id]),
      ).rejects.toThrow(/append-only/);
      await expect(
        client.query("delete from workflow_events where item_id = $1", [id]),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.end();
    }
  });

  test("a record that stays in a status longer than its limit is flagged as stuck", async ({
    page,
  }) => {
    const limited = wf.states.find((s) => s.limitHours !== null && pathTo(s.key) !== null);
    test.skip(!limited, "no reachable status has a time limit");
    const stuckTitle = `${title} (stuck)`;
    const stuckId = await createRecord(page, stuckTitle);
    for (const t of pathTo(limited!.key)!) await move(page, t);
    // Time passes: the record entered this status longer ago than the limit.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query(
      "update workflow_items set state_since = now() - make_interval(hours => $2::int) where id = $1",
      [stuckId, Math.ceil(limited!.limitHours!) + 2],
    );
    await client.end();
    await page.reload();
    await expect(page.getByTestId("stuck")).toContainText("over the limit");
    await page.goto("/dashboard/workflow");
    await expect(page.getByTestId("attention")).toContainText(stuckTitle);
  });
});
