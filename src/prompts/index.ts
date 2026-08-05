import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";
import { loadMemory } from "../memory/memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system.md");
const SUMMARY_PROMPT_PATH = path.join(__dirname, "summary.md");

export async function buildSystemPrompt(): Promise<string> {
  const template = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");
  const memory = (await loadMemory()).trim();

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
    .replace("{{MEMORY}}", memory || "(no saved memory for this project yet)");
}

export async function buildSummaryPrompt(): Promise<string> {
  return await fs.readFile(SUMMARY_PROMPT_PATH, "utf-8");
}
