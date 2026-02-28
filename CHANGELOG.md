# CLZ002 Changelog

**Project:** Claudezilla
**Current Version:** 0.5.8

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
