# Clawcode

An AI-powered command-line interface tool designed to automate complex development tasks through natural language processing and an intelligent agent loop architecture.

## Overview

Clawcode is an agentic system that interprets user requests in natural language and executes multi-step workflows by leveraging a suite of integrated tools. The system maintains conversation context throughout a session and provides real-time streaming responses.

### Key Capabilities

- **Natural Language Task Execution** - Interpret and execute development tasks from text descriptions
- **Multi-Step Workflow Orchestration** - Automatically decompose complex tasks into sequential operations
- **Real-Time Streaming Output** - Token-by-token response delivery for improved user experience
- **Session Context Management** - Maintain conversation history and state throughout sessions, with the ability to resume any prior session (see [Session Management](#session-management))
- **Persistent Memory** - Save durable notes that carry over across sessions
- **Permission-Gated Actions** - State-changing tools (file writes, shell commands) require approval, with destructive/caution command detection (see [Permissions](#permissions))
- **File System Operations** - Create, read, modify, and analyze files programmatically
- **Web Integration** - Search, fetch URLs, and retrieve external information when required

## Installation

### Prerequisites

- Node.js v20 or higher
- pnpm v10 or higher
- API credentials from a supported LLM provider (Groq, OpenRouter, or equivalent)

### Setup Instructions

```bash
# Install project dependencies
pnpm install

# Build TypeScript source code
pnpm build
```

## Configuration

### Initial Setup

1. **Configure API Credentials**
```bash
clawcode set-key --provider groq --key <api_key>
```

2. **Add LLM Model**
```bash
clawcode add-model --provider groq --model mixtral-8x7b-32768 --name "Mixtral"
```

3. **Set Default Model**
```bash
clawcode use mixtral-8x7b-32768
```

4. **Verify Configuration**
```bash
clawcode config
```

### Configuration File Location

Configuration is stored in `~/.clawcode/config.json` with the following structure:

```json
{
  "default": "model-id",
  "models": [
    {
      "id": "model-id",
      "provider": "groq",
      "model": "mixtral-8x7b-32768",
      "name": "Display Name"
    }
  ],
  "keys": {
    "groq": "api_key_here"
  },
  "endpoints": {
    "myCustomProvider": "https://my-openai-compatible-host/v1"
  }
}
```

`endpoints` is only populated for custom, non-builtin providers (see [Supported Providers](#supported-providers)).

## Usage

### Interactive Mode

Launch the interactive REPL environment:
```bash
clawcode
```

Available commands within REPL:
- `/model` - Switch active model
- `/config` - Access configuration interface
- `/exit` - Exit application
- `/help` - Display available commands
- `Esc` - Stop the current response/tool call
- `Ctrl+C` - Stop the current response/tool call if one is running; quits the app if idle

### Single Command Execution

Execute a task directly without entering REPL:
```bash
clawcode "<task_description>"
```

### Skills

Skills are pre-written, on-demand guidance the agent reads before tackling a matching task (e.g. project-specific conventions, a design checklist). There's no CLI command for these — create them directly under `~/.clawcode/skills/`.

**Add a skill** as a folder with a `SKILL.md`:
```
~/.clawcode/skills/
└── node-backend/
    ├── SKILL.md
    ├── examples/
    ├── scripts/
    └── resources/
```

`SKILL.md` needs YAML frontmatter with a `name` and `description`:
```markdown
---
name: node-backend
description: Conventions for building Node.js backend APIs — routing, error handling, validation, and project structure.
---

# Node Backend
...guidance content...
```

A flat `<name>.md` file directly in `~/.clawcode/skills/` (no subfolder) also works for simple cases.

**How it's used**: at the start of every session, the agent sees each skill's `name` and `description` (not its full content). Before a non-trivial task, if a skill's description matches the task's domain, the agent calls `getSkill` to read the full file and follow its guidance — automatically, without being asked. The `description` is what drives matching, so make it specific about what the skill covers.

### MCP (Model Context Protocol)

Clawcode can connect to external MCP servers and let the agent call their tools alongside its built-in ones.

**Register a server** via the CLI:
```bash
clawcode add-mcp --name myServer --command node --args "/path/to/server.js --port 3000" --env "API_KEY=abc123,DEBUG=true"
```

- `--args` is a single space-separated string of arguments
- `--env` is optional, comma-separated `KEY=VALUE` pairs

This writes to `~/.clawcode/.mcp.json` (created automatically on first run), which you can also edit directly:
```json
{
  "mcpServers": {
    "myServer": {
      "command": "node",
      "args": ["/path/to/server.js", "--port", "3000"],
      "env": { "API_KEY": "abc123", "DEBUG": "true" }
    }
  }
}
```

Each entry is spawned over stdio using the given `command`/`args`/`env` — only stdio-based servers are supported currently, not remote/HTTP MCP servers. All configured servers are connected automatically at startup, before the REPL launches.

**Using MCP tools**: once connected, the agent can call `listMCPTools` with a `serverName` to discover a server's tools, and `callMCPTool` with `serverName`, `toolName`, and `args` to invoke one — no extra setup needed on your end, just ask the agent to use the server by name.

## Command Reference

| Command | Description |
|---------|-------------|
| `use <model>` | Set default model |
| `models` | List configured models |
| `add-model --provider <p> --model <m> [--base-url <url>]` | Register new model (`--base-url` required for non-builtin providers) |
| `remove-model <model>` | Unregister model |
| `set-key --provider <p> --key <k>` | Store API credentials |
| `change-key --provider <p> --key <k>` | Update API credentials |
| `remove-key --provider <p>` | Remove API credentials |
| `config` | Display current configuration |
| `reset` | Reset configuration to defaults |
| `add-mcp --name <n> --command <c> [--args <a>] [--env <e>]` | Register a new MCP server |

## Architecture

### Agent Loop Pipeline

The agent operates through the following iterative cycle:

1. **Input Analysis** - Parse user request and extract intent
2. **Planning** - Determine required tools and execution sequence
3. **Tool Execution** - Invoke appropriate tools with parameters
4. **Result Processing** - Analyze tool output and determine next steps
5. **Iteration** - Repeat steps 2-4 until task completion
6. **Output Generation** - Generate and deliver final response

### Available Tools

| Tool | Purpose |
|------|---------|
| runCommand | Execute shell commands |
| createFile | Create new files |
| readFile | Read file contents |
| editFile | Modify existing files |
| listDirectory | Enumerate directory contents |
| grep | Search file contents |
| webSearch | Internet information retrieval |
| fetchURL | Fetch and read content from a specific URL |
| startBackground | Initiate background processes |
| readProcessOutput | Read output from a running background process |
| stopProcess | Terminate background processes |
| getLineCount | Determine file line count |
| saveMemoryNote | Persist a note to memory for future sessions |
| getSkill | Read a skill's full guidance file (see [Skills](#skills)) |
| listMCPTools | List tools exposed by a connected MCP server |
| callMCPTool | Invoke a tool on a connected MCP server |

## Session Management

Every REPL run is saved to disk automatically (`~/.clawcode/sessions/`) with a name derived from the first message.

```bash
# List saved sessions and resume interactively
clawcode --resume

# Resume a specific session by ID
clawcode --resume <sessionId>
```

The session ID and resume command are also printed whenever you exit with `/exit` or Ctrl+C, so you can pick a session back up later without hunting for the ID.

## Permissions

Tools that can change state (`createFile`, `editFile`, `runCommand`, etc.) prompt for approval before running. Read-only tools (`readFile`, `listDirectory`, `grep`, `getLineCount`, `readProcessOutput`, `webSearch`) never prompt.

- Shell commands are scanned for **destructive** patterns (`rm`, `format`, `git reset --hard`, `git push --force`, etc.) and **caution** patterns (package installs, `git push`, network fetches) and flagged accordingly in the prompt.
- Approvals can be granted once or persisted for the current project, stored in `.clawcode/settings.json` in the project directory (analogous to Claude Code's `.claude/settings.local.json`).

## Project Structure

```
clawcode/
├── src/
│   ├── agent/       # Agent loop implementation and permission manager
│   ├── cli/         # Command-line interface, REPL input, banner
│   ├── config/      # Configuration management
│   ├── memory/      # Persistent cross-session memory notes
│   ├── prompts/     # Prompt templates
│   ├── providers/   # LLM provider integrations
│   ├── session/     # Session persistence, listing, and resume
│   ├── tools/       # Tool implementations
│   └── utils/       # Utility functions
├── dist/            # Compiled JavaScript output
├── package.json     # Dependency definitions
└── README.md        # Documentation
```

## Development

```bash
# Run in development mode with hot reload
pnpm dev

# Build TypeScript to JavaScript
pnpm build

# Install globally for testing
npm install -g .
```

## Supported Providers

Built in, no extra setup:
- Groq
- OpenRouter
- Ollama
- Gemini
- NVIDIA

Any other OpenAI-compatible endpoint (self-hosted vLLM/LM Studio, Azure OpenAI proxy, etc.) can be registered as a custom provider:
```bash
clawcode set-key --provider myapi --key sk-xxx
clawcode add-model --provider myapi --model llama-3.1 --base-url https://myapi.example.com/v1
```

## Troubleshooting

### Configuration Issues

**Error: "No default model set"**
```bash
clawcode add-model --provider groq --model mixtral-8x7b-32768
clawcode use mixtral-8x7b-32768
```

**Error: "Invalid API key"**
```bash
clawcode change-key --provider groq --key <valid_key>
```

### Build Issues

If command not found after installation:
```bash
pnpm build
npm install -g .
```

## Extension and Customization

### Adding Custom Tools

1. Define tool schema in `src/tools/schema.ts`
2. Implement tool logic in `src/tools/index.ts`
3. Register tool in agent tool map

### Adding LLM Providers

Any OpenAI-compatible provider can be added without code changes — see [Supported Providers](#supported-providers) for the `set-key` / `add-model --base-url` flow.

To add a new **builtin** provider (no `--base-url` needed by users), add an entry to `BUILTIN_ENDPOINTS` in `src/providers/index.ts`.

### Modifying System Prompts

Edit template files in `src/prompts/`:
- `system.md` - Main system instructions
- `summary.md` - Conversation summarization template
