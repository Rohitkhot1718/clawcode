import fs from "fs/promises";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = path.join(__dirname, "system.md");
const SUMMARY_PROMPT_PATH = path.join(__dirname, "summary.md");

const SKIP_DIRS = [
  "node_modules",
  ".git",
  "dist",
  ".next",
  "__pycache__",
  ".vscode",
];

async function buildProjectTree(
  dir: string,
  indent: string = "",
): Promise<string> {
  let result = "";

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue;

      if (entry.isDirectory()) {
        result += `${indent}- 📁 **${entry.name}/**\n`;
        result += await buildProjectTree(
          path.join(dir, entry.name),
          indent + "  ",
        );
      } else {
        result += `${indent}- 📄 ${entry.name}\n`;
      }
    }
  } catch {}

  return result;
}

export async function buildSystemPrompt(): Promise<string> {
  const template = await fs.readFile(SYSTEM_PROMPT_PATH, "utf-8");
  const tree = await buildProjectTree(process.cwd());
  const projectContext = `## Project Structure\n${tree || "Empty"}\n\n`;

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
    .replace("{{PROJECT_CONTEXT}}", projectContext);
}

export async function buildSummaryPrompt(): Promise<string> {
  return await fs.readFile(SUMMARY_PROMPT_PATH, "utf-8");
}
