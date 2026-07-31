#!/usr/bin/env node
import { agent } from "./src/agent/loop.js";
import dotenv from "dotenv";
import chalk from "chalk";
import { checkConfig, switchModel, configWizard } from "./src/cli/setup.js";
import { getModel } from "./src/config/index.js";
import { program } from "./src/cli/index.js";
import { printBanner, modelLine } from "./src/cli/banner.js";
import { askInput } from "./src/cli/input.js";

dotenv.config();

async function getActiveModel(): Promise<any | null> {
  try {
    return await getModel();
  } catch {
    return null;
  }
}

async function startREPL() {
  while (true) {
    const input = (await askInput()).trim();
    if (!input) continue;

    try {
      if (input === "/exit") {
        process.exit(1);
      }

      if (input === "/model") {
        await switchModel();
        console.log(modelLine(await getActiveModel()) + "\n");
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
            "\n  /config → add new model   /model → switch model\n  /exit   → quit            /help  → show commands\n",
          ),
        );
        continue;
      }

      const selectedModel: any = await getModel();
      await agent.run(
        input,
        selectedModel.provider,
        selectedModel.model,
        selectedModel.contextLimit,
      );
      console.log();
    } catch (err: any) {
      console.error(chalk.red("Error:"), err?.message || err);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

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
