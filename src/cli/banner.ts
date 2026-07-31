import chalk from "chalk";
import fs from "fs";
import os from "os";
import path from "path";

export interface BannerModel {
  name?: string;
  provider?: string;
  contextLimit?: number;
}

function getVersion(): string {
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(pkgUrl, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function formatDirectory(): string {
  const cwd = process.cwd();
  const home = os.homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(home + path.sep)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}

function box(lines: string[]): string {
  const width = Math.max(...lines.map((l) => stripAnsi(l).length)) + 2;
  const top = chalk.gray("╭" + "─".repeat(width) + "╮");
  const bottom = chalk.gray("╰" + "─".repeat(width) + "╯");
  const body = lines.map((l) => {
    if (l === "") return chalk.gray("│" + " ".repeat(width) + "│");
    const pad = width - 1 - stripAnsi(l).length;
    return chalk.gray("│ ") + l + " ".repeat(pad) + chalk.gray("│");
  });
  return [top, ...body, bottom].join("\n");
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function printBanner(model?: BannerModel | null): void {
  const title = `${chalk.gray(">_")} ${chalk.bold("Clawcode")} ${chalk.gray(`(v${getVersion()})`)}`;
  const directory = chalk.gray("directory:  ") + chalk.white(formatDirectory());
  console.log(box([title, "", modelLine(model), directory]));
  console.log();
  console.log(chalk.gray("Type /help for commands"));
  console.log();
}

// A single line describing the active model — reused after /model and /config.
export function modelLine(model?: BannerModel | null): string {
  if (!model?.name) {
    return chalk.yellow("⚠ No model configured — run /config to add one");
  }

  const parts = [chalk.gray("model:      "), chalk.greenBright(model.name)];
  if (model.provider) parts.push(chalk.gray(`  ·  ${model.provider}`));
  parts.push(chalk.gray("   /model to change"));
  return parts.join("");
}
