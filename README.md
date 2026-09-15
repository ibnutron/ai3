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

## Running `ai3 serve` in production (exposed beyond localhost)

`serve` is designed for one trusted operator driving one machine. Before
exposing it past `localhost`, treat the following as required, not optional:

1. **Always use TLS.** Auth is HMAC challenge/response (the token never crosses
   the wire), but every prompt, tool call, file content, and command output
   *does*. Run with `--cert/--key` (`wss://`), or terminate TLS in front of it
   (nginx/Caddy/Cloudflare Tunnel proxying to `ws://127.0.0.1:<port>`). The
   Tailscale + `tailscale cert` route is the least effort for a personal setup.
2. **Set a long, fixed `AI3_REMOTE_TOKEN`** in the package `.env` (32+ random
   bytes, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   Without it a new random token is printed at every start, which is fine for
   an interactive terminal but useless for a service.
3. **Bind narrowly / firewall the port.** `serve` listens on all interfaces.
   Don't open the port on a public IP; put it behind a VPN (Tailscale/WireGuard),
   an SSH tunnel (`ssh -L 4317:localhost:4317 host`), or a reverse proxy with
   its own auth.
4. **Never run with `--yolo` on a machine you care about.** Without it, every
   `write_file` / `edit_file` / `run_bash` waits for a y/N on the *host*
   terminal — which means an unattended service (stdin closed) will hang on
   the first mutating tool call. For an unattended host, either accept
   `--yolo` inside a sandboxed workspace/VM, or keep a terminal attached
   (tmux/screen) to approve calls.
5. **Scope the workspace** with `-w` to the single repo the session should
   touch; `run_bash` still executes with the host user's full privileges inside
   that cwd, so run the service as a low-privilege user.
6. **Keep it alive** with a supervisor, e.g. `pm2 start ai3 --name ai3-ai5 -- serve --port 4318 -w /srv/ai5`
   or a `systemd` unit with `Restart=on-failure`; stdin will be closed, so
   pair this with point 4.
7. **Sessions are plaintext JSON** in `~/.ai3/sessions/` (full conversation,
   tool inputs, file contents). Protect that directory's permissions and
   rotate/delete old sessions.

Not yet live-tested: `wss://` against a real certificate, and `attach` across
the public internet (only localhost so far).

## Status

Chat, tool-use, session persistence, and remote attach/serve work over a
single shared conversation (verified end-to-end with real API calls); no
multi-session concurrency within one process.
