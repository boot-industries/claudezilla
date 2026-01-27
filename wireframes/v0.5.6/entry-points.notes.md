# Claudezilla Entry Points - Notes

**Version:** 0.5.6
**Last Updated:** 2026-01-25

## What's New in v0.5.6

### Windows Entry Points
- **Named Pipe IPC:** `\\.\pipe\claudezilla` as alternative to Unix socket
- **PowerShell Installer:** `install-windows.ps1` for Windows setup

### Installer Scripts
| Platform | Script | Purpose |
|----------|--------|---------|
| macOS | `install-macos.sh` | Setup native host and manifest |
| Linux | `install-linux.sh` | Setup native host and manifest |
| Windows | `install-windows.ps1` | Setup host, manifest, and registry |

## Entry Point Categories

### 1. MCP Tools (Primary Interface)
30+ browser automation tools available to Claude Code:

**Browser Control:**
- `firefox_create_window` - Open URL in shared tab pool
- `firefox_close_tab` - Close tab (ownership enforced)
- `firefox_get_tabs` - List all tabs with ownership info
- `firefox_navigate` - Navigate to URL (owned tabs only)

**Page Interaction:**
- `firefox_click` - Click element by selector
- `firefox_type` - Type text in input field
- `firefox_press_key` - Send keyboard events
- `firefox_scroll` - Scroll to element or position
- `firefox_wait_for` - Wait for element to appear

**Page Analysis:**
- `firefox_screenshot` - Capture viewport (mutex-protected)
- `firefox_get_content` - Get page text content
- `firefox_get_page_state` - Fast structured JSON
- `firefox_get_accessibility_snapshot` - Semantic tree
- `firefox_evaluate` - Run JS (expression blocklist enforced)

**Focus Loops:**
- `firefox_start_loop` - Begin iterative loop
- `firefox_stop_loop` - End loop manually
- `firefox_loop_status` - Check current state

**Multi-Agent:**
- `firefox_request_tab_space` - Request tab when pool full
- `firefox_grant_tab_space` - Release tab to waiting agent
- `firefox_get_slot_requests` - Check pending requests

### 2. Slash Commands
Claude Code plugin commands:

| Command | Description |
|---------|-------------|
| `/focus` | Start a focus loop for iterative development |
| `/cancel-focus` | Stop the active focus loop |
| `/help` | Show Claudezilla help |

### 3. Extension UI
User-facing extension interface:

**Popup:**
- Connection status indicator
- Loop iteration counter
- Stop loop button
- Settings access

**Welcome Page:**
- Post-install setup instructions
- Connection test
- Quick start guide

### 4. Native Host IPC
Platform-specific IPC endpoints:

**Unix (macOS/Linux):**
```
Socket: $TMPDIR/claudezilla.sock
        or $XDG_RUNTIME_DIR/claudezilla.sock
Auth:   $TMPDIR/claudezilla-auth.token
```

**Windows:**
```
Pipe:   \\.\pipe\claudezilla
Auth:   %LOCALAPPDATA%\claudezilla\auth.token
```

### 5. Cloud APIs
Cloudflare Worker endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/create-checkout` | POST | Create Stripe checkout session |
| `/notify` | POST | Email signup notification |
| `/health` | GET | Health check |

### 6. CLI Tools
Development and installation tools:

**Development:**
```bash
# Load extension in Firefox
web-ext run --source-dir extension/

# Run MCP server directly
node mcp/server.js

# Run native host directly
cd host && node index.js
```

**Installation:**
```bash
# macOS
./install/install-macos.sh

# Linux
./install/install-linux.sh

# Windows (PowerShell)
.\install\install-windows.ps1
```

**Packaging:**
```bash
# Create XPI for distribution
npm pack
```

## Connection Flow

### Claude Code → Browser

```
Claude Code CLI
    ↓ MCP Protocol
MCP Server (mcp/server.js)
    ↓ IPC (socket or pipe)
Native Host (host/index.js)
    ↓ Native Messaging
Background Script (background.js)
    ↓ Content Script
Web Page
```

### Plugin → Host

```
Claude Code (session ending)
    ↓ Stop Hook
stop-hook.sh
    ↓ IPC (socket or pipe)
Native Host
    ↓ Returns loop state
Stop Hook (block exit or allow)
```

### User → Extension

```
User (clicks toolbar icon)
    ↓
Extension Popup
    ↓ runtime.sendMessage
Background Script
    ↓
Response displayed in popup
```

## Diagnostic Entry Points

### MCP Diagnose Tool
```
firefox_diagnose()
→ Returns: socket status, auth token status, extension version
```

### Popup Connection Test
Click extension icon → Shows connection status, agent count, tab count

### CLI Diagnostic
```bash
# Check socket exists (Unix)
ls -la $TMPDIR/claudezilla*

# Check pipe exists (Windows)
# Named pipes are transient, check by connecting

# Check auth token
cat $TMPDIR/claudezilla-auth.token  # Unix
type %LOCALAPPDATA%\claudezilla\auth.token  # Windows
```

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - High-level system design
- [Data Flow](./data-flow.mermaid.md) - Request/response cycles
