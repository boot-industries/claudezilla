# Claudezilla - Claude Code Firefox Extension

**Version:** 0.4.3

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

**Key Features (v0.4.x):**
- Single window with max 10 tabs shared across Claude agents
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
└── install/            # Installation scripts
    ├── install-macos.sh
    └── install-linux.sh
```

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
| closeTab | Close specific tab by ID |
| closeWindow | Close entire window |
| getTabs | List tabs in pool |

### Page Interaction
| Command | Description |
|---------|-------------|
| getContent | Get page text (HTML opt-in, 50K limit) |
| click | Click element by selector |
| type | Type text in input |
| pressKey | Send keyboard events |
| scroll | Scroll to element/position |
| waitFor | Wait for element to appear |
| screenshot | Capture viewport (JPEG, configurable) |

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

## Payload Optimization (v0.4.3)

| Function | Default Limit | Parameter |
|----------|---------------|-----------|
| getContent | 50K chars | `maxLength` |
| getContent | No HTML | `includeHtml` |
| getAccessibilitySnapshot | 200 nodes | `maxNodes` |
| getPageState | 50 links, 30 buttons | `maxLinks`, `maxButtons`, etc. |
