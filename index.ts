#!/usr/bin/env node
import readline from "readline";
import { agent } from "./src/agent/loop.js";
import dotenv from "dotenv";
import chalk from "chalk";
import { checkConfig, switchModel, configWizard } from "./src/cli/setup.js";
import { getModel } from "./src/config/index.js";
import { program } from "./src/cli/index.js";

dotenv.config();

function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan("> "),
  });
}

async function startREPL(rl: any) {
  let isProcessing = false;

  rl.on("line", async (input: any) => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isProcessing) return;

    isProcessing = true;
    try {
      if (trimmedInput === "/model") {
        rl.close();
        await switchModel();
        const newRl = createReadlineInterface();
        startREPL(newRl);
        newRl.prompt();
        return;
      }

      if (trimmedInput === "/config") {
        rl.close();
        await configWizard();
        const newRl = createReadlineInterface();
        startREPL(newRl);
        newRl.prompt();
        return;
      }

      if (trimmedInput === "/exit") {
        console.log(chalk.gray("Goodbye!"));
        rl.close();
        return;
      }

      if (trimmedInput === "/help") {
        console.log(
          chalk.gray(
            "\n /config → add new model  /model → switch model\n  /exit  → quit  /help  → show commands\n",
          ),
        );
        isProcessing = false;
        rl.prompt();
        return;
      }

      const { provider, model }: any = await getModel();
      await agent.run(trimmedInput, provider, model);
      console.log();
    } catch (err) {
      console.error(chalk.red("Error:"), err);
    } finally {
      isProcessing = false;
      if (trimmedInput !== "/exit" && trimmedInput !== "/model") {
        rl.prompt();
      }
    }
  });

  rl.prompt();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    await program.parseAsync(process.argv);
    return;
  }

  console.log(chalk.bold.cyan("Welcome to Clawcode! 🦀"));

  await checkConfig();

  const rl = createReadlineInterface();
  await startREPL(rl);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
