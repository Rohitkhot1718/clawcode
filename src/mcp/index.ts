import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export class MCPClient {
  private client: Client;

  constructor() {
    this.client = new Client({
      name: "clawcode MCP Client",
      version: "1.0.0",
    });
  }

  async connect(config: MCPServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
    });

    await this.client.connect(transport);
  }

  async listTools() {
    return await this.client.listTools();
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    return await this.client.callTool({
      name,
      arguments: args,
    });
  }
}
