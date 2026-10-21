import { expect, test } from "@playwright/test";

test.describe.serial("projects", () => {
  test("the owner creates a project and a task assigned to them with a priority and a due date; a task past its due date is flagged overdue", async ({
    page,
  }) => {
    await page.goto("/dashboard/projects");
    await page.getByLabel("Name").fill("Website relaunch");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Website relaunch" })).toBeVisible();
    await page.getByLabel("Task").fill("Write the homepage copy");
    await page.getByLabel("Priority").selectOption("high");
    await page.getByLabel("Due date").fill("2020-01-01");
    await page.getByRole("button", { name: "Add task" }).click();
    const card = page.locator('[data-task="Write the homepage copy"]');
    await expect(card).toBeVisible();
    await expect(card, "the task shows the assignee chosen on creation (the owner)").toContainText(
      "E2E Owner",
    );
    await expect(card, "the task shows its priority").toContainText("high");
    await expect(card, "the task shows its due date").toContainText("2020-01-01");
    await expect(card, "a task past its due date is flagged overdue").toContainText("Overdue");
  });

  test("the owner moves a task on the Kanban board from To do to In progress and the new status is persisted", async ({
    page,
  }) => {
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Website relaunch" }).click();
    await page.getByRole("button", { name: "Move Write the homepage copy to In progress" }).click();
    await expect(
      page.locator('section[aria-labelledby="col-doing"]').getByText("Write the homepage copy"),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.locator('section[aria-labelledby="col-doing"]').getByText("Write the homepage copy"),
      "the new status is persisted: still In progress after a reload",
    ).toBeVisible();
  });

  test("a task assigned to the owner shows in My tasks, and the owner adds a comment that is visible on that task", async ({
    page,
  }) => {
    await page.goto("/dashboard/my-tasks");
    await page.getByRole("link", { name: "Write the homepage copy" }).click();
    await page.getByLabel("Add a comment").fill("First draft is ready for review.");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByText("First draft is ready for review.")).toBeVisible();
  });
  test("the owner edits a task's title and the change is saved", async ({ page }) => {
    await page.goto("/dashboard/my-tasks");
    await page.getByRole("link", { name: "Write the homepage copy" }).click();
    await page.getByLabel("Title").fill("Write the final homepage copy");
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.ok()),
      page.getByRole("button", { name: "Save task" }).click(),
    ]);
    await page.reload();
    await expect(page.getByLabel("Title"), "the new title is saved").toHaveValue(
      "Write the final homepage copy",
    );
    await page.getByRole("link", { name: "← Board" }).click();
    await expect(page.locator('[data-task="Write the final homepage copy"]')).toBeVisible();
  });

  test("the owner archives a task: it leaves the board and shows under Archived tasks, and restoring it brings it back", async ({
    page,
  }) => {
    await page.goto("/dashboard/my-tasks");
    await page.getByRole("link", { name: "Write the final homepage copy" }).click();
    await page.getByRole("button", { name: "Archive task" }).click();
    await expect(page.getByText("Archived task")).toBeVisible();
    await page.getByRole("link", { name: "← Board" }).click();
    await page.waitForURL(/\/dashboard\/projects\/[0-9a-f-]{36}$/);
    await page.reload();
    await expect(
      page.locator('[data-task="Write the final homepage copy"]'),
      "an archived task is not on the board",
    ).toHaveCount(0);
    await expect(
      page.locator('[data-archived-task="Write the final homepage copy"]'),
      "an archived task is listed under Archived tasks",
    ).toBeVisible();
    await page.goto("/dashboard/my-tasks");
    await expect(
      page.getByRole("link", { name: "Write the final homepage copy" }),
      "an archived task is not in My tasks",
    ).toHaveCount(0);
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Website relaunch" }).click();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.ok()),
      page.getByRole("button", { name: "Restore Write the final homepage copy" }).click(),
    ]);
    await page.reload();
    await expect(
      page.locator('[data-task="Write the final homepage copy"]'),
      "a restored task is back on the board",
    ).toBeVisible();
  });

  test("the owner deletes a task and it is no longer on the board", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Website relaunch" }).click();
    await page.getByLabel("Task").fill("Remove the old banner");
    await page.getByRole("button", { name: "Add task" }).click();
    await page.locator('[data-task="Remove the old banner"]').getByRole("link").click();
    await page.getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByRole("heading", { name: "Website relaunch" })).toBeVisible();
    await page.reload();
    await expect(
      page.locator('[data-task="Remove the old banner"]'),
      "the deleted task is gone after a reload",
    ).toHaveCount(0);
  });

  test("the owner renames a project and the new name is shown", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Website relaunch" }).click();
    await page.getByLabel("Project name").fill("Website relaunch 2027");
    await page.getByLabel("Project description").fill("New site for the spring campaign");
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page.getByRole("heading", { name: "Website relaunch 2027" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Website relaunch 2027" })).toBeVisible();
    await expect(page.getByText("New site for the spring campaign").first()).toBeVisible();
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("link", { name: "Website relaunch 2027" })).toBeVisible();
  });

  test("the owner archives a project: it leaves the project list and shows under Archived projects, and restoring it brings it back", async ({
    page,
  }) => {
    await page.goto("/dashboard/projects");
    await page.getByLabel("Name").fill("Autumn campaign");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByRole("heading", { name: "Autumn campaign" })).toBeVisible();
    await page.getByRole("button", { name: "Archive project" }).click();
    await expect(page.getByText("Archived project", { exact: true })).toBeVisible();
    await page.goto("/dashboard/projects");
    const list = page.getByRole("list", { name: "Projects", exact: true });
    await expect(
      list.getByRole("link", { name: "Autumn campaign" }),
      "an archived project is not in the project list",
    ).toHaveCount(0);
    await expect(
      page.locator('[data-archived-project="Autumn campaign"]'),
      "an archived project is listed under Archived projects",
    ).toBeVisible();
    await Promise.all([
      page.waitForResponse((r) => r.request().method() === "POST" && r.ok()),
      page.getByRole("button", { name: "Restore Autumn campaign" }).click(),
    ]);
    await page.reload();
    await expect(
      list.getByRole("link", { name: "Autumn campaign" }),
      "a restored project is back in the project list",
    ).toBeVisible();
  });

  test("the owner deletes a project and its tasks are removed", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Autumn campaign" }).click();
    await page.getByLabel("Task").fill("Draft the autumn brief");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.locator('[data-task="Draft the autumn brief"]')).toBeVisible();
    await page.goto("/dashboard/my-tasks");
    await expect(page.getByRole("link", { name: "Draft the autumn brief" })).toBeVisible();
    await page.goto("/dashboard/projects");
    await page.getByRole("link", { name: "Autumn campaign" }).click();
    await page.getByRole("button", { name: "Delete project and its tasks" }).click();
    await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("link", { name: "Autumn campaign" }),
      "the deleted project is gone",
    ).toHaveCount(0);
    await page.goto("/dashboard/my-tasks");
    await expect(
      page.getByRole("link", { name: "Draft the autumn brief" }),
      "the deleted project's tasks are removed",
    ).toHaveCount(0);
  });
});
