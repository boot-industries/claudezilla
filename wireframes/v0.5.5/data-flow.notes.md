# Claudezilla Data Flow - Notes

**Version:** 0.5.5
**Last Updated:** 2026-01-25

## What's New in v0.5.5

### IPC Layer Integration
All command flows now go through the IPC abstraction layer (`host/ipc.js`), which determines the appropriate IPC mechanism based on platform:
- **macOS/Linux:** Unix socket at `/tmp/claudezilla.sock` or `$XDG_RUNTIME_DIR/claudezilla.sock`
- **Windows:** Named pipe at `\\.\pipe\claudezilla`

### Expression Validation Flow
New validation step in `firefox_evaluate` that checks expressions against a blocklist before execution:
- Blocked patterns: `eval(`, `Function(`, `fetch(`, `XMLHttpRequest`, `document.cookie`, etc.
- Validation happens at MCP server layer before command reaches host

### Reduced Mutex Timeout
Screenshot mutex timeout reduced from 5s to 3s for faster feedback when mutex is held by another agent.

### Agent ID Truncation
Logging now uses `truncateAgentId()` to show only 12-character prefix for privacy.

## Flow Types

### 1. Standard Command Flow
Basic command flow for most operations (click, type, scroll, etc.):

```
Claude CLI → MCP Server → IPC Layer → Host → Native Messaging → Background → Content → Page
```

**Key Steps:**
1. MCP server injects agent ID and updates heartbeat
2. IPC layer provides platform-appropriate socket/pipe path
3. Host validates auth token against stored token
4. Background script verifies tab ownership before DOM operations
5. Content script executes action and returns structured result

### 2. Screenshot Flow (Mutex-Protected)
Screenshots require exclusive access due to tab switching:

```
Claude CLI → MCP → Host → Background (mutex acquire) → Content (readiness) → Capture → Compress → Return
```

**Mutex Behavior:**
- If mutex available: Acquire, switch tab, capture, release
- If mutex held by same agent: Allow (re-entrant)
- If mutex held by another agent >3s: Return `MUTEX_BUSY` error with hint

**Readiness Detection:**
1. Double requestAnimationFrame (ensures repaint)
2. Wait for critical network requests (XHR/fetch)
3. requestIdleCallback (browser has spare time)
4. Returns timeline for debugging

### 3. Expression Validation Flow (v0.5.5)
`firefox_evaluate` now validates expressions before execution:

```
Claude CLI → MCP (validateExpression) → [BLOCKED or ALLOWED] → Host → Content → Page
```

**Blocked Patterns:**
| Pattern | Reason |
|---------|--------|
| `eval(`, `Function(` | Code execution |
| `fetch(`, `XMLHttpRequest` | Network requests |
| `document.cookie` | Credential theft |
| `localStorage`, `sessionStorage` | Storage access |

### 4. Focus Loop Flow
Iterative development with stop hook:

```
Claude CLI → MCP → Host (start loop)
...later...
Claude (exit) → Stop Hook → IPC → Host (check state) → Block exit, re-inject prompt
```

**Cross-Platform Support:**
- Stop hook uses IPC layer to determine socket/pipe path
- Works identically on Unix and Windows

### 5. Orphaned Tab Cleanup Flow
Background process that runs every 60 seconds:

```
MCP → Check heartbeats → Find orphaned agents → Host → Background → Close tabs → Delete heartbeat
```

**Criteria for Orphan:**
- Agent ID in `agentHeartbeats` map
- `lastSeen` timestamp > 2 minutes ago

## Protocol Details

### Message Format
All messages use 4-byte length header + JSON:

```
[4 bytes: length][JSON payload]
```

### Auth Token
- 32 random bytes, hex-encoded
- Written to auth file on host startup
- MCP server reads file to get token
- Every request includes token for validation

### Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `OWNERSHIP` | Agent doesn't own tab | Use correct tab or create new one |
| `MUTEX_BUSY` | Screenshot mutex held | Wait and retry, or use `getPageState` |
| `POOL_FULL` | 10-tab limit reached | Use mercy system or close existing tabs |
| `BLOCKED` | Expression blocklisted | Modify expression to avoid blocked patterns |

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - High-level system design
- [Component Map](./component-map.mermaid.md) - Module relationships
