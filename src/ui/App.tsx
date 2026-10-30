import React, { useRef, useState, useEffect, useMemo } from "react";
import { Box, Text, useApp, useInput } from "ink";
import TextInput from "./TextInput";
import Spinner from "ink-spinner";
import {
  buildInitialMessages,
  getPrimaryArg,
  interrupt,
  newSession,
  resumeSession,
  runTurn,
  setActiveModel,
} from "../agent/agent";
import { mcpManager } from "../mcp/index";
import {
  COMMANDS,
  commandSuggestions,
  fileSuggestions,
  type Suggestion,
} from "./suggestions";
import { loadMemorySync } from "../memory/memory";
import { loadSkills } from "../skills/index";
import { listSessions, type SessionSummary } from "../session/session";
import {
  loadConfig,
  resolveActiveModel,
  setDefaultModel,
  type ModelConfig,
} from "../config/index";
import { toolImpl } from "../tools/index";
import {
  permissions,
  type PermissionChoice,
  type PermissionRequest,
} from "../agent/permissions";
import type { AgentEvent, ToolStatus } from "../agent/agent";
import { renderMarkdown } from "./markdown";
import { DiffView } from "./DiffView";
import { Select } from "./Select";
import { SetupWizard } from "./SetupWizard";
import { Header } from "./Header";

type Line =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; id: string; name: string; arg: string; status: ToolStatus }
  | { role: "write"; id: string; filePath: string; content: string }
  | {
      role: "diff";
      id: string;
      filePath: string;
      oldContent: string;
      newContent: string;
    }
  | { role: "answer"; id: string; question: string; answer: string }
  | { role: "info"; text: string; error?: boolean };

type Mode = "loading" | "chat" | "setup" | "model" | "resume";

const HELP = COMMANDS.map((c) => `${c.name.padEnd(9)}${c.description}`).join("\n");

const BAND_COLOR = "#2d2f36";

function Banded({
  children,
  color,
  width,
}: {
  children: React.ReactNode;
  color: string;
  width: number;
}) {
  return (
    <Box flexDirection="column" width={width}>
      <Text color={color}>{"▄".repeat(width)}</Text>
      <Box width={width} backgroundColor={color}>
        {children}
      </Box>
      <Text color={color}>{"▀".repeat(width)}</Text>
    </Box>
  );
}

const UserLine = React.memo(function UserLine({
  text,
  color,
  width,
}: {
  text: string;
  color: string;
  width: number;
}) {
  return (
    <Box marginBottom={0}>
      <Banded color={color} width={width}>
        <Text>
          <Text color="white">{"> "}</Text>
          {text}
        </Text>
      </Banded>
    </Box>
  );
});

const ToolLine = React.memo(function ToolLine({
  name,
  arg,
  status,
}: {
  name: string;
  arg: string;
  status: ToolStatus;
}) {
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const icon = status === "running" ? "○" : status === "success" ? "✓" : "✗";
  const iconColor =
    status === "running" ? "gray" : status === "success" ? "green" : "red";

  return (
    <Box>
      <Text>
        <Text color={iconColor}>{icon} </Text>
        <Text bold>{displayName}</Text>
        {"  "}
        <Text color="gray" dimColor>
          {arg + "\n"}
        </Text>
      </Text>
    </Box>
  );
});

const WriteLine = React.memo(function WriteLine({
  line,
}: {
  line: { id: string; filePath: string; content: string };
}) {
  const allLines = line.content.split("\n");
  const visibleLines = 9;
  const remaining = Math.max(0, allLines.length - visibleLines);
  const visibleContent = allLines.slice(0, visibleLines).join("\n");

  const language = line.filePath.split(".").pop()?.toLowerCase() || "";
  const fenced = "```" + language + "\n" + visibleContent + "\n```";
  const highlighted = renderMarkdown(fenced).trim();

  const highlightedLines = highlighted.split("\n");

  return (
    <Box flexDirection="column" paddingLeft={4}>
      <Text>wrote {allLines.length} lines</Text>
      <Box flexDirection="column">
        {highlightedLines.map((codeLine, idx) => (
          <Text key={idx}>
            <Text color="gray">{String(idx + 1).padStart(2, " ")} </Text>
            <Text>{codeLine}</Text>
          </Text>
        ))}
      </Box>
      {remaining > 0 && (
        <Text color="gray" dimColor>
          + {remaining} more {"\n"}
        </Text>
      )}
    </Box>
  );
});

const AssistantLine = React.memo(function AssistantLine({
  text,
}: {
  text: string;
}) {
  const rendered = useMemo(() => renderMarkdown(text), [text]);
  return (
    <Box marginBottom={1}>
      <Text>
        <Text color="magenta">{"✦ "}</Text>
        {rendered}
      </Text>
    </Box>
  );
});

const AnswerLine = React.memo(function AnswerLine({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>User answered questions:</Text>
      <Text>
        {"  "}
        {question}
        <Text color="cyan">{" → "}</Text>
        {answer}
      </Text>
    </Box>
  );
});

function upsertToolLine(
  prev: Line[],
  event: Extract<AgentEvent, { type: "tool_call" }>,
): Line[] {
  const idx = prev.findIndex((l) => l.role === "tool" && l.id === event.id);
  const newLine: Line = {
    role: "tool",
    id: event.id,
    name: event.name,
    arg: event.arg,
    status: event.status,
  };
  if (idx === -1) return [...prev, newLine];
  const copy = [...prev];
  copy[idx] = newLine;
  return copy;
}

function parseResult(content: unknown): any {
  try {
    return JSON.parse(String(content));
  } catch {
    return null;
  }
}

function messagesToLines(msgs: Record<string, any>[]): Line[] {
  const results = new Map<string, any>();
  for (const m of msgs) {
    if (m.role === "tool") results.set(m.tool_call_id, parseResult(m.content));
  }

  const lines: Line[] = [];
  let seq = 0;
  for (const m of msgs) {
    if (m.role === "user" && typeof m.content === "string") {
      if (m.content.startsWith("[SYSTEM NOTIFICATION]")) continue;
      lines.push({ role: "user", text: m.content });
    }
    if (m.role !== "assistant") continue;

    if (typeof m.content === "string" && m.content.trim()) {
      lines.push({ role: "assistant", text: m.content });
    }
    for (const call of m.tool_calls ?? []) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {}
      if (args.message_to_user) {
        lines.push({ role: "assistant", text: args.message_to_user });
      }
      const ok = results.get(call.id)?.ok !== false;
      lines.push({
        role: "tool",
        id: `r${++seq}:${call.id}`,
        name: call.function.name,
        arg: getPrimaryArg(call.function.name, args),
        status: ok ? "success" : "error",
      });
      if (call.function.name === "writeFile" && ok && args.path) {
        lines.push({
          role: "write",
          id: `r${seq}:${call.id}-write`,
          filePath: args.path,
          content: String(args.content ?? ""),
        });
      }
    }
  }
  return lines;
}

export default function App({ resume }: { resume?: string | true }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [mode, setMode] = useState<Mode>("loading");
  const [model, setModel] = useState<ModelConfig | null>(null);
  const [modelChoices, setModelChoices] = useState<ModelConfig[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<{
    questions: any[];
    resolve: (answer: string) => void;
  } | null>(null);

  const [streamText, setStreamText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [inputKey, setInputKey] = useState(0);
  const [sessionChoices, setSessionChoices] = useState<SessionSummary[]>([]);
  const [pendingPermission, setPendingPermission] = useState<{
    request: PermissionRequest;
    resolve: (choice: PermissionChoice) => void;
  } | null>(null);

  const initialMessages = useMemo(() => buildInitialMessages(), []);
  const messages = useRef(initialMessages);
  const width = process.stdout.columns || 100;

  const hasRunningTool = lines.some(
    (l) => l.role === "tool" && l.status === "running",
  );
  const showThinkingSpinner = isThinking && !hasRunningTool && !streamText;

  const addInfo = (text: string, error = false) =>
    setLines((prev) => [...prev, { role: "info", text, error }]);

  const quit = async () => {
    await mcpManager.closeAll();
    exit();
  };

  const activate = async (m: ModelConfig) => {
    try {
      await setActiveModel(m);
      setModel(m);
    } catch (err: any) {
      addInfo(err.message, true);
    }
    setMode("chat");
  };

  const openSessionPicker = async () => {
    const sessions = (await listSessions()).slice(0, 10);
    if (sessions.length === 0) {
      addInfo("No previous sessions for this project.", true);
      setMode("chat");
      return;
    }
    setSessionChoices(sessions);
    setMode("resume");
  };

  const loadSessionById = async (id: string) => {
    const restored = await resumeSession(id);
    if (!restored) {
      addInfo(`Session not found: ${id}`, true);
      setMode("chat");
      return;
    }
    messages.current = restored;
    setLines([
      ...messagesToLines(restored),
      { role: "info", text: `Resumed session ${id.slice(0, 8)}` },
    ]);
    setMode("chat");
  };

  const inChat = mode === "chat" && !pendingQuestion && !pendingPermission;

  useEffect(() => {
    let cancelled = false;
    const commands = commandSuggestions(input);
    if (commands.length) {
      setSuggestions(commands);
      setSuggestionIndex(0);
      return;
    }
    fileSuggestions(input).then((files) => {
      if (cancelled) return;
      setSuggestions(files);
      setSuggestionIndex(0);
    });
    return () => {
      cancelled = true;
    };
  }, [input]);

  useInput((input, key) => {
    if (inChat && suggestions.length > 0) {
      if (key.tab) {
        setInput(suggestions[suggestionIndex].value);
        setInputKey((k) => k + 1);
        return;
      }
      if (key.upArrow) {
        setSuggestionIndex((i) => (i === 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (key.downArrow) {
        setSuggestionIndex((i) => (i === suggestions.length - 1 ? 0 : i + 1));
        return;
      }
    }
    if (key.ctrl && input === "c") {
      if (!isThinking) {
        quit();
        return;
      }
      pendingPermission?.resolve("no");
      setPendingPermission(null);
      pendingQuestion?.resolve("(skipped: interrupted)");
      setPendingQuestion(null);
      interrupt();
      return;
    }
    if (key.escape && isThinking && !pendingPermission && !pendingQuestion) {
      interrupt();
    }
  });

  const handleEvent = (event: AgentEvent) => {
    if (event.type === "info") {
      addInfo(event.text, event.error);
      return;
    }
    if (event.type === "stream") {
      setStreamText(event.text);
      return;
    }
    if (event.type === "stream_end") {
      setStreamText("");
      return;
    }
    if (event.type === "message_to_user" || event.type === "final") {
      if (!event.text.trim()) return;
      setLines((prev) => [...prev, { role: "assistant", text: event.text }]);
    }
    if (event.type === "tool_call") {
      setLines((prev) => upsertToolLine(prev, event));
    }
    if (event.type === "write") {
      setLines((prev) => [
        ...prev,
        {
          role: "write",
          id: event.id,
          filePath: event.filePath,
          content: event.content,
        },
      ]);
    }
    if (event.type === "diff") {
      setLines((prev) => [
        ...prev,
        {
          role: "diff",
          id: event.id,
          filePath: event.filePath,
          oldContent: event.oldContent,
          newContent: event.newContent,
        },
      ]);
    }
  };

  useEffect(() => {
    toolImpl.setBgEventHandler(handleEvent);

    toolImpl.setAskUserQuestionHandler((questions) => {
      return new Promise<string>((resolve) => {
        setPendingQuestion({ questions, resolve });
      });
    });

    permissions.setHandler(
      (request) =>
        new Promise<PermissionChoice>((resolve) => {
          setPendingPermission({ request, resolve });
        }),
    );

    mcpManager.connectAll().then((statuses) => {
      for (const st of statuses) {
        if (!st.ok) addInfo(`MCP ${st.server} failed: ${st.error}`, true);
      }
    });

    (async () => {
      const m = await resolveActiveModel();
      if (!m) return setMode("setup");
      await activate(m);
      if (resume === true) await openSessionPicker();
      else if (resume) await loadSessionById(resume);
    })();
  }, []);

  const runCommand = async (command: string) => {
    switch (command) {
      case "/exit":
        await quit();
        return;
      case "/mcp":
        addInfo(
          mcpManager.statuses.length
            ? mcpManager.statuses
                .map((st) =>
                  st.ok
                    ? `${st.server}: ${st.tools.length} tools (${st.tools.join(", ")})`
                    : `${st.server}: failed (${st.error})`,
                )
                .join("\n")
            : "No MCP servers configured. Add them to ~/.clawcode/.mcp.json.",
        );
        return;
      case "/help":
        addInfo(HELP);
        return;
      case "/config":
        setMode("setup");
        return;
      case "/memory":
        addInfo(loadMemorySync().trim() || "No saved notes for this project yet.");
        return;
      case "/skills": {
        const skills = loadSkills();
        addInfo(
          skills.length
            ? skills.map((s) => `${s.name}: ${s.description}`).join("\n")
            : "No skills installed. Add SKILL.md folders to ~/.clawcode/skills.",
        );
        return;
      }
      case "/resume":
        await openSessionPicker();
        return;
      case "/new":
        newSession();
        messages.current = buildInitialMessages();
        setLines([]);
        return;
      case "/model": {
        const config = await loadConfig();
        if (!config?.models.length) {
          addInfo("No models configured. Use /config to add one.", true);
          return;
        }
        setModelChoices(config.models);
        setMode("model");
        return;
      }
      default:
        addInfo(`Unknown command: ${command}. Try /help.`, true);
    }
  };

  const submit = async (value: string) => {
    if (!value.trim()) return;
    setInput("");

    if (value.startsWith("/")) {
      let command = value.trim().split(/\s+/)[0];
      const exact = COMMANDS.some((c) => c.name === command);
      if (!exact && !/\s/.test(value.trim()) && suggestions.length > 0) {
        command = suggestions[suggestionIndex].label;
      }
      await runCommand(command);
      return;
    }
    if (!model) {
      addInfo("No model selected. Use /config to add one.", true);
      return;
    }

    setLines((prev) => [...prev, { role: "user", text: value }]);
    messages.current.push({ role: "user", content: value });
    permissions.setUserRequest(value);

    setIsThinking(true);
    try {
      await runTurn(messages.current, handleEvent);
    } catch (err: any) {
      addInfo(err?.message ?? String(err), true);
    } finally {
      setStreamText("");
      setIsThinking(false);
    }
  };

  return (
    <Box flexDirection="column">
      <Header model={model} loading={mode === "loading"} width={width} />
      {lines.map((line, i) => {
        if (line.role === "user") {
          return (
            <UserLine
              key={i}
              text={line.text}
              color={BAND_COLOR}
              width={width}
            />
          );
        }
        if (line.role === "tool") {
          return (
            <ToolLine
              key={line.id}
              name={line.name}
              arg={line.arg}
              status={line.status}
            />
          );
        }

        if (line.role === "write") {
          return <WriteLine key={line.id} line={line} />;
        }

        if (line.role === "diff") {
          return (
            <DiffView
              key={line.id}
              filePath={line.filePath}
              oldContent={line.oldContent}
              newContent={line.newContent}
            />
          );
        }

        if (line.role === "info") {
          return (
            <Box key={i} marginBottom={1}>
              <Text color={line.error ? "red" : "gray"}>{line.text}</Text>
            </Box>
          );
        }

        if (line.role === "answer") {
          return (
            <AnswerLine
              key={line.id}
              question={line.question}
              answer={line.answer}
            />
          );
        }

        return <AssistantLine key={i} text={line.text} />;
      })}

      {pendingQuestion && (
        <Select
          label={pendingQuestion.questions[0].question}
          options={[
            ...pendingQuestion.questions[0].options,
            { label: "Type something.", description: "", custom: true },
          ]}
          onSelect={(option) => {
            pendingQuestion.resolve(option.label);
            setLines((prev) => [
              ...prev,
              {
                role: "answer",
                id: `${Date.now()}`,
                question: pendingQuestion.questions[0].question,
                answer: option.label,
              },
            ]);
            setPendingQuestion(null);
          }}
        />
      )}

      {pendingPermission && (
        <Select
          label={`${pendingPermission.request.destructive ? "⚠" : "●"} Clawcode wants to run: ${pendingPermission.request.label}`}
          options={[
            { label: "Yes", description: "" },
            ...(pendingPermission.request.rememberLabel
              ? [
                  {
                    label: `Yes, don't ask again for "${pendingPermission.request.rememberLabel}"`,
                    description: "Saved to .clawcode/settings.json",
                  },
                ]
              : []),
            {
              label: "No, tell Clawcode what to do instead",
              description: "",
            },
          ]}
          onSelect={(option) => {
            const choice: PermissionChoice =
              option.label === "Yes"
                ? "yes"
                : option.label.startsWith("Yes")
                  ? "always"
                  : "no";
            addInfo(
              `${choice === "no" ? "Denied" : choice === "always" ? "Allowed (saved)" : "Allowed"}: ${pendingPermission.request.label}`,
              choice === "no",
            );
            pendingPermission.resolve(choice);
            setPendingPermission(null);
          }}
          onCancel={() => {
            addInfo(`Denied: ${pendingPermission.request.label}`, true);
            pendingPermission.resolve("no");
            setPendingPermission(null);
          }}
        />
      )}

      {mode === "setup" && (
        <SetupWizard
          onDone={(m) => {
            addInfo(`Saved ${m.name}.`);
            activate(m);
          }}
          onCancel={() => {
            setMode("chat");
            if (!model) addInfo("No model configured. Use /config to add one.", true);
          }}
        />
      )}

      {mode === "model" && (
        <Select
          label="Select a model"
          options={modelChoices.map((m) => ({
            label: m.id === model?.id ? `${m.name} (current)` : m.name,
            description: m.provider,
          }))}
          onSelect={async (o) => {
            const chosen = modelChoices.find(
              (m) => o.label === m.name || o.label === `${m.name} (current)`,
            );
            if (chosen) {
              await setDefaultModel(chosen.id);
              await activate(chosen);
            } else {
              setMode("chat");
            }
          }}
          onCancel={() => setMode("chat")}
        />
      )}

      {mode === "resume" && (
        <Select
          label="Resume a session"
          options={sessionChoices.map((s) => ({
            label: s.name,
            description: `${new Date(s.createdAt).toLocaleString()} · ${s.model ?? "unknown model"}`,
            value: s.id,
          }))}
          onSelect={(o) => (o.value ? loadSessionById(o.value) : setMode("chat"))}
          onCancel={() => setMode("chat")}
        />
      )}

      {streamText.trim() && <AssistantLine text={streamText} />}

      {showThinkingSpinner && (
        <Box paddingLeft={2} marginBottom={0}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text color="gray"> Thinking...</Text>
        </Box>
      )}

      <Banded color={BAND_COLOR} width={width}>
        <Text color="white">{"> "}</Text>
        <TextInput
          key={inputKey}
          value={input}
          onChange={setInput}
          onSubmit={submit}
          placeholder="Type a message..."
          focus={!pendingQuestion && !pendingPermission && mode === "chat"}
        />
      </Banded>
      {inChat && suggestions.length > 0 && (
        <Box flexDirection="column" paddingLeft={2}>
          {suggestions.map((sg, i) => (
            <Text
              key={sg.label}
              color={i === suggestionIndex ? "cyan" : undefined}
              dimColor={i !== suggestionIndex}
            >
              {i === suggestionIndex ? "❯ " : "  "}
              {sg.label.padEnd(Math.max(...suggestions.map((s) => s.label.length)) + 2)}
              <Text dimColor>{sg.hint}</Text>
            </Text>
          ))}
          <Text dimColor>{"  tab to complete · ↑↓ to choose"}</Text>
        </Box>
      )}
      {model && (
        <Text dimColor>
          {" "}
          {model.name} ({model.provider}) ·{" "}
          {isThinking ? "esc to interrupt" : "/help for commands"}
        </Text>
      )}
    </Box>
  );
}
