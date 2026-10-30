type Message = Record<string, any>;

export const DEFAULT_CONTEXT_LIMIT = 128000;
const COMPACTION_THRESHOLD = 0.8;
const KEEP_RECENT = 6;

export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    for (const call of m.tool_calls ?? []) {
      chars += (call.function?.name ?? "").length;
      chars += (call.function?.arguments ?? "").length;
    }
    chars += 16;
  }
  return Math.ceil(chars / 4);
}

export function needsCompaction(messages: Message[], limit: number): boolean {
  return estimateTokens(messages) > limit * COMPACTION_THRESHOLD;
}

export function splitForCompaction(messages: Message[]): {
  system: Message[];
  head: Message[];
  recent: Message[];
} | null {
  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length <= KEEP_RECENT) return null;

  let split = rest.length - KEEP_RECENT;
  while (split < rest.length && rest[split].role === "tool") split++;
  if (split === 0 || split >= rest.length) return null;

  return { system, head: rest.slice(0, split), recent: rest.slice(split) };
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

export function renderTranscript(messages: Message[]): string {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === "user") out.push(`USER: ${clip(String(m.content ?? ""), 2000)}`);
    if (m.role === "assistant") {
      if (m.content) out.push(`ASSISTANT: ${clip(String(m.content), 2000)}`);
      for (const call of m.tool_calls ?? []) {
        out.push(
          `TOOL CALL: ${call.function?.name}(${clip(call.function?.arguments ?? "", 500)})`,
        );
      }
    }
    if (m.role === "tool") out.push(`TOOL RESULT: ${clip(String(m.content ?? ""), 800)}`);
  }
  return out.join("\n");
}

export function applyCompaction(
  messages: Message[],
  parts: { system: Message[]; recent: Message[] },
  summary: string,
) {
  messages.splice(
    0,
    messages.length,
    ...parts.system,
    { role: "user", content: `[Summary of previous steps]\n${summary}` },
    { role: "assistant", content: "Understood." },
    ...parts.recent,
  );
}
