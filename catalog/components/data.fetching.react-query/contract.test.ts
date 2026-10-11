import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
describe("react-query contract", () => {
  it("caches query results", async () => {
    const qc = new QueryClient();
    let calls = 0;
    const fetchFn = async () => ++calls;
    await qc.fetchQuery({ queryKey: ["n"], queryFn: fetchFn, staleTime: 60_000 });
    await qc.fetchQuery({ queryKey: ["n"], queryFn: fetchFn, staleTime: 60_000 });
    expect(calls).toBe(1);
    qc.clear();
  });
});
