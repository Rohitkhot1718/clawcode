import os from "os";
import path from "path";
import fs from "fs/promises";
import { MCPClient, MCPServerConfig } from "./index.js";

const MCP_CONFIG_PATH = path.join(os.homedir(), ".clawcode", ".mcp.json");

export async function loadMCPConfig(): Promise<any | null> {
  try {
    const data = await fs.readFile(MCP_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(data);
    return parsed;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      const defaultConfig = {
        mcpServers: {},
      };

      await fs.writeFile(
        MCP_CONFIG_PATH,
        JSON.stringify(defaultConfig, null, 2),
      );

      return defaultConfig;
    }

    throw err;
  }
}

export async function saveMCPConfig(config: any): Promise<void> {
  await fs.writeFile(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), {
    flag: "w",
  });
}

export async function addMCPServer(
  name: string,
  server: MCPServerConfig,
): Promise<void> {
  const config = (await loadMCPConfig()) ?? { mcpServers: {} };

  config.mcpServers[name] = server;

  await saveMCPConfig(config);
}

export class MCPManager {
  private clients = new Map<string, MCPClient>();

  async connectAll() {
    const config = await loadMCPConfig();

    if (!config?.mcpServers) {
      return;
    }

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const client = new MCPClient();

      await client.connect(serverConfig as any);

      this.clients.set(name, client);
    }
  }

  listServers() {
    return [...this.clients.keys()];
  }

  getClient(name: string) {
    return this.clients.get(name);
  }
}

export const mcpManager = new MCPManager();
