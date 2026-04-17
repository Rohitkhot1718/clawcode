import { createProvider } from "../providers/index.js";

export async function testLLmConnection(
  provider: string,
  model: string,
  apiKey: string,
) {
  const LLMProvider = await createProvider(provider, model, apiKey);
  const res = await LLMProvider.chat([{ role: "user", content: "hi" }]);
  return res;
}
