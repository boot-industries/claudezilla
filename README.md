# Claudezilla

Firefox browser automation for [Claude Code](https://claude.com/claude-code). A Google-free alternative to the official Chrome extension.

## Features

### Browser Automation
- **Tab Pool** — Single window with max 10 tabs, shared across Claude agents
- **DOM Reading** — Get page content with smart truncation
- **Click/Type** — Interact with elements by CSS selector
- **Screenshot** — JPEG at 60% quality, 50% scale (configurable)
- **Keyboard** — Press keys, use shortcuts (Ctrl+A, Enter, etc.)

### DevTools Access
- **Console Capture** — See console.log/warn/error and uncaught exceptions
- **Network Monitoring** — Track XHR, fetch, scripts with status codes and timing
- **JavaScript Evaluation** — Run JS in page context, extract data
- **Element Inspection** — Get attributes, styles, visibility
- **Wait for Element** — Handle SPAs and dynamic content
- **Scroll Control** — Scroll to elements or coordinates

### Fast Page Analysis (v0.4.0+)
- **Page State** — Structured JSON with headings, links, buttons, inputs, images
- **Accessibility Tree** — Semantic structure as screen readers see it (capped at 200 nodes)

### Visual Effects (v0.4.2+)
- **Focus Glow** — Golden sparkle effect follows Claude's focus
- **Watermark** — Corner badge with Claudezilla mascot and animated electrons
- **Tab Groups** — Color-coded tab groups (Firefox 138+)

### Payload Optimization (v0.4.3)
- **Content** — HTML excluded by default, text capped at 50K chars
- **Accessibility** — Tree capped at 200 nodes to prevent overflow
- **Page State** — Configurable limits per category (links, buttons, etc.)

### Multi-Agent Safety (v0.4.4)
- **Tab Ownership** — Each tab tracks its creator agent; only the creator can close it
- **Screenshot Mutex** — Screenshot requests are serialized to prevent tab-switching collisions
- **Agent IDs** — Each MCP server instance gets a unique ID for ownership tracking

### Security Hardening (v0.4.5)
- **Socket Security** — 0600 permissions, 10MB buffer limit, secure temp path
- **URL Validation** — Blocks javascript:, data:, file:// schemes
- **Content Ownership** — All content commands verify tab ownership
- **Opt-in Console** — Console capture disabled by default
- **Selector Validation** — CSS selectors validated before execution

## Requirements

- Firefox 91+
- Node.js 18+
- Claude Code CLI (for full functionality)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/boot-industries/claudezilla.git
cd claudezilla
```

### 2. Install the native messaging host

**macOS:**
```bash
./install/install-macos.sh
```

**Linux:**
```bash
./install/install-linux.sh
```

### 3. Load the extension in Firefox

1. Open Firefox and go to `about:debugging`
2. Click **"This Firefox"** in the sidebar
3. Click **"Load Temporary Add-on"**
4. Navigate to `extension/` and select `manifest.json`

### 4. Test the connection

Click the Claudezilla icon in the toolbar. You should see "Connected" status.

## Usage

### MCP Server (Recommended)

Claudezilla includes an MCP server so Claude Code sessions can discover and use Firefox automation.

**Setup:**
```bash
# Install MCP server dependencies
cd mcp && npm install

# Add to your Claude Code MCP config (~/.claude/.mcp.json):
{
  "mcpServers": {
    "claudezilla": {
      "command": "node",
      "args": ["/path/to/claudezilla/mcp/server.js"]
    }
  }
}
```

**Available MCP Tools:**

*Browser Control:*
- `firefox_create_window` — Open URL in shared 10-tab pool (returns ownerId)
- `firefox_get_content` — Read page text (HTML opt-in, 50K char limit)
- `firefox_click` — Click element by selector
- `firefox_type` — Type into input field
- `firefox_press_key` — Send keyboard events (Enter, Tab, shortcuts)
- `firefox_screenshot` — Capture screenshot (serialized to prevent collisions)
- `firefox_get_tabs` — List tabs with ownership info
- `firefox_close_tab` — Close your own tab (ownership enforced)
- `firefox_close_window` — Close entire window (affects all agents)

*Page Analysis:*
- `firefox_get_page_state` — Structured JSON (headings, links, buttons, inputs)
- `firefox_get_accessibility_snapshot` — Semantic tree (200 node limit)
- `firefox_get_element` — Element attributes, styles, visibility

*DevTools:*
- `firefox_get_console` — Console logs (filter by level)
- `firefox_get_network` — Network requests (filter by type/status)
- `firefox_evaluate` — Run JavaScript in page context
- `firefox_wait_for` — Wait for element to appear
- `firefox_scroll` — Scroll to element or position

### CLI Usage

Control Firefox directly from the command line:

```bash
# Browser control
./host/cli.js ping
./host/cli.js createWindow --url https://example.com
./host/cli.js navigate --url https://example.com
./host/cli.js getContent
./host/cli.js click --selector "button.submit"
./host/cli.js type --selector "input[name=q]" --text "hello"
./host/cli.js screenshot
./host/cli.js closeWindow --windowId 123

# DevTools
./host/cli.js getConsoleLogs --level error      # See JS errors
./host/cli.js getNetworkRequests --type xhr     # See API calls
./host/cli.js evaluate --expression "document.title"
./host/cli.js waitFor --selector ".loading-done"
./host/cli.js scroll --selector "#footer"
./host/cli.js getElementInfo --selector "button.submit"
```

### Browser Console

Open the browser console (Ctrl+Shift+J) and use:

```javascript
// Test connection
browser.runtime.sendMessage({ action: 'ping' }).then(console.log);

// Get current tab info
browser.runtime.sendMessage({ action: 'getActiveTab' }).then(console.log);

// Navigate to URL
browser.runtime.sendMessage({ action: 'navigate', params: { url: 'https://example.com' } });
```

## ⚠️ JavaScript Evaluation Warning

The `evaluate` command allows running arbitrary JavaScript in the page context. This is powerful for data extraction but has security implications:

- **Only use on trusted pages** — Malicious websites can modify JavaScript behavior
- **Don't evaluate untrusted code** — Never pass user input or page content directly to `evaluate`
- **Be aware of side effects** — JavaScript can modify page state, cookies, or send requests
- **Privileged context** — Runs with the same permissions as the page itself

**Safe usage pattern:**
```javascript
// SAFE: Run specific logic with hardcoded selectors
./host/cli.js evaluate --expression "document.querySelectorAll('article').length"

// DANGEROUS: Never do this
./host/cli.js evaluate --expression pageContent  // ❌ untrusted input
```

See [SECURITY.md](./SECURITY.md) for more details.

## Extension Permissions

Claudezilla works in both regular and private Firefox windows. The "Run in Private Windows" permission controls behavior:

- **Permission disabled (default)** — Extension only works in regular windows. Enable this permission to use Claudezilla in private browsing.
- **Permission enabled** — Extension works in private windows. `firefox_navigate` is disabled to prevent agents from accidentally creating non-private windows (preserving privacy intent).

To enable private window support:
1. Open Firefox and navigate to `about:addons`
2. Click on **Claudezilla**
3. Go to **Details** tab
4. Find **"Run in Private Windows"** and click **Allow**

## Security (v0.4.5)

- **Command whitelist** — Only predefined commands allowed (no arbitrary code execution)
- **Structured data** — Page content returned as data, never interpreted as instructions
- **Local socket** — Unix socket with 0600 permissions (user-only access)
- **URL validation** — Blocks `javascript:`, `data:`, `file://` schemes
- **Tab ownership** — Agents can only interact with tabs they created (128-bit agent IDs)
- **Opt-in console capture** — Console logs only captured when explicitly requested
- **Selector validation** — CSS selectors validated before execution

See [SECURITY.md](./SECURITY.md) for full security model (11 principles).

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  Firefox Extension  │────▶│  Native Messaging    │────▶│  MCP Server     │
│  (WebExtension)     │◀────│  Host (Node.js)      │◀────│  (Claude Code)  │
└─────────────────────┘     └──────────────────────┘     └─────────────────┘
        │                            │
        ▼                            ▼
   Browser APIs              Unix Socket IPC
   (tabs, DOM)               /tmp/claudezilla.sock
```

## Development

See [CLAUDE.md](./CLAUDE.md) for development notes.

## License

MIT

## Author

Chris Lyons — [boot.industries](https://boot.industries)
