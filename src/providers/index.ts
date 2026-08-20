import { OpenAIProvider } from "./openai.js";
import { loadConfig } from "../config/index.js";

// Base URLs for well-known providers. Anything else must be registered
// via `add-model --base-url <url>` and is stored in config.endpoints.
export const BUILTIN_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  ollama: "https://ollama.com/v1",
  openRouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
};

export async function createProvider(
  provider: string,
  model: string,
  apiKey?: string,
) {
  const config = await loadConfig();
  const keys = config?.keys || {};
  const endpoints = config?.endpoints || {};

  const baseURL = BUILTIN_ENDPOINTS[provider] ?? endpoints[provider];
  if (!baseURL) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  return new OpenAIProvider(apiKey || keys[provider], baseURL, model);
}
