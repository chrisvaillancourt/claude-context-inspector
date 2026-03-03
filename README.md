# claude-context-inspector

See exactly what Claude Code loads into context before your first message — system prompt, CLAUDE.md files, hook outputs, MCP server instructions, tool definitions, and more.

Works by routing API requests through a local proxy that captures the `system` field from each request, then renders the results as searchable HTML.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI

## Quick start

```bash
./inspect.sh
```

This starts the proxy, launches Claude Code through it, and opens the captured context in your browser when the session ends.

## Usage

### One-command wrapper

```bash
# Interactive session (full context — hooks, CLAUDE.md, MCP, skills)
./inspect.sh

# Pipe mode (minimal context)
./inspect.sh -p "your prompt here"

# Pass any claude flags through
./inspect.sh --model sonnet
```

### Manual (two terminals)

```bash
# Terminal 1: start the proxy
bun run capture-proxy.ts

# Terminal 2: run claude through it
ANTHROPIC_BASE_URL=http://localhost:9876 claude
```

Then view the capture:

```bash
bun run view.ts                          # most recent capture
bun run view.ts captures/some-file.json  # specific capture
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `9876` | Proxy listen port |
| `OUTPUT_DIR` | `./captures` | Where captured JSON files are saved |

## What gets captured

Each capture is a JSON file containing:

- **`system_blocks`** — the full system prompt array sent to the API, broken into blocks with cache control metadata
- **`model`** — which model was used
- **`metadata.tool_names`** — all tools available in the session
- **`metadata.tools_count`** — total tool count
- **`first_user_message`** — preview of the first message sent

The HTML viewer categorizes blocks by source:

| Tag | Matches on |
|---|---|
| System Prompt | Core Claude Code instructions |
| CLAUDE.md | User/project instruction files |
| Hook Output | SessionStart hooks, git status |
| MCP Config | MCP server instructions |
| Skills | Available skill listings |

## How it works

Claude Code supports `ANTHROPIC_BASE_URL` to redirect API traffic. The proxy:

1. Intercepts `POST /v1/messages` requests
2. Extracts the `system` field (the full pre-conversation context)
3. Deduplicates identical prompts from retries
4. Saves to a timestamped JSON file
5. Forwards the request to `api.anthropic.com` with streaming passthrough

Your session works normally — the proxy is transparent.

## Limitations

- Only captures context sent via the Anthropic API (not Bedrock/Vertex)
- The proxy runs unencrypted (HTTP) on localhost
- `inspect.sh` cleans previous captures on each run
