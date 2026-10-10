import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { DayPicker } from "react-day-picker";
describe("react-day-picker contract", () => {
  it("server-renders an accessible month grid", () => {
    const html = renderToString(
      h(DayPicker, { mode: "single", defaultMonth: new Date(2026, 9, 1) }),
    );
    expect(html).toContain('role="grid"');
  });
});
