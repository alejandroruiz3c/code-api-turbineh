import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { DndContext, useDraggable } from "@dnd-kit/core";
function Card() {
  const { attributes, setNodeRef } = useDraggable({ id: "card-1" });
  return h("div", { ref: setNodeRef, ...attributes }, "Card");
}
describe("dnd-kit core contract", () => {
  it("renders draggable items with accessibility attributes", () => {
    const html = renderToString(h(DndContext, null, h(Card)));
    expect(html).toContain('role="button"');
  });
});
