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
import { permissions, READ_ONLY_TOOLS } from "./permissions.js";
import { renderDiff } from "../utils/renderdiff.js";
import {
  saveSession,
  saveSessionMeta,
  loadSessionMeta,
  deriveSessionName,
} from "../session/session.js";

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
  saveMemoryNote: (args: any) => tools.saveMemoryNote(args),
  getSkill: (args: any) => tools.getSkill(args),
  listMCPTools: (args: any) => tools.listMCPTools(args),
  callMCPTool: (args: any) => tools.callMCPTool(args),
};

export const TOOL_LABELS: Record<string, string> = {
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
  saveMemoryNote: "Memory",
  getSkill: "Skill",
  listMCPTools: "MCPToolLists",
  callMCPTool: "MCPToolCall",
};

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
      "skillPath",
      "serverName",
      "toolName",
      "args",
    ];
    return Object.keys(obj).some((k) => toolish.includes(k));
  } catch {
    return false;
  }
}

export function describeToolCall(toolName: string, args: any): string {
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
    case "saveMemoryNote":
      return `${name}("${clip(args.note, 60)}")`;
    case "getSkill":
      return `${name}(${clip(displayPath(args.skillPath))})`;
    case "listMCPTools":
      return `${name}(${clip(args.serverName)})`;
    case "callMCPTool":
      return `${name}(${clip(args.serverName)}, ${clip(args.toolName)})`;
    default:
      return name;
  }
}

class AgentLoop {
  private provider: any;
  private messages: any[] = [];
  private systemPrompt!: string;
  private summaryPrompt!: string;
  private initialized = false;
  private currentProvider = "";
  private currentModel = "";
  private MAX_TOKENS = 128000;
  private readonly TOKEN_COMPRESSION_THRESHOLD = 0.8;
  private sessionId: string = "";
  private sessionCreatedAt: string = "";
  private titleGenerationPending = false;
  private abortController: AbortController | null = null;

  interrupt(): void {
    this.abortController?.abort();
  }

  private async handleInterrupt(
    spinner: any = null,
    partialContent?: string | null,
  ): Promise<string> {
    if (spinner?.isSpinning) {
      spinner.stopAndPersist({ symbol: chalk.yellow("■"), text: "Interrupted" });
    } else {
      console.log(`\n${chalk.yellow("■")} Interrupted`);
    }

    const interruptMsg = {
      role: "user" as const,
      content: "[Interrupted by user before this response finished]",
    };
    this.messages.push(interruptMsg);
    await saveSession(this.sessionId, interruptMsg);

    return partialContent || "";
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async recordModelChoice(provider: string, model: string) {
    if (!this.sessionId) return;
    await saveSessionMeta(this.sessionId, {
      provider,
      model,
      createdAt: this.sessionCreatedAt || new Date().toISOString(),
    });
  }

  private async generateSessionTitle(
    userInput: string,
    sessionId: string,
    provider: string,
    model: string,
  ) {
    try {
      const titleProvider = this.provider;
      const response = await titleProvider.chat([
        {
          role: "system",
          content:
            "Generate a short 3-6 word title summarizing the user's request. Reply with only the title — no quotes, no trailing punctuation, no explanation.",
        },
        { role: "user", content: userInput },
      ]);

      if (!response.ok) return;

      const title = (await this.consumeStreamSilently(response.message)).trim();
      if (!title) return;

      await saveSessionMeta(sessionId, {
        provider,
        model,
        createdAt: this.sessionCreatedAt,
        name: title,
      });
    } catch {
      // Non-critical: keep the derived fallback name if this fails.
    }
  }

  async resumeFrom(sessionId: string, messages: any[]) {
    const meta = await loadSessionMeta(sessionId);
    this.sessionCreatedAt = meta?.createdAt ?? new Date().toISOString();

    this.systemPrompt = await buildSystemPrompt(
      meta?.provider ?? "unknown",
      meta?.model ?? "unknown",
    );
    this.summaryPrompt = await buildSummaryPrompt();
    this.sessionId = sessionId;
    this.messages = [
      { role: "system", content: this.systemPrompt },
      ...messages,
    ];
    this.initialized = true;
  }

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
      this.systemPrompt = await buildSystemPrompt(provider, model);
      this.summaryPrompt = await buildSummaryPrompt();
      this.initialized = true;
      this.messages = [{ role: "system", content: this.systemPrompt }];

      this.sessionId = crypto.randomUUID();
      this.sessionCreatedAt = new Date().toISOString();
      await saveSessionMeta(this.sessionId, {
        provider,
        model,
        createdAt: this.sessionCreatedAt,
        name: deriveSessionName(userInput),
      });
      this.titleGenerationPending = true;
    }

    if (provider !== this.currentProvider || model !== this.currentModel) {
      const isSwitch = this.currentProvider !== "";

      this.provider = await createProvider(provider, model);
      this.currentProvider = provider;
      this.currentModel = model;

      if (isSwitch) {
        await saveSessionMeta(this.sessionId, {
          provider,
          model,
          createdAt: this.sessionCreatedAt,
        });
        this.systemPrompt = await buildSystemPrompt(provider, model);
        if (this.messages[0]?.role === "system") {
          this.messages[0].content = this.systemPrompt;
        }
      }
    }

    if (this.titleGenerationPending) {
      this.titleGenerationPending = false;
      this.generateSessionTitle(userInput, this.sessionId, provider, model);
    }

    this.messages.push({ role: "user", content: userInput });
    permissions.setUserRequest(userInput);
    await saveSession(this.sessionId, { role: "user", content: userInput });

    const readOnlyCallCache = new Map<string, string>();

    while (true) {
      await this.trimContext();

      // A fresh controller per iteration — reusing one AbortSignal across
      // many chat() calls in a long, multi-tool-call turn was piling up
      // internal SDK listeners on it and tripping Node's MaxListeners warning.
      this.abortController = new AbortController();

      const spinner = ora("Thinking...").start();

      try {
        const response = await this.provider.chat(
          this.messages,
          toolSchemas,
          this.abortController.signal,
        );

        if (response.error === "ABORTED") {
          return await this.handleInterrupt(spinner);
        }

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
        await saveSession(this.sessionId, this.sanitizeMessage(message));

        if (this.abortController?.signal.aborted) {
          return await this.handleInterrupt(null, message.content);
        }

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
          if (this.abortController?.signal.aborted) {
            return await this.handleInterrupt(null, message.content);
          }

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

          let callSignature = "";
          if (READ_ONLY_TOOLS.has(toolName)) {
            const { previousStepContent: _ignored, ...argsForSig } = args;
            callSignature = `${toolName}:${JSON.stringify(argsForSig)}`;
            const cached = readOnlyCallCache.get(callSignature);
            if (cached !== undefined) {
              console.log(
                `${chalk.gray("●")} ${chalk.gray(label)} ${chalk.dim("(already ran this turn, reusing result)")}`,
              );
              this.messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: cached,
              });
              await saveSession(this.sessionId, {
                role: "tool",
                tool_call_id: toolCall.id,
                content: cached,
              });
              continue;
            }
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

          const decision = await permissions.check(toolName, args, label);
          if (decision.behavior === "deny") {
            console.log(
              `${chalk.red("●")} ${chalk.gray(label)} — denied by user`,
            );
            this.messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: decision.message,
              }),
            });
            await saveSession(this.sessionId, {
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

            let parsed: any = null;
            try {
              parsed = JSON.parse(result);
            } catch {
              result = JSON.stringify({
                success: false,
                error: "Tool returned invalid JSON format",
              });
            }

            const succeeded = parsed !== null && parsed?.success !== false;

            if (succeeded && toolName === "createFile" && args.filePath) {
              permissions.markCreated(args.filePath);
            }

            spinner.stopAndPersist({
              symbol: succeeded ? chalk.green("●") : chalk.red("●"),
              text: succeeded
                ? chalk.gray(label)
                : `${chalk.gray(label)} — ${String(parsed?.error ?? "failed").split("\n")[0]}`,
            });

            if (succeeded && toolName === "createFile") {
              console.log(renderDiff("", args.content, 20) + "\n");
            }

            if (succeeded && toolName === "editFile" && parsed?.diff) {
              console.log(
                renderDiff(parsed.diff.old, parsed.diff.new, 30) + "\n",
              );
            }
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
            editFile: 1500,
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

          if (callSignature) {
            readOnlyCallCache.set(callSignature, finalResult);
          }

          this.messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: finalResult,
          });
          await saveSession(this.sessionId, {
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

  private async consumeStreamSilently(stream: any): Promise<string> {
    let fullContent = "";
    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) fullContent += delta.content;
      }
    } catch {
    }
    return fullContent;
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
                .map(
                  (tc: any) =>
                    TOOL_LABELS[tc.function.name] ?? tc.function.name,
                )
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
      const isAbort =
        streamErr?.name === "AbortError" || this.abortController?.signal.aborted;
      if (!isAbort && !streamErr?.message?.includes("JSON")) {
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
