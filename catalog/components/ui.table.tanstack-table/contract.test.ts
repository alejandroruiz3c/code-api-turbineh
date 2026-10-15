import { describe, expect, it } from "vitest";
import { createTable, getCoreRowModel, getSortedRowModel } from "@tanstack/react-table";
describe("@tanstack/react-table contract", () => {
  it("sorts rows headlessly", () => {
    const data = [{ n: "b" }, { n: "a" }];
    const table = createTable({
      data,
      columns: [{ accessorKey: "n" }],
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      state: { sorting: [{ id: "n", desc: false }] },
      onStateChange: () => {},
      renderFallbackValue: null,
    });
    expect(table.getSortedRowModel().rows.map((r) => r.original.n)).toEqual(["a", "b"]);
  });
});
