# Claudezilla

**Browser automation for Claude Code that runs on Firefox** — for systems where Chrome is unavailable, unwelcome, or policy-prohibited.

[![Version](https://img.shields.io/badge/version-0.7.7-blue.svg)](./CHANGELOG.md)

A Firefox-native MCP server for Claude Code and other MCP agent harnesses. Navigate, automate, screenshot, and extract data on any system that runs Firefox — no Chrome dependency, no Google infrastructure.

**[Claudezilla.com](https://claudezilla.com)**

## Why Claudezilla?

Anthropic's official browser tool requires Chrome. If you're on a system where Chrome is not available — or not acceptable — Claudezilla gives Claude Code browser automation through Firefox.

- **Linux-native** — Works with the Firefox that ships on Debian, Fedora, RHEL, Ubuntu, and every major distro. No Google repository required.
- **Zero telemetry** — The automation runs through a local Unix socket (a named pipe on Windows) and sends no page data or commands to any server. No Google account, no Chrome sync, no phone-home. Exceptions, both on extension pages: the welcome and support pages load fonts from Google Fonts, and the support page contacts `api.claudezilla.com` only if you start a donation (see the [privacy policy](https://claudezilla.com/privacy.html)).
- **Hardened environments** — Built for Tails, Whonix, Qubes OS, air-gapped networks, and enterprise Linux where package policy prohibits Chrome.
- **Multi-agent safe** — 12-tab shared pool with 128-bit agent IDs, per-tab owners, and a screenshot mutex. Multiple Claude sessions can share one Firefox (see [SECURITY.md](./SECURITY.md) for exactly what is owner-checked).
- **Full browser control** — Read pages as compact accessibility snapshots with element refs; click, type, scroll, screenshot, evaluate JS (opt-in), inspect network requests and uncaught page errors.

## Quick Start

### 1. Install the extension

Install from **[Firefox Add-ons](https://addons.mozilla.org/firefox/addon/claudezilla/)** (Firefox 140+).

### 2. Install the native host

```bash
git clone https://github.com/boot-industries/claudezilla.git
cd claudezilla

# macOS
./install/install-macos.sh

# Linux
./install/install-linux.sh

# Windows (PowerShell)
.\install\install-windows.ps1
```

The installer automatically:
- Installs the native messaging host
- Runs `npm install` for MCP dependencies
- Registers the MCP server with Claude Code (`claude mcp add --scope user`)
- Allows the Claudezilla tools in `~/.claude/settings.json` (`firefox_evaluate` is excluded by default — see below; macOS/Linux need `jq` for this step)
- Links the `claudezilla-browser` Agent Skill into `~/.claude/skills` (macOS/Linux)

No manual config required — restart Claude Code and you're ready.

Other agent harnesses (macOS/Linux installers): pass `--target omp|pi|hermes|mercury|all` (default `claude`). `omp` writes `~/.omp/agent/mcp.json`; `pi`, `hermes` and `mercury` print the config to add. These configs set `CLAUDEZILLA_SCREENSHOT_FILES=1`, and the skill is linked into `~/.agents/skills` (`~/.mercury/skills` for Mercury, if it exists). The Windows installer configures Claude Code only.

On Linux, when Firefox is found, the installer also sideloads the extension into a headless Firefox profile (`~/.mozilla/firefox/claudezilla-headless`) and writes `start-browser.sh` plus a `claudezilla-browser` systemd user unit (not enabled). Firefox ESR is recommended there: release Firefox may refuse the unsigned build.

`firefox_evaluate` is deliberately not in the allow-list: it runs JavaScript in the page, so it stays behind the extension's own opt-in (**Claudezilla popup → Security → Allow JavaScript evaluation**). To let Claude Code call it, add `"mcp__claudezilla__firefox_evaluate"` to `permissions.allow` in `~/.claude/settings.json` once you have enabled that toggle.

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `CLAUDEZILLA_IPC_DIR` | POSIX only | Directory that holds the IPC socket, auth token and debug log. Set it to run two browsers side by side (for example a visible profile and a headless profile) without the most recently started one taking over the other's socket. |
| `CLAUDEZILLA_AUTOSTART_CMD` | all platforms | Command that starts the browser when the host is not running. Never run through a shell. |
| `CLAUDEZILLA_AUTOSTART_WAIT_MS` | all platforms | How long to wait for the host to bind its socket after a start (default `45000`). |
| `CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS` | all platforms | How long to wait before retrying a failed start (default `60000`). |
| `CLAUDEZILLA_AUTOSTART_LAUNCH_TIMEOUT_MS` | all platforms | How long the start command itself may run (default `20000`). |
| `CLAUDEZILLA_TOOL_MODE` | MCP server | `lazy` lists only the `firefox_activate` gateway until a category is activated (same as `--tools lazy`). The default lists every tool; `--tools all` overrides the variable. |
| `CLAUDEZILLA_SCREENSHOT_FILES` | MCP server | `1` also writes each screenshot taken without an explicit `savePath` to `claudezilla-screenshots/` in the OS temp directory (newest 50 kept) and returns its `savedPath`, for harnesses that cannot show inline images. With `savePath`, only that file is written. |
| `CLAUDEZILLA_AGENT_TIMEOUT_MS` | MCP server | Close this agent's pool tabs after this long without a tool call (default `600000`, 10 minutes; `0` disables). |
| `CLAUDEZILLA_ALLOW_QUIT` | all platforms | Allows the `quitBrowser` command, which closes every window of the browser the host runs in. Set it only in the environment of a browser that exists for agents (for example the profile started by `CLAUDEZILLA_AUTOSTART_CMD` or a systemd unit), never for your own browser. |

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
- Listing the tools never starts the browser; the first tool call does. A client that lists the tools at session start does not launch a browser it may never use.
- Concurrent calls share a single launch, and a failed start is not retried for `CLAUDEZILLA_AUTOSTART_RETRY_COOLDOWN_MS` — a browser that cannot start does not turn every tool call into another process.
- The start command must publish the host socket and auth token where the MCP server looks for them. When the browser and the MCP server are different processes, give both the same `CLAUDEZILLA_IPC_DIR`.

Stopping the browser cleanly:

- A signal is not a clean quit. Firefox does not shut down on `SIGTERM` (what `systemctl stop` sends by default): the process ends without writing its session store or cache index, and the next start restores stray windows. Closing the last window is the only clean quit.
- `node host/cli.js quitBrowser` asks the extension to close every window, the Claudezilla window last so it is the one restored next time. The CLI talks to the host over the socket, so give it the same `CLAUDEZILLA_IPC_DIR` as the browser when one is in use.
- The host refuses the command unless the **browser's** environment carries `CLAUDEZILLA_ALLOW_QUIT=1`. The host inherits that environment from Firefox, so nothing in the CLI's environment can enable it, and a browser started without the variable cannot be quit this way.
- No MCP tool exposes the command: it is for the supervisor that started the browser, not for agents.

```ini
# ~/.config/systemd/user/claudezilla-background.service
[Service]
Environment=CLAUDEZILLA_IPC_DIR=%t/claudezilla-bg CLAUDEZILLA_ALLOW_QUIT=1
ExecStart=/usr/bin/firefox --no-remote --profile %h/profiles/headless
ExecStop=/usr/bin/node /path/to/claudezilla/host/cli.js quitBrowser
```

systemd runs `ExecStop` with the unit's environment. `quitBrowser` replies `{quitting: true}` at once and closes the windows after a 200 ms grace (with a 1.5 s pause before the Claudezilla window when other windows are open), so `cli.js` returns before Firefox has exited; once `ExecStop` returns, systemd sends `SIGTERM` to whatever is still running.

## What Can Claude Do?

| Capability | Description |
|------------|-------------|
| **Browse** | Open URLs, navigate pages, manage tabs, attach to tabs you already have open |
| **Read** | Accessibility snapshots with element refs, find by text, visible page text, page structure |
| **Interact** | Click buttons, fill forms, press keys, scroll (by ref or CSS selector) |
| **Screenshot** | Capture the viewport or a region, sized for vision models (JPEG or PNG) |
| **Consent** | Auto-dismiss cookie/GDPR consent dialogs |
| **Wait** | Handle SPAs and dynamic content |
| **Focus Loops** | Re-run a prompt across Claude Code turns until max iterations or a manual stop |

## Support Development

Claudezilla is free and open source. You can support its development with a one-time donation or monthly sponsorship:

- Click the **☕ Buy Me a Coffee** button on the welcome page (opened each time you open the popup while private-window access is off)
- Or use the **☕ Support this project** link in the extension popup
- Donations are processed securely through Stripe

The donation backend is the Cloudflare Worker in [`worker/`](./worker/).

## Example Usage

Once connected, Claude can use commands like:

```
Claude, open https://example.com and take a screenshot
Claude, fill in the search box with "Firefox automation" and click submit
Claude, get all the links on this page
```

## Available Tools

All 36 tools are listed by default.

### Browser Control
- `firefox_create_window` — Open a URL in a new tab in the shared 12-tab pool (the tab becomes your current tab); `container` opens the tab in a Firefox container (by name or cookieStoreId)
- `firefox_navigate` — Navigate an existing tab (default: your current tab) to a URL; `container` asserts the tab is in that container (a mismatch returns `CONTAINER_IMMUTABLE`)
- `firefox_list_containers` — List the Firefox containers (contextual identities) in the profile, with names and cookieStoreIds
- `firefox_get_content` — Read visible page text or one element's text (20K chars per call, `offset` paging)
- `firefox_click` — Click an element by `ref` (from a snapshot or `firefox_find`) or CSS selector
- `firefox_type` — Type into an input field by `ref` or selector
- `firefox_press_key` — Keyboard events (Enter, Tab, shortcuts)
- `firefox_screenshot` — Capture the viewport or a `region`, sized for vision models (`maxEdge`, default 1568 px); supports annotated mode. Set `CLAUDEZILLA_SCREENSHOT_FILES=1` for harnesses that cannot show inline images: each screenshot without an explicit `savePath` is also saved under the temp directory and its `savedPath` is returned.
- `firefox_get_tabs` / `firefox_close_tab` — Manage tabs
- `firefox_list_all_tabs` — List all open tabs, including ones not yet under Claudezilla's control
- `firefox_attach_tab` / `firefox_detach_tab` — Attach to (or release) a tab the user already has open, driving it in place instead of opening a new one
- `firefox_close_window` — Close the Claudezilla window (refused only when tabs of two or more different agents are open; an adopted user window keeps the window and closes only Claudezilla's tabs)
- `firefox_resize_window` / `firefox_set_viewport` — Resize a window, or apply a device viewport preset

### Multi-Agent
- `firefox_request_tab_space` / `firefox_grant_tab_space` / `firefox_get_slot_requests` — Coordinate the shared 12-tab pool with 30-second slot reservations

**Containers.** A tab opened with `container` lives in that container's cookie jar, so logins already established there apply. A container forces a non-private window (container cookies are persistent), and a tab's container cannot change after creation: to use another container, open a new tab. This needs the `cookies` and `contextualIdentities` permissions; neither triggers an install-time warning in Firefox.

### Configuration
- `firefox_activate` — Only with opt-in lazy loading (`--tools lazy` or `CLAUDEZILLA_TOOL_MODE=lazy`): load tool categories on demand. By default every tool is listed.
- `firefox_set_config` — Per-agent domain allow-list (`allowedDomains`, checked only against the `url` of `firefox_navigate` and `firefox_create_window`; the agent can clear it, so it is not a sandbox) and automatic consent handling (`handleConsent`)
- `firefox_set_private_mode` — Toggle private/regular browsing
- `firefox_handle_consent` — Dismiss cookie/GDPR consent dialogs

### Focus Loops
- `firefox_start_loop` — Start persistent iteration with prompt and max iterations
- `firefox_stop_loop` — Stop active loop manually
- `firefox_loop_status` — Check iteration count and state

### Page Analysis
- `firefox_get_page_state` — Structured data (headings, links, buttons, inputs, images, landmarks); headings, links, buttons and inputs carry `ref`
- `firefox_diff_page_state` — Diff two page-state snapshots
- `firefox_get_accessibility_snapshot` — Primary way to read a page: compact text tree with `[ref_N]` handles for click/type/scroll/press_key (cheaper than screenshots)
- `firefox_find` — Find elements by visible text or accessible name; returns refs with landmark context
- `firefox_get_element` — Element attributes, styles, visibility and position
- `firefox_wait_for` — Wait for element, text, or URL pattern
- `firefox_scroll` — Scroll to element or position

### DevTools
- `firefox_get_console` / `firefox_get_network` — Captured uncaught errors and unhandled promise rejections (the page's own `console.*` calls are not captured), and network requests
- `firefox_evaluate` — Run JavaScript in the page (disabled until enabled in the popup)

### Diagnostics
- `firefox_diagnose` — Check connection health, socket status, and troubleshoot issues

## Requirements

- Firefox 140+
- Node.js 18.17+
- [Claude Code CLI](https://claude.com/claude-code) or another MCP client (omp, Pi, Hermes Agent, Mercury)

## Privacy & Security

Claudezilla is designed with security in mind:

- **Command whitelist** — Only predefined actions allowed; `firefox_evaluate` runs arbitrary page JavaScript once you enable it in the popup
- **Local only** — Communication via Unix socket, or a named pipe on Windows (no network exposure)
- **Tab ownership** — Pool tabs record the agent that created them; close and navigate are owner-checked, and content commands are checked when a `tabId` is passed (the MCP server passes the agent's current tab automatically once it has one). Attached user tabs are not owner-checked except for close.
- **URL validation** — Blocks dangerous schemes (`javascript:`, `data:`)
- **Supply chain hardened** — `ignore-scripts=true`, pinned direct dependencies, SHA-pinned CI actions, timing-safe auth. The installers run `npm install` in `mcp/` (npm ignores `pnpm-lock.yaml`); pnpm with its lockfile is used for development and CI.

Works in both regular and private Firefox windows. `firefox_navigate` drives pool tabs it created (owner-checked) or tabs attached with `firefox_attach_tab` (not owner-checked).

See [SECURITY.md](./SECURITY.md) for the full security model.

## Architecture

```
Claude Code ←→ MCP Server ←→ Unix Socket / named pipe ←→ Native Host ←→ Firefox Extension
```

The extension uses Firefox's [Native Messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging) to talk to a local Node.js host. A separate MCP server process connects to the host over the socket and exposes the tools via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Contributing

[Issues](https://github.com/boot-industries/claudezilla/issues) and PRs welcome. See [CLAUDE.md](./CLAUDE.md) for development notes.

## License

MIT

---

**Author:** Chris Lyons — [boot.industries](https://boot.industries)
