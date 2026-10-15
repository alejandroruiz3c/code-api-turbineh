import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** Theme tokens written by TurbineH from the requested palette (src/app/globals.css). */
function token(name: string): string {
  const css = readFileSync("src/app/globals.css", "utf8");
  const hex = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1] ?? "#000000";
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

test("the app shows the requested colours: page background, accent colour and call-to-action buttons", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page.locator("body")).toHaveCSS("background-color", token("surface"));
  // The app name in the navigation uses the accent colour.
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link").first()).toHaveCSS(
    "color",
    token("accent"),
  );
  // Primary buttons (call to action) use the brand colour.
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in" })).toHaveCSS(
    "background-color",
    token("brand"),
  );
});
