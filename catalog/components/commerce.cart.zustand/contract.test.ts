import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
type Cart = { items: Record<string, number>; add: (sku: string) => void };
describe("zustand contract", () => {
  it("keeps cart state outside React", () => {
    const cart = createStore<Cart>()((set) => ({
      items: {},
      add: (sku) => set((s) => ({ items: { ...s.items, [sku]: (s.items[sku] ?? 0) + 1 } })),
    }));
    cart.getState().add("SKU-1");
    cart.getState().add("SKU-1");
    expect(cart.getState().items).toEqual({ "SKU-1": 2 });
  });
});
