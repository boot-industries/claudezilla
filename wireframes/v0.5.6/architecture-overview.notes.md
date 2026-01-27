# Claudezilla Architecture Overview - Notes

**Version:** 0.5.6
**Last Updated:** 2026-01-25

## What's New in v0.5.6

### Windows Support
- **Named Pipes:** Windows 10/11 support via `\\.\pipe\claudezilla` named pipe
- **IPC Abstraction:** New `host/ipc.js` provides platform-independent IPC paths
- **ACL Security:** Windows uses `icacls` to restrict file access to current user
- **PowerShell Installer:** `install-windows.ps1` with `ConvertTo-Json` hardening

### Security Hardening
- **Path Validation:** `validatePath()` blocks null bytes, path traversal, UNC injection
- **Safe Temp Dir:** `getSafeTempDir()` validates environment variables before use
- **Expression Blocklist:** `firefox_evaluate` blocks dangerous patterns (fetch, eval, cookies)
- **Agent ID Truncation:** Privacy-enhanced logging shows only 12-char prefix

### Performance
- **Selector Optimization:** Early exit and 100-element limit per category
- **Mutex Timeout:** Screenshot mutex timeout reduced from 5s to 3s

## High-Level Design

Claudezilla uses a layered architecture that bridges Claude Code CLI with Firefox browser automation:

```
Claude Code CLI
     ↓ (MCP Protocol)
MCP Server
     ↓ (IPC: Unix Socket or Named Pipe)
Native Host (Node.js)
     ↓ (Native Messaging)
Firefox Extension
     ↓ (Content Scripts)
Web Pages
```

## Architectural Layers

### 1. Claude Code CLI Layer

- **Anthropic SDK:** Powers the Claude AI model
- **MCP Client:** Model Context Protocol client that discovers and calls tools
- **Tools visible:** 30+ browser automation tools prefixed with `firefox_*`

### 2. MCP Server Layer (`mcp/server.js`)

**Responsibilities:**
- Exposes browser automation as MCP tools
- Translates MCP tool calls to Claudezilla commands
- Manages agent heartbeats for orphaned tab cleanup
- Handles connection retry with exponential backoff
- **NEW:** Validates JavaScript expressions against blocklist

**Key Components:**
- `TOOLS[]` - Array of 30+ tool definitions with JSON schemas
- `TOOL_TO_COMMAND{}` - Maps tool names to Claudezilla commands
- `AGENT_ID` - 128-bit unique identifier per MCP server instance
- `agentHeartbeats` - Tracks last activity for each agent
- **NEW:** `EXPRESSION_BLOCKLIST` - Dangerous patterns for `firefox_evaluate`
- **NEW:** `truncateAgentId()` - Privacy-safe agent ID display

### 3. Native Host Layer (`host/index.js`)

**Responsibilities:**
- **NEW:** Platform-independent IPC via `ipc.js` module
- Unix socket server (macOS/Linux) or named pipe server (Windows)
- Loop state management (active, iteration, prompt)
- Auth token generation and validation
- Message serialization (4-byte length header + JSON)

**Security Model:**
- Socket permissions: 0600 (Unix) or ACL (Windows)
- Auth token: 32 random bytes, validated on every request
- Command whitelist: Only 30 specific commands allowed
- Buffer limit: 10MB max to prevent memory exhaustion
- **NEW:** `validatePath()` prevents path injection attacks

### 4. Firefox Extension Layer (`extension/background.js`)

**Responsibilities:**
- Native messaging connection to host
- Session management (single window, 12-tab pool)
- Screenshot mutex for multi-agent coordination
- Network request monitoring via webRequest API

**Key Patterns:**
- Persistent background script (MV2)
- Tab ownership tracking with agent IDs
- Auto-reconnect on disconnect (10 attempts, exponential backoff)

### 5. Content Script Layer (`extension/content.js`)

**Responsibilities:**
- DOM manipulation (click, type, scroll)
- Visual effects (watermark, focus glow)
- Console log capture
- Accessibility tree extraction
- Screenshot resizing via canvas

**Isolation:**
- Shadow DOM for visual elements (prevents CSS conflicts)
- Content is DATA, never interpreted as instructions

### 6. Claude Plugin Layer (`plugin/`)

**Focus Loop Architecture:**
- Stop hook intercepts Claude Code exit
- Queries loop state from native host via socket/pipe
- If loop active, blocks exit and re-injects prompt
- Enables Ralph Wiggum-style persistent iteration

## Design Patterns

### 1. Tab Ownership Pattern

Each tab tracks its creator agent ID. Only the creator can:
- Close the tab
- Navigate to new URLs
- Perform content operations

Prevents cross-agent interference in multi-agent scenarios.

### 2. Screenshot Mutex Pattern

Screenshots require:
1. Tab switching (only visible tab can be captured)
2. Page readiness detection
3. Capture and optional resize

All screenshot requests are serialized via promise chain to prevent race conditions. `MUTEX_BUSY` error returned if held >3 seconds (reduced from 5s).

### 3. Orphaned Tab Cleanup Pattern

Problem: Crashed Claude sessions leave tabs allocated.

Solution:
1. MCP server tracks agent heartbeats (every command updates timestamp)
2. Every 60s, check for agents with no activity in 2 minutes
3. Send `cleanupOrphanedTabs` command to extension
4. Extension closes all tabs owned by orphaned agent

### 4. Mercy System Pattern

When tab pool is full:
1. Agent calls `firefox_request_tab_space`
2. Request queued, agents with >4 tabs notified
3. Generous agent calls `firefox_grant_tab_space`
4. Oldest own tab released to waiting agent

## Security Hardening

| Area | Protection |
|------|------------|
| Socket/Pipe | 0600 permissions (Unix) or ACL (Windows), auth token required |
| URLs | Whitelist: http:, https:, about: only |
| Selectors | Length limit (1000 chars), validation |
| Network | Sensitive params redacted in logs |
| Payments | Origin whitelist, amount limits |
| **Paths** | **NEW:** `validatePath()` blocks null bytes, traversal, UNC |
| **Expressions** | **NEW:** Blocklist for dangerous JS patterns |

## Platform Differences

| Component | macOS/Linux | Windows |
|-----------|-------------|---------|
| IPC | Unix socket (`/tmp/claudezilla.sock`) | Named pipe (`\\.\pipe\claudezilla`) |
| Auth file | `$TMPDIR/claudezilla-auth.token` | `%LOCALAPPDATA%\claudezilla\auth.token` |
| Permissions | `chmod 0600` | `icacls` ACL |
| Installer | `install-macos.sh`, `install-linux.sh` | `install-windows.ps1` |
| Cleanup | Explicit socket deletion | Auto-cleanup on pipe close |

## Technical Debt

1. **Manifest V2:** Firefox still uses MV2, will need migration when Firefox requires MV3
2. **Single Window:** Currently limited to one private window (by design, but inflexible)
3. **No Tab Groups:** Tab grouping API (Firefox 138+) used minimally

## Related Diagrams

- [Component Map](./component-map.mermaid.md) - Detailed module breakdown
- [Data Flow](./data-flow.mermaid.md) - Request/response cycles
- [Deployment](./deployment-infrastructure.mermaid.md) - How code runs
