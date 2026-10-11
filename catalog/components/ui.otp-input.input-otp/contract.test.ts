import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
describe("input-otp contract", () => {
  it("renders a one-time code input limited to digits", () => {
    const html = renderToString(
      h(OTPInput, {
        maxLength: 6,
        pattern: REGEXP_ONLY_DIGITS,
        render: () => h("span", null, "slots"),
      }),
    );
    expect(html).toContain('maxLength="6"');
  });
});
