# Claudezilla

Firefox browser automation for [Claude Code](https://claude.com/claude-code). A Google-free alternative to the official Chrome extension.

## Features

- **Tab Navigation** — Open URLs, switch tabs
- **DOM Reading** — Get page content, element text
- **Click** — Click elements by CSS selector
- **Type** — Enter text in input fields
- **Screenshot** — Capture visible viewport

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
- `firefox_create_window` — Create a private browser window
- `firefox_navigate` — Navigate to URL
- `firefox_get_content` — Read page content
- `firefox_click` — Click element by selector
- `firefox_type` — Type into input field
- `firefox_screenshot` — Capture screenshot
- `firefox_get_tabs` — List open tabs
- `firefox_close_window` — Close browser window

### CLI Usage

Control Firefox directly from the command line:

```bash
./host/cli.js ping
./host/cli.js createWindow --url https://example.com
./host/cli.js navigate --url https://example.com
./host/cli.js getContent
./host/cli.js click --selector "button.submit"
./host/cli.js type --selector "input[name=q]" --text "hello"
./host/cli.js screenshot
./host/cli.js closeWindow --windowId 123
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

## Security

- **Private windows only** — Claude can only operate in private browser windows
- **Command whitelist** — Only predefined commands are allowed (no arbitrary code execution)
- **Structured data** — Page content is returned as data, never interpreted as instructions
- **Local socket** — CLI communication is local-only via Unix socket

See [SECURITY.md](./SECURITY.md) for details.

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
