import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Kanban board end to end (ui.kanban.turbineh on domain.workflow.turbineh): cards move between status columns by drag
 * and drop or with the keyboard; every move is a server-checked transition recorded in the record's history.
 * Columns and allowed moves come from this app's src/workflow/params.json (the owner's transitions).
 */
type Wf = {
  key: string;
  label: string;
  initial: string;
  createRoles: string[];
  states: { key: string; label: string }[];
  transitions: { from: string[]; to: string; roles: string[] }[];
};
const workflows = (
  JSON.parse(readFileSync("src/workflow/params.json", "utf8")) as { workflows: Wf[] }
).workflows;
const kanban = JSON.parse(readFileSync("src/kanban/params.json", "utf8")) as {
  workflows: string[];
  dragAndDrop: boolean;
};
const owner = (roles: string[]) => roles.some((r) => r === "*" || r === "owner" || r === "creator");
const wf = workflows.find(
  (w) =>
    (kanban.workflows.includes("*") || kanban.workflows.includes(w.key)) &&
    owner(w.createRoles) &&
    w.transitions.some((t) => t.from.includes(w.initial) && owner(t.roles)),
);
const allowedTo = wf?.transitions.find((t) => t.from.includes(wf.initial) && owner(t.roles))?.to;
const forbiddenTo = wf?.states.find(
  (s) =>
    s.key !== wf.initial &&
    !wf.transitions.some((t) => t.from.includes(wf.initial) && t.to === s.key && owner(t.roles)),
)?.key;
/** Where ArrowRight lands from the initial column: the next column (board order) the owner may move to. */
const keyTarget = (() => {
  if (!wf) return undefined;
  const ok = new Set(
    wf.transitions.filter((t) => t.from.includes(wf.initial) && owner(t.roles)).map((t) => t.to),
  );
  const order = wf.states.map((s) => s.key).filter((k) => ok.has(k) || k === wf.initial);
  return order[(order.indexOf(wf.initial) + 1) % order.length];
})();
const stamp = Date.now();
const labelOf = (key: string) => wf?.states.find((s) => s.key === key)?.label ?? key;

async function createCard(page: Page, title: string) {
  await page.goto(`/dashboard/workflow/${wf!.key}`);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: `Create ${wf!.label.toLowerCase()}` }).click();
  await expect(page.getByTestId("current-state")).toHaveText(labelOf(wf!.initial));
  await page.goto(`/dashboard/workflow/${wf!.key}`);
}
const card = (page: Page, column: string, title: string) =>
  page.getByTestId(`state-${column}`).getByTestId("card").filter({ hasText: title });

test.describe.serial("kanban board", () => {
  test.skip(!wf || !allowedTo || !kanban.dragAndDrop, "no movable board for the owner in this app");

  test("a card dragged to another status column is saved, with who and when in its history", async ({
    page,
  }) => {
    const title = `Drag ${stamp}`;
    await createCard(page, title);
    await card(page, wf!.initial, title).dragTo(page.getByTestId(`state-${allowedTo}`));
    await expect(page.getByTestId("kanban-status")).toHaveText(
      `Moved "${title}" to ${labelOf(allowedTo!)}.`,
    );
    await page.reload();
    await expect(card(page, allowedTo!, title)).toBeVisible();
    await card(page, allowedTo!, title).getByRole("link").click();
    await expect(page.getByTestId("history").locator("li").last()).toContainText(
      `${labelOf(wf!.initial)} → ${labelOf(allowedTo!)}`,
    );
  });

  test("a card can be moved with the keyboard alone, and each step is announced", async ({
    page,
  }) => {
    const title = `Keys ${stamp}`;
    await createCard(page, title);
    const handle = card(page, wf!.initial, title).getByRole("button", { name: `Move ${title}` });
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(page.getByTestId("kanban-status")).toContainText(`Picked up "${title}"`);
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("kanban-status")).toHaveText(`Over ${labelOf(keyTarget!)}.`);
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("kanban-status")).toHaveText(
      `Moved "${title}" to ${labelOf(keyTarget!)}.`,
    );
    await page.reload();
    await expect(card(page, keyTarget!, title)).toBeVisible();
  });

  test("a move the workflow does not allow is refused by the server and the card stays where it was", async ({
    page,
  }) => {
    test.skip(!forbiddenTo, "every state can be reached from the initial one");
    const title = `Refused ${stamp}`;
    await createCard(page, title);
    await card(page, wf!.initial, title).dragTo(page.getByTestId(`state-${forbiddenTo}`));
    await expect(page.getByTestId("kanban-status")).toContainText(
      `"${title}" stays in ${labelOf(wf!.initial)}`,
    );
    await expect(card(page, wf!.initial, title)).toBeVisible();
    await page.reload();
    await expect(card(page, wf!.initial, title)).toBeVisible();
    await expect(card(page, forbiddenTo!, title)).toHaveCount(0);
  });
});
