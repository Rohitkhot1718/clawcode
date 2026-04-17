import { toolSchemas } from "../tools/schema.js";
import { tools } from "../tools/index.js";
import ora from "ora";
import chalk from "chalk";
import { buildSummaryPrompt, buildSystemPrompt } from "../prompts/index.js";
import { createProvider } from "../providers/index.js";
import {
  shouldCompressContext,
  calculateTokenBudget,
} from "../utils/tokenCounter.js";

const toolsMap: any = {
  runCommand: (args: any) => tools.runCommand(args),
  createFile: (args: any) => tools.createFile(args),
  readFile: (args: any) => tools.readFile(args),
  listDirectory: (args: any) => tools.listDirectory(args),
  editFile: (args: any) => tools.editFile(args),
  startBackground: (args: any) => tools.startBackground(args),
  readProcessOutput: (args: any) => tools.readProcessOutput(args),
  stopProcess: (args: any) => tools.stopProcess(args),
  grep: (args: any) => tools.grep(args),
  webSearch: (args: any) => tools.webSearch(args),
  fetchURL: (args: any) => tools.fetchURL(args),
  getLineCount: (args: any) => tools.getLineCount(args),
};

class AgentLoop {
  private provider: any;
  private messages: any[] = [];
  private sessionMemories: string[] = [];
  private systemPrompt!: string;
  private summaryPrompt!: string;
  private initialized = false;
  private currentProvider = "";
  private currentModel = "";
  private readonly MAX_TOKENS = 8000;
  private readonly TOKEN_COMPRESSION_THRESHOLD = 0.8;

  async run(
    userInput: string,
    provider: string,
    model: string,
  ): Promise<string> {
    if (!this.initialized) {
      this.systemPrompt = await buildSystemPrompt();
      this.summaryPrompt = await buildSummaryPrompt();
      this.initialized = true;
      this.messages = [{ role: "system", content: this.systemPrompt }];
    }

    if (this.sessionMemories.length > 0) {
      const memoryMsg = `Previous tasks this session:\n${this.sessionMemories.join("\n")}`;
      const existing = this.messages.findIndex((m) =>
        m.content?.startsWith("Previous tasks"),
      );
      if (existing >= 0) {
        this.messages[existing].content = memoryMsg;
      } else {
        this.messages.splice(1, 0, { role: "system", content: memoryMsg });
      }
    }

    if (provider !== this.currentProvider || model !== this.currentModel) {
      this.provider = await createProvider(provider, model);
      this.currentProvider = provider;
      this.currentModel = model;
    }

    this.messages.push({ role: "user", content: userInput });

    while (true) {
      await this.trimContext();

      const spinner = ora("Thinking...").start();

      try {
        const response = await this.provider.chat(this.messages, toolSchemas);

        if (!response.ok) {
          spinner.fail("LLM API error");
          throw new Error(response.error || "Unknown LLM error");
        }

        spinner.stop();

        const message = await this.processStream(response.message);
        this.messages.push(this.sanitizeMessage(message));

        if (!message.tool_calls || message.tool_calls.length === 0) {
          if (!message.content?.trim()) {
            this.messages.push({
              role: "user",
              content:
                "Please provide a response based on the tool results above.",
            });
            continue;
          }

          const responseContent = message.content || "";

          return responseContent;
        }

        for (const toolCall of message.tool_calls as any[]) {
          const toolName = toolCall?.function?.name;
          let args = toolCall.function.arguments;
          
          if (!toolName || !args) {
            continue;
          }

          try {
            if (typeof args === "string") {
              args = JSON.parse(args);
            }
          } catch (e: any) {
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: `Failed to parse tool arguments: ${e.message}. Please try again with valid JSON.`,
              }),
            });
            continue;
          }

          const toolFunc = toolsMap[toolName];

          if (args.previousStepContent)
            console.log("\n", chalk.white(args.previousStepContent || ""));

          if (toolName === "runCommand") {
            console.log("", chalk.gray(args.command));
          }

          if (!toolFunc) {
            this.messages.push({
              role: "tool",
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: Tool "${toolName}" not found`,
            });
            continue;
          }

          const spinner = ora({
            text: `🛠 ${toolName}`,
            color: "yellow",
          }).start();

          let result;

          try {
            const raw = await toolFunc(args);
            result = typeof raw === "string" ? raw : JSON.stringify(raw);

            try {
              JSON.parse(result);
            } catch {
              result = JSON.stringify({
                success: false,
                error: "Tool returned invalid JSON format",
              });
            }

            spinner.succeed(`🛠 ${toolName} done \n`);
          } catch (err: any) {
            const errorMsg = err?.message || "Unknown error";
            result = JSON.stringify({
              success: false,
              error: `Tool execution failed: ${errorMsg}`,
            });
            spinner.fail(`${toolName} failed: ${errorMsg}`);
          }

          const MAX_CHARS: Record<string, number> = {
            runCommand: 1000,
            listDirectory: 500,
            readFile: 8000,
            editFile: 200,
            createFile: 200,
            grep: 2000,
            webSearch: 3000,
            startBackground: 500,
            readProcessOutput: 1000,
          };

          const limit = MAX_CHARS[toolName] ?? 2000;
          const truncated = result.length > limit;
          const finalResult = truncated
            ? result.slice(0, limit) +
              `\n...[truncated ${result.length - limit} chars, use readFile with offset and limit for more]`
            : result;

          this.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: finalResult,
          });
        }
      } catch (err: any) {
        spinner.stop();
        console.error("Agent loop error:", err);
        throw new Error(
          `Agent loop failed: ${err?.message || "Unknown error"}`,
        );
      }
    }
  }

  private async processStream(stream: any): Promise<any> {
    let fullContent = "";
    let toolCalls: any = [];
    let finishReason = "";

    try {
      for await (const chunk of stream) {
        try {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            process.stdout.write(delta.content);
            fullContent += delta.content;
          }

          if (delta?.tool_calls) {
            for (let i = 0; i < delta.tool_calls.length; i++) {
              const toolCall = delta.tool_calls[i];
              if (!toolCalls[i]) {
                toolCalls[i] = {
                  id: toolCall.id || "",
                  function: {
                    name: toolCall.function?.name || "",
                    arguments: "",
                  },
                };
              }
              if (toolCall.function?.arguments) {
                toolCalls[i].function.arguments += toolCall.function.arguments;
              }
            }
          }

          finishReason = chunk.choices[0]?.finish_reason || finishReason;
        } catch (chunkErr: any) {
          if (chunkErr?.message?.includes("JSON")) {
            continue;
          }
          throw chunkErr;
        }
      }
    } catch (streamErr: any) {
      if (!streamErr?.message?.includes("JSON")) {
        throw streamErr;
      }
    }

    console.log();

    const message: any = {
      role: "assistant",
      content: fullContent || null,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls
        .filter((tc: any) => tc.id && tc.function.name)
        .map((tc: any) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        }));
    }

    return message;
  }

  sanitizeMessage(msg: any): any {
    const ALLOWED = new Set([
      "role",
      "content",
      "tool_calls",
      "tool_call_id",
      "name",
    ]);

    const clean: any = {};
    for (const key of ALLOWED) {
      if (msg[key] !== undefined) clean[key] = msg[key];
    }

    return clean;
  }

  async summarizeMessages(messages: any[]): Promise<string> {
    const response = await this.provider.chat([
      {
        role: "system",
        content: this.summaryPrompt,
      },
      ...messages,
    ]);

    if (!response.ok) {
      throw new Error(response.message || response.error || "Summary failed");
    }

    const message = await this.processStream(response.message);
    return message.content?.trim() || "No summary was produced.";
  }

  private async trimContext() {
    if (
      !shouldCompressContext(
        this.messages,
        this.TOKEN_COMPRESSION_THRESHOLD,
        this.MAX_TOKENS,
      )
    ) {
      return;
    }

    const budget = calculateTokenBudget(this.messages, this.MAX_TOKENS);
    console.log(
      chalk.yellow(
        `⚠️ Context usage: ${budget.currentUsage}/${budget.maxContextTokens} tokens (${Math.round((budget.currentUsage / budget.maxContextTokens) * 100)}%)`,
      ),
    );

    const keep = 6;
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const nonSystem = this.messages.filter((m) => m.role !== "system");

    if (nonSystem.length <= keep) {
      console.log(
        chalk.red("❌ Context too large but not enough messages to summarize"),
      );
      return;
    }

    const toSummarize = nonSystem.slice(0, -keep);
    const recent = nonSystem.slice(-keep);

    console.log(chalk.cyan(`📝 Summarizing ${toSummarize.length} messages...`));
    const summary = await this.summarizeMessages(toSummarize);

    this.messages = [
      ...systemMessages,
      { role: "user", content: `[Summary of previous steps]\n${summary}` },
      { role: "assistant", content: "Understood." },
      ...recent,
    ];

    const newBudget = calculateTokenBudget(this.messages, this.MAX_TOKENS);
    console.log(
      chalk.green(
        `✅ Context compressed to ${newBudget.currentUsage}/${newBudget.maxContextTokens} tokens`,
      ),
    );
  }
}

export const agent = new AgentLoop();