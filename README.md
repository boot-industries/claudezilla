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

Once installed, Claudezilla provides browser automation capabilities that can be accessed through the native messaging protocol.

### Testing Commands

Open the browser console (Ctrl+Shift+J) and use:

```javascript
// Test connection
browser.runtime.sendMessage({ action: 'ping' }).then(console.log);

// Get current tab info
browser.runtime.sendMessage({ action: 'getActiveTab' }).then(console.log);

// Navigate to URL
browser.runtime.sendMessage({ action: 'navigate', params: { url: 'https://example.com' } });
```

## Architecture

```
┌─────────────────────┐     ┌──────────────────────┐
│  Firefox Extension  │────▶│  Native Messaging    │
│  (WebExtension)     │◀────│  Host (Node.js)      │
└─────────────────────┘     └──────────────────────┘
        │
        ▼
   Browser APIs
   (tabs, DOM)
```

## Development

See [CLAUDE.md](./CLAUDE.md) for development notes.

## License

MIT

## Author

Chris Lyons — [boot.industries](https://boot.industries)
