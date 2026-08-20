import { Command } from "commander";
import { cliCommands } from "./commands.js";
import { addMCPServer } from "../mcp/config.js";
export const program = new Command();

program.name("clawcode").description("AI CLI tool").version("1.0.0");

program
  .command("use <model>")
  .description("Switch default model")
  .action(async (model: string) => {
    await cliCommands.useModel(model);
  });

program
  .argument("[input]", "Input prompt")
  .action(async (input: string | undefined) => {
    if (!input) {
      program.help();
      return;
    }
    await cliCommands.runInput(input);
  });

program
  .command("models")
  .description("List all models")
  .action(async () => await cliCommands.listModels());

program
  .command("add-model")
  .description("Add a new model")
  .requiredOption("--provider <provider>", "Provider name")
  .requiredOption("--model <model>", "Model ")
  .option("--name <name>", "Display name")
  .option(
    "--base-url <url>",
    "Base URL for a custom OpenAI-compatible provider",
  )
  .action(async (options) => {
    const { provider, model, name, baseUrl } = options;
    await cliCommands.addModel(provider, model, name, undefined, baseUrl);
  });

program
  .command("remove-model <model>")
  .description("Remove the model")
  .action(async (model: string) => cliCommands.removeModel(model));

program
  .command("reset")
  .description("Reset the configuration")
  .action(async () => cliCommands.resetConfig());

program
  .command("set-key")
  .description("Add an API key")
  .requiredOption("--provider <provider>", "Provider name")
  .requiredOption("--key <key>", "API key")
  .action(async (options) => {
    const { provider, key } = options;
    await cliCommands.setKey(provider, key);
  });

program
  .command("change-key")
  .description("Update an existing API key")
  .requiredOption("--provider <provider>", "Provider name")
  .requiredOption("--key <key>", "New API key")
  .action(async (options) => {
    const { provider, key } = options;
    await cliCommands.changeKey(provider, key);
  });

program
  .command("remove-key")
  .description("Remove an API key")
  .requiredOption("--provider <provider>", "Provider name")
  .action(async (options) => {
    const { provider } = options;
    await cliCommands.removeKey(provider);
  });

program
  .command("config")
  .description("View current configuration")
  .action(async () => {
    await cliCommands.showConfig();
  });

program
  .command("add-mcp")
  .description("Add a new MCP server")
  .requiredOption("--name <name>", "Server name")
  .requiredOption("--command <command>", "Server command")
  .option("--args <args>", "Space-separated server arguments")
  .option("--env <env>", "Comma-separated KEY=VALUE environment variables")
  .action(async (options) => {
    const { name, command, args, env } = options;

    const parsedEnv = env
      ? Object.fromEntries(
          (env as string)
            .split(",")
            .map((pair) => pair.split("=").map((s: string) => s.trim())),
        )
      : undefined;

    await addMCPServer(name, {
      command,
      args: args ? (args as string).split(" ").filter(Boolean) : [],
      env: parsedEnv,
    });

    console.log(`MCP server "${name}" added`);
  });
