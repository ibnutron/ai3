# ai3

Terminal AI CLI (like opencode / Claude Code) with remote-control support: start a
session on one machine and drive it from another.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY
```

## Commands

- `npm run dev -- chat` — interactive chat in the current terminal.
- `npm run dev -- serve` — host a chat session and print a token + WebSocket
  address that a remote client can attach to.
- `npm run dev -- attach ws://<host>:<port>` — join a running `serve` session
  from another machine, using the token it printed.

Build a standalone binary with `npm run build`, then run `node dist/cli.js ...`
(or `npm link` to expose the `ai3` command globally).

## Status

Early scaffold. Chat and remote attach/serve are functional over a single
shared conversation; no persistence, multi-session, or tool-use support yet.
