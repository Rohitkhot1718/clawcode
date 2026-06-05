import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system.md");
const SUMMARY_PROMPT_PATH = path.join(__dirname, "summary.md");

export async function buildSystemPrompt(): Promise<string> {
  const template = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");

  return template
    .replace(
      "{{OS}}",
      process.platform === "win32" ? "Windows" : process.platform,
    )
    .replace("{{CWD}}", process.cwd())
    .replace(
      "{{SHELL}}",
      process.platform === "win32" ? "cmd/powershell" : "bash",
    );
}

export async function buildSummaryPrompt(): Promise<string> {
  return await fs.readFile(SUMMARY_PROMPT_PATH, "utf-8");
}
