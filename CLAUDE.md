# Claudezilla — Claude Code Firefox Extension

**Version:** 0.6.3
**Documentation PREFIX:** CLZ

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

**Key Features:** Consent automation (4-pass CMP detection), lazy tool loading (~6,400 token savings), Linux/Windows/macOS support, annotated screenshots, focus loops, multi-agent tab coordination, orphaned tab cleanup, auto-retry system.

## Architecture

```
Firefox Extension <-> Native Messaging Host (Node.js) <-> MCP Server <-> Claude Code
```

```
claudezilla/
├── extension/       # Firefox WebExtension (MV2)
├── host/            # Native messaging host (protocol.js, index.js)
├── mcp/             # MCP server (server.js)
├── plugin/          # Claude Code plugin (focus loops)
├── website/         # Marketing website (Cloudflare Pages)
├── worker/          # Cloudflare Worker (Stripe backend)
└── install/         # Installation scripts (macos, linux)
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
- Host location: `~/.mozilla/native-messaging-hosts/claudezilla.json`
- Max message: 1MB (host->ext), 4GB (ext->host)
- All tools support optional `timeout` (5000-300000 ms, default: 150000)
- **Socket path:** XDG_RUNTIME_DIR -> `~/.claudezilla/` (mode 0700) -> tmpdir()
- **Windows:** `host.bat` wrapper (not `args` manifest field)

## Commands

### Browser Control
| Command | Description |
|---------|-------------|
| ping | Test connection |
| version | Get host version |
| createWindow | Open URL in shared 12-tab pool |
| navigate | Navigate owned tab to URL |
| closeTab | Close tab by ID |
| getTabs | List tabs with ownership |

### Page Interaction
| Command | Description |
|---------|-------------|
| getContent | Page text (HTML opt-in, 50K limit) |
| click | Click element by selector |
| type | Type text (React/Angular compatible) |
| pressKey | Send keyboard events |
| scroll | Scroll to element/position |
| waitFor | Wait for element |
| screenshot | Capture with dynamic readiness detection |

### Page Analysis
| Command | Description |
|---------|-------------|
| getPageState | Structured JSON (headings, links, buttons) |
| getAccessibilitySnapshot | Semantic tree (200 node limit) |
| getElementInfo | Element attributes, styles |
| evaluate | Run JS in page context |

### DevTools
| Command | Description |
|---------|-------------|
| getConsoleLogs | Console output by level |
| getNetworkRequests | XHR/fetch with timing |

### Focus Loop
| Command | Description |
|---------|-------------|
| startLoop | Start iterative loop with prompt and max iterations |
| stopLoop | Stop the active loop |
| getLoopState | Get current loop state |

## Multi-Agent Safety

- **Tab ownership:** Only creator can close/navigate their tabs
- **Tab pool:** 12 tabs shared; agents can only evict their own tabs
- **Mercy system:** `firefox_request_tab_space` / `firefox_grant_tab_space` with 30-second slot reservations
- **Screenshot mutex:** Serialized via promise chain; returns `MUTEX_BUSY` if held >3s
- **Agent IDs:** `agent_<128-bit-hex>_<pid>` (truncated to 12 chars in logs)
- **Session cleanup:** `goodbye` on SIGINT/SIGTERM; orphaned tab cleanup after 10 min inactivity

## Security

- Socket permissions 0600, buffer limit 10MB
- URL schemes whitelisted: `http:`, `https:`, `about:`, `file:`
- CSS selectors validated (1000 char limit)
- Expression validation blocks dangerous patterns in `evaluate`
- Path security: null byte, traversal, UNC injection prevention
- Console capture opt-in, request bodies never captured

See [SECURITY.md](./SECURITY.md) for full security model.

## Watermark Visual Effects

See **CLZ006 Watermark Visual Effects Reference** for shadow DOM isolation, SVG transform patterns, speech bubble coordinates (LOCKED: top: 36px, right: 32px).

**Primary file:** `extension/content.js`
