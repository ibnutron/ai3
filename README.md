# aiolah CLI

A terminal AI coding agent from [aiolah](https://aiolah.com). It reads and edits
files and runs commands in your project, and you can drive the same session
from your browser, phone or VS Code.

- **No API key needed.** Sign in with your aiolah account; usage is billed to your plan.
- **Many models.** Every coding model enabled on aiolah that your plan allows — not only Claude.
- **Remote control.** `aiolah rc` makes this folder controllable from [aiolah.com/code](https://aiolah.com/code) without opening ports.
- **You stay in control.** File changes and shell commands ask for Allow/Deny unless you choose otherwise.

Requires Node.js 22 or newer.

## Install

```bash
npm install -g @aiolah/cli
# or
curl -fsSL https://aiolah.com/cli/install.sh | bash
```

Check the installation any time with `aiolah doctor`.

## Quick start

```bash
aiolah auth login     # approve the code in your browser
cd my-project
aiolah                # interactive chat in this folder
```

`aiolah auth login` prints a code and opens the approval page; after you click
Approve the terminal signs in by itself. `aiolah auth status` shows who is
signed in, `aiolah auth logout` signs out and revokes this machine's token.

## Usage

### In the terminal

```bash
aiolah                  # interactive chat (same as: aiolah chat)
aiolah -c               # continue the last session
aiolah -r <session-id>  # resume a specific session (see: aiolah sessions list)
```

The agent can only touch files inside the workspace folder (`-w`, default: the
current folder).

### In scripts and CI

One prompt in, the final answer out. Piped input is appended to the prompt.

```bash
aiolah -p "summarize what this project does"
cat error.log | aiolah -p "explain this error"
aiolah -p "list the TODOs" --output-format json   # {"session_id", "model", "result"}
```

`aiolah -p` is the same as `aiolah run`. Nobody can answer an Allow/Deny prompt
here, so anything the permission mode doesn't allow is denied.

### Remote control

```bash
aiolah rc "My laptop"   # same as: aiolah remote-control "My laptop"
```

The machine appears as a device on [aiolah.com/code](https://aiolah.com/code)
(and in the aiolah app and VS Code extension). It connects out to aiolah — no
open ports, certificates or tokens. Actions that change files or run commands
show an Allow/Deny prompt there.

## Models

```bash
aiolah models           # coding models your plan can use, default marked
aiolah --model <id>     # use one
```

The list is read live from aiolah, so models enabled later (or a plan upgrade)
show up without updating the CLI. Without `--model`, your plan's default model
is used.

## Permissions

Choose how much the agent may do without asking with `--permission-mode`
(chat, run, rc and serve):

| Mode | Behaviour |
|---|---|
| `default` | Asks before every file change (`write_file`, `edit_file`) and every shell command (`run_bash`). |
| `acceptEdits` | File changes are allowed; shell commands still ask. |
| `bypassPermissions` | Never asks. Same as `--dangerously-skip-permissions` — only for sandboxes or throwaway machines. |

## Command reference

Every command accepts `-h, --help`; `aiolah -v` prints the version.

| Command | Description |
|---|---|
| `aiolah auth login` | Sign in through your browser (`--server <url>`, `--no-browser`). Shortcut: `aiolah login`. |
| `aiolah auth status` | Show the signed-in account and which credentials model calls use. Alias: `auth list`. |
| `aiolah auth logout` | Sign out and revoke this machine's token. Shortcut: `aiolah logout`. |
| `aiolah models` | List the coding models your plan can use. |
| `aiolah [chat]` | Interactive agent in the terminal. |
| `aiolah run [prompt...]` / `aiolah -p "<prompt>"` | Non-interactive: answer one prompt and exit (`--output-format text\|json`). |
| `aiolah remote-control [name]` / `aiolah rc [name]` | Control this folder from aiolah (`-n, --name <name>`). |
| `aiolah serve` | Same as `rc` when signed in; with `--port` it runs in direct mode (see below). |
| `aiolah attach <address>` | Join a direct-mode `serve` session from another machine. |
| `aiolah sessions list` | List saved sessions. |
| `aiolah doctor` | Check installation, login, server, models and relay. Exits 1 on failure. |
| `aiolah upgrade [version]` | Update from npm (`--check` only reports). Alias: `update`. |

Session flags (chat, run, rc, serve):

| Flag | Description |
|---|---|
| `-m, --model <id>` | Model to use (see `aiolah models`). |
| `-w, --workspace <dir>` | Folder the agent may read and change (default: current folder). |
| `-c, --continue` | Continue the most recently used session. |
| `-r, --resume <id>` | Resume a saved session by id. |
| `--permission-mode <mode>` | `default`, `acceptEdits` or `bypassPermissions`. |
| `--dangerously-skip-permissions` | Never ask. Only use it in a sandbox. |

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Call Anthropic directly with your own key instead of your aiolah plan (default model `claude-sonnet-5`). |
| `AIOLAH_SERVER` | aiolah server URL (default `https://aiolah.com`). Overrides the server saved at login. |
| `AIOLAH_RELAY_URL` | Relay URL for remote control (default `<server>/cli-relay`). |
| `AIOLAH_REMOTE_TOKEN` | Shared secret for direct mode (`serve --port` and `attach`). |

Exported variables win over a `.env` file next to the installed package.
Empty values count as unset.

## Privacy & data

- **Prompts sent through aiolah are logged to your account.** When you use the
  CLI with your aiolah login, every new prompt you send — typed in the
  terminal, sent from `/code` / the app / VS Code, or passed to `aiolah -p` — is
  recorded together with the model, device, session id and CLI version. Tool
  results and file contents in follow-up steps are sent to the model but not
  logged as prompts.
- **Your own key bypasses aiolah.** With `ANTHROPIC_API_KEY` set, model calls go
  straight to Anthropic and aiolah does not see or log them.
- **Local history.** Full sessions (conversation, tool calls, file contents) are
  saved as plain JSON in `~/.aiolah/sessions/` on the machine running the agent.
  Your login token is in `~/.aiolah/auth.json` (mode 0600).
- **The relay keeps nothing.** Remote-control messages pass through the aiolah
  relay without being stored.

## Troubleshooting

- `aiolah doctor` checks everything and tells you what to fix.
- **"Your plan quota is used up"** — the plan limit was reached; wait for the
  reset or upgrade your plan.
- **429 / "Provider returned error" on a free model** — free models are often
  busy; try again or pick another model from `aiolah models`.
- **"Not logged in"** — run `aiolah auth login`, or set `ANTHROPIC_API_KEY`.

## Advanced

### Direct mode (LAN / self-hosted, no aiolah account)

```bash
AIOLAH_REMOTE_TOKEN=<long-random-secret> aiolah serve --port 4317
aiolah attach ws://<host>:4317          # from another machine
```

Clients answer an HMAC challenge with the token (it never crosses the wire).
The page at aiolah.com/code can also connect ("Add direct device"), but an
`https://` page only accepts `wss://` — serve with `--cert <path> --key <path>`
or put a TLS proxy in front. Before exposing direct mode beyond localhost:

1. Always use TLS — prompts, file contents and command output cross the wire.
2. Set a long, fixed `AIOLAH_REMOTE_TOKEN` (32+ random bytes).
3. Don't open the port publicly; use a VPN, an SSH tunnel or a reverse proxy.
4. Keep the default permission mode on machines you care about; an unattended
   host (closed stdin) gets approvals from connected clients, and unanswered
   prompts are denied after 5 minutes.
5. Scope the workspace with `-w` and run as a low-privilege user.

### Running the relay (aiolah operators)

`aiolah relay --port 4320 --api https://aiolah.com` with `CLI_RELAY_SECRET`
set (must match the aiolah app). It binds 127.0.0.1; put it behind a TLS
reverse proxy at `/cli-relay/`. Hosts connect to `/host` with their CLI token
and device id (verified against aiolah); clients connect to
`/client?ticket=…` with a 60-second single-use ticket issued by aiolah and
checked locally. The relay only forwards frames and stores nothing.

### Wire protocol (for building clients)

JSON messages over one WebSocket:

1. Direct mode only: server → `{type:"challenge", nonce}`; client →
   `{type:"auth", hmac}` with `hmac = hex(HMAC-SHA256(key = token, message = nonce))`.
   Wrong answer → `{type:"error", text:"unauthorized"}` and the socket closes.
   Relay clients skip this step (the ticket authenticates them).
2. Server → `{type:"authed", sessionId, workspace, model, history}`, where
   `history` holds `{role:"user"|"assistant", text}` and
   `{role:"tool", name, input, result}` items.
3. Client → `{type:"user", text}` starts a turn. The server sends
   `{type:"busy"}`, then `{type:"tool", name, input}` /
   `{type:"tool_result", name, result}` per tool call, then
   `{type:"assistant", text}` and `{type:"idle"}`. Other connected clients
   receive the same `user` message.
4. When a tool needs approval: `{type:"confirm", id, description}` to every
   client; the first `{type:"confirm_reply", id, allow}` (or `y`/`n` on the host
   terminal) wins. No answer within 5 minutes counts as denied.

## Development

```bash
git clone https://github.com/ibnutron/aiocli && cd aiocli
npm install && npm run build && npm link
npm run typecheck
```

## License

MIT
