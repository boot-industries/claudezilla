# Claudezilla - Claude Code Firefox Extension

## Overview

Firefox extension providing browser automation for Claude Code CLI. A Google-free alternative to the official Chrome extension.

## Architecture

```
Firefox Extension ←→ Native Messaging Host (Node.js) ←→ Claude Code CLI
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

| Command | Description |
|---------|-------------|
| ping | Test connection |
| version | Get host version info |
| navigate | Open URL in new tab |
| getContent | Get page content/element text |
| click | Click element by selector |
| type | Type text in input |
| screenshot | Capture visible viewport |
