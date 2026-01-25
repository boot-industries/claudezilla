# Claudezilla Repository Structure - Notes

**Version:** 0.5.5
**Last Updated:** 2026-01-25

## What's New in v0.5.5

### New Files
| File | Purpose |
|------|---------|
| `host/ipc.js` | Platform-independent IPC abstraction (Unix sockets, Windows named pipes) |
| `install/install-windows.ps1` | Windows installation script with ConvertTo-Json hardening |
| `install/uninstall-windows.ps1` | Windows uninstallation with process check |

### Modified Files
| File | Changes |
|------|---------|
| `host/index.js` | Imports `ipc.js` for cross-platform socket/pipe paths |
| `mcp/server.js` | Expression blocklist, agent ID truncation |

## Directory Structure

### Root (`/`)
Project configuration and documentation:
- `CLAUDE.md` - Claude Code-specific project instructions
- `CHANGELOG.md` - Version history
- `SECURITY.md` - Security model documentation
- `package.json` - Project metadata

### Extension (`extension/`)
Firefox WebExtension (Manifest V2):

```
extension/
├── manifest.json       # Extension manifest (MV2)
├── background.js       # Native messaging, session management
├── content.js          # DOM interaction, visual effects
├── popup/
│   ├── popup.html     # Extension popup UI
│   └── popup.js       # Connection test, loop display
├── icons/
│   └── claudezilla-48.svg
├── welcome.html/js     # Post-install welcome page
└── support.html/js     # Support/donation page
```

### Host (`host/`)
Node.js native messaging host:

```
host/
├── index.js            # Main entry, socket/pipe server
├── ipc.js              # NEW: Platform IPC abstraction
├── protocol.js         # 4-byte header message serialization
├── cli.js              # CLI commands (if any)
└── package.json
```

**Key v0.5.5 Addition:** `ipc.js` provides:
- `getSocketPath()` - Returns Unix socket or Windows named pipe path
- `validatePath()` - Security validation for paths
- `setWindowsFileACL()` - Windows-specific ACL security

### MCP (`mcp/`)
MCP server exposing browser tools:

```
mcp/
├── server.js           # 30+ MCP tool definitions
├── task-detector.js    # Auto-detect iterative tasks
└── package.json
```

### Plugin (`plugin/`)
Claude Code plugin for focus loops:

```
plugin/
├── .claude-plugin/
│   └── plugin.json     # Plugin metadata
├── hooks/
│   ├── hooks.json      # Hook definitions
│   └── stop-hook.sh    # Intercepts Claude exit
├── commands/
│   ├── focus.md        # /focus command
│   ├── cancel-focus.md # /cancel-focus command
│   └── help.md         # /help command
└── README.md
```

### Website (`website/`)
Marketing website (deployed to Cloudflare Pages):

```
website/
├── index.html          # Landing page
├── extension.html      # Installation guide
├── docs.html           # Documentation
├── support.html        # Support/donations
├── privacy.html        # Privacy policy
├── scripts/
│   ├── notify.js       # Email signup
│   └── support.js      # Stripe integration
└── assets/             # CSS, images
```

**⚠️ Note:** Deploy `website/` directory, NOT `extension/`.

### Worker (`worker/`)
Cloudflare Worker for Stripe payments:

```
worker/
├── wrangler.toml       # Worker configuration
└── src/
    └── index.ts        # Checkout endpoint
```

### Install (`install/`)
Installation scripts:

```
install/
├── install-macos.sh    # macOS installation
├── install-linux.sh    # Linux installation
├── install-windows.ps1 # NEW: Windows installation (v0.5.5)
├── uninstall-windows.ps1 # NEW: Windows uninstallation
└── claudezilla.json    # Native messaging manifest template
```

**Windows Installer Features (v0.5.5):**
- Uses `ConvertTo-Json` for safe JSON serialization
- Creates native messaging host directory at `%APPDATA%\claudezilla`
- Sets up registry key for Firefox native messaging
- Process check on uninstall to prevent removal while running

### Wireframes (`wireframes/`)
Architecture documentation:

```
wireframes/
├── architecture-gallery.html  # Interactive diagram viewer
├── v0.5.3/                   # Previous version diagrams
└── v0.5.5/                   # Current version diagrams
```

## File Relationships

### Native Messaging Chain
```
Firefox Extension (background.js)
    ↓ Native Messaging (stdin/stdout)
Native Host (index.js)
    ↓ Imports
IPC Module (ipc.js) → getSocketPath()
    ↓ Unix Socket or Named Pipe
MCP Server (server.js)
```

### Plugin Integration
```
Claude Code CLI
    ↓ Session ending
Stop Hook (stop-hook.sh)
    ↓ Query via IPC
Native Host (index.js)
    ↓ Check loopState
Block exit, re-inject prompt
```

### Website → Worker
```
Support Page (support.html)
    ↓ Stripe checkout request
Cloudflare Worker (index.ts)
    ↓ Create session
Stripe API
```

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - High-level system design
- [Deployment Infrastructure](./deployment-infrastructure.mermaid.md) - How code runs
