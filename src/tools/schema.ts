import type OpenAI from "openai";

type FnDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const messageToUser = {
  type: "string",
  description:
    "One short sentence telling the user what you're about to do, shown before the tool runs.",
} as const;

const toolDefs = [
  {
    name: "readFile",
    description:
      "Reads a text file from disk, returning line-numbered content within an offset/limit window.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        path: { type: "string", description: "Absolute path to the file." },
        offset: {
          type: "number",
          description: "Line index to start reading from.",
        },
        limit: {
          type: "number",
          description: "Max number of lines to return.",
        },
      },
      required: ["message_to_user", "path", "offset", "limit"],
      additionalProperties: false,
    },
  },
  {
    name: "writeFile",
    description:
      "Creates a new file or fully overwrites an existing one with the given content.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        path: { type: "string", description: "Absolute path to the file." },
        content: { type: "string", description: "Full content to write." },
      },
      required: ["message_to_user", "path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "editFile",
    description:
      "Replaces an exact string in an existing file. Fails if oldStr is missing, or matches more than once without replaceAll.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        path: { type: "string", description: "Absolute path to the file." },
        oldStr: { type: "string", description: "Exact existing text to find." },
        newStr: { type: "string", description: "Text to replace it with." },
        replaceAll: {
          type: "boolean",
          description:
            "Replace every occurrence instead of requiring a single unique match.",
        },
      },
      required: ["message_to_user", "path", "oldStr", "newStr", "replaceAll"],
      additionalProperties: false,
    },
  },
  {
    name: "glob",
    description:
      "Finds files by name/path pattern (e.g. src/**/*.ts) under a directory.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        pattern: {
          type: "string",
          description: "Glob pattern to match, e.g. **/*.ts",
        },
        path: {
          type: "string",
          description:
            "Directory to search under. Defaults to the current working directory.",
        },
      },
      required: ["message_to_user", "pattern", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "grep",
    description: "Searches file contents by regex under a path, using ripgrep.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        query: { type: "string", description: "Regex pattern to search for." },
        path: { type: "string", description: "File or directory to search." },
      },
      required: ["message_to_user", "query", "path"],
      additionalProperties: false,
    },
  },
  {
    name: "bash",
    description:
      "Runs a shell command via Git Bash (POSIX syntax) — git, npm, tests, etc.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        command: {
          type: "string",
          description: "The shell command to execute.",
        },
        runInBackground: {
          type: "boolean",
          description:
            "If true, returns immediately with a taskId instead of waiting for completion.",
        },
      },
      required: ["message_to_user", "command", "runInBackground"],
      additionalProperties: false,
    },
  },
  {
    name: "powerShell",
    description:
      "Runs a command via Windows PowerShell — same purpose as bash but native Windows syntax.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        command: {
          type: "string",
          description: "The PowerShell command to execute.",
        },
        runInBackground: {
          type: "boolean",
          description:
            "If true, returns immediately with a taskId instead of waiting for completion.",
        },
      },
      required: ["message_to_user", "command", "runInBackground"],
      additionalProperties: false,
    },
  },
  {
    name: "askUserQuestion",
    description:
      "Ask questions to the user and let them select from predefined options.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask the user.",
          items: {
            type: "object",
            properties: {
              question: {
                type: "string",
                description: "The question to ask the user.",
              },
              header: {
                type: "string",
                description: "A short header for the question.",
              },
              options: {
                type: "array",
                description: "Options available for the user to select.",
                items: {
                  type: "object",
                  properties: {
                    label: {
                      type: "string",
                      description: "The option label displayed to the user.",
                    },
                    description: {
                      type: "string",
                      description: "Additional information about the option.",
                    },
                  },
                  required: ["label", "description"],
                  additionalProperties: false,
                },
              },
            },
            required: ["question", "header", "options"],
            additionalProperties: false,
          },
        },
      },
      required: ["questions"],
      additionalProperties: false,
    },
  },
  {
    name: "saveMemoryNote",
    description:
      "Save a durable note to memory for future sessions in this project. If it corrects or updates an existing note, pass that note's exact current text as `replaces`.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        note: {
          type: "string",
          description: "Short, self-contained note (max 300 characters).",
        },
        replaces: {
          type: "string",
          description:
            "Exact text of an existing note to replace, or an empty string if none.",
        },
      },
      required: ["message_to_user", "note", "replaces"],
      additionalProperties: false,
    },
  },
  {
    name: "webSearch",
    description:
      "Searches the web and returns the top results (title, URL, snippet). Use for errors, docs, packages, and anything outside the codebase.",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        query: { type: "string", description: "The search query." },
      },
      required: ["message_to_user", "query"],
      additionalProperties: false,
    },
  },
  {
    name: "fetchURL",
    description:
      "Fetches a web page or API endpoint with GET and returns readable text (HTML is converted to text, JSON is pretty-printed).",
    parameters: {
      type: "object",
      properties: {
        message_to_user: messageToUser,
        url: { type: "string", description: "The http(s) URL to fetch." },
      },
      required: ["message_to_user", "url"],
      additionalProperties: false,
    },
  },
] satisfies FnDef[];

export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = toolDefs.map(
  (def) => ({ type: "function", function: def }),
);
