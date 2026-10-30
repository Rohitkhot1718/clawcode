import fs from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export type SessionMeta = {
  provider: string;
  model: string;
  createdAt: string;
  name?: string;
};

export type SessionSummary = {
  id: string;
  createdAt: string;
  provider?: string;
  model?: string;
  name: string;
};

function sessionDir(): string {
  return path.join(
    os.homedir(),
    ".clawcode",
    "projects",
    path.basename(process.cwd()),
    "sessions",
  );
}

function sessionFile(id: string): string {
  return path.join(sessionDir(), `${id}.jsonl`);
}

async function append(id: string, data: unknown) {
  await fs.mkdir(sessionDir(), { recursive: true });
  await fs.writeFile(sessionFile(id), JSON.stringify(data) + "\n", {
    flag: "a",
  });
}

async function readLines(id: string): Promise<any[]> {
  let data: string;
  try {
    data = await fs.readFile(sessionFile(id), "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const entries: any[] = [];
  for (const line of data.split("\n")) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

export function deriveSessionName(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
}

export async function loadSession(
  id: string,
): Promise<{ messages: any[]; meta: SessionMeta | null } | null> {
  const lines = await readLines(id);
  if (lines.length === 0) return null;
  return {
    messages: lines.filter((e) => e.type !== "meta"),
    meta: lines.filter((e) => e.type === "meta").at(-1) ?? null,
  };
}

export async function listSessions(): Promise<SessionSummary[]> {
  let files: string[];
  try {
    files = await fs.readdir(sessionDir());
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    files
      .filter((f) => f.endsWith(".jsonl"))
      .map(async (f): Promise<SessionSummary | null> => {
        const id = f.replace(/\.jsonl$/, "");
        const lines = await readLines(id);
        if (lines.length === 0) return null;

        const metas = lines.filter((e) => e.type === "meta");
        const firstUser = lines.find(
          (e) => e.role === "user" && typeof e.content === "string",
        );
        const stat = await fs.stat(sessionFile(id));

        return {
          id,
          createdAt: metas[0]?.createdAt ?? stat.birthtime.toISOString(),
          provider: metas.at(-1)?.provider,
          model: metas.at(-1)?.model,
          name:
            [...metas].reverse().find((m) => m.name)?.name ??
            deriveSessionName(firstUser?.content ?? "(empty)"),
        };
      }),
  );

  return summaries
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveTitle(
  id: string,
  meta: { provider: string; model: string; createdAt: string },
  name: string,
) {
  await append(id, { type: "meta", ...meta, name });
}

export class SessionTracker {
  id = "";
  createdAt = "";
  private titleRequest: { id: string; text: string } | null = null;
  private saved = 0;
  private lastModel = "";
  private queue: Promise<void> = Promise.resolve();

  attach(id: string, createdAt: string, savedCount: number, modelKey: string) {
    this.id = id;
    this.createdAt = createdAt;
    this.saved = savedCount;
    this.lastModel = modelKey;
  }

  takeTitleRequest() {
    const request = this.titleRequest;
    this.titleRequest = null;
    return request;
  }

  skipTo(count: number) {
    this.saved = count;
  }

  reset() {
    this.titleRequest = null;
    this.attach("", "", 0, "");
  }

  persist(messages: any[], model: { provider: string; model: string }) {
    const fresh = messages
      .slice(this.saved)
      .filter((m) => m.role !== "system");
    this.saved = messages.length;
    if (fresh.length === 0) return this.queue;

    const firstUserText = fresh.find(
      (m) => m.role === "user" && typeof m.content === "string",
    )?.content;
    if (!this.id) {
      this.id = crypto.randomUUID();
      this.createdAt = new Date().toISOString();
      if (firstUserText) this.titleRequest = { id: this.id, text: firstUserText };
    }
    const id = this.id;
    const createdAt = this.createdAt;
    const modelKey = `${model.provider}/${model.model}`;
    const writeMeta = modelKey !== this.lastModel;
    const isFirst = this.lastModel === "";
    this.lastModel = modelKey;

    const firstUser = fresh.find(
      (m) => m.role === "user" && typeof m.content === "string",
    );

    this.queue = this.queue
      .then(async () => {
        if (writeMeta) {
          await append(id, {
            type: "meta",
            provider: model.provider,
            model: model.model,
            createdAt,
            ...(isFirst && firstUser
              ? { name: deriveSessionName(firstUser.content) }
              : {}),
          });
        }
        for (const m of fresh) await append(id, m);
      })
      .catch(() => {});
    return this.queue;
  }
}
