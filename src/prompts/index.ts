import { readFileSync } from "fs";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import os from "os";
import path from "path";
import { loadMemorySync } from "../memory/memory";
import { loadSkills } from "../skills/index";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = readFileSync(path.join(__dirname, "system.md"), "utf-8");

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 3000,
  });
}

function gitInfo(): string {
  try {
    const branch = git(["branch", "--show-current"]).trim() || "(detached HEAD)";
    const changes = git(["status", "--porcelain"]).split("\n").filter((l) => l.trim()).length;
    return `${branch}, ${changes === 0 ? "clean" : `${changes} uncommitted change(s)`}`;
  } catch {
    return "not a git repo";
  }
}

function environment(): string {
  const windows = process.platform === "win32";
  return [
    `- Operating system: ${windows ? "Windows" : process.platform}`,
    `- Current working directory: ${process.cwd()}`,
    `- Home directory: ${os.homedir()}`,
    `- Today's date: ${new Date().toISOString().slice(0, 10)}`,
    `- Node: ${process.version}`,
    `- Git: ${gitInfo()} (snapshot from session start)`,
    windows
      ? "- Commands run on Windows. Use Windows flags and tools (e.g. `ping -n 4 host`, not `-c`). Prefer powerShell for native Windows commands; bash is Git Bash but still calls Windows executables like ping.exe."
      : "- Commands run on a POSIX system.",
  ].join("\n");
}

export function buildSystemPrompt(): string {
  const skills = loadSkills()
    .map((s) => `- **${s.name}**: ${s.description} (path: ${s.path})`)
    .join("\n");

  return TEMPLATE.replace("{{ENVIRONMENT}}", environment())
    .replace("{{MEMORY}}", loadMemorySync().trim() || "(no saved memory for this project yet)")
    .replace("{{SKILLS}}", skills || "(no skills installed)");
}
