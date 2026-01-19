# Claudezilla Repository Structure - Notes

**Version:** 0.5.0
**Last Updated:** 2026-01-18

## Overview

Claudezilla is a Firefox browser automation system for Claude Code CLI. It provides a Google-free alternative to the official Chrome extension with enhanced features like focus loops and multi-agent coordination.

## Directory Purposes

### `/extension/` - Firefox WebExtension

The browser extension component using Manifest V2 (for Firefox compatibility).

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest, permissions, content script injection |
| `background.js` | Native messaging connection, command routing, session management |
| `content.js` | DOM manipulation, visual effects, screenshot resizing |
| `popup/` | Extension popup UI showing connection status, loop state, settings |
| `icons/` | Extension icons (SVG format for scalability) |
| `welcome.html` | Post-install welcome page |
| `support.html` | Support/donation page |

### `/host/` - Native Messaging Host

Node.js application that bridges Firefox extension with the MCP server.

| File | Purpose |
|------|---------|
| `index.js` | Main entry point, socket server, loop state management |
| `protocol.js` | Message serialization (4-byte header + JSON) |
| `cli.js` | CLI interface for direct testing |
| `package.json` | Node dependencies (@anthropic/sdk) |

### `/mcp/` - MCP Server

Model Context Protocol server exposing browser automation tools to Claude.

| File | Purpose |
|------|---------|
| `server.js` | Tool definitions (30+ tools), command routing, agent heartbeat |
| `task-detector.js` | Automatic detection of iterative tasks for focus loop suggestions |
| `package.json` | MCP SDK dependencies |

### `/plugin/` - Claude Code Plugin

Plugin for Claude Code that enables focus loops via Stop hook.

| Directory | Purpose |
|-----------|---------|
| `.claude-plugin/` | Plugin metadata (plugin.json) |
| `hooks/` | Stop hook script for loop enforcement |
| `commands/` | Slash commands (/focus, /cancel-focus, /help) |
| `README.md` | Plugin installation and usage guide |

### `/website/` - Marketing Site

Static website deployed to Cloudflare Pages.

| File | Purpose |
|------|---------|
| `index.html` | Landing page |
| `extension.html` | Installation/setup guide |
| `docs.html` | Documentation |
| `support.html` | Support/donations page |
| `privacy.html` | Privacy policy |
| `scripts/` | JS for notifications and Stripe integration |

### `/worker/` - Cloudflare Worker

Serverless backend for payment processing.

| File | Purpose |
|------|---------|
| `wrangler.toml` | Cloudflare Workers configuration |
| `src/index.ts` | Stripe checkout session creation, email signup |

### `/install/` - Installation Scripts

Shell scripts for setting up native messaging host.

| File | Purpose |
|------|---------|
| `install-macos.sh` | macOS installation (Homebrew Node) |
| `install-linux.sh` | Linux installation |

### `/docs/` - Documentation

PREFIX-organized documentation following workspace conventions.

## Configuration Files

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project instructions for Claude Code |
| `CHANGELOG.md` | Version history |
| `SECURITY.md` | Security model documentation |
| `package.json` | Root package for `web-ext` tooling |
| `web-ext.config.js` | Firefox extension build configuration |

## Key Patterns

1. **Extension ID:** `claudezilla@boot.industries`
2. **Native Host Name:** `claudezilla`
3. **Socket Path:** `$TMPDIR/claudezilla.sock` or `$XDG_RUNTIME_DIR/claudezilla.sock`
4. **Auth Token:** `$TMPDIR/claudezilla-auth.token`

## Where to Look

| Task | Files to Check |
|------|----------------|
| Adding new browser commands | `extension/background.js`, `mcp/server.js` |
| Modifying DOM interactions | `extension/content.js` |
| Changing UI/popup | `extension/popup/popup.html`, `extension/popup/popup.js` |
| Native messaging protocol | `host/protocol.js` |
| Loop feature | `host/index.js` (state), `plugin/hooks/` (enforcement) |
| MCP tool definitions | `mcp/server.js` |
| Payment flow | `worker/src/index.ts`, `website/scripts/support.js` |
| Installation | `install/install-*.sh` |

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md)
- [Component Map](./component-map.mermaid.md)
- [Data Flow](./data-flow.mermaid.md)
