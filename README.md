# aiolah

Terminal AI CLI with remote-control support: start a session on one machine and
drive it from another (aiolah /code, the aiolah app, or VS Code). The model can read/write files
and run shell commands in a scoped workspace.

## Install & sign in

```bash
curl -fsSL https://aiolah.com/cli/install.sh | bash   # or: npm install -g @aiolah/cli
aiolah auth login        # approve the code in your browser — no API key needed
aiolah rc                # control this folder from aiolah /code, the app or VS Code
```

Which credentials are used for model calls:

1. `ANTHROPIC_API_KEY` (env or the package `.env`) — if set, model calls go
   straight to Anthropic on your own key.
2. Otherwise the token from `aiolah auth login` (`~/.aiolah/auth.json`, mode
   0600) — model calls go through `https://aiolah.com/api/cli/anthropic` and are
   billed to your aiolah plan. Any coding model your plan allows can be used
   (Claude, GPT, Gemini, Qwen, … whatever aiolah has enabled); `aiolah models`
   lists them live and `--model <id>` picks one (default: your plan's default).

From source: `npm install && npm run build && npm link`. The `.env` next to the
package is loaded automatically on every invocation (regardless of the current
directory); variables already exported in the environment take precedence.

## Commands

- `aiolah auth login|logout|status` (shortcuts `aiolah login` / `aiolah logout`)
  — device-code sign-in: approve a code in your browser, no password or key in
  the terminal.
  `--server <url>` (or `AIOLAH_SERVER`) targets another aiolah instance,
  `--no-browser` only prints the URL.
- `aiolah remote-control [name]` / `aiolah rc [name]` — registers this folder as a device and dials out to the aiolah
  relay. No open port, certificate or token; the device appears on /code.
- `aiolah models` — list the coding models your aiolah plan can use (live from
  the server, so newly enabled models appear without updating the CLI).
- `aiolah` / `aiolah chat` — interactive chat with tool-use (file read/write/edit,
  `run_bash`) scoped to `--workspace` (default: current directory).
- `aiolah run "<prompt>"` / `aiolah -p "<prompt>"` — non-interactive: one prompt
  in, the final answer out (`--output-format text|json`). Piped stdin is appended
  to the prompt (`cat log.txt | aiolah -p "explain this error"`). Nobody can
  confirm here, so changes are denied unless the permission mode allows them.
- `aiolah doctor` — check the install, credentials, server, login, models and
  relay; exits 1 when a required check fails.
- `aiolah upgrade [version]` (alias `update`) — update the npm install to the
  latest or a given version; `--check` only reports.
- `aiolah serve` — same as `rc` when logged in and no `--port` is given. With
  `--port` it runs in **direct mode**: listens for WebSocket clients that
  authenticate with `AIOLAH_REMOTE_TOKEN` (LAN / self-hosted / no account).
  Tools always execute on the host, never on the client.
- `aiolah attach ws://<host>:<port>` — join a direct-mode `serve` session from
  another machine, using its token (HMAC challenge/response, the token never
  crosses the wire).
- `aiolah sessions list` — list saved sessions (id, last updated, workspace).
- `aiolah relay` — operators only: the relay server behind
  `wss://aiolah.com/cli-relay/` (see "Relay" below).

### Flags

- `-w, --workspace <dir>` — root directory tools are scoped to (default `.`).
  File paths that resolve outside this directory are rejected.
- `-m, --model <id>` — model to use (see `aiolah models`).
- `-r, --resume <id>` / `-c, --continue` — resume a specific saved session, or the
  most recently updated one. Full history (including tool calls) is persisted to
  `~/.aiolah/sessions/<id>.json` after every turn.
- `--permission-mode <mode>` — when to ask before mutating tools:
  `default` (ask before `write_file`, `edit_file`, `run_bash`), `acceptEdits`
  (file edits allowed, shell commands still ask), `bypassPermissions` (never
  ask). `--dangerously-skip-permissions` is the same as `bypassPermissions`
  (the old `--yolo` still works as a hidden alias).
- `-n, --name <name>` (serve/rc) — device name on /code (default
  `<hostname> · <folder>`).
- `--cert <path> --key <path>` (direct-mode serve only) — serve over `wss://` (TLS) using a
  self-signed cert or one from Tailscale/Let's Encrypt, for confidentiality
  when attaching over a real network instead of localhost.

## Relay (how `aiolah rc` works)

```
aiolah rc ──outbound wss──▶ aiolah relay ◀──wss + one-time ticket── /code, ai6, ai4
     │                          │
     └─ POST /api/v1/app/cli/hosts (register device)
                                └─ POST /api/cli/relay/host-online|host-offline (verify CLI token)
```

- The host connects to `/host` with `Authorization: Bearer <cli token>` and
  `X-Host-Id`; the relay verifies both against Laravel with the shared
  `CLI_RELAY_SECRET` header.
- Clients get a 60-second single-use ticket from Laravel
  (`POST /code/hosts/{id}/ticket` or `/api/v1/app/remote-hosts/{id}/ticket`)
  and connect to `/client?ticket=…`; the relay checks the HMAC locally.
- Clients speak the normal wire protocol below, minus the challenge: the host
  sends `authed` as soon as the relay pairs them. Between host and relay the
  messages are wrapped as `relay_client_joined` / `relay_client_left` /
  `relay_msg {from|to, msg}`. The relay keeps no conversation state.
- Run it with `CLI_RELAY_SECRET=… aiolah relay --port 4320 --api https://aiolah.com`
  (binds 127.0.0.1) behind nginx `location /cli-relay/ { proxy_pass http://127.0.0.1:4320/; … Upgrade headers … }`.

## Wire protocol (for building other clients)

`serve` speaks newline-free JSON messages over a single WebSocket. Any client
(web page, mobile app, editor extension) can implement it:

1. Server → `{type:"challenge", nonce}`; client → `{type:"auth", hmac}` where
   `hmac = hex(HMAC-SHA256(key = token, message = nonce))`. Wrong answer →
   `{type:"error", text:"unauthorized"}` and the socket closes (3 attempts per
   socket, 5 per IP per minute).
2. Server → `{type:"authed", sessionId, workspace, model, history}` where
   `history` is the conversation so far, flattened for rendering:
   `{role:"user"|"assistant", text}` and `{role:"tool", name, input, result}`.
3. Client → `{type:"user", text}` starts a turn. While it runs the server sends
   `{type:"busy"}`, then per tool call `{type:"tool", name, input}` and
   `{type:"tool_result", name, result}`, then `{type:"assistant", text}` and
   `{type:"idle"}`. A `user` message sent while busy gets `error: "busy"`.
   Other connected clients receive the same `user` message so they stay in sync.
4. Unless the host runs with `--dangerously-skip-permissions` (or a permission
   mode that allows them), mutating tools (`write_file`,
   `edit_file`, `run_bash`) pause with `{type:"confirm", id, description}` sent
   to every client and printed on the host terminal. The first answer wins —
   a client replies `{type:"confirm_reply", id, allow:true|false}`, or the host
   operator types `y`/`n`. No answer within 5 minutes counts as denied.

The token never crosses the wire, but everything else does: use `wss://` (see
production notes below) whenever the connection leaves localhost. Browsers
also refuse `ws://` from an `https://` page.

## Remote-controlling another repo

Any repo can expose its own `aiolah serve`, rooted at that repo, via an npm
script, e.g.:

```json
{ "scripts": { "code": "aiolah serve --port 4318" } }
```

Then `npm run code` in that repo, and `aiolah attach ws://<host>:4318` from
another machine to work on it remotely.

## Running direct-mode `aiolah serve --port` in production (exposed beyond localhost)

`serve` is designed for one trusted operator driving one machine. Before
exposing it past `localhost`, treat the following as required, not optional:

1. **Always use TLS.** Auth is HMAC challenge/response (the token never crosses
   the wire), but every prompt, tool call, file content, and command output
   *does*. Run with `--cert/--key` (`wss://`), or terminate TLS in front of it
   (nginx/Caddy/Cloudflare Tunnel proxying to `ws://127.0.0.1:<port>`). The
   Tailscale + `tailscale cert` route is the least effort for a personal setup.
2. **Set a long, fixed `AIOLAH_REMOTE_TOKEN`** in the package `.env` (32+ random
   bytes, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   Without it a new random token is printed at every start, which is fine for
   an interactive terminal but useless for a service.
3. **Bind narrowly / firewall the port.** `serve` listens on all interfaces.
   Don't open the port on a public IP; put it behind a VPN (Tailscale/WireGuard),
   an SSH tunnel (`ssh -L 4317:localhost:4317 host`), or a reverse proxy with
   its own auth.
4. **Never run with `--dangerously-skip-permissions` on a machine you care about.** Without it, every
   `write_file` / `edit_file` / `run_bash` waits for a y/N on the *host*
   terminal — which means an unattended service (stdin closed) will hang on
   the first mutating tool call. For an unattended host, either accept
   `--dangerously-skip-permissions` inside a sandboxed workspace/VM, or keep a terminal attached
   (tmux/screen) to approve calls.
5. **Scope the workspace** with `-w` to the single repo the session should
   touch; `run_bash` still executes with the host user's full privileges inside
   that cwd, so run the service as a low-privilege user.
6. **Keep it alive** with a supervisor, e.g. `pm2 start aiolah --name aiolah-ai5 -- serve --port 4318 -w /srv/ai5`
   or a `systemd` unit with `Restart=on-failure`; stdin will be closed, so
   pair this with point 4.
7. **Sessions are plaintext JSON** in `~/.aiolah/sessions/` (full conversation,
   tool inputs, file contents). Protect that directory's permissions and
   rotate/delete old sessions.

Not yet live-tested: `wss://` against a real certificate, and `attach` across
the public internet (only localhost so far).

## Status

Chat, tool-use, session persistence, and remote attach/serve work over a
single shared conversation (verified end-to-end with real API calls); no
multi-session concurrency within one process.
