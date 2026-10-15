import { describe, expect, it } from "vitest";
import { LngLat, LngLatBounds } from "maplibre-gl";
describe("maplibre-gl contract", () => {
  it("handles coordinates and bounds without a browser", () => {
    const madrid = new LngLat(-3.7038, 40.4168);
    const bounds = new LngLatBounds(madrid, new LngLat(2.1734, 41.3851));
    expect(bounds.contains(new LngLat(0, 41))).toBe(true);
    expect(madrid.toArray()).toEqual([-3.7038, 40.4168]);
  });
});
