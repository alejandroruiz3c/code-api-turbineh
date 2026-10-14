import { describe, expect, it } from "vitest";
import { componentsForNeed, stem } from "./search.js";
import type { CatalogEntry } from "./types.js";

const entry = (id: string, provides: string[], does: string): CatalogEntry => ({
  id,
  version: "1.0.0",
  category: id.split(".")[0] ?? "ops",
  provides,
  license: "MIT",
  purl: `pkg:npm/${id}@1.0.0`,
  does,
});

describe("componentsForNeed (ADR-0051)", () => {
  it("stems every form of a word the same way", () => {
    expect(stem("parse")).toBe(stem("parsing"));
    expect(stem("parses")).toBe(stem("parse"));
    expect(stem("retries")).toBe(stem("retry"));
    expect(stem("formatting")).toBe(stem("format"));
    expect(stem("dates")).toBe(stem("date"));
    expect(stem("limiting")).toBe(stem("limit"));
  });

  const catalog = [
    entry(
      "ops.http-client.ky",
      ["ops.http-client"],
      "Small fetch-based HTTP client with retries and timeouts",
    ),
    entry("commerce.cart.zustand", ["commerce.cart"], "Small client state store for carts"),
    entry(
      "data.fetching.react-query",
      ["data.fetching"],
      "Client data fetching with caching and retries",
    ),
    entry("files.pdf.pdf-lib", ["files.pdf"], "Creates PDF documents"),
    entry("email.transactional.x", ["email.transactional"], "Sends transactional email"),
  ];

  it("does not add components that only share a common word", () => {
    expect(
      componentsForNeed("HTTP client with retries and timeouts", catalog).map((m) => m.entry.id),
    ).toEqual(["ops.http-client.ky"]);
  });

  it("adds a second component for a second capability of the need", () => {
    expect(
      componentsForNeed("Transactional email with a PDF attached", catalog)
        .map((m) => m.entry.id)
        .sort(),
    ).toEqual(["email.transactional.x", "files.pdf.pdf-lib"]);
  });

  it("returns nothing when no word matches", () => {
    expect(componentsForNeed("quantum teleportation", catalog)).toEqual([]);
  });
});
