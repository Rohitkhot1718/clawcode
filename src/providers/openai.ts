import OpenAI from "openai";

export type ChatResult =
  | { ok: true; message: OpenAI.Chat.Completions.ChatCompletionMessage }
  | { ok: false; error: string; message: string };

const STREAM_EMIT_INTERVAL_MS = 60;

export class OpenAIProvider {
  private client: OpenAI;

  constructor(
    apiKey: string,
    baseURL: string,
    private model: string,
  ) {
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  }

  private isRetryable(err: any): boolean {
    if (err?.status === 429) return true;
    if (typeof err?.status === "number" && err.status >= 500) return true;
    return ["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"].includes(
      err?.code,
    );
  }

  async chat(
    messages: any[],
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[],
    signal?: AbortSignal,
    onText?: (fullText: string) => void,
  ): Promise<ChatResult> {
    const MAX_RETRIES = 3;
    let streaming = !!onText;
    const progress = { started: false };

    for (let attempt = 0; ; attempt++) {
      progress.started = false;
      try {
        const params = {
          model: this.model,
          messages,
          ...(tools ? { tools, tool_choice: "auto" as const } : {}),
        };
        const requestOptions = signal ? { signal } : undefined;

        if (streaming) {
          const message = await this.streamOnce(params, requestOptions, onText!, progress);
          return { ok: true, message };
        }

        const response = await this.client.chat.completions.create(params, requestOptions);
        const message = response.choices[0]?.message;
        if (!message) {
          return { ok: false, error: "EMPTY", message: "Empty response" };
        }
        return { ok: true, message };
      } catch (err: any) {
        if (err?.name === "AbortError" || signal?.aborted) {
          return { ok: false, error: "ABORTED", message: "Interrupted" };
        }
        if (streaming && !progress.started && err?.status === 400) {
          streaming = false;
          attempt--;
          continue;
        }
        if (this.isRetryable(err) && attempt < MAX_RETRIES && !progress.started) {
          const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return this.mapError(err);
      }
    }
  }

  private async streamOnce(
    params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    requestOptions: { signal: AbortSignal } | undefined,
    onText: (fullText: string) => void,
    progress: { started: boolean },
  ): Promise<OpenAI.Chat.Completions.ChatCompletionMessage> {
    const stream = await this.client.chat.completions.create(
      { ...params, stream: true },
      requestOptions,
    );

    let content = "";
    let lastEmit = 0;
    const calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        progress.started = true;
        content += delta.content;
        const now = Date.now();
        if (now - lastEmit >= STREAM_EMIT_INTERVAL_MS) {
          lastEmit = now;
          onText(content);
        }
      }

      for (const part of delta.tool_calls ?? []) {
        progress.started = true;
        const call = (calls[part.index ?? 0] ??= {
          id: "",
          type: "function",
          function: { name: "", arguments: "" },
        });
        if (part.id) call.id = part.id;
        if (part.function?.name && !call.function.name) call.function.name = part.function.name;
        if (part.function?.arguments) call.function.arguments += part.function.arguments;
      }
    }

    if (requestOptions?.signal.aborted) {
      throw Object.assign(new Error("Interrupted"), { name: "AbortError" });
    }

    if (content) onText(content);

    const finished = calls
      .filter(Boolean)
      .map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));

    return {
      role: "assistant",
      content: content || null,
      refusal: null,
      ...(finished.length ? { tool_calls: finished } : {}),
    };
  }

  private mapError(err: any): ChatResult {
    const detail = err?.error?.message || err?.message || "Something went wrong";
    switch (err?.status) {
      case 401:
        return { ok: false, error: "INVALID_API_KEY", message: "Invalid API key" };
      case 404:
        return {
          ok: false,
          error: "NOT_FOUND",
          message: detail.toLowerCase().includes("model")
            ? "Model not found"
            : "Resource not found",
        };
      case 429:
        return { ok: false, error: "RATE_LIMIT", message: "Rate limit exceeded" };
      case 400:
        return { ok: false, error: "BAD_REQUEST", message: `Bad request (400): ${detail}` };
    }
    if (err?.name === "TypeError" || err?.code === "ENOTFOUND") {
      return {
        ok: false,
        error: "NETWORK_ERROR",
        message: "Network error: cannot reach server",
      };
    }
    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: err?.status ? `HTTP ${err.status}: ${detail}` : detail,
    };
  }
}
