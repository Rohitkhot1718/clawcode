import { OpenAIProvider } from "./openai.js";
import { loadConfig } from "../config/index.js";

export async function createProvider(
  provider: string,
  model: string,
  apiKey?: string,
) {
  const config = await loadConfig();
  const keys = config?.keys || {};

  switch (provider) {
    case "groq":
      return new OpenAIProvider(
        apiKey || keys.groq,
        "https://api.groq.com/openai/v1",
        model,
      );

    case "gemini":
      return new OpenAIProvider(
        apiKey || keys.gemini,
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        model,
      );

    case "ollama":
      return new OpenAIProvider(
        apiKey || keys.ollama,
        "https://ollama.com/v1",
        model,
      );

    case "openRouter":
      return new OpenAIProvider(
        apiKey || keys.openRouter,
        "https://openrouter.ai/api/v1",
        model,
      );

    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
