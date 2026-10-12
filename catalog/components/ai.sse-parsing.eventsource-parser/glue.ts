import { createParser, type EventSourceMessage } from "eventsource-parser";

/** Reads a Server-Sent Events body (e.g. a streamed answer) and calls `onEvent` for each event. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: EventSourceMessage) => void,
): Promise<void> {
  const parser = createParser({ onEvent });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value, { stream: true }));
  }
}
