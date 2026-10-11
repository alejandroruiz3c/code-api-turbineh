import { describe, expect, it } from "vitest";
import { Virtualizer, observeElementOffset, observeElementRect, elementScroll } from "@tanstack/react-virtual";
describe("tanstack virtual contract", () => {
  it("computes the total size of a long list", () => {
    const v = new Virtualizer<HTMLDivElement, HTMLDivElement>({ count: 10_000, getScrollElement: () => null, estimateSize: () => 32, scrollToFn: elementScroll, observeElementRect, observeElementOffset });
    expect(v.getTotalSize()).toBe(320_000);
  });
});
