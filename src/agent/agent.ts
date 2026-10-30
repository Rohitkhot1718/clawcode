import dotenv from "dotenv";
import { tools } from "../tools/schema";
import { toolImpl, type ToolResult } from "../tools/index";
import fs from "fs/promises";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { createProvider, type Provider } from "../providers/index";
import type { ModelConfig } from "../config/index";
import { permissions } from "./permissions";
import { buildSystemPrompt } from "../prompts/index";
import { saveMemoryNote } from "../memory/memory";
import { webSearch, fetchURL } from "../tools/web";
import { mcpManager, MCP_PREFIX } from "../mcp/index";
import { SessionTracker, loadSession, saveTitle } from "../session/session";
import {
  DEFAULT_CONTEXT_LIMIT,
  applyCompaction,
  needsCompaction,
  renderTranscript,
  splitForCompaction,
} from "./context";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_PROMPT = readFileSync(
  path.join(__dirname, "..", "prompts", "summary.md"),
  "utf-8",
);

export type ChatMessage = Record<string, any>;

let provider: Provider | null = null;
let activeModel: ModelConfig | null = null;

export async function setActiveModel(model: ModelConfig) {
  provider = await createProvider(model.provider, model.model);
  activeModel = model;
}

export function getActiveModel() {
  return activeModel;
}

type ToolArgs = Record<string, any>;

const toolCallers: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  readFile: (a) => toolImpl.readFile(a.path, a.offset, a.limit),
  writeFile: (a) => toolImpl.writeFile(a.path, a.content),
  editFile: (a) => toolImpl.editFile(a.path, a.oldStr, a.newStr, a.replaceAll),
  glob: (a) => toolImpl.glob(a.pattern, a.path),
  grep: (a) => toolImpl.grep(a.query, a.path),
  bash: (a) => toolImpl.bash(a.command, a.runInBackground),
  powerShell: (a) => toolImpl.powerShell(a.command, a.runInBackground),
  askUserQuestion: (a) => toolImpl.askUserQuestion(a.questions),
  webSearch: (a) => webSearch(a.query),
  fetchURL: (a) => fetchURL(a.url),
  saveMemoryNote: async (a) => {
    try {
      await saveMemoryNote(String(a.note ?? ""), a.replaces || undefined);
      return { ok: true, output: "Note saved." };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  },
};

async function runTool(name: string, args: ToolArgs): Promise<ToolResult> {
  const caller = toolCallers[name];
  if (caller) return caller(args);
  if (mcpManager.has(name)) {
    const { message_to_user: _ignored, ...mcpArgs } = args;
    return mcpManager.call(name, mcpArgs);
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}

const primaryArgKey: Record<string, keyof ToolArgs> = {
  readFile: "path",
  writeFile: "path",
  editFile: "path",
  glob: "pattern",
  grep: "query",
  bash: "command",
  powerShell: "command",
  saveMemoryNote: "note",
  webSearch: "query",
  fetchURL: "url",
};

export function getPrimaryArg(name: string, args: ToolArgs): string {
  if (name.startsWith(MCP_PREFIX)) {
    const { message_to_user: _ignored, ...rest } = args;
    const text = JSON.stringify(rest);
    return text.length > 80 ? text.slice(0, 80) + "…" : text;
  }
  const key = primaryArgKey[name];
  if (!key) return "";
  const value = args[key];
  return value !== undefined ? String(value) : "";
}

export type ToolStatus = "running" | "success" | "error";

export type AgentEvent =
  | { type: "message_to_user"; text: string }
  | {
      type: "tool_call";
      id: string;
      name: string;
      arg: string;
      status: ToolStatus;
    }
  | {
      type: "diff";
      id: string;
      filePath: string;
      oldContent: string;
      newContent: string;
    }
  | { type: "write"; id: string; filePath: string; content: string }
  | { type: "final"; text: string }
  | { type: "info"; text: string; error?: boolean }
  | { type: "stream"; text: string }
  | { type: "stream_end" };

export function buildInitialMessages(): ChatMessage[] {
  return [{ role: "system", content: buildSystemPrompt() }];
}

const sessionTracker = new SessionTracker();

async function generateTitle(text: string, id: string, createdAt: string) {
  if (!provider || !activeModel) return;
  const model = activeModel;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
    if (await tryGenerateTitle(text, id, createdAt, model)) return;
  }
}

async function tryGenerateTitle(
  text: string,
  id: string,
  createdAt: string,
  model: ModelConfig,
): Promise<boolean> {
  if (!provider) return false;
  try {
    const res = await provider.chat([
      {
        role: "system",
        content:
          "Generate a short 3-6 word title summarizing the user's request. Reply with only the title, no quotes, no trailing punctuation, no explanation.",
      },
      { role: "user", content: text.slice(0, 500) },
    ]);
    if (!res.ok) return false;
    const title = String(res.message.content ?? "")
      .replace(/^["'\s]+|["'.\s]+$/g, "")
      .split("\n")[0]
      .slice(0, 60);
    if (!title) return false;
    await saveTitle(id, { provider: model.provider, model: model.model, createdAt }, title);
    return true;
  } catch {
    return false;
  }
}

async function persist(messages: ChatMessage[], turnDone = false) {
  if (!activeModel) return;
  await sessionTracker.persist(messages, activeModel);
  if (!turnDone) return;
  const request = sessionTracker.takeTitleRequest();
  if (request) void generateTitle(request.text, request.id, sessionTracker.createdAt);
}

export function newSession() {
  sessionTracker.reset();
}

let abortController: AbortController | null = null;
let callSeq = 0;

export function interrupt() {
  abortController?.abort();
}

async function compactIfNeeded(
  messages: ChatMessage[],
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
) {
  const limit = activeModel?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  if (!provider || !needsCompaction(messages, limit)) return;

  const parts = splitForCompaction(messages);
  if (!parts) return;

  onEvent({ type: "info", text: `Context is nearly full, summarizing ${parts.head.length} earlier messages…` });
  const res = await provider.chat(
    [
      { role: "system", content: SUMMARY_PROMPT },
      { role: "user", content: renderTranscript(parts.head) },
    ],
    undefined,
    signal,
  );
  if (!res.ok) {
    if (res.error !== "ABORTED") {
      onEvent({ type: "info", text: `Could not summarize context: ${res.message}`, error: true });
    }
    return;
  }

  applyCompaction(messages, parts, res.message.content?.trim() || "No summary was produced.");
  sessionTracker.skipTo(messages.length);
  onEvent({ type: "info", text: "Context compacted." });
}

export async function resumeSession(id: string): Promise<ChatMessage[] | null> {
  const loaded = await loadSession(id);
  if (!loaded) return null;

  const restored: ChatMessage[] = [];
  const answered = new Set(
    loaded.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id),
  );
  for (const m of loaded.messages) {
    restored.push(m);
    for (const call of m.role === "assistant" ? (m.tool_calls ?? []) : []) {
      if (answered.has(call.id)) continue;
      restored.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ ok: false, error: "Interrupted before completion." }),
      });
    }
  }

  const all = [...buildInitialMessages(), ...restored];
  const meta = loaded.meta;
  sessionTracker.attach(
    id,
    meta?.createdAt ?? new Date().toISOString(),
    all.length,
    meta ? `${meta.provider}/${meta.model}` : "",
  );
  return all;
}

export const messages = buildInitialMessages();
export let isRunning = false;

export function flushPendingEvents(messages: ChatMessage[]) {
  while (toolImpl.pendingEvents.length > 0) {
    const event: any = toolImpl.pendingEvents.shift();
    if (!event) break;

    messages.push({
      role: "user",
      content: `[SYSTEM NOTIFICATION]: Background task ${event.taskId} completed with status '${event.status}'.
Output:
${String(event.output).slice(-8000)}
Errors:
${String(event.error).slice(-4000)}`,
    });
  }
}

const CACHEABLE_TOOLS = new Set(["readFile", "glob", "grep", "webSearch", "fetchURL"]);
const MAX_NUDGES = 2;

const MAX_OUTPUT_CHARS: Record<string, number> = {
  readFile: 20000,
  bash: 8000,
  powerShell: 8000,
  grep: 8000,
  glob: 6000,
  webSearch: 6000,
  fetchURL: 10000,
};
const DEFAULT_MAX_OUTPUT_CHARS = 4000;

function truncateResult(name: string, result: ToolResult): ToolResult {
  if (!result.ok) return result;
  const limit = MAX_OUTPUT_CHARS[name] ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (result.output.length <= limit) return result;
  const hint =
    name === "readFile"
      ? "use offset and limit to read more"
      : "narrow the command or search";
  return {
    ok: true,
    output:
      result.output.slice(0, limit) +
      `\n...[truncated ${result.output.length - limit} chars, ${hint}]`,
  };
}

export function looksLikeTextToolCall(content: unknown): boolean {
  const trimmed = String(content ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return false;
  try {
    const obj = JSON.parse(candidate);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return false;
    const toolish = [
      "message_to_user",
      "command",
      "oldStr",
      "newStr",
      "pattern",
      "runInBackground",
      "questions",
    ];
    return Object.keys(obj).some((k) => toolish.includes(k));
  } catch {
    return false;
  }
}

function sanitizeMessage(msg: ChatMessage): ChatMessage {
  const clean: ChatMessage = { role: "assistant", content: msg.content ?? null };
  if (msg.tool_calls?.length) clean.tool_calls = msg.tool_calls;
  return clean;
}

export async function runTurn(
  messages: ChatMessage[],
  onEvent: (event: AgentEvent) => void,
) {
  isRunning = true;
  const controller = new AbortController();
  const signal = controller.signal;
  abortController = controller;

  const readCache = new Map<string, string>();
  let nudges = 0;

  const stop = () => {
    messages.push({
      role: "user",
      content: "[Interrupted by user before this response finished]",
    });
    onEvent({ type: "info", text: "Interrupted." });
  };

  try {
    while (true) {
      flushPendingEvents(messages);
      await persist(messages);
      if (!provider) throw new Error("No model selected. Run /config to add one.");

      await compactIfNeeded(messages, onEvent, signal);
      if (signal.aborted) return stop();

      const response = await provider.chat(
        messages,
        [...tools, ...mcpManager.tools()],
        signal,
        (text) => onEvent({ type: "stream", text }),
      );
      onEvent({ type: "stream_end" });
      if (!response.ok) {
        if (response.error === "ABORTED") return stop();
        throw new Error(response.message);
      }

      const assistant = sanitizeMessage(response.message);
      messages.push(assistant);

      const functionCalls = (assistant.tool_calls ?? []).filter(
        (c: any) => c.type === "function",
      );

      if (functionCalls.length === 0) {
        const afterTool = messages.at(-2)?.role === "tool";
        const nudge =
          nudges < MAX_NUDGES &&
          (looksLikeTextToolCall(assistant.content) ||
            (afterTool && !String(assistant.content ?? "").trim()));
        if (nudge) {
          nudges++;
          messages.push({
            role: "user",
            content: looksLikeTextToolCall(assistant.content)
              ? "You wrote tool arguments as a JSON text reply, which does not execute anything. Invoke the tool through the tool-calling interface instead and do not print JSON in your message."
              : "Please provide a response based on the tool results above.",
          });
          continue;
        }
        onEvent({ type: "final", text: assistant.content ?? "" });
        return;
      }

      for (const [i, call] of functionCalls.entries()) {
        if (signal.aborted) {
          for (const rest of functionCalls.slice(i)) {
            messages.push({
              role: "tool",
              tool_call_id: rest.id,
              content: JSON.stringify({ ok: false, error: "Interrupted by user." }),
            });
          }
          return stop();
        }
        const uiId = `${++callSeq}:${call.id}`;
        const name: string = call.function.name;
        let args: ToolArgs;
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({
              ok: false,
              error: `Arguments for ${name} were not valid JSON. Retry with complete, valid JSON.`,
            }),
          });
          continue;
        }
        if (args.message_to_user) {
          onEvent({ type: "message_to_user", text: args.message_to_user });
        }

        const primaryArg = getPrimaryArg(name, args);

        const { message_to_user: _ignored, ...argsForSig } = args;
        const signature = CACHEABLE_TOOLS.has(name)
          ? `${name}:${JSON.stringify(argsForSig)}`
          : "";
        const cached = signature ? readCache.get(signature) : undefined;
        if (cached !== undefined) {
          onEvent({ type: "tool_call", id: uiId, name, arg: primaryArg, status: "success" });
          messages.push({ role: "tool", tool_call_id: call.id, content: cached });
          continue;
        }

        onEvent({
          type: "tool_call",
          id: uiId,
          name: name,
          arg: primaryArg,
          status: "running",
        });

        let fullOldContent: string | undefined;
        if (name === "editFile") {
          try {
            fullOldContent = await fs.readFile(args.path, "utf-8");
          } catch {
            fullOldContent = undefined;
          }
        }

        const decision = await permissions.check(name, args);
        const result: ToolResult =
          decision.behavior === "allow"
            ? await runTool(name, args)
            : { ok: false, error: decision.message };

        if (name === "writeFile" && result.ok) permissions.markCreated(args.path);

        onEvent({
          type: "tool_call",
          id: uiId,
          name: name,
          arg: primaryArg,
          status: result.ok ? "success" : "error",
        });

        if (name === "writeFile" && result.ok) {
          onEvent({
            type: "write",
            id: uiId + "-write",
            filePath: args.path,
            content: args.content,
          });
        }

        if (
          name === "editFile" &&
          result.ok &&
          fullOldContent !== undefined
        ) {
          try {
            const fullNewContent = await fs.readFile(args.path, "utf-8");
            onEvent({
              type: "diff",
              id: uiId + "-diff",
              filePath: args.path,
              oldContent: fullOldContent,
              newContent: fullNewContent,
            });
          } catch {}
        }

        const content = JSON.stringify(truncateResult(name, result));
        if (!CACHEABLE_TOOLS.has(name)) readCache.clear();
        else if (result.ok) readCache.set(signature, content);

        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
  } finally {
    await persist(messages, true);
    isRunning = false;
    if (abortController === controller) abortController = null;
    if (!signal.aborted && toolImpl.pendingEvents.length > 0) {
      flushPendingEvents(messages);
      runTurn(messages, toolImpl.bgEventHandler!).catch(console.error);
    }
  }
}
