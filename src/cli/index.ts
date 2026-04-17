import { Command } from "commander";
import { cliCommands } from "./commands.js";
export const program = new Command();

program.name("clawcode").description("AI CLI tool").version("1.0.0");

program
  .command("use <model>")
  .description("Switch default model")
  .action(async (model: string) => {
    await cliCommands.useModel(model);
  });

program.argument("<input>", "Input prompt").action(async (input: string) => {
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
  .action(async (options) => {
    const { provider, model, name } = options;
    await cliCommands.addModel(provider, model, name);
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
