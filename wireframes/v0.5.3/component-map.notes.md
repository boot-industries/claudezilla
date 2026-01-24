# Claudezilla Component Map - Notes

**Version:** 0.5.3
**Last Updated:** 2026-01-18

## Core Components

### MCP Server (`mcp/server.js`)

The MCP server is the primary interface between Claude Code and browser automation.

**Responsibilities:**
- Expose 30+ browser tools via MCP protocol
- Route commands to native host via Unix socket
- Track agent heartbeats for orphaned tab cleanup
- Handle connection retry with exponential backoff

**Public API:**
| Function | Description |
|----------|-------------|
| `sendCommand(command, params)` | Send command to native host |
| `runDiagnostics()` | Check socket, auth, connection health |
| `cleanupOrphanedAgents()` | Remove tabs from dead agents |
| `updateAgentHeartbeat(agentId)` | Update last-seen timestamp |

**Key Constants:**
- `AGENT_ID`: 128-bit unique identifier (16 random bytes + PID)
- `SOCKET_PATH`: `$TMPDIR/claudezilla.sock`
- `AGENT_TIMEOUT_MS`: 120000 (2 minutes)
- `CLEANUP_INTERVAL_MS`: 60000 (1 minute)

### Native Host (`host/index.js`)

Node.js bridge between Unix socket and Firefox native messaging.

**Responsibilities:**
- Run Unix socket server for MCP communication
- Manage loop state (active, iteration, prompt)
- Handle authentication token generation/validation
- Forward commands to extension via native messaging

**Key State:**
```javascript
loopState = {
  active: false,
  prompt: '',
  iteration: 0,
  maxIterations: 0,
  completionPromise: null,
  startedAt: null
}
```

**Security Constants:**
- `MAX_BUFFER_SIZE`: 10MB
- `MAX_ITERATIONS_LIMIT`: 10000
- `MAX_LOOP_DURATION_MS`: 3600000 (1 hour)
- `MAX_COMPLETION_PROMISE_LENGTH`: 1000 chars

### Background Script (`extension/background.js`)

Extension's persistent background page handling all coordination.

**Responsibilities:**
- Native messaging connection to host
- Session management (claudezillaWindow, activeTabId)
- Screenshot mutex serialization
- Network request monitoring
- Tab ownership enforcement

**Key State:**
```javascript
claudezillaWindow = {
  windowId: number,
  tabs: [{ tabId, ownerId }, ...],
  createdAt: timestamp,
  groupId: number | null
}
```

**Auto-Reconnect Config:**
```javascript
RECONNECT_CONFIG = {
  maxAttempts: 10,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 1.5
}
```

### Content Script (`extension/content.js`)

Injected into every page for DOM manipulation.

**Responsibilities:**
- DOM interactions (click, type, scroll)
- Content extraction (text, HTML)
- Console log capture
- Accessibility tree extraction
- Visual effects (watermark, focus glow)
- Screenshot resizing via canvas

**Key Functions:**
| Function | Description |
|----------|-------------|
| `click({selector})` | Click element, returns clicked element info |
| `type({selector, text, clear})` | Type into input with React/Angular compatibility |
| `getContent({selector, maxLength})` | Extract text/HTML from page |
| `getPageState()` | Structured JSON with headings, links, buttons |
| `getAccessibilitySnapshot({maxNodes})` | Semantic tree (capped at 200 nodes) |
| `checkPageReadiness()` | Double RAF + idle callback for render settlement |

## Tool Categories

### Browser Control Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_create_window` | `createWindow` | Open URL in shared 10-tab pool |
| `firefox_navigate` | `navigate` | Navigate tab (ownership required) |
| `firefox_close_tab` | `closeTab` | Close own tab only |
| `firefox_get_tabs` | `getTabs` | List tabs with ownership info |
| `firefox_resize_window` | `resizeWindow` | Resize browser window |
| `firefox_set_viewport` | `setViewport` | Device viewport presets |

### Page Interaction Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_get_content` | `getContent` | Get page text (50K limit) |
| `firefox_click` | `click` | Click element by selector |
| `firefox_type` | `type` | Type into input field |
| `firefox_press_key` | `pressKey` | Send keyboard events |
| `firefox_scroll` | `scroll` | Scroll to element/position |
| `firefox_wait_for` | `waitFor` | Wait for element to appear |

### Analysis Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_screenshot` | `screenshot` | Capture with readiness detection |
| `firefox_get_page_state` | `getPageState` | Structured JSON (fast) |
| `firefox_get_accessibility_snapshot` | `getAccessibilitySnapshot` | Semantic tree |
| `firefox_get_element` | `getElementInfo` | Element attributes/styles |
| `firefox_evaluate` | `evaluate` | Execute JS in page context |

### DevTools Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_get_console` | `getConsoleLogs` | Captured console output |
| `firefox_get_network` | `getNetworkRequests` | XHR/fetch with timing |

### Focus Loop Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_start_loop` | `startLoop` | Start iterative loop |
| `firefox_stop_loop` | `stopLoop` | Stop active loop |
| `firefox_loop_status` | `getLoopState` | Get current loop state |

### Multi-Agent Coordination Tools
| Tool | Command | Description |
|------|---------|-------------|
| `firefox_request_tab_space` | `requestTabSpace` | Queue for tab slot |
| `firefox_grant_tab_space` | `grantTabSpace` | Release oldest tab |
| `firefox_get_slot_requests` | `getSlotRequests` | Check pending requests |

## Module Dependencies

```
┌─────────────────────────────────────────────────────────────┐
│                      Claude Code CLI                        │
└───────────────────────────┬─────────────────────────────────┘
                            │ MCP Protocol
┌───────────────────────────▼─────────────────────────────────┐
│                       MCP Server                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ TOOLS[]     │  │ AGENT_ID     │  │ agentHeartbeats   │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Unix Socket + Auth
┌───────────────────────────▼─────────────────────────────────┐
│                      Native Host                            │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ loopState   │  │ socketServer │  │ pendingCliRequests│  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└───────────────────────────┬─────────────────────────────────┘
                            │ Native Messaging
┌───────────────────────────▼─────────────────────────────────┐
│                   Background Script                         │
│  ┌─────────────────┐  ┌───────────────┐  ┌───────────────┐ │
│  │ claudezillaWindow│ │ screenshotLock │ │ networkRequests│ │
│  └─────────────────┘  └───────────────┘  └───────────────┘ │
└───────────────────────────┬─────────────────────────────────┘
                            │ executeInTab
┌───────────────────────────▼─────────────────────────────────┐
│                     Content Script                          │
│  ┌────────┐  ┌────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │ click  │  │ type   │  │ getContent│  │ getPageState    │ │
│  └────────┘  └────────┘  └──────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Related Diagrams

- [Data Flow](./data-flow.mermaid.md) - Request/response cycles
- [Entry Points](./entry-points.mermaid.md) - Ways to interact with the system
