import { loadConfig, saveConfig } from "../config/index.js";
import ora from "ora";
import { testLLmConnection } from "./util.js";
import { clearLine, prompt } from "../utils/enquirerPrompt.js";

export async function checkConfig() {
  const config = await loadConfig();

  if (!config) {
    console.log("No configuration found. Let's get you set up.");
    const res = await addModelFlow();
    if (res) console.log("Setup completed!");
  }

  return;
}

export async function configWizard() {
  const res: any = await prompt({
    type: "select",
    name: "action",
    message: "What do you want to do?",
    choices: [
      { name: "addModel", message: "Add a new model" },
      { name: "changeKey", message: "Update API key" },
      { name: "changeDefault", message: "Switch default model" },
    ],
  });

  if (!res) return null;

  switch (res.action) {
    case "addModel":
      return await addModelFlow();
    case "changeKey":
      return await changeKeyFlow();
    case "changeDefault":
      return await switchModel();
  }
}

async function addModelFlow() {
  const config = await loadConfig();
  const keys = config?.keys || {};

  const providerRes = await prompt({
    type: "select",
    name: "provider",
    message: "Select provider",
    choices: [
      { name: "groq", message: `Groq ${keys.groq ? "✓" : ""}` },
      { name: "ollama", message: `Ollama ${keys.ollama ? "✓" : ""}` },
      {
        name: "openRouter",
        message: `OpenRouter ${keys.openRouter ? "✓" : ""}`,
      },
    ],
  });
  if (!providerRes) return;
  const { provider } = providerRes as any;

  let apiKey = keys[provider] || "";

  if (!apiKey) {
    const keyRes = await prompt({
      type: "password",
      name: "apiKey",
      message: `Enter API key for ${provider}`,
    });
    if (!keyRes) return;
    clearLine();
    apiKey = (keyRes as any).apiKey;
    console.log(`API key entered`);
  }

  const modelRes = await prompt([
    {
      type: "input",
      name: "model",
      message: "Model ID (e.g. meta-llama/llama-3.1-8b)",
    },
    { type: "input", name: "name", message: "Display name" },
  ]);
  if (!modelRes) return;
  const { model, name } = modelRes as any;

  const spinner = ora("Validating...").start();
  try {
    const res = await testLLmConnection(provider, model, apiKey);
    spinner.stop();
    if (!res.ok) {
      console.log(res.message);
      return;
    }
  } catch {
    spinner.stop();
    console.log("Connection failed, not saved.");
    return;
  }

  await saveConfig({
    default: model,
    ...(apiKey && { keys: { [provider]: apiKey } }),
    models: [{ id: model, name, provider, model }],
  });

  console.log(`\n✔ Model "${name}" added\n`);
  return { provider, apiKey, model, name };
}

async function changeKeyFlow() {
  const config = await loadConfig();
  const existingKeys = Object.keys(config?.keys || {});

  if (existingKeys.length === 0) {
    console.log("No providers configured yet. Add a model first.");
    return;
  }

  const providerRes = await prompt({
    type: "select",
    name: "provider",
    message: "Select provider to update",
    choices: existingKeys.map((k) => ({ name: k, message: k })),
  });
  if (!providerRes) return;
  const { provider } = providerRes as any;

  const keyRes = await prompt({
    type: "password",
    name: "apiKey",
    message: `Enter new API key for ${provider}`,
  });
  if (!keyRes) return;
  const { apiKey } = keyRes as any;

  const model = config?.models.find((m: any) => m.provider === provider);
  if (!model) {
    console.log(`No model found for ${provider}. Add a model first.`);
    return;
  }

  const spinner = ora("Validating...").start();
  try {
    const res = await testLLmConnection(provider, model.model, apiKey);
    spinner.stop();
    if (!res.ok) {
      console.log(res.message);
      return;
    }
  } catch {
    spinner.stop();
    console.log("Invalid key, not saved.");
    return;
  }

  await saveConfig({ keys: { [provider]: apiKey } });
  console.log(`\n✔ API key updated for ${provider}\n`);
}

export async function switchModel() {
  const config: any = await loadConfig();

  const currentModelId = config.default;

  const res: any = await prompt({
    type: "select",
    name: "selectedId",
    message: "Select a model",
    choices: config?.models.map((m: any) => ({
      name: m.id,
      message: m.id === currentModelId ? `${m.name} (current)` : m.name,
    })),
  });

  if (!res) return null;

  await saveConfig({ default: res.selectedId });

  const selectedModel: any = config.models.find(
    (m: any) => m.id === res.selectedId,
  );

  console.log(`\n✔ Switched to ${selectedModel.name}\n`);
}
