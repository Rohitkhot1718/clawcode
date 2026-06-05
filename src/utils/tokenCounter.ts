export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: any[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(typeof msg.content === "string" ? msg.content : "");

    // Tool call payloads (function name + JSON arguments) also cost tokens and
    // can dominate a coding session, so count them too.
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc.function?.name || "");
        total += estimateTokens(tc.function?.arguments || "");
      }
    }

    total += 4;
  }
  return total;
}

export interface TokenBudget {
  maxContextTokens: number;
  maxOutputTokens: number;
  currentUsage: number;
  available: number;
}

export function calculateTokenBudget(messages: any[], maxTokens = 8000): TokenBudget {
  const currentUsage = estimateMessagesTokens(messages);
  const maxOutputTokens = 1000;
  const available = maxTokens - currentUsage - maxOutputTokens;

  return {
    maxContextTokens: maxTokens,
    maxOutputTokens,
    currentUsage,
    available: Math.max(0, available),
  };
}

export function shouldCompressContext(messages: any[], threshold = 0.8, maxTokens = 8000): boolean {
  const budget = calculateTokenBudget(messages, maxTokens);
  const usageRatio = budget.currentUsage / maxTokens;
  return usageRatio > threshold;
}
