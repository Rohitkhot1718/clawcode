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
  }
}
```

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

### Single Command Execution

Execute a task directly without entering REPL:
```bash
clawcode "<task_description>"
```

## Command Reference

| Command | Description |
|---------|-------------|
| `use <model>` | Set default model |
| `models` | List configured models |
| `add-model --provider <p> --model <m>` | Register new model |
| `remove-model <model>` | Unregister model |
| `set-key --provider <p> --key <k>` | Store API credentials |
| `change-key --provider <p> --key <k>` | Update API credentials |
| `remove-key --provider <p>` | Remove API credentials |
| `config` | Display current configuration |
| `reset` | Reset configuration to defaults |

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

- Groq
- OpenRouter
- Ollama
- Gemini

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

1. Create provider class in `src/providers/`
2. Implement required interface methods
3. Register in provider factory

### Modifying System Prompts

Edit template files in `src/prompts/`:
- `system.md` - Main system instructions
- `summary.md` - Conversation summarization template
