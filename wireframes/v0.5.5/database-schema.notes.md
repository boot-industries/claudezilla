# Claudezilla Database Schema - Notes

**Version:** 0.5.5
**Last Updated:** 2026-01-25

## What's New in v0.5.5

### IPC State Tracking
New conceptual structure for tracking platform-specific IPC state:

```javascript
// host/ipc.js getPaths() returns:
{
  platform: "win32" | "darwin" | "linux",
  isWindows: boolean,
  tempDir: string,
  socketPath: string,      // Unix socket or named pipe
  authTokenPath: string,
  debugLogPath: string
}
```

## Data Storage Types

Claudezilla uses two types of data storage:

### 1. Persistent Storage (Cloudflare D1)
SQLite database for website operations:

**Table: `email_signups`**
| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `email` | TEXT | Unique, lowercase email |
| `created_at` | INTEGER | Unix timestamp (ms) |

### 2. In-Memory State (Extension/Host)
Ephemeral state managed in JavaScript:

**Structure: `loopState`** (Native Host)
```javascript
{
  active: boolean,       // Is loop running?
  prompt: string,        // Task prompt
  iteration: number,     // Current iteration
  maxIterations: number, // Limit (0 = unlimited)
  completionPromise: string, // Exit signal text
  startedAt: string      // ISO timestamp
}
```

**Structure: `claudezillaWindow`** (Background Script)
```javascript
{
  windowId: number,      // Firefox window ID
  createdAt: number,     // Unix timestamp
  groupId: number,       // Tab group ID (optional)
  tabs: Map<tabId, { ownerId: string }>
}
```

**Structure: `agentHeartbeats`** (MCP Server)
```javascript
Map<agentId, lastSeen>
// agentId: "agent_<128-bit-hex>_<pid>"
// lastSeen: Unix timestamp (ms)
```

**Structure: `pendingSlotRequests`** (Background Script)
```javascript
[
  { agentId: string, requestedAt: number },
  ...
]
```

**Structure: `screenshotMutexHolder`** (Background Script)
```javascript
{
  agentId: string,       // Holding agent
  acquiredAt: number,    // Unix timestamp (ms)
  requestId: string      // Unique request ID
}
```

**Structure: `networkRequests`** (Background Script)
```javascript
Map<requestId, {
  url: string,           // Redacted URL
  method: string,        // GET, POST, etc.
  type: string,          // xhr, script, image
  tabId: number,
  timestamp: number,
  status: string,        // pending, completed, error
  statusCode: number,
  duration: number
}>
```

## State Lifecycle

### Tab Entry Lifecycle
```
1. firefox_create_window → Creates tab with ownerId = current agentId
2. Commands use verifyTabOwnership() to check access
3. firefox_close_tab → Removes tab (ownership required)
4. Orphan cleanup → Removes tabs from inactive agents (>2min)
```

### Agent Heartbeat Lifecycle
```
1. MCP command received → updateAgentHeartbeat(agentId)
2. Every 60s → cleanupOrphanedAgents()
3. If lastSeen > 2min ago → Close agent's tabs, delete heartbeat
```

### Screenshot Mutex Lifecycle
```
1. firefox_screenshot requested
2. Check if mutex available (or same agent)
3. If held by other agent >3s → Return MUTEX_BUSY
4. Acquire mutex → Take screenshot → Release mutex
```

### Slot Request Lifecycle
```
1. Agent tries to create tab when pool full
2. Pool returns POOL_FULL error
3. Agent calls firefox_request_tab_space → Queued
4. Agent with >4 tabs calls firefox_grant_tab_space
5. Oldest tab released, request fulfilled
```

## Platform Differences (v0.5.5)

### IPC Paths
| Platform | Socket/Pipe | Auth Token |
|----------|-------------|------------|
| macOS | `$TMPDIR/claudezilla.sock` | `$TMPDIR/claudezilla-auth.token` |
| Linux | `$XDG_RUNTIME_DIR/claudezilla.sock` | `$XDG_RUNTIME_DIR/claudezilla-auth.token` |
| Windows | `\\.\pipe\claudezilla` | `%LOCALAPPDATA%\claudezilla\auth.token` |

### State Persistence
| State | Location | Persistence |
|-------|----------|-------------|
| Loop state | Native host memory | Until host restart |
| Tab ownership | Extension memory | Until extension restart |
| Agent heartbeats | MCP server memory | Until MCP restart |
| Email signups | Cloudflare D1 | Persistent |

## Data Security

### Agent IDs
- 128-bit random entropy
- Format: `agent_<32-char-hex>_<pid>`
- Logged as truncated (12 chars) for privacy

### Auth Token
- 32 random bytes, hex-encoded
- File permissions: 0600 (Unix) or ACL (Windows)
- Validated on every IPC request

### Network Requests
- Sensitive URL params redacted before storage
- Request bodies never captured

## Related Diagrams

- [Component Map](./component-map.mermaid.md) - Where state is managed
- [Data Flow](./data-flow.mermaid.md) - How state changes flow
