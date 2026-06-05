import chalk from "chalk";
import figlet from "figlet";

export interface BannerModel {
  name?: string;
  provider?: string;
  contextLimit?: number;
}

export function printBanner(model?: BannerModel | null): void {
  const art = figlet.textSync("Clawcode", { font: "ANSI Shadow" });
  console.log(chalk.cyan(art));
  console.log(chalk.gray("AI coding agent in your terminal  🦀\n"));
  console.log(modelLine(model));
  console.log(chalk.gray("  Type /help for commands\n"));
}

// A single line describing the active model — reused after /model and /config.
export function modelLine(model?: BannerModel | null): string {
  if (!model?.name) {
    return chalk.yellow("  ⚠ No model configured — run /config to add one");
  }

  const parts = [chalk.gray("  Model: "), chalk.greenBright(model.name)];
  if (model.provider) parts.push(chalk.gray(`  ·  ${model.provider}`));
  if (model.contextLimit) {
    parts.push(chalk.gray(`  ·  ${formatTokens(model.contextLimit)} ctx`));
  }
  return parts.join("");
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
