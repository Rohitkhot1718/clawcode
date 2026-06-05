import ora from "ora";
import { loadConfig, saveConfig } from "../config/index.js";
import { testLLmConnection } from "./util.js";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { prompt } from "../utils/enquirerPrompt.js";
import { agent } from "../agent/loop.js";

const CONFIG_PATH = path.join(os.homedir(), ".clawcode", "config.json");

const PROVIDERS = ["groq", "ollama", "openRouter", "gemini"];

class CLICommands {
  async useModel(model: string): Promise<void> {
    const config = await loadConfig();
    if (!config) {
      console.log("No configuration found");
      return;
    }

    const isModelExists = config.models.find((m: any) => m.id === model);

    if (!isModelExists) {
      console.log(` Model "${model}" not found\n`);
      console.log("Available models:");
      config.models.forEach((m: any) => {
        const current = m.id === config.default ? " (current)" : "";
        console.log(`  - ${m.id}${current}`);
      });
      return;
    }

    if (!config.keys?.[isModelExists.provider]) {
      console.log(
        `No API key for ${isModelExists.provider}. Run: clawcode set-key --provider ${isModelExists.provider}`,
      );
      return;
    }

    if (config.default === model) {
      console.log(`"${isModelExists.name}" is already the current model`);
      return;
    }

    await saveConfig({ default: model });
    console.log(`✅ Switched to "${isModelExists.name}"`);
  }

  async listModels(): Promise<void> {
    const config = await loadConfig();
    if (!config || !config.models) {
      console.log("No models configured");
      return;
    }

    const { models, default: defaultModel } = config;

    const groupedModels = models.reduce(
      (acc: Record<string, string[]>, curr: any) => {
        if (!acc[curr.provider]) acc[curr.provider] = [];
        acc[curr.provider].push(
          `${curr.name} - ${curr.model} ${curr.id === defaultModel ? "(current)" : ""}`,
        );
        return acc;
      },
      {},
    );

    Object.entries(groupedModels).forEach(([key, vals]) => {
      console.log(key + ":");
      (vals as string[]).forEach((v) => console.log(" " + v));
      console.log("");
    });
  }

  async addModel(
    provider: string,
    model: string,
    name?: string,
    contextLimit?: number,
  ): Promise<void> {
    const config = await loadConfig();
    if (!config) {
      console.log("No configuration found");
      return;
    }

    const { models, keys } = config;
    const providerList = PROVIDERS as readonly string[];

    const isProviderExists = providerList.includes(provider);
    if (!isProviderExists) {
      console.log(`The ${provider} not supported`);
      console.log("Supported providers:");
      PROVIDERS.forEach((p) => console.log(`  - ${p}`));
      return;
    }

    const isModelExists = models.find((m: any) => m.id === model);
    if (isModelExists) {
      console.log("This model already exists.");
      return;
    }

    const isApiKeyExists = keys[provider];
    if (!isApiKeyExists) {
      console.log(
        `No API key for ${provider}. Run: clawcode set-key --provider ${provider}`,
      );
      return;
    }

    const spinner = ora("Validating...").start();
    try {
      const res = await testLLmConnection(provider, model, isApiKeyExists);
      spinner.stop();
      if (!res.ok) {
        console.log(res.message);
        return;
      }
    } catch (err) {
      spinner.stop();
      console.log("Connection failed, not saved.");
      return;
    }

    const newModel: any = {
      id: model,
      name: name || model,
      provider: provider as (typeof PROVIDERS)[number],
      model,
      ...(contextLimit && contextLimit > 0 ? { contextLimit } : {}),
    };

    await saveConfig({
      default: model,
      models: [newModel],
    });

    console.log(`\n✔ Model "${newModel.name}" added\n`);
  }

  async removeModel(model: string) {
    const config: any = await loadConfig();
    if (!config) {
      console.log("No configuration found");
      return;
    }

    const isModelExists = config.models?.find((m: any) => m?.id === model);
    if (!isModelExists) {
      console.log("This model doesn't exists.");
      return;
    }
    if (config.default === model) {
      console.log(
        "This model is currently the default. Run: clawcode use <modelName> before removing it.",
      );
      return;
    }
    const updated = config.models.filter((m: any) => m.id !== model);
    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify(
        {
          ...config,
          models: updated,
        },
        null,
        2,
      ),
    );
    console.log(`${model} removed successfully`);
  }

  async resetConfig() {
    const res = await prompt({
      type: "confirm",
      name: "confirm",
      message: "Reset configuration? This cannot be undone.",
    });

    if (!res) return;
    if (!(res as any).confirm) return;

    await fs.rm(CONFIG_PATH, { force: true });
    console.log("✅ Configuration reset. Run clawcode to set up again.");
  }

  async setKey(provider: string, key: string) {
    const { keys }: any = await loadConfig();

    const isProviderExists = PROVIDERS.includes(provider as any);
    if (!isProviderExists) {
      console.log(`The ${provider} not supported`);
      console.log("Supported providers");
      PROVIDERS.forEach((p) => console.log(p));
      return;
    }

    const isApiKeyExists = keys[provider];
    if (isApiKeyExists) {
      console.log(
        `API key for ${provider} already exists. Run: "clawcode change-key --provider <provider> --key <key>" to change existing key`,
      );
      return;
    }

    saveConfig({ keys: { [provider]: key } });
    console.log("API key added successfully");
  }

  async changeKey(provider: string, key: string) {
    const config = await loadConfig();
    const { keys = {} }: any = config;

    if (!PROVIDERS.includes(provider as any)) {
      console.log(`The ${provider} not supported`);
      return;
    }

    if (!keys[provider]) {
      console.log(`No API key found for ${provider}. Use set-key first.`);
      return;
    }

    await saveConfig({
      keys: {
        [provider]: key,
      },
    });

    console.log(`API key for ${provider} updated successfully`);
  }

  async removeKey(provider: string) {
    const config = await loadConfig();
    const { keys = {} }: any = config;

    if (!PROVIDERS.includes(provider as any)) {
      console.log(`The ${provider} not supported`);
      return;
    }

    if (!keys[provider]) {
      console.log(`No API key found for ${provider}`);
      return;
    }

    const updatedKeys = { ...keys };
    delete updatedKeys[provider];

    await fs.writeFile(
      CONFIG_PATH,
      JSON.stringify(
        {
          ...config,
          keys: updatedKeys,
        },
        null,
        2,
      ),
    );

    console.log(`API key for ${provider} removed successfully`);
  }

  async showConfig() {
    const config = await loadConfig();

    const { keys = {}, models = [], default: defaultModelId }: any = config;

    console.log("🔧 Configuration\n");

    const defaultModel = models.find((m: any) => m.id === defaultModelId);

    console.log("Default Model:");
    console.log(
      defaultModel
        ? `  ${defaultModel.name} (${defaultModel.id})`
        : "  (not set)",
    );

    console.log("\nProviders:\n");

    const maskKey = (key: string) => {
      if (!key) return "(not set)";
      return key.length > 8 ? `${key.slice(0, 4)}****${key.slice(-4)}` : "****";
    };

    for (const provider of PROVIDERS.sort()) {
      console.log(`  ${provider}`);

      const apiKey = keys[provider];

      console.log(`    API Key : ${maskKey(apiKey)}`);

      const providerModels = models
        .filter((m: any) => m.provider === provider)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));

      if (providerModels.length === 0) {
        console.log("    Models  : (none)\n");
        continue;
      }

      console.log("    Models  :");

      for (const model of providerModels) {
        const isDefault = model.id === defaultModelId;

        console.log(
          `      - ${model.name} (${model.id})${isDefault ? "  ⭐" : ""}`,
        );
      }

      console.log("");
    }
  }

  async runInput(input: string) {
    const config = await loadConfig();
    const { models = [], default: defaultModelId, keys = {} }: any = config;

    if (!defaultModelId) {
      console.log(" No default model set. Run: clawcode use <model>");
      return;
    }

    const selectedModel = models.find((m: any) => m.id === defaultModelId);

    if (!selectedModel) {
      console.log(` Default model "${defaultModelId}" not found in config`);
      return;
    }

    const { provider, model } = selectedModel;

    if (!PROVIDERS.includes(provider)) {
      console.log(` Unsupported provider: ${provider}`);
      return;
    }

    if (!keys[provider]) {
      console.log(
        `Missing API key for ${provider}. Run: clawcode set-key --provider ${provider} --key <key>`,
      );
      return;
    }
    try {
      await agent.run(input, provider, model, selectedModel.contextLimit);
    } catch (err: any) {
      console.log("Failed to execute:");
      console.log(err?.message || err);
    }
  }
}

export const cliCommands = new CLICommands();
