export const toolSchemas: any[] = [
  {
    type: "function",
    function: {
      name: "runCommand",
      description: "Execute a shell command in the windows environment",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["command", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createFile",
      description: "Create a file with specified content",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          content: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["filePath", "content", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readFile",
      description:
        "Read file contents with line numbers. Use offset and limit for large files instead of reading everything at once and also use getLineCount to see the number of lines the file contains.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          offset: {
            type: "number",
            description: "Line to start from (default 1)",
          },
          limit: {
            type: "number",
            description: "Max lines to read (default 200)",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["filePath", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listDirectory",
      description: "List files and directories in a specified directory",
      parameters: {
        type: "object",
        properties: {
          dirPath: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["dirPath", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "editFile",
      description:
        'Edit a file using EITHER (a) oldContent/newContent — oldContent must match the file\'s text exactly, or (b) startLine/endLine — replace a 1-based inclusive line range using the line numbers shown by readFile, with no exact text matching needed. Prefer startLine/endLine whenever you are adding, removing, or replacing whole lines (e.g. "keep only the first line", "add a line at the end") since it cannot fail on whitespace or content mismatches. Pass newContent as an empty string to delete.',
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          oldContent: {
            type: "string",
            description:
              "Exact text to find and replace. Omit this if using startLine/endLine instead.",
          },
          startLine: {
            type: "number",
            description:
              "1-based line to start at (inclusive). To INSERT without replacing anything (including appending at the end), set endLine to startLine - 1 — e.g. to append to a file with N lines, use startLine=N+1, endLine=N.",
          },
          endLine: {
            type: "number",
            description:
              "1-based line to stop at (inclusive). Use with startLine instead of oldContent.",
          },
          newContent: {
            type: "string",
            description:
              "Replacement or inserted text. Empty string deletes the matched content/lines.",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["filePath", "newContent", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "startBackground",
      description:
        "Start a long-running background process like dev servers, watchers, or any command that doesn't exit. Use this instead of runCommand for: npm start, npm run dev, vite, webpack, nodemon, or any server command.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          cwd: {
            type: "string",
            description: "Directory to run the command in. Optional.",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["command", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readProcessOutput",
      description:
        "Read the latest output from a background process started with startBackground. Use when user asks about errors, logs, or status of a running process.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Process ID returned by startBackground",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["id", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "stopProcess",
      description: `Stop a background process that was started with startBackground.
    ALWAYS use this tool to stop servers — never use runCommand with taskkill or kill.
    Using taskkill manually may kill the agent itself.`,
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["id", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description:
        "Search for a string in a file OR recursively across a directory, returning matching lines with their file path and line number. Pass a directory to search the whole codebase. Use this instead of reading whole files when looking for specific content.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description:
              "Path to a file or a directory. A directory is searched recursively (ignoring node_modules, .git, dist, etc.).",
          },
          query: {
            type: "string",
            description: "String to search for (case-insensitive)",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of what you are searching for in the file.",
          },
        },
        required: ["filePath", "query", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "webSearch",
      description:
        "Search the web for up-to-date information such as documentation, error solutions, or external knowledge not available in the codebase.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          previousStepContent: {
            type: "string",
            description:
              "A short explanation of what you are searching for and why.",
          },
        },
        required: ["query", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetchURL",
      description: "Fetch data from a REST API endpoint.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The API endpoint URL",
          },
          method: {
            type: "string",
            description:
              "The HTTP method (GET, POST, PUT, DELETE). Defaults to GET.",
          },
          body: {
            type: "string",
            description:
              "Optional raw JSON request body for POST and PUT requests",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["url", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getLineCount",
      description:
        "Get the total number of lines in a file efficiently without loading it into memory",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["filePath", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "saveMemoryNote",
      description:
        "Save a durable note to memory for future sessions. If this corrects or updates an existing note (shown in the Memory section of your instructions), pass its exact current text as `replaces` so it gets swapped instead of duplicated.",
      parameters: {
        type: "object",
        properties: {
          note: { type: "string" },
          replaces: {
            type: "string",
            description:
              "Exact text of an existing note this one replaces, copied verbatim from the Memory section. Omit if this is a brand-new note.",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["note", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getSkill",
      description:
        "Retrieve the content of a skill's main file, or any other file it references (script, example, reference doc) that lives in the same folder.",
      parameters: {
        type: "object",
        properties: {
          skillPath: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["skillPath", "previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listMCPTools",
      description: "List all available MCP tools and their descriptions.",
      parameters: {
        type: "object",
        properties: {
          serverName: {
            type: "string",
            description: "The name of the MCP server for which to list tools.",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["previousStepContent"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "callMCPTool",
      description:
        "Call a specific MCP tool with the provided arguments and return its output.",
      parameters: {
        type: "object",
        properties: {
          serverName: {
            type: "string",
            description: "The name of the MCP server to call the tool on.",
          },
          toolName: {
            type: "string",
            description: "The name of the MCP tool to call.",
          },
          args: {
            type: "object",
            description:
              "A JSON object containing the arguments to pass to the MCP tool.",
          },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: ["serverName", "toolName", "args", "previousStepContent"],
      },
    },
  },
];
