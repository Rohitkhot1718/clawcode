import path from "node:path";
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
import { permissions } from "./permissions.js";

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

// Friendly display names for the terminal (the model still sees the real
// tool names). Rendered Claude Code-style: `Create(src/App.jsx)`.
const TOOL_LABELS: Record<string, string> = {
  runCommand: "Shell",
  startBackground: "Background",
  createFile: "Create",
  readFile: "Read",
  editFile: "Edit",
  listDirectory: "List",
  grep: "Search",
  webSearch: "WebSearch",
  fetchURL: "Fetch",
  getLineCount: "Lines",
  readProcessOutput: "Logs",
  stopProcess: "Stop",
};

// Absolute paths inside the project render as short relative ones:
// C:\...\clawcode\todo\client\src\App.jsx -> todo\client\src\App.jsx
function displayPath(p: any): string {
  const str = String(p ?? "");
  try {
    const rel = path.relative(process.cwd(), path.resolve(str));
    if (rel === "") return ".";
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  } catch {
    // fall through to the raw string
  }
  return str;
}

// Detects a model mistake small models make: writing the tool arguments as
// a JSON text reply (optionally fenced) instead of actually calling the
// tool. Only matches when the ENTIRE message is one JSON object with
// tool-ish keys, so ordinary answers that merely contain JSON don't trip it.
export function looksLikeTextToolCall(content: string): boolean {
  const trimmed = String(content ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return false;
  try {
    const obj = JSON.parse(candidate);
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      return false;
    }
    const toolish = [
      "previousStepContent",
      "filePath",
      "dirPath",
      "command",
      "query",
      "url",
      "oldContent",
      "newContent",
    ];
    return Object.keys(obj).some((k) => toolish.includes(k));
  } catch {
    return false;
  }
}

// Short, human-readable summary of what a tool call is actually doing, e.g.
// `Shell(npm install)` or `Search("foo" in src)`. Shown next to the spinner.
function describeToolCall(toolName: string, args: any): string {
  const clip = (s: any, n = 60) => {
    const str = String(s ?? "");
    return str.length > n ? str.slice(0, n) + "…" : str;
  };
  const name = TOOL_LABELS[toolName] ?? toolName;

  switch (toolName) {
    case "runCommand":
    case "startBackground":
      return `${name}(${clip(args.command)})`;
    case "createFile":
    case "readFile":
    case "editFile":
    case "getLineCount":
      return `${name}(${clip(displayPath(args.filePath))})`;
    case "listDirectory":
      return `${name}(${clip(displayPath(args.dirPath))})`;
    case "grep":
      return `${name}("${clip(args.query, 40)}" in ${clip(displayPath(args.filePath))})`;
    case "webSearch":
      return `${name}("${clip(args.query)}")`;
    case "fetchURL":
      return `${name}(${clip(args.url)})`;
    case "readProcessOutput":
    case "stopProcess":
      return `${name}(${clip(args.id)})`;
    default:
      return name;
  }
}

class AgentLoop {
  private provider: any;
  private messages: any[] = [];
  private sessionMemories: string[] = [];
  private systemPrompt!: string;
  private summaryPrompt!: string;
  private initialized = false;
  private currentProvider = "";
  private currentModel = "";
  private MAX_TOKENS = 128000;
  private readonly TOKEN_COMPRESSION_THRESHOLD = 0.8;

  async run(
    userInput: string,
    provider: string,
    model: string,
    contextLimit?: number,
  ): Promise<string> {
    if (contextLimit && contextLimit > 0) {
      this.MAX_TOKENS = contextLimit;
    }

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
    permissions.setUserRequest(userInput);

    while (true) {
      await this.trimContext();

      const spinner = ora("Thinking...").start();

      try {
        const response = await this.provider.chat(this.messages, toolSchemas);

        if (!response.ok) {
          spinner.stopAndPersist({
            symbol: chalk.red("●"),
            text: "LLM API error",
          });
          throw new Error(
            response.message || response.error || "Unknown LLM error",
          );
        }

        const message = await this.processStream(response.message, spinner);
        if (spinner.isSpinning) spinner.stop();

        const brokenToolCalls = new Set<string>();
        for (const tc of message.tool_calls ?? []) {
          try {
            JSON.parse(tc.function.arguments || "{}");
          } catch {
            brokenToolCalls.add(tc.id);
            tc.function.arguments = "{}";
          }
        }

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

          if (looksLikeTextToolCall(message.content)) {
            console.log(
              chalk.yellow(
                "\n(model wrote a tool call as text — asking it to retry properly)\n",
              ),
            );
            this.messages.push({
              role: "user",
              content:
                "You wrote tool arguments as a JSON text reply — that does not execute anything. Invoke the tool through the tool-calling interface instead, and do not print JSON in your message.",
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

          if (brokenToolCalls.has(toolCall.id)) {
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: `The arguments for ${toolName} were not valid JSON (truncated or malformed). Retry this tool call with complete, valid JSON arguments.`,
              }),
            });
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
            console.log(chalk.white(args.previousStepContent || ""));

          const label = describeToolCall(toolName, args);

          if (!toolFunc) {
            this.messages.push({
              role: "tool",
              name: toolName,
              tool_call_id: toolCall.id,
              content: `Error: Tool "${toolName}" not found`,
            });
            continue;
          }

          const decision = await permissions.check(toolName, args, label);
          if (decision.behavior === "deny") {
            console.log(`${chalk.red("●")} ${chalk.gray(label)} — denied by user\n`);
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: decision.message,
              }),
            });
            continue;
          }

          const spinner = ora({
            text: `🛠 ${chalk.gray(label)}`,
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

            if (toolName === "createFile" && args.filePath) {
              try {
                if (JSON.parse(result)?.success) {
                  permissions.markCreated(args.filePath);
                }
              } catch {
                // unparseable result — don't mark
              }
            }

            spinner.stopAndPersist({
              symbol: chalk.green("●"),
              text: `${chalk.gray(label)}\n`,
            });
          } catch (err: any) {
            const errorMsg = err?.message || "Unknown error";
            result = JSON.stringify({
              success: false,
              error: `Tool execution failed: ${errorMsg}`,
            });
            spinner.stopAndPersist({
              symbol: chalk.red("●"),
              text: `${chalk.gray(label)} failed: ${errorMsg}`,
            });
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
        throw new Error(err?.message || "Unknown error", { cause: err });
      }
    }
  }

  private async processStream(stream: any, spinner?: any): Promise<any> {
    let fullContent = "";
    let toolCalls: any = [];
    let finishReason = "";
    let contentNeedsNewline = false;

    try {
      for await (const chunk of stream) {
        try {
          const delta = chunk.choices[0]?.delta;

          if (delta?.content) {
            if (spinner?.isSpinning) spinner.stop();
            process.stdout.write(delta.content);
            fullContent += delta.content;
            contentNeedsNewline = !delta.content.endsWith("\n");
          }

          if (delta?.tool_calls) {
            for (let i = 0; i < delta.tool_calls.length; i++) {
              const toolCall = delta.tool_calls[i];
              const slot = toolCall.index ?? i;
              if (!toolCalls[slot]) {
                toolCalls[slot] = {
                  id: "",
                  function: { name: "", arguments: "" },
                };
              }
              if (toolCall.id) {
                toolCalls[slot].id = toolCalls[slot].id || toolCall.id;
              }
              if (toolCall.function?.name) {
                toolCalls[slot].function.name =
                  toolCalls[slot].function.name || toolCall.function.name;
              }
              if (toolCall.function?.arguments) {
                toolCalls[slot].function.arguments +=
                  toolCall.function.arguments;
              }
            }

            if (spinner) {
              if (!spinner.isSpinning) {
                if (contentNeedsNewline) {
                  process.stdout.write("\n");
                  contentNeedsNewline = false;
                }
                spinner.start();
              }
              const names = toolCalls
                .filter(Boolean)
                .map((tc: any) => TOOL_LABELS[tc.function.name] ?? tc.function.name)
                .filter(Boolean);
              spinner.text = names.length
                ? `Preparing ${names.join(", ")}...`
                : "Preparing tool call...";
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
    } finally {
      if (spinner?.isSpinning) spinner.stop();
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

    let splitIndex = nonSystem.length - keep;
    while (
      splitIndex < nonSystem.length &&
      nonSystem[splitIndex].role === "tool"
    ) {
      splitIndex++;
    }

    const toSummarize = nonSystem.slice(0, splitIndex);
    const recent = nonSystem.slice(splitIndex);

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