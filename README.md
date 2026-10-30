# Clawcode

A coding agent for your terminal. It reads and edits files, runs commands, searches the web, and works with any OpenAI-compatible model.

## Setup

Requires Node.js 20+.

```bash
npm install
npm run dev
```

On first run, a setup wizard asks for a provider, API key and model. Supported out of the box: Groq, Gemini, Ollama, OpenRouter, NVIDIA, or any custom OpenAI-compatible endpoint.

Settings are saved in `~/.clawcode/config.json`. As a shortcut, setting `GROQ_API_KEY` in a `.env` file also works.

## Usage

Type a message and press Enter. Type `/` for commands or `@` to pick a file.

| Command | What it does |
|---|---|
| `/model` | Switch the active model |
| `/config` | Add a model or provider |
| `/new` | Start a fresh session |
| `/memory` | Show saved project notes |
| `/skills` | List installed skills |
| `/mcp` | Show connected MCP servers |
| `/help` | List commands |
| `/exit` | Quit |

**Keys:** `Esc` interrupts a running reply, `Ctrl+C` interrupts or quits, `Tab` completes a suggestion.

**Resume a session:** `npm run dev -- --resume` (pick from a list) or `--resume <id>`.

## Features

- Live streaming replies, with long chats compacted automatically
- Permission prompt before risky commands (deletes, installs, force-push); "don't ask again" is saved in `.clawcode/settings.json`
- Sessions saved per project, with auto-generated titles
- Project memory notes and on-demand skills in `~/.clawcode/skills`
- MCP servers from `~/.clawcode/.mcp.json`
- Web search (DuckDuckGo, no key needed; add a Tavily key at `keys.tavily` in the config to use Tavily instead) and page fetching

## Development

```bash
npm run typecheck
```
