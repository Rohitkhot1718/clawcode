import { OpenAI } from "openai/client.js";

export class OpenAIProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseURL: string, model: string) {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  private isRetryable(err: any): boolean {
    if (err?.status === 429) return true;
    if (typeof err?.status === "number" && err.status >= 500) return true;
    const code = err?.code;
    if (
      code === "ENOTFOUND" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ECONNREFUSED"
    ) {
      return true;
    }
    if (err?.name === "TypeError") return true; // fetch network failure
    return false;
  }

  async chat(messages: any[], tools?: any[]): Promise<any> {
    const MAX_RETRIES = 3;

    for (let attempt = 0; ; attempt++) {
      try {
        const response: any = await this.client.chat.completions.create({
          model: this.model,
          messages,
          stream: true,
          ...(tools ? { tools } : {}),
          tool_choice: tools ? "auto" : "none",
        });

        return {
          ok: true,
          message: response,
        };
      } catch (err: any) {
        if (this.isRetryable(err) && attempt < MAX_RETRIES) {
          // Exponential backoff with jitter: ~0.5s, 1s, 2s.
          const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        return this.mapError(err);
      }
    }
  }

  private mapError(err: any): any {
    if (err.name === "TypeError" || err.code === "ENOTFOUND") {
      return {
        ok: false,
        error: "NETWORK_ERROR",
        message: "Network error: Cannot reach server",
      };
    }

    if (err.status === 401) {
      return {
        ok: false,
        error: "INVALID_API_KEY",
        message: "Invalid API key",
      };
    }

    if (err.status === 404 || err.type === "not_found_error") {
      if (err?.error?.message?.toLowerCase().includes("model")) {
        return {
          ok: false,
          error: "INVALID_MODEL",
          message: "Model not found",
        };
      }

      return {
        ok: false,
        error: "NOT_FOUND",
        message: "Resource not found",
      };
    }

    if (err.status === 429) {
      return {
        ok: false,
        error: "RATE_LIMIT",
        message: "Rate limit exceeded",
      };
    }

    return {
      ok: false,
      error: "UNKNOWN_ERROR",
      message: err?.error?.message || err.message || "Something went wrong",
    };
  }
}
