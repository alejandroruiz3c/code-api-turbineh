import { describe, expect, it } from "vitest";
import { notifyEmail } from "./commands.js";
import { CliError } from "./context.js";

/** `--notify-email` / TURBINEH_NOTIFY_EMAIL (ADR-0074): sent as `notify_email` with plan and build. */
describe("notifyEmail", () => {
  it("takes the flag, else the environment variable, else nothing", () => {
    expect(notifyEmail(" person@example.com ", undefined)).toEqual({
      notify_email: "person@example.com",
    });
    expect(notifyEmail(undefined, "env@example.com")).toEqual({ notify_email: "env@example.com" });
    expect(notifyEmail("flag@example.com", "env@example.com")).toEqual({
      notify_email: "flag@example.com",
    });
    expect(notifyEmail(undefined, undefined)).toEqual({});
    expect(notifyEmail(undefined, "  ")).toEqual({});
  });

  it("refuses an invalid address or a flag without a value (usage error, exit 2)", () => {
    for (const bad of [
      "not-an-email",
      "a@b",
      "two words@example.com",
      `${"x".repeat(250)}@example.com`,
    ])
      expect(() => notifyEmail(bad, undefined)).toThrow(CliError);
    expect(() => notifyEmail(true, undefined)).toThrow(/needs an address/);
    expect(() => notifyEmail(undefined, "bad")).toThrow(/TURBINEH_NOTIFY_EMAIL/);
  });
});
