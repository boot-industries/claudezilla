# CLZ002 Changelog

**Project:** Claudezilla
**Current Version:** 0.4.5

## v0.4.5 (2026-01-05)

**Security hardening release.** Comprehensive audit fixing 15 vulnerabilities.

### Security

- Socket permissions set to 0600 (user-only)
- URL scheme validation (blocks javascript:, data:, file://)
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

## v0.4.4 (2026-01-05)

**Multi-agent safety.**

### Features

- Tab ownership tracking (each tab knows its creator)
- Screenshot mutex (serialized to prevent collisions)
- Agent IDs generated per MCP server instance

---

## v0.4.3 (2026-01-04)

**Payload optimization.**

### Features

- Content truncation (50K chars default)
- HTML excluded by default (opt-in)
- Accessibility tree capped at 200 nodes
- Page state configurable limits

---

## v0.4.2 (2026-01-04)

**Visual effects.**

### Features

- Focus glow effect follows Claude's interactions
- Watermark badge with animated electrons
- Tab groups support (Firefox 138+)

---

## v0.4.0 (2026-01-03)

**Fast page analysis.**

### Features

- `getPageState` - Structured JSON extraction
- `getAccessibilitySnapshot` - Semantic tree
- Multi-session window targeting

---

## v0.3.0 (2026-01-02)

**Permission gating.**

### Features

- Auto-detect "Run in Private Windows" permission
- Navigate without tabId restricted in private mode (use tabId for owned tabs)

---

## v0.2.0 (2026-01-01)

**DevTools commands.** (Planned - not implemented)

### Planned

- Console capture
- Network monitoring
- JavaScript evaluation
- Element inspection

---

## v0.1.0 (2025-12-31)

**Initial release.**

### Features

- Native messaging bridge
- Basic browser control (navigate, click, type)
- Screenshot capture
- MCP server integration

## Tags

#changelog #clz
