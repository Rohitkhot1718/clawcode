import { readdirSync, readFileSync, existsSync } from "fs";
import os from "os";
import path from "path";

const SKILLS_DIR = path.join(os.homedir(), ".clawcode", "skills");
const MAX_DESCRIPTION_LENGTH = 200;

export type SkillInfo = { name: string; description: string; path: string };

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const meta: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const name = line.match(/^name:\s*(.+)$/);
    if (name) meta.name = name[1].trim();
    const description = line.match(/^description:\s*(.+)$/);
    if (description) meta.description = description[1].trim();
  }
  return meta;
}

function clip(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  const slice = description.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const space = slice.lastIndexOf(" ");
  return (space > 0 ? slice.slice(0, space) : slice).trimEnd() + "…";
}

function loadOne(skillPath: string, fallbackName: string): SkillInfo {
  let name = fallbackName;
  let description = "(no description in frontmatter, read the file to see what it covers)";
  try {
    const meta = parseFrontmatter(readFileSync(skillPath, "utf-8"));
    if (meta.name) name = meta.name;
    if (meta.description) description = clip(meta.description);
  } catch {}
  return { name, description, path: skillPath };
}

export function loadSkills(): SkillInfo[] {
  try {
    const skills: SkillInfo[] = [];
    for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const file = path.join(SKILLS_DIR, entry.name, "SKILL.md");
        if (existsSync(file)) skills.push(loadOne(file, entry.name));
      } else if (entry.name.endsWith(".md")) {
        skills.push(loadOne(path.join(SKILLS_DIR, entry.name), entry.name));
      }
    }
    return skills;
  } catch {
    return [];
  }
}
