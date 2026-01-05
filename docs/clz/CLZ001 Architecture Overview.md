# CLZ002 Architecture Overview

**Date:** 2026-01-05
**Version:** 0.4.5

## System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Claude Code   │────▶│    MCP Server    │────▶│   Native Host   │────▶│    Firefox      │
│   (CLI/Agent)   │◀────│   (Node.js)      │◀────│   (Node.js)     │◀────│   Extension     │
└─────────────────┘     └──────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                        │                       │
        ▼                       ▼                        ▼                       ▼
   User prompts           Tool dispatch           Socket IPC              Browser APIs
   MCP protocol           Agent ID mgmt           JSON messages           DOM, tabs, etc.
```

## Components

### 1. MCP Server (`mcp/server.js`)

Model Context Protocol server that Claude Code discovers and uses.

**Responsibilities:**
- Register tools with Claude Code (firefox_create_window, etc.)
- Generate unique agent ID (128-bit entropy)
- Inject agentId into ownership-requiring commands
- Route tool calls to native host via Unix socket

**Key data:**
```javascript
AGENT_ID = `agent_${randomBytes(16).toString('hex')}_${pid}`
SOCKET_PATH = '/tmp/claudezilla.sock'
```

### 2. Native Host (`host/index.js`)

Node.js process that bridges the socket and Firefox extension.

**Responsibilities:**
- Listen on Unix socket for MCP server connections
- Communicate with extension via Native Messaging (stdin/stdout)
- Serialize/deserialize messages (4-byte length header + JSON)
- Enforce buffer limits (10MB max)

**Protocol:**
```
┌────────────┬────────────────────────────┐
│ 4 bytes    │ JSON payload               │
│ (length)   │ (command, params, id)      │
└────────────┴────────────────────────────┘
```

### 3. Firefox Extension (`extension/`)

WebExtension (Manifest V2) that executes browser commands.

**Files:**
- `manifest.json` - Extension metadata, permissions
- `background.js` - Native messaging, command routing, tab management
- `content.js` - DOM interaction (click, type, scroll, etc.)
- `popup/` - Status popup UI

**Key state:**
```javascript
claudezillaWindow = {
  windowId: number,
  tabs: [{ tabId, url, title, ownerId }]  // max 10 tabs
}
```

## Communication Flow

### Tool Call Example: `firefox_click`

```
1. User: "Click the submit button"
2. Claude Code → MCP Server: firefox_click({ selector: "button.submit" })
3. MCP Server injects agentId, sends to socket
4. Native Host → Extension: { action: "click", params: {...}, requestId: uuid }
5. Extension → Content Script: sendMessage to tab
6. Content Script: document.querySelector(selector).click()
7. Response flows back through chain
```

### Tab Ownership Flow

```
1. Agent A calls firefox_create_window({ url: "..." })
2. Extension creates tab, stores { tabId, ownerId: "agent_abc123_1234" }
3. Agent B calls firefox_close_tab({ tabId })
4. Extension checks: ownerId !== agentId → REJECT
5. Error: "OWNERSHIP: Cannot close tab X (owned by agent_abc123_1234)"
```

## Security Boundaries

| Boundary | Protection |
|----------|------------|
| Socket | 0600 permissions, 10MB buffer limit |
| URL input | Scheme whitelist (http/https/about) |
| CSS selectors | Syntax validation, 1000 char limit |
| Tab access | Ownership verification per command |
| Agent identity | 128-bit random ID per session |

## File Structure

```
claudezilla/
├── extension/
│   ├── manifest.json      # MV2 manifest
│   ├── background.js      # 38KB - command routing
│   ├── content.js         # 38KB - DOM interaction
│   ├── icons/             # Extension icons
│   └── popup/             # Status UI
├── host/
│   ├── index.js           # Native host main
│   ├── protocol.js        # Message serialization
│   └── cli.js             # Direct CLI access
├── mcp/
│   └── server.js          # MCP server (22KB)
├── install/
│   ├── install-macos.sh
│   └── install-linux.sh
├── SECURITY.md            # Security model
├── CLAUDE.md              # Dev notes
└── README.md              # Public docs
```

## Dependencies

- **Node.js 18+** - Native host and MCP server
- **Firefox 91+** - WebExtension APIs
- **@anthropic-ai/sdk** - MCP protocol (mcp/package.json)

## Tags

#architecture #clz
