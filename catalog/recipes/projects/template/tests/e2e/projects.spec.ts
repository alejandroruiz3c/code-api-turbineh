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
    await expect(card).toContainText("Overdue");
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
});
