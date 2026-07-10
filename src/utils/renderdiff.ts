import { diffLines } from "diff";
import chalk from "chalk";

export function renderDiff(
  oldText: string,
  newText: string,
  maxLines = Infinity,
): string {
  const diff = diffLines(oldText ?? "", newText ?? "");
  const lines: string[] = [];
  let added = 0;
  let removed = 0;

  for (const part of diff) {
    let prefix = "  ";
    let color: ((s: string) => string) | null = null;
    if (part.added) {
      prefix = "+ ";
      color = chalk.green;
    } else if (part.removed) {
      prefix = "- ";
      color = chalk.red;
    }
    for (const line of part.value.replace(/\n$/, "").split("\n")) {
      if (part.added) added++;
      else if (part.removed) removed++;
      const text = prefix + line;
      lines.push(color ? color(text) : text);
    }
  }

  if (added === 0 && removed === 0) return chalk.gray("(no visible change)");

  const header = chalk.gray.bold(`Diff (${chalk.green(`+${added}`)}${chalk.gray("/")}${chalk.red(`-${removed}`)}):`);

  if (lines.length > maxLines) {
    const hidden = lines.length - maxLines;
    return (
      `${header}\n` +
      lines.slice(0, maxLines).join("\n") +
      chalk.gray(`\n… +${hidden} more lines`)
    );
  }
  return `${header}\n${lines.join("\n")}`;
}
