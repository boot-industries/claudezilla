# Claudezilla — Claude Code Firefox Extension

**Version:** 0.7.7
**Documentation PREFIX:** CLZ

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

**Key Features:** Consent automation (4-pass CMP detection), full tool catalog by default (opt-in lazy loading with `--tools lazy`), stable element refs (`ref_N`) with text snapshots and `firefox_find`, vision-sized screenshots, Linux/Windows/macOS support, annotated screenshots, focus loops, multi-agent tab coordination, orphaned tab cleanup, auto-retry system, supply chain hardened.

## Architecture

```
Firefox Extension <-> Native Messaging Host (Node.js) <-> MCP Server <-> Claude Code
```

```
claudezilla/
├── extension/       # Firefox WebExtension (MV2)
├── host/            # Native messaging host (index.js, protocol.js, ipc.js, debug-log.js, cli.js)
├── mcp/             # MCP server (server.js, socket-request.js, autostart.js, agent-reaper.js)
├── plugin/          # Claude Code plugin (focus loops, claudezilla-browser skill)
├── website/         # Marketing website (Cloudflare Pages)
├── worker/          # Cloudflare Worker (Stripe backend)
└── install/         # Installation scripts (macos, linux, windows)
```

## Deployment

**Cloudflare Pages:** Deploy `website/` directory (NOT `extension/`).

**Manual deploy required** (GitHub org connection issues with auto-deploy):
```bash
wrangler pages deploy website --project-name=claudezilla
```

CDN cache propagation takes 2-5 minutes after deploy.

## Extension ID

```
claudezilla@boot.industries
```

## Native Messaging

- Protocol: JSON over stdin/stdout with 4-byte length header
- Host manifest: `~/.mozilla/native-messaging-hosts/claudezilla.json` (Linux), `~/Library/Application Support/Mozilla/NativeMessagingHosts/claudezilla.json` (macOS), `%APPDATA%\claudezilla\claudezilla.json` plus an HKCU registry key (Windows)
- Max message: 1MB (host->ext), 10MB (ext->host; host-side cap, the protocol allows 4GB)
- All tools support optional `timeout` (5000-300000 ms, default: 150000)
- **Socket path:** XDG_RUNTIME_DIR -> `~/.claudezilla/` (mode 0700) -> tmpdir()
- **Override (POSIX only):** `CLAUDEZILLA_IPC_DIR` puts the socket, auth token and debug log in that directory (mode 0700; an existing directory is chmod'ed to 0700). The host is launched by Firefox and inherits the *browser's* environment, while the MCP server resolves the path from *its own* environment at module load — so both must carry the same value, and the MCP server must be restarted after a change. Windows uses a fixed named pipe and a `%LOCALAPPDATA%` token path, so the variable is ignored there.
- **Windows:** `host.bat` wrapper (not `args` manifest field)
- **Optional on-demand start:** `CLAUDEZILLA_AUTOSTART_CMD` starts the browser when the host is not reachable. The command is an argv vector (a JSON array, or a plain string split on whitespace), executed with `execFile` and never through a shell. The readiness check is a connection attempt, not a file check, so it works with the Windows named pipe. Listing the tools never starts the browser; the first tool call does. `CLAUDEZILLA_AUTOSTART_WAIT_MS` (default 45 s) bounds the wait for the socket; `CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS` (default 60 s) throttles retries after a failed start.

## Commands

### Browser Control
| Command | Description |
|---------|-------------|
| ping | Test connection |
| version | Get host version |
| createWindow | Open URL in shared 12-tab pool (auto-fallback on private mode failure) |
| navigate | Navigate an owned pool tab or an attached tab to URL; never creates a window |
| getActiveTab | Selected tab of the current window |
| closeTab | Close tab by ID |
| closeWindow | Close the Claudezilla window (refused only when tabs of two or more different agents are open; an adopted user window keeps the window and closes only the tracked tabs) |
| getTabs | List tabs with ownership |
| listAllTabs | List every open tab across windows |
| attachTab / detachTab | Drive (or release) a user tab in place |
| getWindows | List windows as `{windowId, private, focused, tabCount}` |
| resizeWindow | Resize/reposition a window |
| setViewport | Apply a device viewport preset |
| setPrivateMode | Private (default) or regular windows for new Claudezilla windows |
| getWindowMode | Query private mode capability and current window state |
| handleConsent | Dismiss cookie/consent dialogs |
| goodbye | Agent session ending: close that agent's tabs |
| quitBrowser | Close every window (clean quit, Claudezilla window last); CLI/supervisor only, opt-in via `CLAUDEZILLA_ALLOW_QUIT` |

### Page Interaction
| Command | Description |
|---------|-------------|
| getContent | Visible page text (`ref`/selector scope, 20K chars per call, `offset` paging, HTML opt-in) |
| click | Click element by `ref` or selector |
| type | Type text by `ref` or selector (React/Angular compatible) |
| pressKey | Send keyboard events |
| scroll | Scroll to element/position (instant by default) |
| waitFor | Wait for element, text or URL pattern |
| screenshot | Vision-sized capture (`maxEdge` 1568, `region` zoom) with dynamic readiness detection |

### Page Analysis
| Command | Description |
|---------|-------------|
| getPageState | Structured JSON (headings, links, buttons, inputs, images, landmarks; headings, links, buttons and inputs carry `ref`) |
| getAccessibilitySnapshot | Compact text tree with `[ref_N]` handles (200 node default, `filter: interactive`, `format: json`) |
| find | Elements by visible text or accessible name, with refs and landmark context |
| getElementInfo | Element attributes, styles |
| evaluate | Run JS in page context |

### DevTools
| Command | Description |
|---------|-------------|
| getConsoleLogs | Uncaught errors and unhandled promise rejections (page `console.*` calls are not captured) |
| getNetworkRequests | XHR/fetch with timing |

### Focus Loop
| Command | Description |
|---------|-------------|
| startLoop | Start iterative loop with prompt and max iterations |
| stopLoop | Stop the active loop |
| getLoopState | Get current loop state |
| incrementLoopIteration | Advance the loop (called by the stop hook) |

### Multi-Agent
| Command | Description |
|---------|-------------|
| requestTabSpace / grantTabSpace / getSlotRequests | Tab-pool slot requests and 30-second reservations |
| cleanupOrphanedTabs | Close an idle agent's tabs (MCP-side reaper) |

## Multi-Agent Safety

- **Tab ownership:** Pool tabs record their creator; close and navigate are owner-checked; content commands are checked only when a `tabId` is passed (the MCP server injects the agent's current tab once it has one; before that the window's active tab is used unchecked). Attached tabs are owner-checked only on close, and another agent can re-attach an attached tab. Owner `unknown` bypasses the check.
- **Tab pool:** 12 tabs shared; agents can only evict their own tabs
- **Mercy system:** `firefox_request_tab_space` / `firefox_grant_tab_space` with 30-second slot reservations
- **Screenshot mutex:** Serialized via promise chain; if another agent has held it >2.5s the caller gets `Screenshot mutex held by another agent` (internal code `MUTEX_BUSY`)
- **Agent IDs:** `agent_<128-bit-hex>_<pid>` (truncated to 12 chars in logs)
- **Session cleanup:** bounded `goodbye` (2 s, never autostarts the browser) on SIGINT/SIGTERM/SIGHUP, stdin end and beforeExit; each MCP server closes its own agent's pool tabs after 10 min without a tool call (`CLAUDEZILLA_AGENT_TIMEOUT_MS`, `0` disables)

## Security

- Socket chmod'ed to 0600 right after `listen()`, buffer limit 10MB
- URL schemes whitelisted: `http:`, `https:`, `about:`, `file:`
- CSS selectors validated (1000 char limit)
- Expression validation blocks dangerous patterns in `evaluate`
- Path security: null byte, traversal, UNC injection prevention
- Error capture opt-in (uncaught errors and rejections only), request bodies never captured
- Host debug log capped at 10 MB (rotated to `.1`), records command names, not parameters; the extension console still prints raw host messages (known gap)
- Screenshot `savePath` confined to temp/working directories with a matching extension, written 0600 without following symlinks
- Auth token comparison via `crypto.timingSafeEqual()`
- Explicit CSP in manifest: `script-src 'self'; object-src 'self'`
- `quitBrowser` is refused unless `CLAUDEZILLA_ALLOW_QUIT=1` is in the browser's environment (the host inherits it from Firefox, never from the socket client); no MCP tool exposes it

### Supply Chain Hardening (v0.6.4)

- `ignore-scripts=true` in `.npmrc` (root, `mcp/`, `worker/`) — blocks postinstall hook attacks
- All direct dependency versions pinned to exact (no `^`/`~` ranges)
- pnpm with strict dependency isolation for development and CI (root, `mcp/`, `worker/`); the installers run `npm install` in `mcp/`, which ignores `pnpm-lock.yaml`
- GitHub Actions SHA-pinned (no mutable tags)
- All CI workflows have explicit `permissions:` blocks
- Bot-detection in `dep-audit.yml` flags Dependabot/Renovate PRs
- macOS/Linux install scripts use the `--ignore-scripts` flag; the Windows installer relies on `mcp/.npmrc` (`ignore-scripts=true`)
- Lockfiles committed for all workspaces including zero-dep `host/`

See [SECURITY.md](./SECURITY.md) for full security model.

## Watermark Visual Effects

See **CLZ006 Watermark Visual Effects Reference** for shadow DOM isolation, SVG transform patterns, speech bubble coordinates (LOCKED: top: 36px, right: 32px).

**Primary file:** `extension/content.js`
