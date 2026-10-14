import { flowOutcome, flowState, PACKAGE_NOT_VERIFIED_TITLE } from "@turbineh/engine";
import type { FlowOutcome, Plan } from "@turbineh/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  followFlow,
  type FollowEvent,
  type FollowSnapshot,
  type StreamLike,
} from "../lib/flow-follow";
import { describeProgress } from "../lib/flow-progress";
import { FlowSteps, LiveNow, PackageResult, QUIET_NOTICE_MS } from "./flow-live";

/**
 * Production incident 2026-10-13 23:39 UTC (ADR-0051): flow 470bc606 (a capability for a connected Next.js repository)
 * finished in 1.5 s without a verify phase; the page stayed on "Assembling verified components · Packaging" with no
 * end state. These tests replay its exact event sequence through the follower (fake event stream, fake API) and render
 * what the person sees.
 */

const ID = "470bc606-12e6-433b-b286-25b48c78e970";
const T = (s: string) => `2026-10-13T23:${s}Z`;

const PLAN_RUN: FollowEvent[] = [
  { id: 1, phase: "queued", type: "queued", data: {}, at: T("39:05.100") },
  { id: 2, phase: "compiling", type: "start", data: {}, at: T("39:05.300") },
  { id: 3, phase: "compiling", type: "done", data: { ok: true }, at: T("39:10.900") },
  {
    id: 4,
    phase: "selecting",
    type: "done",
    data: {
      componentOnly: true,
      selected: [
        "ops.http-client.ky",
        "commerce.cart.zustand",
        "data.fetching.react-query",
        "data.fuzzy-search.fuse",
        "email.transactional.turbineh",
      ],
    },
    at: T("39:11.000"),
  },
  { id: 5, phase: "done", type: "finished", data: { status: "done" }, at: T("39:12.000") },
];
const GENERATE_RUN: FollowEvent[] = [
  { id: 6, phase: "queued", type: "queued", data: { mode: "generate" }, at: T("39:30.000") },
  {
    id: 7,
    phase: "assembling",
    type: "start",
    data: { components: ["ops.http-client.ky"] },
    at: T("39:30.500"),
  },
  {
    id: 8,
    phase: "delivering",
    type: "done",
    data: { channel: "package", package: true },
    at: T("39:31.989"),
  },
  { id: 9, phase: "done", type: "finished", data: { status: "done" }, at: T("39:32.010") },
];

const plan = {
  id: ID,
  need: "Small fetch-based HTTP client with retries and timeouts for external APIs",
  capability: { id: "small-fetch-based-http-client", kind: "component", name: "HTTP client" },
  components: [{ id: "ops.http-client.ky", version: "2.1.0", license: "MIT", why: "" }],
  dependencies: [{ name: "ky", version: "2.1.0" }],
  config: [],
  left: [],
  repository: { repo: "owner/next-app" },
} as unknown as Plan;

/** The production row as stored (legacy: only the components' certification check). */
const row = {
  id: ID,
  status: "done",
  options: { mode: "generate" },
  metrics: { plan, verify: [{ name: "certification", ok: true }], timings: { total: 1500 } },
  artifact: { slug: plan.capability.id, package: { slug: plan.capability.id, zipKey: "k" } },
  error: null,
};

interface Api {
  status: string;
  state?: string;
  outcome?: FlowOutcome;
  package?: { zip_url: string } | null;
}
const apiOf = (status: string): Api =>
  status === "done"
    ? {
        status,
        state: flowState(row),
        outcome: flowOutcome(row),
        package: { zip_url: "https://x/pkg.zip" },
      }
    : { status };

class FakeStream implements StreamLike {
  static all: FakeStream[] = [];
  readyState = 0;
  private listeners = new Map<string, ((e: { data?: string }) => void)[]>();
  constructor(public url: string) {
    FakeStream.all.push(this);
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  send(e: FollowEvent, final = false) {
    for (const fn of this.listeners.get(final ? "finished" : "phase") ?? [])
      fn({ data: JSON.stringify(e) });
  }
  fail() {
    this.readyState = 2;
    for (const fn of this.listeners.get("error") ?? []) fn({});
  }
}

function harness(rowStatus: () => string) {
  let snap: FollowSnapshot<Api> | null = null;
  const loads: string[] = [];
  const f = followFlow<Api>(ID, {
    open: (url) => new FakeStream(url),
    load: async () => {
      const s = rowStatus();
      loads.push(s);
      return apiOf(s);
    },
    onChange: (s) => {
      snap = s;
    },
    now: () => Date.now(),
  });
  return { f, loads, snap: () => snap as FollowSnapshot<Api> | null };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(T("39:31.000")));
  FakeStream.all = [];
});
afterEach(() => vi.useRealTimers());

describe("flow page always reaches an end state (incident 2026-10-13)", () => {
  it("the exact production sequence ends on the package result, not on 'Packaging'", async () => {
    let status = "running";
    const h = harness(() => status);
    const es = FakeStream.all[0] as FakeStream;
    for (const e of [...PLAN_RUN, ...GENERATE_RUN.slice(0, 3)]) es.send(e);
    await flush();
    // Live: the generation run, its plan steps already done, packaging under way, with text.
    let s = h.snap();
    const live = describeProgress(s?.events ?? [], { kind: "component", now: Date.now() });
    expect(live.steps.find((x) => x.key === "understand")).toMatchObject({
      status: "done",
      note: "from your plan",
    });
    status = "done";
    es.send(GENERATE_RUN[3] as FollowEvent, true);
    await flush();
    s = h.snap();
    expect(s?.result?.status).toBe("done");
    expect(s?.connection).toBe("closed");
    const end = describeProgress(s?.events ?? [], {
      kind: "component",
      now: Date.now(),
      finished: true,
    });
    expect(end.current).toBeNull();
    expect(end.steps.map((x) => [x.key, x.status])).toEqual([
      ["understand", "done"],
      ["select", "done"],
      ["assemble", "done"],
      ["verify", "skipped"],
      ["deliver", "done"],
    ]);
    expect(end.steps.find((x) => x.key === "verify")?.note).toMatch(/inside your project/);
    // The end state the person sees, from the API's outcome.
    const outcome = s?.result?.outcome as FlowOutcome;
    expect(s?.result?.state).toBe("generated");
    expect(outcome.title).toBe(PACKAGE_NOT_VERIFIED_TITLE);
    const html = renderToStaticMarkup(
      <PackageResult id={ID} outcome={outcome} zipUrl="https://x/pkg.zip" plan={plan} />,
    );
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'");
    expect(text).toContain(PACKAGE_NOT_VERIFIED_TITLE);
    expect(text).toContain("Open a pull request");
    expect(text).toContain("Download ZIP");
    expect(text).toContain(`turbineh apply ${ID}`);
    expect(text).toMatch(/What it does: Writes turbineh\/small-fetch-based-http-client\//);
    expect(text).toContain("What is left");
    expect(text).toMatch(/Verify it inside your project/);
    h.f.stop();
  });

  it("a late subscriber renders the final state from the API before any event", async () => {
    const h = harness(() => "done");
    await flush();
    expect(h.snap()?.result?.status).toBe("done");
    expect(h.snap()?.result?.outcome?.kind).toBe("package_unverified");
    h.f.stop();
  });

  it("a finished event that races the row update keeps following, then renders the result", async () => {
    let status = "running";
    const h = harness(() => status);
    const es = FakeStream.all[0] as FakeStream;
    for (const e of GENERATE_RUN.slice(0, 3)) es.send(e);
    es.send(GENERATE_RUN[3] as FollowEvent, true);
    await flush();
    expect(h.snap()?.result?.status).toBe("running");
    status = "done";
    await vi.advanceTimersByTimeAsync(2_100);
    const again = FakeStream.all[1] as FakeStream;
    expect(again).toBeDefined();
    again.send(GENERATE_RUN[3] as FollowEvent, true);
    await flush();
    expect(h.snap()?.result?.status).toBe("done");
    h.f.stop();
  });

  it("reconnects when the stream drops", async () => {
    const h = harness(() => "running");
    await flush();
    (FakeStream.all[0] as FakeStream).fail();
    expect(h.snap()?.connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(2_100);
    expect(FakeStream.all.length).toBe(2);
    h.f.stop();
  });

  it("safety net: no events, the API says done → the result is rendered", async () => {
    let status = "running";
    const h = harness(() => status);
    await flush();
    status = "done";
    await vi.advanceTimersByTimeAsync(16_000);
    await flush();
    expect(h.snap()?.result?.status).toBe("done");
    expect(h.loads.length).toBeGreaterThanOrEqual(2);
    h.f.stop();
  });
});

describe("live messages during the process (ADR-0051)", () => {
  const gateEvents: FollowEvent[] = [
    { id: 1, phase: "queued", type: "queued", data: { mode: "generate" }, at: T("40:00.000") },
    {
      id: 2,
      phase: "assembling",
      type: "start",
      data: { components: ["auth.session.better-auth", "data.orm.drizzle"] },
      at: T("40:01.000"),
    },
    { id: 3, phase: "assembling", type: "done", data: { files: 182 }, at: T("40:02.000") },
    { id: 4, phase: "verifying", type: "start", data: {}, at: T("40:20.000") },
    {
      id: 5,
      phase: "verifying",
      type: "step",
      data: { name: "lint", state: "start" },
      at: T("40:21.000"),
    },
    {
      id: 6,
      phase: "verifying",
      type: "step",
      data: { name: "lint", state: "done", ok: true, ms: 4100 },
      at: T("40:25.000"),
    },
    {
      id: 7,
      phase: "verifying",
      type: "step",
      data: { name: "unit", state: "start" },
      at: T("40:21.500"),
    },
  ];

  it("says what runs now, the gate order, elapsed time, the typical duration and what comes next", () => {
    const p = describeProgress(gateEvents, {
      kind: "app",
      now: Date.parse(T("40:40.000")),
      typical: { verifying: 164_000 },
    });
    expect(p.current?.key).toBe("verify");
    expect(p.current?.line).toBe("Checking in an isolated sandbox: Unit tests now");
    expect(p.current?.details).toContain("✓ Lint · 4 s");
    expect(p.current?.details).toContain("… Unit tests · running");
    expect(p.next).toBe("Writing the evidence");
    const html = renderToStaticMarkup(<LiveNow progress={p} connection="live" />);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).toContain("Elapsed 40 s");
    expect(text).toContain("this step usually takes ~3 min");
    expect(text).toContain("next: Writing the evidence");
    const steps = renderToStaticMarkup(<FlowSteps progress={p} />);
    expect(steps).toContain('data-status="current"');
    expect(steps).toContain('data-status="next"');
    expect(steps).toMatch(/Assembling verified components.*done/);
  });

  it("a long silence gets a reassuring line and a safe action", () => {
    const p = describeProgress(gateEvents, {
      kind: "app",
      now: Date.parse(T("40:25.000")) + QUIET_NOTICE_MS + 5_000,
      typical: { verifying: 164_000 },
    });
    const text = renderToStaticMarkup(<LiveNow progress={p} connection="polling" />).replace(
      /<[^>]+>/g,
      " ",
    );
    expect(text).toContain("Still running building, testing &amp; scanning");
    expect(text).toContain("Keep this page open or come back later: we’ll keep building");
    expect(text).toContain("Activity");
  });

  it("never a spinner without text", () => {
    const p = describeProgress([], { kind: "app", now: Date.now() });
    const text = renderToStaticMarkup(<LiveNow progress={p} connection="connecting" />).replace(
      /<[^>]+>/g,
      " ",
    );
    expect(text).toMatch(/Starting|Understanding|Reading your need/);
  });
});
