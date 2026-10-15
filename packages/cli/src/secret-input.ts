/**
 * Secrets typed or piped into the CLI (ADR-0055): never as a command-line argument, which stays in the shell history
 * and is visible to other users in the process list.
 */

/** Everything on stdin, trimmed (for `… | turbineh login --with-token`). */
export async function readStdin(input: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of input) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** Reads one line from the terminal without echoing it (raw mode). Ctrl-C cancels. */
export function readHidden(
  prompt: string,
  io: { input: NodeJS.ReadStream; output: NodeJS.WritableStream } = {
    input: process.stdin,
    output: process.stderr,
  },
): Promise<string> {
  const { input, output } = io;
  output.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;
    input.setRawMode?.(true);
    input.resume();
    input.setEncoding("utf8");
    const done = (err: Error | null) => {
      input.off("data", onData);
      input.setRawMode?.(wasRaw ?? false);
      input.pause();
      output.write("\n");
      if (err) reject(err);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(null);
        if (ch === "\u0003") return done(new Error("cancelled"));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    input.on("data", onData);
  });
}
