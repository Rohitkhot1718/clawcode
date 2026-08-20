import fs from "fs/promises";
import path from "path";
import os from "os";
import chalk from "chalk";
import { renderDiff } from "../utils/renderdiff.js";
import { describeToolCall } from "../agent/loop.js";

function getSessionDir(): string {
  const projectName = path.basename(process.cwd());
  return path.join(os.homedir(), ".clawcode", "projects", projectName, "sessions");
}

export async function saveSession(sessionId: string, data: any) {
  const sessionDir = getSessionDir();
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionFilePath = path.join(sessionDir, `${sessionId}.jsonl`);
  await fs.writeFile(sessionFilePath, JSON.stringify(data) + "\n", {
    flag: "a",
  });
}

export interface SessionMeta {
  provider: string;
  model: string;
  createdAt: string;
  name?: string;
}

export async function saveSessionMeta(sessionId: string, meta: SessionMeta) {
  const sessionDir = getSessionDir();
  await fs.mkdir(sessionDir, { recursive: true });
  const sessionFilePath = path.join(sessionDir, `${sessionId}.jsonl`);
  await fs.writeFile(
    sessionFilePath,
    JSON.stringify({ type: "meta", ...meta }) + "\n",
    { flag: "a" },
  );
}

export async function loadSessionMeta(
  sessionId: string,
): Promise<SessionMeta | null> {
  const lines = await readSessionLines(sessionId);
  const metaLines = lines.filter((entry) => entry.type === "meta");
  return metaLines.at(-1) ?? null;
}

export function deriveSessionName(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  return cleaned.length > 60 ? cleaned.slice(0, 60) + "…" : cleaned;
}

async function readSessionLines(sessionId: string): Promise<any[]> {
  const sessionFilePath = path.join(getSessionDir(), `${sessionId}.jsonl`);

  let data: string;
  try {
    data = await fs.readFile(sessionFilePath, "utf8");
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  return data.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export async function loadSession(sessionId: string): Promise<any[]> {
  const lines = await readSessionLines(sessionId);
  return lines.filter((entry) => entry.type !== "meta");
}

export interface SessionSummary {
  id: string;
  createdAt: string;
  provider?: string;
  model?: string;
  name: string;
  sizeBytes: number;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const sessionDir = getSessionDir();
  await fs.mkdir(sessionDir, { recursive: true });
  const files = await fs.readdir(sessionDir);
  const sessionIds = files
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => f.replace(/\.jsonl$/, ""));

  const summaries = await Promise.all(
    sessionIds.map(async (id): Promise<SessionSummary | null> => {
      const lines = await readSessionLines(id);
      if (lines.length === 0) return null;

      const metaLines = lines.filter((entry) => entry.type === "meta");
      const firstMeta = metaLines[0];
      const latestMeta = metaLines.at(-1);
      const firstUserMsg = lines.find(
        (entry) => entry.role === "user" && typeof entry.content === "string",
      );

      const stat = await fs.stat(path.join(sessionDir, `${id}.jsonl`));

      return {
        id,
        createdAt: firstMeta?.createdAt ?? "",
        provider: latestMeta?.provider,
        model: latestMeta?.model,
        name:
          latestMeta?.name ?? deriveSessionName(firstUserMsg?.content ?? ""),
        sizeBytes: stat.size,
      };
    }),
  );

  return summaries
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function printSession(sessionId: string) {
  const sessionData = await readSessionLines(sessionId);
  let lastMetaProvider: string | undefined;
  let lastMetaModel: string | undefined;

  sessionData.forEach((msg, i) => {
    if (msg.type === "meta") {
      const changed =
        i > 0 &&
        (msg.provider !== lastMetaProvider || msg.model !== lastMetaModel);
      if (changed) {
        console.log(
          chalk.yellow(`↻ Switched to ${msg.model} (${msg.provider})\n`),
        );
      }
      lastMetaProvider = msg.provider;
      lastMetaModel = msg.model;
      return;
    }

    if (msg.role === "user") {
      process.stdout.write(chalk.cyan("> ") + msg.content + "\n");
    }
    if (msg.role === "assistant") {
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        msg.tool_calls.forEach((toolCall: any) => {
          const args = JSON.parse(toolCall.function.arguments);

          if (args.previousStepContent) {
            console.log("\n" + chalk.white(args.previousStepContent));
          }

          const resultMsg = sessionData
            .slice(i + 1)
            .find(
              (m) => m.role === "tool" && m.tool_call_id === toolCall.id,
            );
          let parsedResult: any = null;
          try {
            parsedResult = resultMsg ? JSON.parse(resultMsg.content) : null;
          } catch {
            parsedResult = null;
          }
          const succeeded = parsedResult?.success !== false;

          process.stdout.write(
            (succeeded ? chalk.green("● ") : chalk.red("● ")) +
              chalk.gray(describeToolCall(toolCall.function.name, args)) +
              "\n",
          );

          if (succeeded && toolCall.function.name === "createFile") {
            console.log("\n" + renderDiff("", args.content, 20));
          }

          if (succeeded && toolCall.function.name === "editFile" && parsedResult?.diff) {
            console.log(
              "\n" +
                renderDiff(parsedResult.diff.old, parsedResult.diff.new, 20),
            );
          }
        });
      } else {
        process.stdout.write(msg.content + "\n");
      }
      console.log();
    }
  });
}

