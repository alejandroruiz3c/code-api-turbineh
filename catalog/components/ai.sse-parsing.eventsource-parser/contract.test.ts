import { describe, expect, it } from "vitest";
import { createParser, type EventSourceMessage } from "eventsource-parser";
describe("eventsource-parser contract", () => {
  it("parses a Server-Sent Events stream fed in arbitrary chunks", () => {
    const events: EventSourceMessage[] = [];
    const parser = createParser({ onEvent: (e) => events.push(e) });
    parser.feed('data: {"delta":"Hel');
    parser.feed('lo"}\n\nevent: done\ndata: [DONE]\n\n');
    expect(events.map((e) => e.data)).toEqual(['{"delta":"Hello"}', "[DONE]"]);
    expect(events[1]?.event).toBe("done");
  });
});
