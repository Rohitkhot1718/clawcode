import os from "os";
import path from "path";
import fs from "fs/promises";

const SKILLS_DIR = path.join(os.homedir(), ".clawcode", "skills");

export interface SkillInfo {
  path: string;
  name: string;
  description: string;
}

function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = content.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const meta: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) meta.name = nameMatch[1].trim();
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) meta.description = descMatch[1].trim();
  }
  return meta;
}

const MAX_DESCRIPTION_LENGTH = 200;

function truncateDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) return description;
  const slice = description.slice(0, MAX_DESCRIPTION_LENGTH - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const clipped = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return clipped.trimEnd() + "…";
}

async function loadOne(skillPath: string, fallbackName: string): Promise<SkillInfo> {
  let name = fallbackName;
  let description = "(no description in frontmatter — read the file to see what it covers)";

  try {
    const content = await fs.readFile(skillPath, "utf-8");
    const meta = parseFrontmatter(content);
    if (meta.name) name = meta.name;
    if (meta.description) description = truncateDescription(meta.description);
  } catch {
    // Unreadable file — fall back to the filename-derived entry rather
    // than dropping it silently.
  }

  return { path: skillPath, name, description };
}

async function loadSkillsDir(): Promise<SkillInfo[]> {
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });

    const skills = await Promise.all(
      entries.map(async (entry): Promise<SkillInfo | null> => {
        if (entry.isDirectory()) {
          const skillMdPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
          try {
            await fs.access(skillMdPath);
          } catch {
            return null;
          }
          return loadOne(skillMdPath, entry.name);
        }
        // Flat <name>.md file, directly in the skills dir.
        return loadOne(path.join(SKILLS_DIR, entry.name), entry.name);
      }),
    );

    return skills.filter((s): s is SkillInfo => s !== null);
  } catch (error) {
    console.error("Error loading skills:", error);
    return [];
  }
}

async function getSkill(skillPath: string) {
  try {
    const skillContent = await fs.readFile(skillPath, "utf-8");
    return skillContent;
  } catch (error) {
    console.error(`Error reading skill at ${skillPath}:`, error);
    return null;
  }
}

export { loadSkillsDir, getSkill };
