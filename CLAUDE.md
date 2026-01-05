# Claudezilla - Claude Code Firefox Extension

**Version:** 0.4.5

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

**Key Features (v0.4.x):**
- Single window with max 10 tabs shared across Claude agents
- Multi-agent safety (tab ownership, screenshot mutex, 128-bit agent IDs)
- Security hardening (socket permissions, URL validation, selector validation)
- Image compression (JPEG 60%, 50% scale by default)
- Payload optimization (text truncation, node limits)
- Visual effects (focus glow, watermark with animated electrons)
- Fast page analysis (structured JSON, accessibility tree)

## Architecture

```
Firefox Extension ←→ Native Messaging Host (Node.js) ←→ MCP Server ←→ Claude Code
```

## Directory Structure

```
claudezilla/
├── extension/           # Firefox WebExtension
│   ├── manifest.json   # Extension manifest (MV2)
│   ├── background.js   # Native messaging connection
│   ├── content.js      # DOM interaction
│   ├── icons/          # Extension icons
│   └── popup/          # Status popup UI
├── host/               # Native messaging host
│   ├── index.js        # Main entry point
│   └── protocol.js     # Message serialization
└── install/            # Installation scripts
    ├── install-macos.sh
    └── install-linux.sh
```

## Development

### Setup

```bash
# Install native host
./install/install-macos.sh

# Load extension in Firefox
# 1. Open about:debugging
# 2. Click "This Firefox"
# 3. Click "Load Temporary Add-on"
# 4. Select extension/manifest.json
```

### Testing

Click the Claudezilla icon in toolbar to test connection.

### Key Files

- `extension/background.js` - Native messaging and command routing
- `extension/content.js` - DOM manipulation in pages
- `host/protocol.js` - Message serialization (4-byte header + JSON)
- `host/index.js` - Main host loop

## Extension ID

```
claudezilla@boot.industries
```

## Native Messaging

- Protocol: JSON over stdin/stdout with 4-byte length header
- Host location: `~/.mozilla/native-messaging-hosts/claudezilla.json`
- Max message: 1MB (host→extension), 4GB (extension→host)

## Commands

### Browser Control
| Command | Description |
|---------|-------------|
| ping | Test connection |
| version | Get host version info |
| createWindow | Open URL in shared 10-tab pool |
| navigate | Navigate tab to URL (with tabId: owned tabs only) |
| closeTab | Close specific tab by ID |
| closeWindow | Close entire window |
| getTabs | List tabs in pool |

### Page Interaction
| Command | Description |
|---------|-------------|
| getContent | Get page text (HTML opt-in, 50K limit) |
| click | Click element by selector (returns text, id, className) |
| type | Type text in input (React/Angular compatible) |
| pressKey | Send keyboard events |
| scroll | Scroll to element/position |
| waitFor | Wait for element to appear |
| screenshot | Capture viewport (JPEG, configurable) |

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

## Payload Optimization (v0.4.3)

| Function | Default Limit | Parameter |
|----------|---------------|-----------|
| getContent | 50K chars | `maxLength` |
| getContent | No HTML | `includeHtml` |
| getAccessibilitySnapshot | 200 nodes | `maxNodes` |
| getPageState | 50 links, 30 buttons | `maxLinks`, `maxButtons`, etc. |

## Multi-Agent Safety (v0.4.4+)

**Tab Ownership:**
- Each tab tracks its creator (agentId from MCP server)
- Only the creator can close or navigate their own tabs
- All content commands (getContent, click, type, navigate, etc.) verify ownership
- Other agents get: `OWNERSHIP: Cannot <operation> tab X (owned by agent_Y)`
- Use `getTabs` to see ownership info for all tabs

**Screenshot Mutex:**
- All screenshot requests are serialized via promise chain
- Prevents tab-switching collisions when multiple agents screenshot simultaneously
- Each request waits for previous to complete before switching tabs

**Agent IDs (v0.4.5):**
- Generated at MCP server startup: `agent_<128-bit-hex>_<pid>`
- 128-bit entropy (16 random bytes) for security
- Passed automatically with all ownership-requiring commands
- Visible in `getTabs` response as `ownerId` field

## Security (v0.4.5)

**Socket Security:**
- Permissions set to 0600 (user-only access)
- Buffer limit 10MB prevents memory exhaustion
- Uses XDG_RUNTIME_DIR when available (secure temp path)

**Input Validation:**
- URL schemes whitelisted: `http:`, `https:`, `about:` only
- CSS selectors validated with length limit (1000 chars)
- Sensitive URL parameters redacted in network monitoring

**Privacy:**
- Console capture opt-in (disabled by default)
- Request bodies never captured (prevents credential leak)
- Debug logs created with 0600 permissions

See [SECURITY.md](./SECURITY.md) for full security model.
