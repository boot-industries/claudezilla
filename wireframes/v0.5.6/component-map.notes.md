# Claudezilla Component Map - Notes

**Version:** 0.5.6
**Last Updated:** 2026-01-25

## What's New in v0.5.6

### IPC Module (`host/ipc.js`)
New cross-platform IPC abstraction module providing:

| Function | Description |
|----------|-------------|
| `getSocketPath()` | Returns Unix socket path or Windows named pipe path |
| `getAuthTokenPath()` | Returns platform-appropriate auth token location |
| `getSafeTempDir()` | Returns validated secure temp directory |
| `validatePath(path, ctx)` | Security validation for paths |
| `cleanupSocket(path)` | Removes stale Unix sockets (no-op on Windows) |
| `setSecurePermissions(path)` | Sets 0600 on Unix (no-op on Windows) |
| `setWindowsFileACL(path)` | Sets ACL on Windows for user-only access |
| `isWindows()` | Platform check helper |
| `getPaths()` | Returns all platform paths for diagnostics |

### MCPServer Enhancements
- **`EXPRESSION_BLOCKLIST`:** Array of dangerous JavaScript patterns blocked in `firefox_evaluate`
- **`truncateAgentId(agentId)`:** Returns 12-char prefix for privacy-safe logging
- **`validateExpression(expr)`:** Checks expression against blocklist before execution

### Security Validations

**Path Validation (`validatePath`):**
```javascript
// Blocks:
// - Null bytes: "path\0injection"
// - Path traversal: "../../../etc/passwd"
// - UNC paths (Windows): "\\server\share"
// Allows:
// - Named pipes: "\\.\pipe\claudezilla"
```

**Expression Blocklist:**
```javascript
EXPRESSION_BLOCKLIST = [
  'eval(', 'Function(',           // Code execution
  'fetch(', 'XMLHttpRequest',     // Network requests
  'document.cookie',              // Credential theft
  'localStorage', 'sessionStorage' // Storage access
];
```

## Component Overview

### MCPServer
The MCP server is the bridge between Claude Code CLI and the browser automation system.

**Key Methods:**
- `sendCommand(command, params)` - Send command to native host via IPC
- `runDiagnostics()` - Returns system health information
- `cleanupOrphanedAgents()` - Removes tabs from disconnected agents
- `updateAgentHeartbeat(agentId)` - Track agent activity

### IPC (v0.5.6)
Platform-independent IPC abstraction layer.

**Platform Behavior:**

| Platform | Socket/Pipe Path | Auth Token Path |
|----------|------------------|-----------------|
| macOS | `/tmp/claudezilla.sock` | `/tmp/claudezilla-auth.token` |
| Linux | `$XDG_RUNTIME_DIR/claudezilla.sock` | `$XDG_RUNTIME_DIR/claudezilla-auth.token` |
| Windows | `\\.\pipe\claudezilla` | `%LOCALAPPDATA%\claudezilla\auth.token` |

### NativeHost
Node.js process that bridges IPC and native messaging.

**Key Methods:**
- `startSocketServer()` - Create Unix socket or named pipe server
- `handleCliCommand(command, params, auth)` - Validate and forward commands
- `handleExtensionMessage(message)` - Process responses from extension

### BackgroundScript
Firefox extension background script (MV2 persistent).

**Key Methods:**
- `verifyTabOwnership(tabId, agentId)` - Check agent owns tab before operations
- `waitForPageReady(tabId, options)` - Dynamic readiness detection before screenshot

### ContentScript
Injected into web pages for DOM interaction.

**Key Methods:**
- `click(params)` - Click element, returns `{tagName, text, id, className}`
- `getPageState()` - Fast structured JSON (headings, links, buttons)
- `getAccessibilitySnapshot(params)` - Semantic tree with `maxNodes` limit

## Tool Categories

### Browser Tools
Window and tab management:
- `firefox_create_window` - Open URL in shared 12-tab pool
- `firefox_close_tab` - Close tab (ownership enforced)
- `firefox_get_tabs` - List tabs with ownership info

### Page Tools
DOM interaction:
- `firefox_click` - Click by selector (auto-retry on fail)
- `firefox_type` - Type text (React/Angular compatible)
- `firefox_scroll` - Scroll to element or position

### Analysis Tools
Page inspection:
- `firefox_screenshot` - Capture with dynamic readiness, mutex-serialized
- `firefox_get_page_state` - Fast JSON structure
- `firefox_evaluate` - Run JS (expression blocklist enforced)

### Loop Tools
Focus loop management:
- `firefox_start_loop` - Begin iterative loop
- `firefox_stop_loop` - End loop manually
- `firefox_loop_status` - Check iteration count

### Coordination Tools
Multi-agent cooperation:
- `firefox_request_tab_space` - Queue request when pool full
- `firefox_grant_tab_space` - Release tab to waiting agent

## Dependencies

```
MCPServer
    ├── IPC (new in v0.5.6)
    │   └── Platform detection, path generation
    ├── NativeHost
    │   ├── Protocol (4-byte header serialization)
    │   └── BackgroundScript
    │       ├── ContentScript
    │       └── Popup
    └── TaskDetector
```

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - High-level system design
- [Data Flow](./data-flow.mermaid.md) - Request/response cycles
