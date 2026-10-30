import fs from "fs/promises";
import path from "path";

export type Suggestion = { label: string; hint: string; value: string };

export const COMMANDS: { name: string; description: string; hidden?: boolean }[] = [
  { name: "/model", description: "switch the active model" },
  { name: "/config", description: "add a model / provider" },
  { name: "/resume", description: "continue a previous session", hidden: true },
  { name: "/new", description: "start a fresh session" },
  { name: "/memory", description: "show saved project notes" },
  { name: "/skills", description: "list installed skills" },
  { name: "/mcp", description: "show connected MCP servers" },
  { name: "/help", description: "show this help" },
  { name: "/exit", description: "quit" },
];

const IGNORED = new Set(["node_modules", ".git", "dist"]);
const MAX_SUGGESTIONS = 8;

export function commandSuggestions(input: string): Suggestion[] {
  if (!input.startsWith("/") || /\s/.test(input)) return [];
  return COMMANDS.filter((c) => !c.hidden && c.name.startsWith(input.toLowerCase())).map((c) => ({
    label: c.name,
    hint: c.description,
    value: c.name + " ",
  }));
}

export const FILE_TOKEN = /(^|\s)@([^\s]*)$/;

export async function fileSuggestions(input: string): Promise<Suggestion[]> {
  const match = FILE_TOKEN.exec(input);
  if (!match) return [];

  const typed = match[2];
  const slash = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
  const dirPart = slash >= 0 ? typed.slice(0, slash + 1) : "";
  const prefix = typed.slice(slash + 1).toLowerCase();

  let entries;
  try {
    entries = await fs.readdir(path.resolve(dirPart || "."), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((e) => !IGNORED.has(e.name))
    .filter((e) => e.name.toLowerCase().startsWith(prefix))
    .filter((e) => prefix.startsWith(".") || !e.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
    .map((e) => {
      const name = dirPart + e.name + (e.isDirectory() ? "/" : "");
      return {
        label: name,
        hint: e.isDirectory() ? "directory" : "file",
        value: input.slice(0, match.index + match[1].length) + "@" + name + (e.isDirectory() ? "" : " "),
      };
    });
}
