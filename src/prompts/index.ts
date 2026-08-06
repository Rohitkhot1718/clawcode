import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { loadMemory } from "../memory/memory.js";
import { loadConfig } from "../config/index.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system.md");
const SUMMARY_PROMPT_PATH = path.join(__dirname, "summary.md");

async function getGitInfo(): Promise<string> {
  try {
    const { stdout: branch } = await execFileAsync("git", [
      "branch",
      "--show-current",
    ]);
    const { stdout: status } = await execFileAsync("git", [
      "status",
      "--porcelain",
    ]);
    const changeCount = status.split("\n").filter((l) => l.trim()).length;
    const state = changeCount === 0 ? "clean" : `${changeCount} uncommitted change(s)`;
    return `${branch.trim() || "(detached HEAD)"}, ${state}`;
  } catch {
    return "not a git repo";
  }
}

async function getConfiguredModelsList(): Promise<string> {
  try {
    const config: any = await loadConfig();
    const models: any[] = config?.models ?? [];
    if (models.length === 0) return "(none configured — run `clawcode add-model`)";
    return models
      .map(
        (m) =>
          `${m.name} (${m.provider}${m.id === config.default ? ", default" : ""})`,
      )
      .join(", ");
  } catch {
    return "(none configured — run `clawcode add-model`)";
  }
}

export async function buildSystemPrompt(
  provider: string,
  model: string,
): Promise<string> {
  const template = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");
  const memory = (await loadMemory()).trim();
  const gitInfo = await getGitInfo();
  const modelsList = await getConfiguredModelsList();

  return template
    .replace(
      "{{OS}}",
      process.platform === "win32" ? "Windows" : process.platform,
    )
    .replace("{{CWD}}", process.cwd())
    .replace(
      "{{SHELL}}",
      process.platform === "win32" ? "cmd/powershell" : "bash",
    )
    .replace("{{DATE}}", new Date().toISOString())
    .replace("{{MODEL}}", `${model} (via ${provider})`)
    .replace("{{HOME}}", os.homedir())
    .replace("{{NODE_VERSION}}", process.version)
    .replace("{{GIT}}", gitInfo)
    .replace("{{CONFIGURED_MODELS}}", modelsList)
    .replace("{{MEMORY}}", memory || "(no saved memory for this project yet)");
}

export async function buildSummaryPrompt(): Promise<string> {
  return await fs.readFile(SUMMARY_PROMPT_PATH, "utf-8");
}
