# Claudezilla Entry Points - Notes

**Version:** 0.5.3
**Last Updated:** 2026-01-18

## Overview

Claudezilla has multiple entry points for different use cases: AI agent automation, human interaction, development, and deployment.

## Primary Entry Points

### 1. MCP Tools (Claude Code CLI)

The main interface for AI agents.

**Location:** Exposed via `mcp/server.js`

**Tool Categories:**

| Category | Tools | Purpose |
|----------|-------|---------|
| Browser Control | `create_window`, `navigate`, `close_tab`, `get_tabs` | Window/tab management |
| Page Interaction | `click`, `type`, `press_key`, `scroll`, `wait_for` | DOM manipulation |
| Analysis | `screenshot`, `get_page_state`, `get_accessibility_snapshot`, `get_element`, `evaluate` | Page inspection |
| DevTools | `get_console`, `get_network` | Debug info |
| Focus Loop | `start_loop`, `stop_loop`, `loop_status` | Persistent iteration |
| Coordination | `request_tab_space`, `grant_tab_space`, `get_slot_requests` | Multi-agent |
| Diagnostics | `diagnose` | Connection health |

**Example Usage:**
```javascript
// Claude Code calls
await mcp.callTool('firefox_create_window', { url: 'https://example.com' });
await mcp.callTool('firefox_click', { selector: 'button.submit' });
const screenshot = await mcp.callTool('firefox_screenshot', { quality: 60 });
```

### 2. Slash Commands (Claude Plugin)

User-invoked commands for focus loop control.

**Location:** `plugin/commands/*.md`

| Command | Description |
|---------|-------------|
| `/focus` | Start a focus loop with prompt and max iterations |
| `/cancel-focus` | Stop the active focus loop |
| `/help` | Show Claudezilla plugin help |

**Usage:**
```
User: /focus "Build a REST API" --max 20
Claude: Starting focus loop with max 20 iterations...

User: /cancel-focus
Claude: Focus loop stopped at iteration 7.
```

### 3. Stop Hook (Plugin)

Automatic interception of session exit.

**Location:** `plugin/hooks/stop-hook.sh`

**Trigger:** When Claude Code session is about to end

**Behavior:**
1. Query loop state from native host
2. If loop active and iterations remaining:
   - Block exit
   - Increment iteration counter
   - Re-inject original prompt
3. If loop inactive or complete:
   - Allow normal exit

### 4. Extension Popup

Human interface for status and control.

**Location:** `extension/popup/popup.html`

**Features:**
- Connection status indicator
- Test connection button
- Loop status display
- Stop loop button
- Settings (compression toggle)
- Auto-loop detection toggle

**Access:** Click Claudezilla icon in Firefox toolbar

### 5. Welcome Page

Post-installation onboarding.

**Location:** `extension/welcome.html`

**Shows:**
- Installation success
- Quick start guide
- Links to documentation
- Support options

## Development Entry Points

### 1. web-ext Development Server

Live-reloading extension development.

```bash
cd /path/to/claudezilla
npx web-ext run --source-dir=extension --browser=firefox
```

**Features:**
- Auto-reload on file changes
- Firefox Developer Edition compatibility
- Console logging visible in terminal

### 2. Installation Scripts

Set up native messaging host.

```bash
# macOS
./install/install-macos.sh

# Linux
./install/install-linux.sh
```

**What they do:**
1. Copy host files to `~/.claudezilla/`
2. Create native messaging manifest in Firefox's expected location
3. Set executable permissions

### 3. Package Building

Create distributable XPI.

```bash
# Using web-ext
npx web-ext build --source-dir=extension --artifacts-dir=web-ext-artifacts

# Or npm script
npm run package
```

**Output:** `web-ext-artifacts/claudezilla-0.5.3.zip`

## Cloud API Entry Points

### 1. Create Checkout Session

**Endpoint:** `POST /create-checkout`

**Request:**
```json
{
  "amount": 1000,     // Cents ($10.00)
  "frequency": "one-time"  // or "monthly"
}
```

**Response:**
```json
{
  "url": "https://checkout.stripe.com/..."
}
```

**Validation:**
- Origin must be in whitelist
- Amount: $3-$999.99
- Frequency: "one-time" or "monthly"

### 2. Email Signup

**Endpoint:** `POST /notify`

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Subscribed successfully"
}
```

**Storage:** D1 database (`email_signups` table)

### 3. Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok"
}
```

## Environment-Specific Entry Points

### Development

| Entry Point | Purpose |
|-------------|---------|
| `about:debugging` | Load temporary extension |
| `npm run dev` | Start development server |
| Native messaging logs | `$TMPDIR/claudezilla-debug.log` |

### Production

| Entry Point | Purpose |
|-------------|---------|
| Firefox Add-ons | Install from AMO |
| Native host | Installed via script |
| MCP config | Added to Claude Code settings |

## Initialization Sequence

1. **User installs extension** → Firefox loads background.js
2. **Background script** → Calls `connect()` to native host
3. **Native host** → Starts socket server, writes auth token
4. **MCP server** → Reads auth token, connects to socket
5. **Claude Code** → Discovers MCP tools, ready for commands

## Error Recovery

| Entry Point | Recovery Action |
|-------------|-----------------|
| MCP Tools | Auto-retry with exponential backoff (3 attempts) |
| Socket | Reconnect, reload extension if persistent |
| Native Messaging | Extension auto-reconnect (10 attempts) |
| Popup | Manual reconnect button |
| API | Return structured error with hint |

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - System layers
- [Data Flow](./data-flow.mermaid.md) - Request paths
