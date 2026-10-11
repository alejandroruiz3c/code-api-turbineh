import { describe, expect, it } from "vitest";
import type { Organization, WithContext } from "schema-dts";
describe("schema-dts contract", () => {
  it("types schema.org JSON-LD objects", () => {
    const org: WithContext<Organization> = { "@context": "https://schema.org", "@type": "Organization", name: "Acme", url: "https://acme.test" };
    expect(JSON.parse(JSON.stringify(org))["@type"]).toBe("Organization");
  });
});
