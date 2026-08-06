import chalk from "chalk";
import fs from "node:fs/promises";
import path from "node:path";
import { prompt } from "../utils/enquirerPrompt.js";

export type PermissionDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

// Project-local persisted approvals, like Claude Code's .claude/settings.local.json.
const SETTINGS_DIR = ".clawcode";
const SETTINGS_FILE = "settings.json";

// Tools that only observe state — never prompt for these.
export const READ_ONLY_TOOLS = new Set([
  "readFile",
  "listDirectory",
  "grep",
  "getLineCount",
  "readProcessOutput",
  "webSearch",
]);

const AUTO_ALLOW_TOOLS = new Set([
  "createFile",
  "editFile",
  "stopProcess",
  "saveMemoryNote",
]);

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /(^|[\s&|;])(del|erase|rd|rmdir|rm)(\.exe)?(\s|$)/i,
  /remove-item/i,
  /(^|[\s&|;])format(\s|$)/i,
  /(^|[\s&|;])(taskkill|shutdown|logoff)(\s|$)/i,
  /reg\s+delete/i,
  /git\s+(reset\s+--hard|clean\b|push\b[^\n]*--force|push\s+-f\b|checkout\s+--\s)/i,
  /(^|[\s&|;])(mkfs|dd)(\s|$)/i,
];


const CAUTION_PATTERNS: RegExp[] = [
  /(^|[\s&|;])(npm|pnpm|yarn|bun)\s+(i|install|add|remove|un|uninstall|update|upgrade|link|publish)\b/i,
  /(^|[\s&|;])pip3?\s+(install|uninstall)\b/i,
  /(^|[\s&|;])(choco|winget|scoop|apt|apt-get|brew)\s/i,
  /(^|[\s&|;])npx\s/i,
  /git\s+push\b/i,
  /(^|[\s&|;])(setx|reg\s+add)\b/i,
  /(^|[\s&|;])(curl|wget|iwr|invoke-webrequest)\b/i,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}

export function isCautionCommand(command: string): boolean {
  return CAUTION_PATTERNS.some((p) => p.test(command));
}

function chainSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}


function commandPrefix(command: string): string {
  const segments = chainSegments(command);
  const interesting =
    segments.find((s) => CAUTION_PATTERNS.some((p) => p.test(s))) ??
    segments.find((s) => !/^cd(\s|$)/i.test(s)) ??
    segments[0] ??
    command;
  return interesting.trim().split(/\s+/).slice(0, 2).join(" ");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

const DELETE_VERB = /^(del|erase|rd|rmdir|rm|remove-item)(\.exe)?$/i;

function extractDeleteTargets(command: string): string[] | null {
  const targets: string[] = [];
  for (const seg of chainSegments(command)) {
    const tokens = seg
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => t.replace(/^["']|["']$/g, ""));
    const [head, ...rest] = tokens;
    if (!head) continue;
    if (DELETE_VERB.test(head)) {
      const files = rest.filter((t) => !/^[-/]/.test(t));
      if (files.length === 0) return null;
      targets.push(...files);
    } else if (isDestructiveCommand(seg)) {
      return null;
    }
  }
  return targets.length > 0 ? targets : null;
}

function isInsideProject(target: string): boolean {
  const rel = path.relative(process.cwd(), path.resolve(target));
  // rel === "" would be the project root itself — never auto-delete that.
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export class PermissionManager {
  private readonly allowedTools = new Set<string>();
  private readonly allowedCommandPrefixes = new Set<string>();
  private readonly createdThisSession = new Set<string>();
  private userRequest = "";
  private settingsLoaded = false;

  // Called at the start of each user turn so deletion checks can tell
  // "the user asked for this" apart from "the model decided on its own".
  setUserRequest(text: string): void {
    this.userRequest = String(text || "").toLowerCase();
  }

  // Called after the agent successfully creates a file: things it made this
  // session are its own to clean up without asking.
  markCreated(filePath: string): void {
    this.createdThisSession.add(path.resolve(filePath).toLowerCase());
  }

  private wasCreatedThisSession(target: string): boolean {
    return this.createdThisSession.has(path.resolve(target).toLowerCase());
  }

  // True when the current user message names the target, e.g. "delete
  // note.txt" or "remove the note file" for a target of note.txt. Matches
  // the basename (with or without extension) as a whole word.
  private userNamedTarget(target: string): boolean {
    if (!this.userRequest) return false;
    const base = path.basename(path.resolve(target)).toLowerCase();
    const noExt = base.replace(/\.[^.]+$/, "");
    const asWord = (s: string) =>
      new RegExp(`(^|[^a-z0-9_-])${escapeRegex(s)}([^a-z0-9_-]|$)`).test(
        this.userRequest,
      );
    if (asWord(base)) return true;
    // Guard short stems ("a", "db") from matching everywhere.
    return noExt.length >= 3 && noExt !== base && asWord(noExt);
  }

  private settingsPath(): string {
    return path.join(process.cwd(), SETTINGS_DIR, SETTINGS_FILE);
  }

  // Loads persisted approvals once per process. A missing or malformed
  // settings file simply means nothing is pre-approved.
  private async loadSettings(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const raw = await fs.readFile(this.settingsPath(), "utf-8");
      const permissions = JSON.parse(raw)?.permissions ?? {};
      for (const tool of permissions.allowTools ?? []) {
        this.allowedTools.add(String(tool));
      }
      for (const cmd of permissions.allowCommands ?? []) {
        this.allowedCommandPrefixes.add(String(cmd));
      }
    } catch {
      // no settings file yet
    }
  }

  private async persist(kind: "tool" | "command", value: string): Promise<void> {
    const file = this.settingsPath();
    let settings: any = {};
    try {
      settings = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch {
      // starting fresh
    }
    const permissions = settings.permissions ?? {};
    const key = kind === "tool" ? "allowTools" : "allowCommands";
    const list: string[] = Array.isArray(permissions[key])
      ? permissions[key]
      : [];
    if (!list.includes(value)) list.push(value);
    permissions[key] = list;
    settings.permissions = permissions;

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + "\n");
  }

  async check(
    toolName: string,
    args: any,
    label: string,
  ): Promise<PermissionDecision> {
    if (READ_ONLY_TOOLS.has(toolName)) return { behavior: "allow" };
    if (AUTO_ALLOW_TOOLS.has(toolName)) return { behavior: "allow" };

    // Plain GET/HEAD fetches only observe; other methods mutate remote state.
    if (toolName === "fetchURL") {
      const method = (args.method || "GET").toUpperCase();
      if (method === "GET" || method === "HEAD") return { behavior: "allow" };
    }

    await this.loadSettings();

    if (toolName === "runCommand" || toolName === "startBackground") {
      return this.checkCommand(toolName, String(args.command || ""), label);
    }

    // Anything else (e.g. fetchURL POST/PUT/DELETE, future tools).
    if (this.allowedTools.has(toolName)) return { behavior: "allow" };
    return this.ask(toolName, label, {
      isCommandTool: false,
      command: "",
      destructive: false,
    });
  }

  private async checkCommand(
    toolName: string,
    command: string,
    label: string,
  ): Promise<PermissionDecision> {
    if (isDestructiveCommand(command)) {
      // Plain deletes run without a prompt when every target is inside the
      // project AND was either named by the user in the current request or
      // created by the agent this session. Anything else destructive asks.
      const targets = extractDeleteTargets(command);
      const approved =
        !!targets &&
        targets.every(
          (t) =>
            isInsideProject(t) &&
            (this.userNamedTarget(t) || this.wasCreatedThisSession(t)),
        );
      if (approved) return { behavior: "allow" };

      return this.ask(toolName, label, {
        isCommandTool: true,
        command,
        destructive: true,
      });
    }
    // Ordinary local commands (tests, builds, git status...) are normal
    // task work; only installs/publishes/downloads need a nod.
    if (!isCautionCommand(command)) return { behavior: "allow" };
    if (this.allowedCommandPrefixes.has(commandPrefix(command))) {
      return { behavior: "allow" };
    }
    return this.ask(toolName, label, {
      isCommandTool: true,
      command,
      destructive: false,
    });
  }

  private async ask(
    toolName: string,
    label: string,
    opts: { isCommandTool: boolean; command: string; destructive: boolean },
  ): Promise<PermissionDecision> {
    const icon = opts.destructive ? chalk.red("⚠") : chalk.yellow("●");
    console.log(`\n${icon} Clawcode wants to run:`);
    console.log(`   ${chalk.bold(label)}`);
    if (opts.destructive) {
      console.log(chalk.red("   This action may delete or modify data."));
    }

    const target = opts.isCommandTool
      ? `"${commandPrefix(opts.command)}"`
      : toolName;
    const REMEMBER_KEY = `Yes, don't ask again for ${target}`;

    const choices = opts.destructive
      ? ["Yes", "No, tell Clawcode what to do instead"]
      : ["Yes", REMEMBER_KEY, "No, tell Clawcode what to do instead"];

    const res: any = await prompt({
      type: "select",
      name: "choice",
      message: "Allow this action?",
      choices,
    });

    const choice = res?.choice;

    if (choice === "Yes") return { behavior: "allow" };

    if (choice === REMEMBER_KEY) {
      await this.remember(toolName, opts);
      return { behavior: "allow" };
    }

    // "No" or the prompt was cancelled (Ctrl+C / non-interactive stdin).
    return {
      behavior: "deny",
      message: `The user declined permission for: ${label}. Do NOT retry this action. Explain briefly what you intended and ask the user how they would like to proceed.`,
    };
  }

  // "Don't ask again" allows for this session AND saves to the settings
  // file so it stays approved in future sessions.
  private async remember(
    toolName: string,
    opts: { isCommandTool: boolean; command: string },
  ): Promise<void> {
    const value = opts.isCommandTool
      ? commandPrefix(opts.command)
      : toolName;

    if (opts.isCommandTool) {
      this.allowedCommandPrefixes.add(value);
    } else {
      this.allowedTools.add(value);
    }

    try {
      await this.persist(opts.isCommandTool ? "command" : "tool", value);
    } catch (err: any) {
      console.log(
        chalk.yellow(
          `Could not save to ${SETTINGS_DIR}/${SETTINGS_FILE}: ${err?.message}. Allowed for this session only.`,
        ),
      );
    }
  }
}

export const permissions = new PermissionManager();
