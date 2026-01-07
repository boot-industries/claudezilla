# Claudezilla

**Firefox browser automation for Claude Code.** A privacy-friendly alternative to Chrome-based solutions.

[![Version](https://img.shields.io/badge/version-0.4.8-blue.svg)](./CHANGELOG.md)

Give Claude the ability to browse the web, fill out forms, take screenshots, and extract data — all through Firefox.

## Why Claudezilla?

- **No Google account required** — Works with Firefox, no Chrome sign-in needed
- **Privacy-conscious** — Use private browsing, control what Claude can access
- **Multi-agent safe** — Multiple Claude sessions can share the browser without conflicts

## Quick Start

### 1. Install the extension

Install from **[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/claudezilla/)**

### 2. Install the native host

```bash
git clone https://github.com/boot-industries/claudezilla.git
cd claudezilla

# macOS
./install/install-macos.sh

# Linux
./install/install-linux.sh
```

### 3. Connect to Claude Code

Add to your Claude Code config (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "claudezilla": {
      "command": "node",
      "args": ["/path/to/claudezilla/mcp/server.js"]
    }
  }
}
```

Then install dependencies and restart Claude Code:

```bash
cd claudezilla/mcp && npm install
```

## What Can Claude Do?

| Capability | Description |
|------------|-------------|
| **Browse** | Open URLs, navigate pages, manage tabs |
| **Read** | Extract text, get page structure, accessibility tree |
| **Interact** | Click buttons, fill forms, press keys, scroll |
| **Screenshot** | Capture pages (JPEG, configurable quality) |
| **Wait** | Handle SPAs and dynamic content |

## Support Development

Claudezilla is free and open source. You can support its development with a one-time donation or monthly sponsorship:

- Click the **☕ Buy Me a Coffee** button on the welcome page after first install
- Or use the **☕ Support this project** link in the extension popup
- Donations are processed securely through Stripe

See [STRIPE_SETUP.md](./STRIPE_SETUP.md) for deployment and configuration details.

## Example Usage

Once connected, Claude can use commands like:

```
Claude, open https://example.com and take a screenshot
Claude, fill in the search box with "Firefox automation" and click submit
Claude, get all the links on this page
```

## Available Tools

### Browser Control
- `firefox_create_window` — Open URL in browser
- `firefox_get_content` — Read page text (50K char limit)
- `firefox_click` — Click element by CSS selector
- `firefox_type` — Type into input field
- `firefox_press_key` — Keyboard events (Enter, Tab, shortcuts)
- `firefox_screenshot` — Capture viewport
- `firefox_get_tabs` / `firefox_close_tab` — Manage tabs

### Page Analysis
- `firefox_get_page_state` — Structured data (headings, links, buttons)
- `firefox_get_accessibility_snapshot` — Semantic tree (screen reader view)
- `firefox_get_element` — Element attributes and styles
- `firefox_wait_for` — Wait for element to appear
- `firefox_scroll` — Scroll to element or position

## Requirements

- Firefox 91+
- Node.js 18+
- [Claude Code CLI](https://claude.com/claude-code)

## Privacy & Security

Claudezilla is designed with security in mind:

- **Command whitelist** — Only predefined actions allowed
- **Local only** — Communication via Unix socket (no network exposure)
- **Tab isolation** — Each Claude session owns its tabs
- **URL validation** — Blocks dangerous schemes (`javascript:`, `data:`)

Works in both regular and private Firefox windows. Tab navigation respects ownership — Claude can only navigate tabs it created.

See [SECURITY.md](./SECURITY.md) for the full security model.

## Architecture

```
Claude Code ←→ MCP Server ←→ Unix Socket ←→ Native Host ←→ Firefox Extension
```

The extension uses Firefox's [Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging) to communicate with a local Node.js process, which exposes tools via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Contributing

[Issues](https://github.com/boot-industries/claudezilla/issues) and PRs welcome. See [CLAUDE.md](./CLAUDE.md) for development notes.

## License

MIT

---

**Author:** Chris Lyons — [boot.industries](https://boot.industries)
