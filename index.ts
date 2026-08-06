#!/usr/bin/env node
import { agent } from "./src/agent/loop.js";
import dotenv from "dotenv";
import chalk from "chalk";
import { checkConfig, switchModel, configWizard } from "./src/cli/setup.js";
import { getModel, loadConfig } from "./src/config/index.js";
import { program } from "./src/cli/index.js";
import { printBanner, modelLine } from "./src/cli/banner.js";
import { askInput } from "./src/cli/input.js";
import {
  loadSession,
  loadSessionMeta,
  listSessions,
  printSession,
} from "./src/session/session.js";
import { prompt, clearLine } from "./src/utils/enquirerPrompt.js";

dotenv.config();

async function getActiveModel(): Promise<any | null> {
  try {
    return await getModel();
  } catch {
    return null;
  }
}

function formatRelativeTime(iso: string): string {
  if (!iso) return "unknown date";
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const units: [number, string][] = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, label] of units) {
    const n = Math.floor(diffSec / secs);
    if (n > 0) return `${n} ${label}${n > 1 ? "s" : ""} ago`;
  }
  return "just now";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function getSessionBannerModel(sessionId: string): Promise<any | null> {
  const meta = await loadSessionMeta(sessionId);
  if (!meta) return getActiveModel();

  const config = await loadConfig();
  const matched = config?.models?.find(
    (m: any) => m.id === meta.model && m.provider === meta.provider,
  );

  return matched ?? { name: meta.model, provider: meta.provider };
}

async function runWithInterrupt<T>(task: () => Promise<T>): Promise<T> {
  const stdin = process.stdin;
  const isTTY = Boolean(stdin.isTTY);
  const wasRaw = stdin.isRaw;

  if (isTTY) stdin.setRawMode(true);

  const onKeypress = (_str: string, key: any) => {
    if (key?.ctrl && key?.name === "c") {
      if (isTTY) stdin.setRawMode(wasRaw ?? false);
      process.exit(0);
    }
    if (key?.name === "escape") {
      agent.interrupt();
    }
  };

  if (isTTY) stdin.on("keypress", onKeypress);

  try {
    return await task();
  } finally {
    if (isTTY) {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(wasRaw ?? false);
    }
  }
}

async function startREPL() {
  while (true) {
    const input = (await askInput()).trim();
    if (!input) continue;

    try {
      if (input === "/exit") {
        const sessionId = agent.getSessionId();
        if (sessionId) {
          console.log(chalk.gray("Resume this session with:"));
          console.log(chalk.gray(`clawcode --resume ${sessionId}`));
        }
        process.exit(0);
      }

      if (input === "/model") {
        await switchModel();
        const selected = await getActiveModel();
        if (selected) {
          await agent.recordModelChoice(selected.provider, selected.model);
        }
        continue;
      }

      if (input === "/config") {
        await configWizard();
        console.log(modelLine(await getActiveModel()) + "\n");
        continue;
      }

      if (input === "/help") {
        console.log(modelLine(await getActiveModel()));
        console.log(
          chalk.gray(
            "\n  /config → add new model   /model → switch model\n  /exit   → quit            /help  → show commands\n  Esc     → stop the current response/tool call\n",
          ),
        );
        continue;
      }

      const selectedModel: any = await getModel();
      await runWithInterrupt(() =>
        agent.run(
          input,
          selectedModel.provider,
          selectedModel.model,
          selectedModel.contextLimit,
        ),
      );
      console.log();
    } catch (err: any) {
      console.error(chalk.red("Error:"), err?.message || err);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  const resumeIdx = args.indexOf("--resume");
  if (resumeIdx !== -1) {
    let sessionId = args[resumeIdx + 1];
    if (!sessionId || sessionId.startsWith("--")) {
      const sessions = await listSessions();
      if (sessions.length === 0) {
        console.log(chalk.yellow("No saved sessions found."));
        return;
      }

      const res: any = await prompt({
        type: "select",
        name: "sessionId",
        message: "Select a session to resume",
        choices: sessions.map((s) => ({
          name: s.id,
          message: `${s.name || "(untitled)"}  ${chalk.gray(`· ${formatRelativeTime(s.createdAt)} · ${formatFileSize(s.sizeBytes)}`)}`,
        })),
      });

      if (!res) return;
      sessionId = res.sessionId;
      clearLine();
    }

    const messages = await loadSession(sessionId);
    if (messages.length === 0) {
      console.error(chalk.red(`No session found for "${sessionId}"`));
      process.exit(1);
    }

    await checkConfig();
    printBanner(await getSessionBannerModel(sessionId));

    await printSession(sessionId);
    await agent.resumeFrom(sessionId, messages);
    await startREPL();
    return;
  }

  if (args.length > 0) {
    await program.parseAsync(process.argv);
    return;
  }

  await checkConfig();

  printBanner(await getActiveModel());

  await startREPL();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
