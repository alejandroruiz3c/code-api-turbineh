import { createInterface } from "node:readline";
import { isAbsolute, resolve } from "node:path";
import type { Ctx } from "./commands.js";
import { VERSION } from "./context.js";
import { jsonOf } from "./output.js";
import { runCommand } from "./registry.js";

/**
 * `turbineh mcp` (ADR-0036): a Model Context Protocol server over stdio — newline-delimited JSON-RPC 2.0, the stdio
 * transport of the MCP specification — implemented in a few lines so the CLI stays one dependency-free file. It
 * exposes the CLI's commands as tools; every tool result is exactly the command's `--json` document (as text and as
 * structuredContent). Add it to Claude Code with `claude mcp add turbineh -- turbineh mcp`.
 */

/** Protocol revisions this server speaks (newest first); the client's is echoed when supported. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

type Schema = Record<string, unknown>;
interface Tool {
  name: string;
  description: string;
  inputSchema: Schema;
  /** Arguments → CLI command, positional args and flags. */
  map: (a: Record<string, unknown>) => {
    cmd: string;
    args: string[];
    flags: Record<string, string | boolean>;
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({
  type: "object",
  properties: {
    ...properties,
    directory: {
      type: "string",
      description: "Project folder (default: the folder the server was started in).",
    },
  },
  ...(required.length ? { required } : {}),
});

export const TOOLS: Tool[] = [
  {
    name: "build",
    description:
      "Spec → verified code committed in the project folder: plans, generates, verifies (lint, types, unit, build, E2E, security), writes and commits. Empty folder → complete app; existing project → the capability in its own folder. Result: criteria met/open with where, left[], settings, gate, next. Takes 2–4 min; on timeout (exitCode 4) call resume.",
    inputSchema: obj({
      spec: { type: "string", description: "What to build: the full specification text." },
      specFile: {
        type: "string",
        description: "Path to a specification file (instead of spec).",
      },
      approve: {
        type: "boolean",
        description: "Only after the user agreed to the plan's needsApproval decisions.",
      },
      timeoutMinutes: { type: "number", description: "Stop waiting after this (default 20)." },
    }),
    map: (a) => ({
      cmd: "build",
      args: str(a.spec) ? [str(a.spec) as string] : [],
      flags: {
        ...(str(a.specFile) ? { spec: str(a.specFile) as string } : {}),
        ...(a.approve === true ? { approve: true } : {}),
        ...(typeof a.timeoutMinutes === "number" ? { timeout: String(a.timeoutMinutes) } : {}),
      },
    }),
  },
  {
    name: "resume",
    description:
      "Keep waiting for a build that timed out or was interrupted, then write and commit it (same result as build).",
    inputSchema: obj({
      id: { type: "string", description: "Build id (default: the pending one here)." },
      approve: { type: "boolean" },
    }),
    map: (a) => ({
      cmd: "resume",
      args: str(a.id) ? [str(a.id) as string] : [],
      flags: a.approve === true ? { approve: true } : {},
    }),
  },
  {
    name: "search",
    description:
      "Which verified capabilities and components cover a need (seconds, nothing generated).",
    inputSchema: obj({ query: { type: "string" }, limit: { type: "number" } }, ["query"]),
    map: (a) => ({
      cmd: "search",
      args: [str(a.query) ?? ""],
      flags: typeof a.limit === "number" ? { limit: String(a.limit) } : {},
    }),
  },
  {
    name: "plan",
    description:
      "Plan a need for this project without generating: components, compatibility, files, dependencies, settings, criteria covered/open, decisions that need the user.",
    inputSchema: obj({ need: { type: "string" } }, ["need"]),
    map: (a) => ({ cmd: "plan", args: [str(a.need) ?? ""], flags: {} }),
  },
  {
    name: "apply",
    description:
      "Generate a plan made with `plan` and integrate it on a new branch (one commit). Prefer build, which does plan + apply in one step.",
    inputSchema: obj({
      plan: { type: "string", description: "Plan id (default: the last one)." },
      approve: { type: "boolean" },
    }),
    map: (a) => ({
      cmd: "apply",
      args: str(a.plan) ? [str(a.plan) as string] : [],
      flags: { yes: true, ...(a.approve === true ? { approve: true } : {}) },
    }),
  },
  {
    name: "status",
    description: "A flow's state (by id) or the project's recent flows and integrations.",
    inputSchema: obj({ id: { type: "string" } }),
    map: (a) => ({ cmd: "status", args: str(a.id) ? [str(a.id) as string] : [], flags: {} }),
  },
  {
    name: "left",
    description:
      "In a delivered package: what is left — open criteria with where, gaps, gate findings, missing settings.",
    inputSchema: obj({}),
    map: () => ({ cmd: "left", args: [], flags: {} }),
  },
  {
    name: "verify",
    description:
      "Fast local checks (typecheck, lint, unit tests) with file:line and the fix; for an integration, also dependencies and settings.",
    inputSchema: obj({ integration: { type: "string" } }),
    map: (a) => ({
      cmd: "verify",
      args: str(a.integration) ? [str(a.integration) as string] : [],
      flags: {},
    }),
  },
];

const INSTRUCTIONS =
  "TurbineH delivers verified, already-tested code for common capabilities. Before writing a shop, auth, bookings, AI assistant, dashboard or portal yourself, call build with the spec; then work only on criteria not met and left[] from its result.";

type Message = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: unknown };

export function serve(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  cwd = process.cwd(),
): Promise<void> {
  const send = (m: Record<string, unknown>) =>
    output.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  const reply = (id: Message["id"], result: unknown) => send({ id, result });
  const error = (id: Message["id"], code: number, message: string) =>
    send({ id, error: { code, message } });

  async function handle(m: Message): Promise<void> {
    const isRequest = m.id !== undefined && m.id !== null;
    switch (m.method) {
      case "initialize": {
        const asked = (m.params as { protocolVersion?: string } | undefined)?.protocolVersion;
        reply(m.id, {
          protocolVersion:
            asked && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "turbineh", version: VERSION },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case "ping":
        reply(m.id, {});
        return;
      case "tools/list":
        reply(m.id, {
          tools: TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });
        return;
      case "tools/call": {
        const p = (m.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
          _meta?: { progressToken?: string | number };
        };
        const tool = TOOLS.find((t) => t.name === p.name);
        if (!tool) {
          error(m.id, -32602, `Unknown tool: ${String(p.name)}`);
          return;
        }
        const a = p.arguments ?? {};
        const { cmd, args, flags } = tool.map(a);
        const dir = str(a.directory);
        const token = p._meta?.progressToken;
        let progress = 0;
        const ctx: Ctx = {
          cwd: dir ? (isAbsolute(dir) ? dir : resolve(cwd, dir)) : cwd,
          args,
          flags: { ...flags, json: true },
          json: true,
          confirm: async () => false,
          ...(token !== undefined
            ? {
                emit: (event: Record<string, unknown>) =>
                  send({
                    method: "notifications/progress",
                    params: { progressToken: token, progress: ++progress, message: JSON.stringify(event) },
                  }),
              }
            : {}),
        };
        const { result } = await runCommand(cmd, ctx);
        const doc = jsonOf(result);
        reply(m.id, {
          content: [{ type: "text", text: JSON.stringify(doc) }],
          structuredContent: JSON.parse(JSON.stringify(doc)) as Record<string, unknown>,
          isError: !result.ok,
        });
        return;
      }
      default:
        if (isRequest) error(m.id, -32601, `Method not found: ${String(m.method)}`);
    }
  }

  return new Promise((done) => {
    const rl = createInterface({ input });
    const pending = new Set<Promise<void>>();
    rl.on("line", (line) => {
      if (!line.trim()) return;
      let m: Message;
      try {
        m = JSON.parse(line) as Message;
      } catch {
        send({ id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      const task = handle(m)
        .catch((err: unknown) => {
          if (m.id !== undefined && m.id !== null)
            error(m.id, -32603, err instanceof Error ? err.message : String(err));
        })
        .finally(() => pending.delete(task));
      pending.add(task);
    });
    rl.on("close", () => {
      void Promise.all(pending).then(() => done());
    });
  });
}
