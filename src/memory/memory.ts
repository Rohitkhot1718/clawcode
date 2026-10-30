import fs from "fs/promises";
import { readFileSync } from "fs";
import path from "path";
import os from "os";

const MAX_NOTE_LENGTH = 300;
const MAX_NOTES = 50;

function memoryPath(): string {
  return path.join(
    os.homedir(),
    ".clawcode",
    "projects",
    path.basename(process.cwd()),
    "memory.md",
  );
}

export function loadMemorySync(): string {
  try {
    return readFileSync(memoryPath(), "utf-8");
  } catch {
    return "";
  }
}

function parseNotes(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

export async function saveMemoryNote(note: string, replaces?: string) {
  const file = memoryPath();
  await fs.mkdir(path.dirname(file), { recursive: true });

  const clean = note.trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) throw new Error("Note is empty.");

  let notes = parseNotes(loadMemorySync());
  if (replaces) notes = notes.filter((n) => n !== replaces.trim());

  if (!notes.includes(clean)) {
    if (notes.length >= MAX_NOTES) {
      throw new Error(
        `Memory is full (${MAX_NOTES} notes max). Call saveMemoryNote with \`replaces\` set to the note being merged or dropped.`,
      );
    }
    notes.push(clean);
  }

  await fs.writeFile(file, notes.map((n) => `- ${n}`).join("\n") + "\n");
}
