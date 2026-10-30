import fs from "node:fs/promises";
import path from "node:path";
import { MCP_PREFIX } from "../mcp/index";

export type PermissionDecision =
  | { behavior: "allow" }
  | { behavior: "deny"; message: string };

export type PermissionRequest = {
  toolName: string;
  label: string;
  destructive: boolean;
  rememberLabel?: string;
};

export type PermissionChoice = "yes" | "always" | "no";

export type PermissionHandler = (
  request: PermissionRequest,
) => Promise<PermissionChoice>;

const SETTINGS_DIR = ".clawcode";
const SETTINGS_FILE = "settings.json";

const COMMAND_TOOLS = new Set(["bash", "powerShell"]);
const ALLOWED_TOOLS = new Set([
  "readFile",
  "glob",
  "grep",
  "writeFile",
  "editFile",
  "askUserQuestion",
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
    const tokens = (seg.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((t) =>
      t.replace(/^["']|["']$/g, ""),
    );
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
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export class PermissionManager {
  private readonly allowedCommandPrefixes = new Set<string>();
  private readonly allowedTools = new Set<string>();
  private readonly createdThisSession = new Set<string>();
  private userRequest = "";
  private settingsLoaded = false;
  private handler: PermissionHandler | null = null;

  setHandler(handler: PermissionHandler | null): void {
    this.handler = handler;
  }

  setUserRequest(text: string): void {
    this.userRequest = String(text || "").toLowerCase();
  }

  markCreated(filePath: string): void {
    this.createdThisSession.add(path.resolve(filePath).toLowerCase());
  }

  private wasCreatedThisSession(target: string): boolean {
    return this.createdThisSession.has(path.resolve(target).toLowerCase());
  }

  private userNamedTarget(target: string): boolean {
    if (!this.userRequest) return false;
    const base = path.basename(path.resolve(target)).toLowerCase();
    const noExt = base.replace(/\.[^.]+$/, "");
    const asWord = (s: string) =>
      new RegExp(`(^|[^a-z0-9_-])${escapeRegex(s)}([^a-z0-9_-]|$)`).test(
        this.userRequest,
      );
    if (asWord(base)) return true;
    return noExt.length >= 3 && noExt !== base && asWord(noExt);
  }

  private settingsPath(): string {
    return path.join(process.cwd(), SETTINGS_DIR, SETTINGS_FILE);
  }

  private async loadSettings(): Promise<void> {
    if (this.settingsLoaded) return;
    this.settingsLoaded = true;
    try {
      const raw = await fs.readFile(this.settingsPath(), "utf-8");
      const saved = JSON.parse(raw)?.permissions ?? {};
      for (const cmd of saved.allowCommands ?? []) {
        this.allowedCommandPrefixes.add(String(cmd));
      }
      for (const tool of saved.allowTools ?? []) {
        this.allowedTools.add(String(tool));
      }
    } catch {}
  }

  private async persist(value: string, kind: "allowCommands" | "allowTools"): Promise<void> {
    const file = this.settingsPath();
    let settings: any = {};
    try {
      settings = JSON.parse(await fs.readFile(file, "utf-8"));
    } catch {}
    const permissions = settings.permissions ?? {};
    const list: string[] = Array.isArray(permissions[kind]) ? permissions[kind] : [];
    if (!list.includes(value)) list.push(value);
    permissions[kind] = list;
    settings.permissions = permissions;

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(settings, null, 2) + "\n");
  }

  async check(toolName: string, args: any): Promise<PermissionDecision> {
    if (ALLOWED_TOOLS.has(toolName)) return { behavior: "allow" };
    if (toolName.startsWith(MCP_PREFIX)) {
      await this.loadSettings();
      if (this.allowedTools.has(toolName)) return { behavior: "allow" };
      const { message_to_user: _ignored, ...shown } = args ?? {};
      return this.ask(toolName, `${toolName} ${JSON.stringify(shown)}`, false, toolName);
    }
    if (!COMMAND_TOOLS.has(toolName)) return { behavior: "allow" };

    await this.loadSettings();
    const command = String(args?.command ?? "");

    if (isDestructiveCommand(command)) {
      const targets = extractDeleteTargets(command);
      const approved =
        !!targets &&
        targets.every(
          (t) =>
            isInsideProject(t) &&
            (this.userNamedTarget(t) || this.wasCreatedThisSession(t)),
        );
      if (approved) return { behavior: "allow" };
      return this.ask(toolName, command, true);
    }

    if (!isCautionCommand(command)) return { behavior: "allow" };
    if (this.allowedCommandPrefixes.has(commandPrefix(command))) {
      return { behavior: "allow" };
    }
    return this.ask(toolName, command, false);
  }

  private async ask(
    toolName: string,
    command: string,
    destructive: boolean,
    rememberTool?: string,
  ): Promise<PermissionDecision> {
    if (!this.handler) {
      return {
        behavior: "deny",
        message: `Permission required for: ${command}, but no prompt is available.`,
      };
    }

    const prefix = rememberTool ?? commandPrefix(command);
    const choice = await this.handler({
      toolName,
      label: command,
      destructive,
      rememberLabel: destructive ? undefined : prefix,
    });

    if (choice === "yes") return { behavior: "allow" };

    if (choice === "always" && !destructive) {
      if (rememberTool) this.allowedTools.add(prefix);
      else this.allowedCommandPrefixes.add(prefix);
      try {
        await this.persist(prefix, rememberTool ? "allowTools" : "allowCommands");
      } catch {}
      return { behavior: "allow" };
    }

    return {
      behavior: "deny",
      message: `The user declined permission for: ${command}. Do NOT retry this action. Explain briefly what you intended and ask the user how they would like to proceed.`,
    };
  }
}

export const permissions = new PermissionManager();
