# Claudezilla Architecture Overview - Notes

**Version:** 0.5.0
**Last Updated:** 2026-01-18

## High-Level Design

Claudezilla uses a layered architecture that bridges Claude Code CLI with Firefox browser automation:

```
Claude Code CLI
     ↓ (MCP Protocol)
MCP Server
     ↓ (Unix Socket + Auth Token)
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

**Key Components:**
- `TOOLS[]` - Array of 30+ tool definitions with JSON schemas
- `TOOL_TO_COMMAND{}` - Maps tool names to Claudezilla commands
- `AGENT_ID` - 128-bit unique identifier per MCP server instance
- `agentHeartbeats` - Tracks last activity for each agent

### 3. Native Host Layer (`host/index.js`)

**Responsibilities:**
- Unix socket server for MCP server communication
- Loop state management (active, iteration, prompt)
- Auth token generation and validation
- Message serialization (4-byte length header + JSON)

**Security Model:**
- Socket permissions: 0600 (user-only)
- Auth token: 32 random bytes, validated on every request
- Command whitelist: Only 30 specific commands allowed
- Buffer limit: 10MB max to prevent memory exhaustion

### 4. Firefox Extension Layer (`extension/background.js`)

**Responsibilities:**
- Native messaging connection to host
- Session management (single window, 10-tab pool)
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
- Queries loop state from native host via socket
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

All screenshot requests are serialized via promise chain to prevent race conditions. `MUTEX_BUSY` error returned if held >5 seconds.

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
| Socket | 0600 permissions, auth token required |
| URLs | Whitelist: http:, https:, about: only |
| Selectors | Length limit (1000 chars), validation |
| Network | Sensitive params redacted in logs |
| Payments | Origin whitelist, amount limits |

## Technical Debt

1. **Manifest V2:** Firefox still uses MV2, will need migration when Firefox requires MV3
2. **Single Window:** Currently limited to one private window (by design, but inflexible)
3. **No Tab Groups:** Tab grouping API (Firefox 138+) used minimally

## Related Diagrams

- [Component Map](./component-map.mermaid.md) - Detailed module breakdown
- [Data Flow](./data-flow.mermaid.md) - Request/response cycles
- [Deployment](./deployment-infrastructure.mermaid.md) - How code runs
