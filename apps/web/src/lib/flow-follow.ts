/**
 * Follows a flow until it reaches an end state (ADR-0051). Framework-free so it can be driven by a fake event stream
 * in tests. Guarantees, in order:
 *  1. the row is loaded at once: a late subscriber (the flow already finished before the page opened) renders the
 *     final state from the API, not from the stream;
 *  2. live events from `/v1/builds/{id}/events` (deduplicated by id; the stream resumes with Last-Event-ID);
 *  3. on the final `finished` event the row is loaded again; if it is still `queued`/`running` (a plan's own finish,
 *     or the event raced the row update) the trace is followed again;
 *  4. a dropped connection is reopened;
 *  5. safety net: if no event arrives for `silenceMs` while the row is in progress, the API state is polled every
 *     `pollMs` and a done or failed row is rendered even if the stream never says so.
 */
import { isWorking } from "./flow-events";

export interface FollowEvent {
  id: number;
  phase: string;
  type: string;
  data: Record<string, unknown>;
  at: string;
}

/** The parts of an EventSource the follower uses. */
export interface StreamLike {
  addEventListener(type: string, listener: (e: { data?: string }) => void): void;
  close(): void;
  readonly readyState?: number;
}

export interface FollowSnapshot<R> {
  events: FollowEvent[];
  result: R | null;
  /** live: events arriving · reconnecting: the stream dropped · closed: final event received · polling: no events for a while, reading the API. */
  connection: "connecting" | "live" | "reconnecting" | "closed" | "polling";
  lastEventAt: number;
}

export interface FollowDeps<R extends { status: string }> {
  open: (url: string) => StreamLike;
  load: () => Promise<R | null>;
  onChange: (s: FollowSnapshot<R>) => void;
  now?: () => number;
  silenceMs?: number;
  pollMs?: number;
  refollowMs?: number;
}

const CLOSED = 2;

export function followFlow<R extends { status: string }>(
  id: string,
  deps: FollowDeps<R>,
): { stop: () => void; restart: () => void } {
  const now = deps.now ?? (() => Date.now());
  const silenceMs = deps.silenceMs ?? 15_000;
  const pollMs = deps.pollMs ?? 10_000;
  const refollowMs = deps.refollowMs ?? 2_000;
  const state: FollowSnapshot<R> = {
    events: [],
    result: null,
    connection: "connecting",
    lastEventAt: now(),
  };
  let stream: StreamLike | null = null;
  let stopped = false;
  let lastPoll = 0;
  let reopen: ReturnType<typeof setTimeout> | null = null;
  const terminal = () => Boolean(state.result && !isWorking(state.result.status));
  const emit = () => deps.onChange({ ...state, events: [...state.events] });

  const add = (raw?: string) => {
    if (!raw) return;
    try {
      const e = JSON.parse(raw) as FollowEvent;
      state.lastEventAt = now();
      if (!state.events.some((p) => p.id === e.id)) state.events = [...state.events, e];
    } catch {
      // a malformed chunk is ignored; the next event or the safety net continues
    }
  };

  const refresh = async (): Promise<R | null> => {
    const r = await deps.load().catch(() => null);
    if (stopped || !r) return r;
    state.result = r;
    return r;
  };

  const scheduleOpen = (ms: number) => {
    if (reopen || stopped) return;
    reopen = setTimeout(() => {
      reopen = null;
      if (!stopped && !terminal()) openStream();
    }, ms);
  };

  function openStream() {
    stream?.close();
    const es = deps.open(`/v1/builds/${id}/events`);
    stream = es;
    state.connection = "connecting";
    es.addEventListener("phase", (e) => {
      add(e.data);
      state.connection = "live";
      emit();
    });
    es.addEventListener("finished", (e) => {
      add(e.data);
      es.close();
      state.connection = "closed";
      emit();
      void refresh().then((r) => {
        if (stopped) return;
        // Still working (the plan's own finish, or the event raced the row update): keep following.
        if (r && isWorking(r.status)) scheduleOpen(refollowMs);
        emit();
      });
    });
    es.addEventListener("error", () => {
      if (stopped || state.connection === "closed") return;
      state.connection = "reconnecting";
      emit();
      // EventSource reconnects by itself unless it gave up (CLOSED): then we open it again.
      if (es.readyState === CLOSED) scheduleOpen(refollowMs);
    });
  }

  const tick = setInterval(() => {
    if (stopped) return;
    if (!terminal() && now() - state.lastEventAt >= silenceMs && now() - lastPoll >= pollMs) {
      lastPoll = now();
      state.connection = state.connection === "closed" ? "closed" : "polling";
      void refresh().then((r) => {
        if (stopped) return;
        if (r && !isWorking(r.status)) {
          // Finished while the stream said nothing: render it, and take the trace's tail once.
          stream?.close();
          state.connection = "closed";
        } else if (state.connection === "closed" || stream?.readyState === CLOSED) {
          scheduleOpen(0);
        }
        emit();
      });
    }
    emit();
  }, 1000);

  // 1 · late subscriber: the row first, then the stream.
  void refresh().then(() => emit());
  openStream();

  return {
    stop: () => {
      stopped = true;
      clearInterval(tick);
      if (reopen) clearTimeout(reopen);
      stream?.close();
    },
    restart: () => {
      state.result = null;
      state.lastEventAt = now();
      emit();
      openStream();
    },
  };
}
