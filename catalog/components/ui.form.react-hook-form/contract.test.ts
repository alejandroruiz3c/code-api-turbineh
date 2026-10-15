import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { useForm } from "react-hook-form";
describe("react-hook-form contract", () => {
  it("registers fields during server render", () => {
    function F() {
      const { register } = useForm({ defaultValues: { email: "a@b.co" } });
      return h("input", register("email"));
    }
    expect(renderToString(h(F))).toContain('name="email"');
  });
});
