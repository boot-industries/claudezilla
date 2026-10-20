# Claudezilla

**Browser automation for Claude Code that runs on Firefox** — for systems where Chrome is unavailable, unwelcome, or policy-prohibited.

[![Version](https://img.shields.io/badge/version-0.7.2-blue.svg)](./CHANGELOG.md)

The only Firefox-native MCP server for Claude Code. Navigate, automate, screenshot, and extract data on any system that runs Firefox — no Chrome dependency, no Google infrastructure.

**[Claudezilla.com](https://claudezilla.com)**

## Why Claudezilla?

Anthropic's official browser tool requires Chrome. If you're on a system where Chrome is not available — or not acceptable — Claudezilla gives Claude Code the same browser automation capabilities through Firefox.

- **Linux-native** — Works with the Firefox that ships on Debian, Fedora, RHEL, Ubuntu, and every major distro. No Google repository required.
- **Zero telemetry** — All communication runs through a local Unix socket. No data leaves your machine. No Google account, no Chrome sync, no phone-home.
- **Hardened environments** — Built for Tails, Whonix, Qubes OS, air-gapped networks, and enterprise Linux where package policy prohibits Chrome.
- **Multi-agent safe** — 12-tab shared pool with 128-bit agent IDs, ownership tracking, and screenshot mutex. Multiple Claude sessions coexist safely.
- **Full feature parity** — Click, type, scroll, screenshot, evaluate JS, access DevTools console and network. Same capabilities, different browser.

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

The installer automatically:
- Installs the native messaging host
- Runs `npm install` for MCP dependencies
- Registers the MCP server with Claude Code (`claude mcp add --scope user`)
- Allows the Claudezilla tools in `~/.claude/settings.json` (`firefox_evaluate` is excluded by default — see below)

No manual config required — restart Claude Code and you're ready.

`firefox_evaluate` is deliberately not in the allow-list: it runs JavaScript in the page, so it stays behind the extension's own opt-in (**Claudezilla popup → Settings → Allow JavaScript evaluation**). To let Claude Code call it, add `"mcp__claudezilla__firefox_evaluate"` to `permissions.allow` in `~/.claude/settings.json` once you have enabled that toggle.

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `CLAUDEZILLA_IPC_DIR` | POSIX only | Directory that holds the IPC socket, auth token and debug log. Set it to run two browsers side by side (for example a visible profile and a headless profile) without the most recently started one taking over the other's socket. |
| `CLAUDEZILLA_AUTOSTART_CMD` | all platforms | Command that starts the browser when the host is not running. Never run through a shell. |
| `CLAUDEZILLA_AUTOSTART_WAIT_MS` | all platforms | How long to wait for the host to bind its socket after a start (default `45000`). |
| `CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS` | all platforms | How long to wait before retrying a failed start (default `60000`). |

`CLAUDEZILLA_IPC_DIR` in detail:

- **POSIX only** (macOS/Linux). On Windows the host uses a fixed named pipe (`\\.\pipe\claudezilla`) and a `%LOCALAPPDATA%` token path, so the variable is ignored there.
- The directory is created with mode `0700` when missing, and an existing directory is tightened to `0700`.
- **Both processes need the same value.** The native messaging host is launched by Firefox and inherits the *browser's* environment; the MCP server resolves the socket path from *its own* environment at startup. Export the variable before launching Firefox **and** before starting Claude Code.
- **Restart the MCP server** after changing it — the path is resolved once at module load.
- An invalid value (path traversal, null byte) is ignored with a warning and the default location is used.

```bash
# browser (and the native host it launches)
CLAUDEZILLA_IPC_DIR=/run/user/1000/claudezilla-bg firefox --no-remote --profile ~/profiles/headless

# MCP server that drives that browser
CLAUDEZILLA_IPC_DIR=/run/user/1000/claudezilla-bg claude
```

`CLAUDEZILLA_AUTOSTART_CMD` in detail:

- **Never a shell.** The value is an argv vector, executed with `execFile(..., { shell: false })`. A JSON array is the exact form:
  ```bash
  CLAUDEZILLA_AUTOSTART_CMD='["systemctl","--user","start","claudezilla-background"]'
  ```
  A plain string is split on whitespace and is not interpreted by a shell:
  ```bash
  CLAUDEZILLA_AUTOSTART_CMD='systemctl --user start claudezilla-background'
  ```
- The browser is started only when the host is **not reachable**. The check is a connection attempt, not a file check, so it also works on Windows, where the host socket is a named pipe rather than a file.
- Concurrent calls share a single launch, and a failed start is not retried for `CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS` — a browser that cannot start does not turn every tool call into another process.
- The start command must publish the host socket and auth token where the MCP server looks for them. When the browser and the MCP server are different processes, give both the same `CLAUDEZILLA_IPC_DIR`.

## What Can Claude Do?

| Capability | Description |
|------------|-------------|
| **Browse** | Open URLs, navigate pages, manage tabs |
| **Read** | Extract text, get page structure, accessibility tree |
| **Interact** | Click buttons, fill forms, press keys, scroll |
| **Screenshot** | Capture pages (JPEG, configurable quality) |
| **Consent** | Auto-dismiss cookie/GDPR consent dialogs |
| **Wait** | Handle SPAs and dynamic content |
| **Focus Loops** | Persistent iterative tasks until completion |

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
- `firefox_create_window` — Open URL in browser; `container` opens the tab in a Firefox container (by name or cookieStoreId)
- `firefox_navigate` — Navigate current tab to a URL; `container` asserts the tab is in that container (a mismatch returns `CONTAINER_IMMUTABLE`)
- `firefox_list_containers` — List the Firefox containers (contextual identities) in the profile, with names and cookieStoreIds
- `firefox_get_content` — Read page text (50K char limit)
- `firefox_click` — Click element by CSS selector
- `firefox_type` — Type into input field
- `firefox_press_key` — Keyboard events (Enter, Tab, shortcuts)
- `firefox_screenshot` — Capture viewport (supports annotated mode)
- `firefox_get_tabs` / `firefox_close_tab` — Manage tabs
- `firefox_list_all_tabs` — List all open tabs, including ones not yet under Claudezilla's control
- `firefox_attach_tab` / `firefox_detach_tab` — Attach to (or release) a tab the user already has open, driving it in place instead of opening a new one

**Containers.** A tab opened with `container` lives in that container's cookie jar, so logins already established there apply. A container forces a non-private window (container cookies are persistent), and a tab's container cannot change after creation: to use another container, open a new tab. This needs the `cookies` and `contextualIdentities` permissions; neither triggers an install-time warning in Firefox.

### Configuration
- `firefox_activate` — Load tool categories on demand (lazy loading saves ~6K tokens)
- `firefox_set_config` — Set domain allowlist, consent auto-dismiss, and session config
- `firefox_set_private_mode` — Toggle private/regular browsing
- `firefox_handle_consent` — Dismiss cookie/GDPR consent dialogs

### Focus Loops
- `firefox_start_loop` — Start persistent iteration with prompt and max iterations
- `firefox_stop_loop` — Stop active loop manually
- `firefox_loop_status` — Check iteration count and state

### Page Analysis
- `firefox_get_page_state` — Structured data (headings, links, buttons, diff support)
- `firefox_get_accessibility_snapshot` — Semantic tree (screen reader view)
- `firefox_get_element_info` — Element attributes and styles
- `firefox_wait_for` — Wait for element, text, or URL pattern
- `firefox_scroll` — Scroll to element or position

### Diagnostics
- `firefox_diagnose` — Check connection health, socket status, and troubleshoot issues

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
- **Supply chain hardened** — `ignore-scripts=true`, pinned dependencies, pnpm strict isolation, SHA-pinned CI actions, timing-safe auth

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
