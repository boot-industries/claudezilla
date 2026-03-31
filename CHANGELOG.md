# CLZ002 Changelog

**Project:** Claudezilla
**Current Version:** 0.6.4

## v0.6.4 (2026-03-31)

**Supply chain hardening — closes ignore-scripts gap, hardens auth, upgrades MCP SDK.**

Triggered by WHB011-014 TeamPCP campaign audit. No indicators of compromise found, but the `ignore-scripts` gap left postinstall hooks enabled — the primary CanisterWorm attack vector. This release closes all identified gaps.

### Security Fixes

- **Block dependency lifecycle scripts** — Added `ignore-scripts=true` to root `.npmrc` and created per-workspace `.npmrc` files for `mcp/` and `worker/` (independent lockfiles don't inherit root config). Prevents postinstall hook execution — the primary TeamPCP/CanisterWorm attack vector.
- **Harden install scripts** — Added `--ignore-scripts` flag to `npm install` in `install-macos.sh`, `install-linux.sh`, and `windows-test.yml` CI workflow. User-facing install paths were previously unprotected.
- **Timing-safe auth comparison** — Replaced `!==` string comparison with `crypto.timingSafeEqual()` for socket auth token validation in native host (`host/index.js`).
- **Explicit Content Security Policy** — Added `content_security_policy` to `extension/manifest.json` (defense-in-depth over MV2 default).
- **Host lockfile** — Added `pnpm-lock.yaml` to `host/` to gate future dependency additions via lockfile review.

### Improvements

- **Graceful private mode handling** — `firefox_create_window` now auto-falls back to non-private mode when Firefox incognito permission isn't granted, instead of hard-failing. Response includes `isPrivate`, `privateFallback`, and `modeWarning` fields so agents always know the actual mode.
- **Per-window mode awareness** — `firefox_create_window` accepts optional `private` boolean. If the existing shared window's mode conflicts, returns a structured `MODE_MISMATCH` error. Omitting the param preserves backward-compatible behavior.
- **Mode detection at activation** — `firefox_activate` response now includes `privateWindowsAvailable` and `currentWindowMode` so agents know capabilities upfront.
- **New `getWindowMode` command** — lightweight query for current window state and private mode capability.

### Dependencies

- **Upgraded `@modelcontextprotocol/sdk`** from 1.25.2 to 1.29.0 — patches GHSA-345p-7cg4-v4c7 (cross-client data leak via shared server/transport). Claudezilla uses stdio transport (1:1 pipe), so was not exploitable in our architecture, but upgraded for hygiene.

## v0.6.3 (2026-03-27)

**Critical fix: native host fails to start on macOS (and Linux with non-standard node paths).**

### Bug Fixes

- **Native host PATH resolution** — Firefox (GUI app) doesn't inherit shell PATH, so `#!/usr/bin/env node` fails with exit 127 when Node.js is installed via Homebrew (`/opt/homebrew/bin`), nvm, or any non-system path. Installer now resolves the absolute node path at install time and writes a `host/run.sh` wrapper with `exec /absolute/path/to/node`. Affects both macOS and Linux installers.
- **Dead `browserAction.onClicked` listener** — Removed listener that never fires because `default_popup` is defined in the manifest. Reconnection already handled by `sendToHost()` calling `connect()` when `port` is null.

## v0.6.2 (2026-03-24)

**Socket path reliability + Windows native messaging — community contributions.**

### Bug Fixes

- **Socket path consistency on macOS** — `getSafeTempDir()` now falls back to `~/.claudezilla/` (mode 0700) between XDG_RUNTIME_DIR and tmpdir(). Fixes socket path mismatch when macOS assigns different per-process TMPDIR values to Firefox vs Claude Desktop.
- **CLI socket path** — `host/cli.js` now uses `getSocketPath()` and `getAuthTokenPath()` from ipc.js instead of hardcoded `/tmp/claudezilla.sock`.
- **Stop hook socket fallback** — `plugin/hooks/stop-hook.sh` now mirrors the full 3-tier fallback (XDG > ~/.claudezilla/ > TMPDIR) matching the Node.js ipc.js logic.
- **Windows native messaging** — Installer creates a `host.bat` wrapper instead of using the non-spec `args` manifest field. Fixes silent connection failure on Windows.

### Contributors

Thanks to community contributors for these fixes.

## v0.6.1 (2026-03-22)

**Linux support + reliability/security audit + lazy tool loading.**

**Lazy Tool Loading (MCP context optimization)**

- **`firefox_activate` gateway tool** — At session start, only this single tool (~50 tokens) is exposed instead of all 31 tools (~6,529 tokens). Call `firefox_activate()` to load the default `core` category, or `firefox_activate({ category: "..." })` for a specific subset.
- **Category system** — Tools organized into 8 categories: `core` (navigate/click/type/scroll/screenshot/page_state/tabs), `inspection` (content/element/wait/diff), `devtools` (console/network/evaluate/accessibility), `multiagent` (tab space management), `loop` (iterative dev), `config` (viewport/privacy/consent/window), `diagnose` (health check), `all` (everything).
- **`notifications/tools/list_changed`** — Server declares `listChanged: true` capability and emits the notification after activation, so Claude Code updates its tool list immediately without a round-trip.
- **Additive activation** — Calling `firefox_activate` multiple times with different categories accumulates tools (core + devtools, etc.).
- **Token savings** — ~6,400 tokens saved per session where browser automation isn't needed. Sessions using Claudezilla load tools on-demand.

- **Portable shebang** — `host/index.js` changed from `#!/opt/homebrew/bin/node` to `#!/usr/bin/env node`. Homebrew path doesn't exist on Linux; env-lookup works on all Unix-like systems.
- **MCP dependencies on Linux** — `install/install-linux.sh` now runs `npm install` in `mcp/` after manifest setup, matching the macOS installer. Prevents MCP crash on first launch.

### Features

**Consent Form Automation**

- **`firefox_handle_consent` MCP tool** — Automatically detects and dismisses common cookie/consent dialogs and GDPR overlays. Operates with a 4-pass detection strategy:
  - **Pass 1: CMP selectors** — Google consent.google.com (`#L2AGLb`), OneTrust (`#onetrust-accept-btn-handler`), Quantcast, Didomi, Cookiebot, and generic `[id*="accept"][id*="cookie"]` patterns
  - **Pass 2: Text matching** — Button text matching "I agree", "Accept all", "Allow all", "Consent", "Got it", etc. (rejects buttons containing "reject", "decline", "refuse")
  - **Pass 3: Shadow DOM traversal** — Scans shallow shadow roots on consent host elements (closed-mode roots gracefully skipped)
  - **Pass 4: ARIA dialog fallback** — `[role="dialog"]` and `[role="alertdialog"]` elements as final fallback
  - Returns `{ found, clicked, buttonText, method, elapsed }` so agents can verify success
  - 3-second default timeout prevents hanging on unresponsive pages
- **`handleConsent: true` config option** — Agents can enable automatic consent handling via `firefox_set_config({ handleConsent: true })`. After navigation, consent dismissal is triggered fire-and-forget with 800ms delay, allowing page to settle before scanning. Does not block navigation or error out if consent not found.
- **Known limitations:** TrustArc dialogs, closed Shadow DOM roots (inaccessible by design), pages with custom obfuscated consent mechanics

### Reliability & Security Audit (9 fix batches)

**MCP server (`mcp/server.js`)**

- **Socket listener cleanup** — `sendCommandOnce` now calls `socket.removeAllListeners()` + `socket.destroy()` on every resolve/reject path. Previously, `data`/`error`/`timeout`/`close` listeners accumulated over many commands causing FD leaks. Close handler now logs JSON parse failures instead of silently swallowing them.
- **Process robustness** — `cleanupOrphanedAgents` interval callback is now wrapped in try/catch with `.catch()` to prevent silent async crashes. Interval ID stored as `cleanupIntervalId` and cleared in `handleShutdown` to prevent races on exit. Added `process.on('unhandledRejection', ...)` handler to surface any missed rejections.
- **Domain pattern ReDoS prevention** — `checkDomainAllowed` now validates each domain pattern before constructing a regex: max 255 chars, only `[a-zA-Z0-9*.\-]` characters allowed. Pathological wildcard patterns previously could cause catastrophic backtracking.

**Host (`host/index.js`, `host/ipc.js`)**

- **Connection limit** — `server.maxConnections = 10` prevents FD exhaustion under DoS conditions.
- **Socket error cleanup** — Socket error handler now calls `socket.destroy()` after logging, preventing half-open connections from lingering.
- **Per-socket request tracking** — Each socket tracks its pending request IDs in a `Set`; on socket close, all associated entries are removed from `pendingCliRequests` to prevent memory leaks on abrupt disconnect.
- **Auth token hardening** — Auth check strengthened to `!authToken || typeof authToken !== 'string' || authToken !== SOCKET_AUTH_TOKEN` to guard against null/non-string bypass.
- **Command validation** — `command` field validated as a non-empty string before dispatch; invalid commands return a structured error JSON response instead of propagating `undefined` into handlers.
- **`icacls` command injection** (Windows) — `host/ipc.js` replaced `exec()` shell invocation with `execFile('icacls', [...args])` array form, eliminating shell interpretation of file paths containing quotes or special characters.

**Extension (`extension/background.js`, `extension/content.js`)**

- **Screenshot mutex finally block** — `screenshotMutexHolder = null` is now inside a `finally` block, ensuring the mutex is always released even if the screenshot throws. Previously a mid-flight exception would leave the mutex permanently held, blocking all subsequent screenshots.
- **`consoleCaptureEnabled` typo** — Renamed from `consoleCapureEnabled` (missing 't') across all 6 occurrences.
- **Focusglow style dedup** — `initFocusglow()` now checks for `#claudezilla-focusglow-styles` before injecting the `<style>` block, preventing style accumulation on repeated calls.

**Installers (`install/install-linux.sh`, `install/install-macos.sh`)**

- **npm pre-check** — Both installers now verify `npm` is available before running `npm install`, with a clear error message pointing to Node.js installation if missing.
- **XPI validation** (Linux) — Installer verifies XPI exists before attempting sideload copy; `cp` failure also exits with an error instead of continuing silently.
- **systemd journal output** (Linux) — Service `[Service]` block now includes `StandardInput=null`, `StandardOutput=journal`, `StandardError=journal` to prevent hangs on headless systems waiting for stdin.

## v0.6.0 (2026-03-06)

**Annotated screenshots, domain allowlists, smarter waiting, page state diffing.**

This release adds four new capabilities and a round of stability fixes from community feedback.

### Features

- **Annotated screenshots** — `firefox_screenshot` with `annotate: true` overlays numbered badges on every interactive element (buttons, links, inputs, form controls) using Shadow DOM isolation. The response includes a `labels` map keyed by badge number so agents can reference elements by number in follow-up commands (e.g., "click element 3"). Badges are injected, the screenshot is captured, and badges are removed in one atomic sequence — no visual artifacts persist on the page.

- **Domain allowlist** — Agents can restrict their own navigation to approved domains via `firefox_set_config({ allowedDomains: ["*.example.com", "docs.stripe.com"] })`. Supports exact matches and wildcard prefixes. Any `createWindow` or `navigate` call to an unapproved domain returns a `DOMAIN_BLOCKED` error with the rejected URL. Opt-in per agent — no global config changes, no impact on other agents in multi-agent setups.

- **Expanded waitFor** — `firefox_wait_for` now supports three modes:
  - `selector` — CSS selector (existing behavior)
  - `text` — Substring match on visible page text (`document.body.innerText`)
  - `url` — Glob match on `window.location.href` (useful for waiting on redirects or SPA navigation)
  - All modes respect the existing `timeout` and `pollInterval` parameters.

- **Page state diff** — `firefox_diff_page_state` takes two snapshots (from `firefox_get_page_state`) and returns structured diffs: added/removed/changed headings, links, buttons, and form fields. Runs entirely in the MCP server with no extension round-trip needed — useful for verifying that a click or form submission actually changed the page.

### Bug Fixes

- **Orphan tab timeout increased** — Changed from 2 minutes to 10 minutes. The previous threshold caused false positives during long-running operations (large page screenshots, complex waitFor chains), incorrectly cleaning up active agents' tabs.
- **`pressKey` error messages** — Invalid key names now return actionable errors listing the valid key (e.g., `"Unknown key 'enter' — did you mean 'Enter'?"`) instead of a generic type error.
- **`scroll` noEffect flag** — `firefox_scroll` response now includes `noEffect: true` when the viewport position didn't change after scrolling (already at top/bottom), letting agents detect when they've reached the end of a page.
- **Screenshot watermark hidden during capture** — The Claudezilla watermark and focus glow effects are now hidden during `captureVisibleTab` and restored after, eliminating visual artifacts in screenshots.
- **CONTENT_SCRIPT_ERROR false positives** — JSON, XML, PDF, and binary tabs no longer trigger content script injection errors. The extension now checks the tab's content type before attempting `sendMessage` and returns a descriptive `NON_HTML_TAB` error instead.
- **Network header stripping** — `getNetworkRequests` no longer includes raw request/response headers in the payload, reducing response size by ~60% for header-heavy pages.
- **Background scroll warning** — Suppressed harmless `scroll` event listener warning in the background script console.

### Updated

- Version bumped to 0.6.0 across extension manifest, host, MCP server, popup, and package.json
- Documentation site launched at [docs.claudezilla.com](https://docs.claudezilla.com)

---

## v0.5.9 (2026-03-04)

**Tab state bug fixes — eliminates stale-tab loops and session nukes.**

### Bug Fixes

- **`getSession()` no longer nukes window state on empty tabs** (CRITICAL) — When the last tab is externally closed, `getSession()` now throws `NO_TABS` without nulling `claudezillaWindow`. Previously, an empty tabs array caused `browser.tabs.get(undefined)` to throw, which wiped the entire session requiring a full extension reload.
- **`executeInTab()` now detects closed tabs** (SERIOUS) — When a tab is closed mid-operation, `browser.tabs.sendMessage()` throws "Receiving end does not exist". Previously this returned `CONTENT_SCRIPT_UNAVAILABLE` causing agents to retry forever. Now checks if the tab is still tracked; if not, throws `TAB_CLOSED` with actionable guidance.
- **Heartbeat refreshed before long operations** (MODERATE) — Heartbeat was only updated at command arrival. Long operations (screenshots, `waitFor`) could exceed the 120s orphan timeout during execution, causing the agent's tabs to be deleted mid-operation. Heartbeat now also refreshes immediately before `sendCommand()`.
- **`getSession()` catch-all scope narrowed** (MODERATE) — The single try/catch previously wrapped both `windows.get()` and `tabs.get()`, with both paths nulling `claudezillaWindow`. Now split into two scopes: window-level failure resets session state; tab-level failure throws `TAB_UNAVAILABLE` without destroying the window.

### Updated

- Version bumped to 0.5.9 across extension, host, MCP server, and popup

---

## v0.5.8 (2026-02-28)

**Community-reported install and runtime fixes.**

### Bug Fixes

- **macOS native host path** — Fixed wrong directory for Firefox native messaging manifest
  - Was: `~/.mozilla/native-messaging-hosts/` (Linux path)
  - Now: `~/Library/Application Support/Mozilla/NativeMessagingHosts/` (correct macOS path)
  - Resolves "No such native application" error on fresh macOS installs
- **MCP dependencies missing after fresh clone** — `install-macos.sh` now runs `npm install` in `mcp/`
  - Fresh `git clone` no longer requires a manual `npm install` step
  - Install is idempotent (safe to re-run on existing installs)
- **`tabId` string coercion** — All tab-targeting tools now normalize `tabId` to `Number()`
  - Affects 12 cases: `getContent`, `click`, `type`, `scroll`, `waitFor`, `evaluate`, `getElementInfo`, `getPageState`, `getAccessibilitySnapshot`, `pressKey`, `getConsoleLogs`, `getNetworkRequests`
  - Also fixes `navigate` case
  - Resolves `"Incorrect argument types"` when MCP passes `tabId` as a JSON string
  - Consistent with existing `closeTab` and `screenshot` coercion pattern

### Updated

- Version bumped to 0.5.8 across extension, MCP server, and popup

---

## v0.5.7 (2026-02-08)

**Critical bug fixes + timeout flexibility.**

### Bug Fixes

- **Screenshot error propagation** - Errors during capture now properly propagate to Claude
  - Fixed `.catch(() => {})` silently swallowing screenshot chain errors
  - Screenshot failures include full error context for debugging
  - Subsequent screenshots still function correctly after failures
- **Slot reservation race condition** - Atomic reservation consumption prevents double-claims
  - Reservation deleted immediately before agent proceeds to create tab
  - Defensive logging tracks reservation expiry timing
- **Message ID overflow protection** - Replaced numeric `++messageId` with `crypto.randomUUID()`
  - Eliminates theoretical collision after 2^53 requests
  - Consistent with host/index.js UUID usage

### Features

- **Per-operation timeouts** - Tools can now specify custom timeout values
  - Optional `timeout` parameter added to all tool schemas (except `firefox_diagnose`)
  - Default remains 150s for backward compatibility
  - Range: 5s to 300s (5 minutes)
  - Timeout propagates through MCP server → host → extension pipeline
- **Improved timeout errors** - Timeout messages now include operation name and duration
  - Example: `Request timed out after 150000ms (command: screenshot)`
  - Host and extension both provide contextual error messages

### Updated

- Version bumped to 0.5.7 across all components (extension, host, MCP server)

---

## v0.5.6 (2026-01-26)

**Autonomous installation + timeout fixes + expanded tab pool.**

### Features

- **Autonomous permissions** - Installers now configure Claude Code settings automatically
  - Adds `mcp__claudezilla__*` to `permissions.allow` in `~/.claude/settings.json`
  - Auto-configures MCP server in `~/.claude/mcp.json`
  - Works on macOS, Linux, and Windows
  - Uses `jq` for safe JSON merging on Unix (with fallback)
- **Expanded tab pool** - Increased from 10 to 12 tabs shared across agents
  - Mercy system threshold unchanged (>4 tabs triggers notifications)
  - More headroom for multi-agent workflows
- **Screenshot purpose presets** - Suggestive quality settings based on intent
  - `quick-glance` (q:30, s:0.25) - Layout/navigation confirmation
  - `read-text` (q:60, s:0.5) - Reading content [DEFAULT]
  - `inspect-ui` (q:80, s:0.75) - UI details/small text
  - `full-detail` (q:95, s:1.0) - Pixel-perfect inspection
  - Agent can still override with explicit quality/scale parameters

### Bug Fixes

- **Allow file:// URLs** - Local file viewing now works
  - `file://` scheme added to allowed URL schemes
  - Enables viewing local HTML files for development and testing
  - Rationale: Claude Code runs locally with full filesystem access anyway
- **Improved error messages** - "Receiving end does not exist" now shows actionable info
  - `PAGE_LOAD_FAILED`: Page didn't load (server down, 404, etc.) - includes URL and hint
  - `RESTRICTED_PAGE`: about:, chrome:, moz-extension: pages can't run content scripts
  - `CONTENT_SCRIPT_UNAVAILABLE`: Generic fallback with tab info and retry hint
- **Session cleanup on exit** - MCP server now sends `goodbye` command on shutdown
  - Handles SIGINT, SIGTERM, SIGHUP, and beforeExit signals
  - Extension immediately closes all tabs owned by exiting agent
  - Also cleans up reservations and pending slot requests for that agent
  - Fallback: 2-minute orphan timeout still applies for hard crashes (SIGKILL)
- **Mercy system slot reservation** - Fixed critical bug where agents couldn't claim freed slots
  - Previously: `requestTabSpace` queued requests but freed slots could be stolen by any agent
  - Now: When a slot is freed (via `closeTab` or `grantTabSpace`), a 30-second reservation is created
  - Waiting agent can check `firefox_get_slot_requests` to see if they have a reservation
  - Reserved slots cannot be stolen by other agents during the TTL window
  - `createWindow` respects reservations (reserved agent bypasses POOL_FULL check)
- **Mutex timeout mismatch** - Code now matches documentation
  - `MUTEX_BUSY_THRESHOLD_MS` changed from 5000ms to 3000ms (as documented in v0.5.4 CHANGELOG)
  - Updated all wireframe and CLAUDE.md references
- **Request timeouts extended** - Now 150s (2.5 minutes) instead of 30s
  - `extension/background.js` - native host request timeout
  - `host/index.js` - CLI request timeout
  - `mcp/server.js` - socket connection timeout
  - Prevents timeout errors on long-running browser operations

### Updated

- Version bumped to 0.5.6 across all components
- Documentation consistency fixes for mutex timeout values

---

## v0.5.5 (2026-01-25)

**Windows 10/11 support + security hardening.**

### Features

- **Windows support** - Full Windows 10/11 compatibility
  - Named pipes (`\\.\pipe\claudezilla`) for Windows IPC
  - Platform-independent path resolution via `host/ipc.js` abstraction
  - Windows ACL via `icacls` for auth token file (user-only access)
  - PowerShell installer with `ConvertTo-Json` (safe serialization)

### Security

- **Path validation** - New `validatePath()` function in `ipc.js`
  - Prevents null byte injection
  - Blocks path traversal (`..`)
  - Rejects UNC network paths (except named pipes)
- **Environment variable validation** - `getSafeTempDir()` validates paths from `LOCALAPPDATA`, `TEMP`, `XDG_RUNTIME_DIR`
- **PowerShell hardening**
  - `Test-SafePath` function validates paths before use
  - Process check in uninstaller prevents race conditions

### Bug Fixes

- **Support link** - Popup support link now uses async/await properly

### Updated

- Version bumped to 0.5.5 across all components (9 files)
- GitHub Actions workflow for Windows CI testing

---

## v0.5.4 (2026-01-24)

**Security hardening + performance optimization.**

### Security

- **Expression validation** - `firefox_evaluate` now blocks dangerous patterns
  - Blocked: `fetch()`, `XMLHttpRequest`, `eval()`, `Function()`, `setTimeout/setInterval`
  - Blocked: `document.cookie`, `localStorage`, `sessionStorage`, dynamic `import()`
  - Expression length limit: 10,000 characters (prevents DoS)
- **Loop prompt sanitization** - `promptPreview` field truncates to 100 chars
  - Full prompt still stored internally for plugin hook
  - Logs and API responses only show truncated preview
- **Agent ID truncation** - Privacy-enhanced logging
  - `truncateAgentId()` helper shows first 12 chars + `...`
  - Applied to all orphan cleanup logs and error messages

### Performance

- **Selector alternative search optimization** - `findSelectorAlternatives()`
  - MAX_SEARCH limit: 100 elements per category (was unbounded)
  - Early exit when MAX_ALTERNATIVES (5) reached
  - For-of loops with break instead of forEach (allows early termination)
- **Screenshot mutex timeout reduced** - 3000ms (was 5000ms)
  - Agents get MUTEX_BUSY feedback faster
  - Reduces wait time in multi-agent scenarios

### Updated

- Version bumped to 0.5.4 across all components
- Features array includes `expression-validation` flag

---

## v0.5.3 (2026-01-18)

**Reconnection resilience + diagnostics.**

### Features

- **Auto-reconnect** - Extension automatically reconnects when host disconnects
  - Exponential backoff (1s → 30s) with max 10 attempts
  - Manual retry resets backoff state
  - Connection status available via `getConnectionStatus()` action
- **`firefox_diagnose` tool** - Comprehensive connection health check
  - Checks socket file existence and permissions
  - Validates auth token file
  - Tests connection ping with latency measurement
  - Reports extension version and tab pool status
  - Provides actionable recommendations for issues
- **MCP retry logic** - Automatic retry with backoff for transient failures
  - 3 retries with 100ms → 1000ms exponential backoff
  - Retries on ENOENT, ECONNREFUSED, ECONNRESET errors

### Improvements

- **Better error messages** - Connection errors now include diagnostic info
  - Shows socket/auth token state: `[Socket: exists/missing, Auth: exists/missing]`
  - Specific fix instructions for each error type
  - Clear guidance on how to reconnect

### Updated

- **MCP SDK** - Updated from 0.5.0 to 1.25.2 for Claude Code 2.1.x compatibility
  - Supports tool search auto-mode
  - Supports `list_changed` notifications

---

## v0.5.0 (2026-01-06)

**Focus loops + Enhanced autonomy.**

### Breaking Changes

- **Terminology:** "Concentration loops" renamed to "Focus loops" across all documentation and UI
  - MCP tool names unchanged: `firefox_start_loop`, `firefox_stop_loop`, `firefox_loop_status`
  - Only user-facing text updated (descriptions, comments, documentation)

### Features

- **`/focus` slash command** - Skill wrapper for starting focus loops
  - `plugin/commands/focus.md` - Start iterative development tasks
  - `plugin/commands/cancel-focus.md` - Stop active loops
  - `plugin/commands/help.md` - Usage documentation
- **Auto-retry system** - Smart DOM element waiting with enhanced error messages
  - `smartQuerySelector()` with configurable auto-wait (5s default timeout)
  - `buildElementNotFoundError()` provides selector suggestions when elements not found
  - `findSelectorAlternatives()` suggests similar IDs, buttons, links, aria-labels
  - `click()` and `type()` now async with auto-wait built-in
- **Task detection** - Automatic detection of iterative tasks for focus loop suggestions
  - New `mcp/task-detector.js` module with `TaskDetector` class
  - Keyword matching: TDD, iterate, refactor, "keep trying", "fix until"
  - Behavioral pattern analysis: repeated test runs, file edits, error patterns
  - Scoring system with confidence levels (low/medium/high)
- **Auto-loop settings in popup** - UI controls for task detection behavior
  - Enable/disable auto-detect iterative tasks (default: on)
  - Enable/disable auto-start loops without confirmation (default: off)
  - Configurable default max iterations (default: 15)
  - Settings stored in `browser.storage.local` under `focusLoops` key

### Updated

- Plugin metadata updated for focus loop terminology
- MCP server tool descriptions updated
- Documentation updated across CLAUDE.md, CHANGELOG.md, CLZ002

---

## v0.4.9 (2026-01-06)

**Hotfix: Popup version display.**

### Bug Fixes

- **Popup version string** - Fixed hardcoded v0.4.5 displaying in extension popup
  - Users saw v0.4.5 in popup while running v0.4.8 binary
  - Popup now displays correct runtime version (v0.4.9)

### Notes

- No functional changes to error handling or browser automation
- v0.4.8 was shipped but popup showed stale version — this corrects that UI oversight

---

## v0.4.8 (2026-01-06)

**Critical error handling + comprehensive documentation.**

### Features

- **Error reporting for all content-script commands** - Agents now get clear error messages
  - `firefox_click` - Reports "Element not found: selector" when target missing
  - `firefox_type` - Reports invalid selector or element not found
  - `firefox_getContent`, `firefox_scroll`, `firefox_waitFor`, `firefox_evaluate`, etc. - All properly propagate errors
  - `firefox_getPageState`, `firefox_getAccessibilitySnapshot`, `firefox_getConsoleLogs` - Errors no longer silently dropped
- **Comprehensive documentation** - Global CLAUDE.md updated with complete Claudezilla reference
  - Full tool list organized by category (Window/Tab, DOM, Content Analysis, DevTools, etc.)
  - Performance hints (use getPageState over screenshot, mutex details)
  - Multi-agent coordination explained (mercy system, orphaned cleanup)

### Bug Fixes

- **Silent error suppression** - Background.js now checks response.success flag
  - Previously: Content script errors → undefined response.result → empty response with no error
  - Now: Content script errors properly thrown and propagated to agents
  - Affects 11 commands: click, type, getContent, scroll, waitFor, evaluate, getElementInfo, getPageState, getAccessibilitySnapshot, pressKey, getConsoleLogs

### Breaking Changes

- None - all changes are backward compatible (errors were previously silent)

### Multi-Agent Safety

- Agents can now reliably detect failures and retry with different selectors
- Full visibility into what went wrong during browser automation
- Essential for giving Claude complete control over Firefox

---

## v0.4.5 (2026-01-06)

**Orphaned tab cleanup + support page optimization.**

### Features

- **Orphaned tab cleanup** - Automatic cleanup of tabs from disconnected agents
  - MCP server tracks agent heartbeats via command timestamps
  - Agents orphaned after 2 minutes of inactivity
  - Periodic cleanup check every 60s
  - All tabs from disconnected agent automatically closed
  - Freed space immediately available to active agents
  - Cleanup events logged to MCP server stderr
- **Support page layout** - Wider 2-column grid design
  - Container max-width increased from 500px to 900px
  - CSS Grid with cross-column alignment
  - All interactive elements standardized to 52px height
  - Responsive breakpoints maintained (768px tablet, 600px mobile)
- **Landing page spacing** - Hero section vertical spacing reduced (80px → 48px)

### Multi-Agent Safety

- Solves "ghost agent" problem where crashed/killed sessions hold tabs indefinitely
- Tab pool automatically recovers from disconnected agents

---

## v0.4.4 (2026-01-06)

**Fair multi-agent coordination.**

### Features

- **POOL_FULL error** - Agents can only evict their OWN tabs when pool is full
  - If agent has no tabs in pool, throws POOL_FULL instead of evicting others
  - Error includes owner breakdown (e.g., `agent_ec2e...: 7, agent_d99a...: 3`)
  - Hint guides agents to wait for others or request tab closure
- **MUTEX_BUSY error** - Screenshot contention now returns informative error
  - Shows which agent holds the mutex and for how long
  - Includes tab pool status and retry guidance
  - Prevents cascading timeouts during multi-agent work

### Multi-Agent Safety

- Tab eviction respects ownership - no silent stealing of other agents' tabs
- Clear communication when resources are contended
- Agents informed of contention rather than silently blocked or failed

---

## v0.4.3 (2026-01-06)

**Screenshot timing + crypto payments + CSS isolation.**

### Features

- **Dynamic screenshot readiness** - Replaces hardcoded delays with actual page signals
  - Network idle detection (waits for XHR/fetch/scripts to complete)
  - Visual idle (optional wait for images/fonts, 3s max)
  - Render settlement (double RAF + requestIdleCallback)
  - Timeline data in response shows wait breakdown
  - `skipReadiness` param for instant capture when page is known-ready
- **Helio crypto payments** - Solana/USDC option on support page

### Bug Fixes

- **Shadow DOM isolation** - Watermark CSS no longer corrupts page styles
- **Support page worker URL** - Fixed endpoint for website deployment

---

## v0.4.2 (2026-01-05)

**Focus loops.**

### Features

- **Ralph Wiggum-style loops** - Persistent iterative development until completion
  - `firefox_start_loop` - Start with prompt, max iterations, optional completion promise
  - `firefox_stop_loop` - Manual cancellation
  - `firefox_loop_status` - Check iteration count and state
- **Plugin system** - Stop hook enforcement via Unix socket
- **Browser UI** - Loop status in popup with iteration counter and stop button

### Bug Fixes

- **SVG transform fixes** - Speech bubble positioning after transform changes
- **Breathing animation removed** - Electrons/arms/bubble provide sufficient feedback

---

## v0.4.1 (2026-01-05)

**Website launch + support integration.**

### Features

- **claudezilla.com** - Marketing website on Cloudflare Pages
  - Home, extension setup, docs, and support pages
  - Retro-futuristic design matching extension aesthetic
- **Stripe integration** - Support/donation payments via Cloudflare Worker
- **Thank you modal** - Post-payment confirmation with font preloading

### Infrastructure

- **Cloudflare Pages** - Website deployed from `website/` directory
- **Cloudflare Worker** - Stripe checkout endpoint at `worker/`

---

## v0.4.0 (2026-01-05)

**Security hardening release.** Comprehensive audit fixing 15 vulnerabilities.

### Security

- Socket permissions set to 0600 (user-only)
- URL scheme validation (blocks javascript:, data:) — file:// allowed in v0.5.6
- Agent ID entropy increased to 128 bits
- Tab ownership enforcement for all content commands
- Window close blocked when other agents have tabs
- Request body capture removed from network monitoring
- Sensitive URL parameters redacted
- Debug log permissions set to 0600
- Buffer size limits (10MB) prevent memory exhaustion
- TMPDIR hijacking prevented via XDG_RUNTIME_DIR
- Install script permissions explicit (755/644)
- UUID-based request IDs prevent collision
- Console capture made opt-in
- CSS selector validation with length limits
- Screenshot race condition fixed

See [[CLZ003 Security Audit v0.4.5]] for full details.

### Bug Fixes

- **React/Angular input compatibility** - Type command now uses native value setter to work with framework-controlled inputs
- **Tab navigation** - Navigate command accepts `tabId` parameter to navigate owned tabs (ownership enforced)

### Enhancements

- **Click feedback** - Returns element `text`, `id`, and `className` for better debugging
- **Watermark improvements** - Moved to bottom-left corner, clickable to open popup, hover scale effect
- **Checkbox branding** - Popup checkboxes use favicon terracotta color (#D14D32)

### New Features

- **Welcome page** - Retro-futuristic onboarding with animated Godzilla logo, visual step-by-step permission guide
- **First-run UX** - Automatically shows welcome page when private window permission not enabled
- **Screenshot compression toggle** - User-configurable JPEG vs PNG format (default: compressed)
- **Permission status indicator** - Shows private window permission state in popup

### Visual Polish (2026-01-05)

- **Hero logo redesign** - "Atomic Kaiju" aesthetic with tesseract frame, orbiting electrons, conical spines, cyclops eye, asymmetric bendy arms, rounded feet
- **Watermark updates** - Conical spines with glow, z-index layering fix, cyclops eye, 20% larger (84→100px)
- **Watermark animations** - Breathing scale animation (1.20→1.24) only when active, glow throb effect, soft dissolve edges on elliptical glow
- **Speech bubble feature** - Tiny 8x8px white bubble with music note (♪) appears when Claude is working, positioned at `top: 37px, right: 34px` relative to watermark container, diagonal tail pointing to monster's mouth, bobbing note animation
- **Arms rendering fix** - Moved to render after glow layer so they appear in front (z-index correction)
- **Tesseract scaling** - Fixed clipping at container's rounded corners by using 1.20 scale factor
- **Focusglow enhancements** - 1s fade in, 2s fade out, pixie dust particle animation
- **Favicon** - Conical filled spines (matching hero/watermark)
- **Tagline typography** - Orbitron font, white color

### Infrastructure

- **Repo transfer** - Moved to `boot-industries/claudezilla` organization
- **README** - Updated clone URL, added Issues link

---

## v0.3.1 (2026-01-05)

**Multi-agent safety.**

### Features

- Tab ownership tracking (each tab knows its creator)
- Screenshot mutex (serialized to prevent collisions)
- Agent IDs generated per MCP server instance

---

## v0.3.0 (2026-01-04)

**Payload optimization.**

### Features

- Content truncation (50K chars default)
- HTML excluded by default (opt-in)
- Accessibility tree capped at 200 nodes
- Page state configurable limits

---

## v0.2.0 (2026-01-04)

**Visual effects.**

### Features

- Focus glow effect follows Claude's interactions
- Watermark badge with animated electrons
- Tab groups support (Firefox 138+)

---

## v0.1.0 (2026-01-03)

**Fast page analysis.**

### Features

- `getPageState` - Structured JSON extraction
- `getAccessibilitySnapshot` - Semantic tree
- Multi-session window targeting

---

## v0.0.3 (2026-01-02)

**Permission gating.**

### Features

- Auto-detect "Run in Private Windows" permission
- Navigate without tabId restricted in private mode (use tabId for owned tabs)

---

## v0.0.2 (2026-01-01)

**DevTools commands.** (Planned - not implemented)

### Planned

- Console capture
- Network monitoring
- JavaScript evaluation
- Element inspection

---

## v0.0.1 (2025-12-31)

**Initial release.**

### Features

- Native messaging bridge
- Basic browser control (navigate, click, type)
- Screenshot capture
- MCP server integration

## Tags

#changelog #clz
