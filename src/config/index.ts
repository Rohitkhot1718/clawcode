import fs from "fs/promises";
import path from "path";
import os from "os";

export const CONFIG_PATH = path.join(os.homedir(), ".clawcode", "config.json");

export type ModelConfig = {
  id: string;
  name: string;
  provider: string;
  model: string;
  contextLimit?: number;
};

export type Config = {
  default: string;
  keys: Record<string, string>;
  endpoints: Record<string, string>;
  models: ModelConfig[];
};

export async function loadConfig(): Promise<Config | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    return {
      default: parsed.default ?? "",
      keys: parsed.keys ?? {},
      endpoints: parsed.endpoints ?? {},
      models: parsed.models ?? [],
    };
  } catch {
    return null;
  }
}

async function writeConfig(config: Config) {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export async function saveConfig(newData: Partial<Config>) {
  const existing = (await loadConfig()) ?? {
    default: "",
    keys: {},
    endpoints: {},
    models: [],
  };

  await writeConfig({
    ...existing,
    ...newData,
    keys: { ...existing.keys, ...(newData.keys ?? {}) },
    endpoints: { ...existing.endpoints, ...(newData.endpoints ?? {}) },
    models: [
      ...existing.models.filter(
        (e) => !(newData.models ?? []).some((m) => m.id === e.id),
      ),
      ...(newData.models ?? []),
    ],
  });
}

export async function setDefaultModel(id: string) {
  await saveConfig({ default: id });
}

export async function resolveActiveModel(): Promise<ModelConfig | null> {
  const config = await loadConfig();
  const selected = config?.models.find((m) => m.id === config.default);
  if (selected) return selected;

  if (process.env.GROQ_API_KEY) {
    return {
      id: "openai/gpt-oss-120b",
      name: "gpt-oss-120b",
      provider: "groq",
      model: "openai/gpt-oss-120b",
    };
  }
  return null;
}
