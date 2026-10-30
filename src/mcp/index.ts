import fs from "fs/promises";
import os from "os";
import path from "path";
import type OpenAI from "openai";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ToolResult } from "../tools/index";

export type MCPServerConfig = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type MCPStatus = {
  server: string;
  ok: boolean;
  tools: string[];
  error?: string;
};

const CONFIG_PATH = path.join(os.homedir(), ".clawcode", ".mcp.json");
const CONNECT_TIMEOUT_MS = 15000;
export const MCP_PREFIX = "mcp__";

type Entry = { server: string; tool: string; client: Client };

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function loadConfig(): Promise<Record<string, MCPServerConfig>> {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_PATH, "utf-8"));
    return parsed?.mcpServers ?? {};
  } catch {
    return {};
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    promise.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    );
  });
}

class MCPManager {
  private clients: Client[] = [];
  private entries = new Map<string, Entry>();
  private defs: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  statuses: MCPStatus[] = [];

  async connectAll(): Promise<MCPStatus[]> {
    const servers = await loadConfig();
    this.statuses = await Promise.all(
      Object.entries(servers).map(([name, config]) => this.connect(name, config)),
    );
    return this.statuses;
  }

  private async connect(server: string, config: MCPServerConfig): Promise<MCPStatus> {
    const client = new Client({ name: "clawcode", version: "1.0.0" });
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
      });
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS);
      const { tools } = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS);

      this.clients.push(client);
      for (const t of tools) {
        const name = `${MCP_PREFIX}${safeName(server)}__${safeName(t.name)}`.slice(0, 64);
        this.entries.set(name, { server, tool: t.name, client });
        this.defs.push({
          type: "function",
          function: {
            name,
            description: `[MCP ${server}] ${t.description ?? t.name}`,
            parameters: (t.inputSchema as Record<string, unknown>) ?? {
              type: "object",
              properties: {},
            },
          },
        });
      }
      return { server, ok: true, tools: tools.map((t) => t.name) };
    } catch (err: any) {
      try {
        await client.close();
      } catch {}
      return { server, ok: false, tools: [], error: err?.message ?? String(err) };
    }
  }

  tools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return this.defs;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const entry = this.entries.get(name);
    if (!entry) return { ok: false, error: `Unknown MCP tool: ${name}` };
    try {
      const res: any = await entry.client.callTool({
        name: entry.tool,
        arguments: args,
      });
      const text = (res.content ?? [])
        .map((c: any) => (c.type === "text" ? c.text : `[${c.type} content omitted]`))
        .join("\n");
      return res.isError
        ? { ok: false, error: text || "MCP tool reported an error." }
        : { ok: true, output: text };
    } catch (err: any) {
      return { ok: false, error: `MCP call failed: ${err?.message ?? err}` };
    }
  }

  async closeAll() {
    await Promise.all(this.clients.map((c) => c.close().catch(() => {})));
    this.clients = [];
  }
}

export const mcpManager = new MCPManager();
