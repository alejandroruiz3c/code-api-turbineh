import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { Bar, BarChart } from "recharts";
describe("recharts contract", () => {
  it("server-renders a chart without throwing", () => {
    const html = renderToString(
      h(
        BarChart,
        { width: 300, height: 200, data: [{ v: 1 }, { v: 2 }] },
        h(Bar, { dataKey: "v" }),
      ),
    );
    expect(html).toContain("recharts");
  });
});
