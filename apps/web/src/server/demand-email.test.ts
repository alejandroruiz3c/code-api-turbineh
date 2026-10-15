import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduled: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => scheduled.push(fn) }));
vi.mock("./db", () => ({ db: {} }));
const sendDemandEmails = vi.fn(async () => ({ confirmation: "sent", ownerAlert: "sent" }));
vi.mock("@turbineh/db", () => ({ sendDemandEmails }));

const { confirmDemandLater, isRefusedDemand } = await import("./demand-email");

beforeEach(() => {
  scheduled.length = 0;
  sendDemandEmails.mockClear();
  vi.unstubAllEnvs();
});

describe("confirmDemandLater (ADR-0056)", () => {
  it("only refused flows (uncovered or partial) are demand", () => {
    expect(isRefusedDemand({ metrics: { scopeGate: { status: "uncovered" } } })).toBe(true);
    expect(isRefusedDemand({ metrics: { scopeGate: { status: "partial" } } })).toBe(true);
    expect(isRefusedDemand({ metrics: { scopeGate: { status: "covered" } } })).toBe(false);
    expect(isRefusedDemand({ metrics: {} })).toBe(false);
  });

  it("schedules the emails after the response, once per flow per instance", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const row = { id: "b-1", metrics: { scopeGate: { status: "uncovered" } } };
    confirmDemandLater(row);
    expect(sendDemandEmails).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
    expect(sendDemandEmails).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ from: expect.any(String) }),
      "b-1",
      expect.anything(),
    );
    confirmDemandLater(row);
    expect(scheduled).toHaveLength(1);
  });

  it("does nothing without RESEND_API_KEY or for covered flows", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    confirmDemandLater({ id: "b-2", metrics: { scopeGate: { status: "uncovered" } } });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    confirmDemandLater({ id: "b-3", metrics: { scopeGate: { status: "covered" } } });
    expect(scheduled).toHaveLength(0);
  });
});
