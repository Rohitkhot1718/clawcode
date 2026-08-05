import fs from "fs/promises";
import path from "path";
import os from "os";

function getMemoryPath(): string {
  const projectName = path.basename(process.cwd());
  return path.join(
    os.homedir(),
    ".clawcode",
    "projects",
    projectName,
    "memory.md",
  );
}

export async function loadMemory(): Promise<string> {
  try {
    return await fs.readFile(getMemoryPath(), "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return "";
    throw err;
  }
}

function parseNotes(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

const MAX_NOTE_LENGTH = 300;
const MAX_NOTES = 50;

export async function saveMemoryNote(
  note: string,
  replaces?: string,
): Promise<void> {
  const memoryPath = getMemoryPath();
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });

  const cleanNote = note.trim().slice(0, MAX_NOTE_LENGTH);
  const existing = parseNotes(await loadMemory());

  let notes = existing;
  if (replaces) {
    const target = replaces.trim();
    notes = existing.filter((n) => n !== target);
  }

  if (!notes.includes(cleanNote)) {
    if (notes.length >= MAX_NOTES) {
      throw new Error(
        `Memory is full (${MAX_NOTES} notes max). Merge or replace an existing note instead of adding a new one — call saveMemoryNote with \`replaces\` set to the note being consolidated.`,
      );
    }
    notes = [...notes, cleanNote];
  }

  const content = notes.map((n) => `- ${n}`).join("\n") + "\n";
  await fs.writeFile(memoryPath, content);
}
