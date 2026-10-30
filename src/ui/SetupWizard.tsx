import { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "./TextInput";
import Spinner from "ink-spinner";
import { Select } from "./Select";
import { loadConfig, saveConfig, type ModelConfig } from "../config/index";
import { BUILTIN_ENDPOINTS, testConnection } from "../providers/index";

type Step =
  | "provider"
  | "customName"
  | "baseUrl"
  | "apiKey"
  | "model"
  | "name"
  | "context"
  | "validating";

const CUSTOM = "__custom__";

type Props = {
  onDone: (model: ModelConfig) => void;
  onCancel: () => void;
};

const PROMPTS: Partial<Record<Step, string>> = {
  customName: "Provider name (e.g. together)",
  baseUrl: "Base URL (OpenAI-compatible, e.g. https://api.x.ai/v1)",
  apiKey: "API key",
  model: "Model ID (e.g. openai/gpt-oss-120b)",
  name: "Display name",
  context: "Context window size in tokens",
};

export function SetupWizard({ onDone, onCancel }: Props) {
  const [step, setStep] = useState<Step>("provider");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [data, setData] = useState({
    provider: "",
    baseURL: "",
    apiKey: "",
    model: "",
    name: "",
  });

  useInput((_, key) => {
    if (key.escape && step !== "validating") onCancel();
  });

  const advance = async (next: Step, patch: Partial<typeof data> = {}) => {
    const merged = { ...data, ...patch };
    setData(merged);
    setError("");
    setValue("");
    setStep(next);
  };

  const afterProvider = async (provider: string) => {
    const config = await loadConfig();
    const hasKey = !!config?.keys[provider] || !!process.env[`${provider.toUpperCase()}_API_KEY`];
    await advance(hasKey ? "model" : "apiKey", { provider });
  };

  const validateAndSave = async (contextRaw: string) => {
    const contextLimit = Number(contextRaw) > 0 ? Number(contextRaw) : 128000;
    setStep("validating");

    const apiKey = data.apiKey || undefined;
    let res;
    try {
      res = await testConnection(data.provider, data.model, {
        apiKey,
        baseURL: data.baseURL || undefined,
      });
    } catch (err: any) {
      setError(err.message);
      setStep("model");
      return;
    }
    if (!res.ok) {
      setError(res.message);
      setStep("model");
      return;
    }

    const model: ModelConfig = {
      id: data.model,
      name: data.name || data.model,
      provider: data.provider,
      model: data.model,
      contextLimit,
    };
    await saveConfig({
      default: model.id,
      ...(apiKey ? { keys: { [data.provider]: apiKey } } : {}),
      ...(data.baseURL ? { endpoints: { [data.provider]: data.baseURL } } : {}),
      models: [model],
    });
    onDone(model);
  };

  const submit = async (raw: string) => {
    const v = raw.trim();
    if (step === "context") return validateAndSave(v);
    if (!v && step !== "name") {
      setError("This field is required.");
      return;
    }
    switch (step) {
      case "customName":
        return advance("baseUrl", { provider: v });
      case "baseUrl":
        return advance("apiKey", { baseURL: v });
      case "apiKey":
        return advance("model", { apiKey: v });
      case "model":
        return advance("name", { model: v });
      case "name":
        return advance("context", { name: v || data.model });
    }
  };

  if (step === "provider") {
    return (
      <Select
        label="Select provider"
        options={[
          ...Object.keys(BUILTIN_ENDPOINTS).map((p) => ({
            label: p,
            description: BUILTIN_ENDPOINTS[p],
          })),
          { label: "Custom…", description: "Any OpenAI-compatible endpoint" },
        ]}
        onSelect={(o) =>
          o.label === "Custom…" ? advance("customName") : afterProvider(o.label)
        }
        onCancel={onCancel}
      />
    );
  }

  if (step === "validating") {
    return (
      <Box>
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
        <Text color="gray"> Validating connection…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{PROMPTS[step]}</Text>
      <Box>
        <Text color="cyan">{"› "}</Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={submit}
          mask={step === "apiKey" ? "*" : undefined}
          placeholder={step === "context" ? "128000" : ""}
        />
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
      <Text dimColor>Esc to cancel</Text>
    </Box>
  );
}
