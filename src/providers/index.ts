import { OpenAIProvider } from "./openai";
import { loadConfig } from "../config/index";

export const BUILTIN_ENDPOINTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  ollama: "https://ollama.com/v1",
  openRouter: "https://openrouter.ai/api/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
};

export type Provider = OpenAIProvider;

export async function createProvider(
  provider: string,
  model: string,
  opts: { apiKey?: string; baseURL?: string } = {},
): Promise<Provider> {
  const config = await loadConfig();

  const baseURL =
    opts.baseURL ??
    BUILTIN_ENDPOINTS[provider] ??
    config?.endpoints[provider];
  if (!baseURL) throw new Error(`Unsupported provider: ${provider}`);

  const apiKey =
    opts.apiKey ??
    config?.keys[provider] ??
    process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!apiKey) {
    throw new Error(`No API key for ${provider}. Add one with /config.`);
  }

  return new OpenAIProvider(apiKey, baseURL, model);
}

export async function testConnection(
  provider: string,
  model: string,
  opts: { apiKey?: string; baseURL?: string },
) {
  const p = await createProvider(provider, model, opts);
  return p.chat([{ role: "user", content: "hi" }]);
}
