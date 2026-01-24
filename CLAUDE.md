# Claudezilla - Claude Code Firefox Extension

**Version:** 0.5.4

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

**Key Features (v0.5.4):**
- **NEW: Expression validation** - Blocked dangerous patterns in `firefox_evaluate` (fetch, eval, cookies)
- **NEW: Agent ID truncation** - Privacy-enhanced logging (12-char truncation in all outputs)
- **NEW: Selector search optimization** - Early exit and 100-element limit per category
- Focus loops - `/focus` slash command for iterative development
- Auto-retry system - Smart element waiting with enhanced error messages
- Task detection - Automatic detection of iterative tasks for focus loop suggestions
- Orphaned tab cleanup - Automatic cleanup of tabs from disconnected agents (2-minute timeout)
- Fair multi-agent coordination - POOL_FULL and MUTEX_BUSY errors with clear feedback
- Focus loops - Persistent iterative development like Ralph Wiggum
- Single window with max 10 tabs shared across Claude agents
- Multi-agent safety (tab ownership, screenshot mutex, 128-bit agent IDs, own-tab-only eviction)
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
├── mcp/                # MCP server
│   └── server.js       # Tool definitions and command routing
├── plugin/             # Claude Code plugin (focus loops)
│   ├── .claude-plugin/ # Plugin metadata
│   ├── hooks/          # Stop hook for loop enforcement
│   └── README.md
├── website/            # Marketing website (Cloudflare Pages)
│   ├── index.html      # Home page
│   ├── extension.html  # Setup/installation guide
│   ├── docs.html       # Documentation
│   ├── support.html    # Support/donations page
│   └── assets/         # CSS, JS, images
├── worker/             # Cloudflare Worker (Stripe backend)
│   ├── wrangler.toml   # Worker config
│   └── src/index.ts    # Checkout endpoint
└── install/            # Installation scripts
    ├── install-macos.sh
    └── install-linux.sh
```

## Deployment Notes

⚠️ **Cloudflare Pages deployment:** Deploy the `website/` directory, NOT `extension/`. The extension files are bundled into the XPI via manifest.json; the website/ directory contains the marketing landing page for claudezilla.com.

⚠️ **Manual deployment required:** This repo is under a GitHub org (boot-industries) which has connection issues with Cloudflare Pages auto-deploy. You must deploy manually after pushing:
```bash
wrangler pages deploy website --project-name=claudezilla
```

⚠️ **CDN cache propagation:** After deploying, the main domain (claudezilla.com) may serve cached content for a few minutes. The deployment preview URL (e.g., `https://[hash].claudezilla.pages.dev`) always shows the latest version immediately. Wait 2-5 minutes for CDN cache to propagate to the production domain.

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
| screenshot | Capture viewport with dynamic readiness detection |

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

### Focus Loop (v0.4.2)
| Command | Description |
|---------|-------------|
| startLoop | Start iterative loop with prompt and max iterations |
| stopLoop | Stop the active loop |
| getLoopState | Get current loop state (iteration, prompt, etc.) |

## Focus Loops (v0.4.2)

Enables Ralph Wiggum-style persistent iterative development. Claude works on a prompt repeatedly until completion.

**Architecture:**
```
Claude Code Session
    ↓
Plugin Stop Hook (claudezilla/plugin/)
    ↓ (Unix socket query)
Claudezilla Host (loop state)
    ↓
Firefox Extension (visual control)
```

**Usage:**
```javascript
// Start a focus loop
firefox_start_loop({
  prompt: "Build a REST API for todos",
  maxIterations: 20,
  completionPromise: "DONE"  // Optional: end when <promise>DONE</promise> detected
})

// Check status
firefox_loop_status()
// Returns: { active: true, iteration: 5, maxIterations: 20, ... }

// Stop manually
firefox_stop_loop()
```

**How it works:**
1. Claude calls `firefox_start_loop` with a task prompt
2. When Claude tries to exit, the plugin's Stop hook intercepts
3. Hook queries Claudezilla host for loop state
4. If active, hook blocks exit and re-injects the prompt
5. Loop continues until max iterations or manual stop

**Plugin installation:**
```bash
# From claudezilla directory
ln -s "$(pwd)/plugin" ~/.claude/plugins/claudezilla-loop
```

**Browser UI:**
- Loop status shown in extension popup
- Iteration counter and prompt preview
- Stop button for manual cancellation

## Screenshot Timing (v0.4.3)

Dynamic page readiness detection replaces hardcoded delays. Screenshots now wait for actual signals from the page before capture.

**How it works:**
1. **Network idle detection** - Waits for XHR/fetch/scripts to complete (critical resources)
2. **Visual idle** - Optional wait for images/fonts (3s max)
3. **Render settlement** - Double requestAnimationFrame + requestIdleCallback

**Parameters:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxWait` | 10000 | Maximum ms to wait for page ready |
| `waitForImages` | true | Wait for images/fonts to load |
| `skipReadiness` | false | Skip all detection (instant capture) |

**Response includes timing data:**
```javascript
{
  tabId: 123,
  dataUrl: "data:image/jpeg;base64,...",
  readiness: {
    waitMs: 347,        // Total wait time
    timedOut: false,    // Did we hit maxWait?
    timeline: [         // Decision log
      { t: 0, event: "start" },
      { t: 45, event: "critical_idle" },
      { t: 312, event: "visual_idle" },
      { t: 347, event: "render_settled" }
    ]
  }
}
```

**Fast path:** If page is already idle, captures in <50ms (just double RAF).

## Payload Optimization (v0.3.0)

| Function | Default Limit | Parameter |
|----------|---------------|-----------|
| getContent | 50K chars | `maxLength` |
| getContent | No HTML | `includeHtml` |
| getAccessibilitySnapshot | 200 nodes | `maxNodes` |
| getPageState | 50 links, 30 buttons | `maxLinks`, `maxButtons`, etc. |

## Multi-Agent Safety (v0.3.1+)

**Tab Ownership:**
- Each tab tracks its creator (agentId from MCP server)
- Only the creator can close or navigate their own tabs
- All content commands (getContent, click, type, navigate, etc.) verify ownership
- Other agents get: `OWNERSHIP: Cannot <operation> tab X (owned by agent_Y)`
- Use `getTabs` to see ownership info for all tabs

**Tab Pool Coordination (v0.4.4):**
- Agents can only evict their **own** tabs when pool is full
- If agent has no tabs but needs one, returns `POOL_FULL` error with hint to use mercy system
- No silent eviction of other agents' tabs

**Mercy System (v0.4.4):**
When blocked by POOL_FULL, agents can request tab space:
1. Blocked agent calls `firefox_request_tab_space` → queues request
2. Agents with >4 tabs see pending requests via `firefox_get_slot_requests`
3. Generous agent calls `firefox_grant_tab_space` → releases oldest tab to waiting agent

| Command | Description |
|---------|-------------|
| `firefox_request_tab_space` | Queue request for tab space (used when POOL_FULL) |
| `firefox_grant_tab_space` | Release oldest tab to help waiting agent (requires >2 tabs) |
| `firefox_get_slot_requests` | Check if agents are waiting for space |

**Orphaned Tab Cleanup (v0.4.5):**
Automatic cleanup of tabs from disconnected agents prevents tab pool exhaustion:
- **Heartbeat tracking**: MCP server tracks agent activity via command timestamps
- **Timeout threshold**: Agent is orphaned if no commands received in 2 minutes (120s)
- **Periodic cleanup**: MCP server checks every 60s for orphaned agents
- **Automatic recovery**: All tabs from orphaned agent are closed and space returned to pool
- **Logging**: Cleanup events logged to MCP server stderr with agent ID and tab count

How it works:
1. Each agent command updates heartbeat timestamp in MCP server
2. Every 60s, MCP server checks for agents with no activity in >120s
3. For each orphaned agent, MCP server sends `cleanupOrphanedTabs` command to extension
4. Extension closes all tabs owned by orphaned agent and updates tab pool tracking
5. Freed tab space becomes immediately available for active agents

This solves the "ghost agent" problem where tabs remain allocated to Claude sessions that have crashed, been killed, or lost connection.

**Screenshot Mutex:**
- All screenshot requests are serialized via promise chain
- Prevents tab-switching collisions when multiple agents screenshot simultaneously
- If mutex held >5s by another agent, returns `MUTEX_BUSY` error:
  ```
  MUTEX_BUSY: Screenshot mutex held by another agent.
    Holder: agent_ec2e...
    Held for: 6234ms
    Tab pool: 8/10
    Hint: Use getPageState (no mutex) or retry after delay.
  ```

**Agent IDs (v0.4.0):**
- Generated at MCP server startup: `agent_<128-bit-hex>_<pid>`
- 128-bit entropy (16 random bytes) for security
- Passed automatically with all ownership-requiring commands
- Visible in `getTabs` response as `ownerId` field

## Security (v0.4.0)

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

## Watermark Visual Effects

See **[[CLZ006 Watermark Visual Effects Reference]]** for complete documentation on:
- Shadow DOM isolation (prevents page CSS corruption)
- SVG transform patterns (do not use CSS transforms on SVG groups)
- Speech bubble coordinates (LOCKED: top: 36px, right: 32px)
- Troubleshooting guide

**Primary file:** `extension/content.js`
