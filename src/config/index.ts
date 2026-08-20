import fs from "fs/promises";
import path from "path";
import os from "os";

const CONFIG_PATH = path.join(os.homedir(), ".clawcode", "config.json");

export async function loadConfig(): Promise<any | null> {
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return parsed;
  } catch (err: any) {
    return null;
  }
}

export async function getModel() {
  const config = await loadConfig();
  if (!config || !config.models || config.models.length === 0) {
    throw new Error("No models configured. Run: clawcode add-model");
  }

  const selectedModel = config.models.find((m: any) => m.id === config.default);
  if (!selectedModel) {
    throw new Error("Default model not found in config");
  }
  return selectedModel;
}

export async function saveConfig(newData: Partial<any>) {
  const existing = (await loadConfig()) || {
    default: "",
    keys: {},
    models: [],
  };

  const merged: any = {
    ...existing,
    ...newData,
    keys: { ...existing.keys, ...(newData.keys || {}) },
    endpoints: { ...existing.endpoints, ...(newData.endpoints || {}) },
    models: [
      ...existing.models,
      ...(newData.models || []).filter(
        (m: any) => !existing.models.find((e: any) => e.id === m.id),
      ),
    ],
  };

  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2));
}
