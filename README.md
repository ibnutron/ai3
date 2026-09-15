# ai3

Terminal AI CLI (like opencode / Claude Code) with remote-control support: start a
session on one machine and drive it from another. The model can read/write files
and run shell commands in a scoped workspace.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
npm run build
npm link                # puts the `ai3` binary on PATH globally
```

The `.env` next to the package is loaded automatically on every `ai3` invocation
(regardless of the current directory), so `npm run code` from another repo still
finds the key. Variables already exported in the environment take precedence.

## Commands

- `ai3 chat` — interactive chat with tool-use (file read/write/edit, `run_bash`)
  scoped to `--workspace` (default: current directory).
- `ai3 serve` — host a chat session and print a token + WebSocket address that a
  remote client can attach to. Tools always execute on the host, never on the
  attach client.
- `ai3 attach ws://<host>:<port>` — join a running `serve` session from another
  machine, using the token it printed. You'll be prompted for the token; auth
  uses an HMAC challenge/response so the token itself never crosses the wire.
- `ai3 sessions list` — list saved sessions (id, last updated, workspace).

### Flags

- `-w, --workspace <dir>` — root directory tools are scoped to (default `.`).
  File paths that resolve outside this directory are rejected.
- `--resume <id>` / `--continue` — resume a specific saved session, or the most
  recently updated one. Full history (including tool calls) is persisted to
  `~/.ai3/sessions/<id>.json` after every turn.
- `--yolo` — skip the y/n confirmation prompt before `write_file`, `edit_file`,
  or `run_bash`. Off by default: those three tools always ask first.
- `--cert <path> --key <path>` (serve only) — serve over `wss://` (TLS) using a
  self-signed cert or one from Tailscale/Let's Encrypt, for confidentiality
  when attaching over a real network instead of localhost.

## Remote-controlling another repo

Any repo can expose its own `ai3 serve`, rooted at that repo, via an npm
script, e.g.:

```json
{ "scripts": { "code": "ai3 serve --port 4318" } }
```

Then `npm run code` in that repo, and `ai3 attach ws://<host>:4318` from
another machine to work on it remotely.

## Status

Early scaffold. Chat, tool-use, session persistence, and remote attach/serve
work over a single shared conversation; no multi-session concurrency within
one process, and `wss://` has been code-reviewed but not live-tested against
a real certificate.
