import { describe, expect, it } from "vitest";
import i18next from "i18next";
describe("i18next contract", () => {
  it("translates with interpolation and plurals", async () => {
    const i = i18next.createInstance();
    await i.init({
      lng: "es",
      resources: {
        es: {
          translation: {
            hi: "Hola {{name}}",
            item_one: "{{count}} elemento",
            item_other: "{{count}} elementos",
          },
        },
      },
    });
    expect(i.t("hi", { name: "Ana" })).toBe("Hola Ana");
    expect(i.t("item", { count: 3 })).toBe("3 elementos");
  });
});
