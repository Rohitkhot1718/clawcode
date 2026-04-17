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
      description: "Edit a file by replacing old content with new content",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          oldContent: { type: "string" },
          newContent: { type: "string" },
          previousStepContent: {
            type: "string",
            description:
              "A natural, conversational summary of the previous task or the current step.",
          },
        },
        required: [
          "filePath",
          "oldContent",
          "newContent",
          "previousStepContent",
        ],
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
        "Search for a string inside a file and return matching lines with line numbers. Use this instead of reading the whole file when looking for specific content.",
      parameters: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Absolute or relative path to the file",
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
            description: "The HTTP method (GET, POST, PUT, DELETE). Defaults to GET.",
          },
          body: {
            type: "string",
            description: "Optional raw JSON request body for POST and PUT requests",
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
];
