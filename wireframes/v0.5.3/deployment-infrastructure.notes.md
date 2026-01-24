# Claudezilla Deployment Infrastructure - Notes

**Version:** 0.5.3
**Last Updated:** 2026-01-18

## Overview

Claudezilla runs across three environments:
1. **User's Machine** - Extension, native host, Claude Code
2. **Cloudflare Edge** - Website, API, database
3. **External Services** - Stripe, Firefox Add-ons, GitHub

## User Machine Components

### Firefox Extension

**Installation Methods:**
1. Firefox Add-ons Marketplace (AMO) - Production
2. `about:debugging` → "Load Temporary Add-on" - Development
3. XPI file direct install

**Files:**
```
~/.mozilla/extensions/claudezilla@boot.industries/
├── manifest.json
├── background.js
├── content.js
├── popup/
│   ├── popup.html
│   └── popup.js
└── icons/
    └── claudezilla-48.svg
```

**Permissions Required:**
- `nativeMessaging` - Connect to native host
- `tabs` - Tab management
- `activeTab` - Current tab access
- `<all_urls>` - Content script injection
- `webRequest`, `webRequestBlocking` - Network monitoring
- `storage` - Settings persistence

### Native Messaging Host

**Installation:**
```bash
./install/install-macos.sh
# or
./install/install-linux.sh
```

**Files Created:**
```
~/.claudezilla/
├── host/
│   ├── index.js
│   ├── protocol.js
│   └── package.json
└── claudezilla.json  (native messaging manifest)

# Native messaging manifest copied to:
# macOS: ~/Library/Application Support/Mozilla/NativeMessagingHosts/
# Linux: ~/.mozilla/native-messaging-hosts/
```

**Runtime Files:**
```
$TMPDIR/ (or $XDG_RUNTIME_DIR)
├── claudezilla.sock      (Unix socket, 0600 permissions)
├── claudezilla-auth.token (Auth token, 0600 permissions)
└── claudezilla-debug.log  (Debug log, 0600 permissions)
```

### MCP Server

**Installation:**
```bash
# Add to Claude Code MCP config
{
  "mcpServers": {
    "claudezilla": {
      "command": "node",
      "args": ["/path/to/claudezilla/mcp/server.js"]
    }
  }
}
```

**Runtime:**
- Spawned by Claude Code as child process
- Communicates via stdin/stdout (MCP protocol)
- Connects to native host via Unix socket

### Claude Plugin

**Installation:**
```bash
# Symlink plugin to Claude plugins directory
ln -s /path/to/claudezilla/plugin ~/.claude/plugins/claudezilla-loop
```

**Files:**
```
~/.claude/plugins/claudezilla-loop/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   ├── hooks.json
│   └── stop-hook.sh
├── commands/
│   ├── focus.md
│   ├── cancel-focus.md
│   └── help.md
└── README.md
```

## Cloudflare Components

### Cloudflare Pages (Website)

**Deployment:**
```bash
# Manual deploy (GitHub org connection issues)
wrangler pages deploy website --project-name=claudezilla
```

**Domain:** `claudezilla.com`

**CDN Behavior:**
- Cache propagation: 2-5 minutes
- Preview URL shows changes immediately
- Production domain has cache delay

**Files Deployed:**
```
website/
├── index.html      (Landing page)
├── extension.html  (Setup guide)
├── docs.html       (Documentation)
├── support.html    (Donations)
├── privacy.html    (Privacy policy)
├── assets/         (CSS, images)
└── scripts/        (JS)
```

### Cloudflare Workers (API)

**Deployment:**
```bash
cd worker
wrangler deploy
```

**Configuration:** `worker/wrangler.toml`

**Endpoints:**
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/create-checkout` | POST | Create Stripe checkout session |
| `/notify` | POST | Email signup |
| `/health` | GET | Health check |

**Environment Variables:**
- `STRIPE_SECRET_KEY` - Stripe API key (secret)
- `STRIPE_WEBHOOK_SECRET` - Webhook validation
- `FRONTEND_URL` - Redirect URL base

**Bindings:**
- `DB` - D1 database binding

### Cloudflare D1 (Database)

**Database Name:** Configured in wrangler.toml

**Schema:**
```sql
CREATE TABLE email_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
```

## External Services

### Stripe

**Integration:**
- Checkout Sessions API for payments
- One-time and monthly subscription support
- Redirect-based checkout flow

**Limits:**
- Amount: $3.00 - $999.99
- Currencies: USD only

### Firefox Add-ons (AMO)

**Listing:** https://addons.mozilla.org/firefox/addon/claudezilla/

**Review Process:**
- Manual review for new versions
- 1-5 day turnaround
- Source code may be requested

### GitHub

**Repository:** `boot-industries/claudezilla`

**Branches:**
- `main` - Production code
- `feature/*` - Feature development

**No Auto-Deploy:**
- Cloudflare Pages connection issues with org
- Manual `wrangler pages deploy` required

## CI/CD Pipeline

Currently manual deployment:

```bash
# 1. Build extension
npx web-ext build --source-dir=extension

# 2. Deploy website
wrangler pages deploy website --project-name=claudezilla

# 3. Deploy worker
cd worker && wrangler deploy

# 4. Submit to AMO (for extension updates)
# Upload XPI at addons.mozilla.org
```

## Environment Differences

| Component | Development | Production |
|-----------|-------------|------------|
| Extension | Temporary add-on | AMO installed |
| Host logs | Console + file | File only |
| Website | localhost | Cloudflare Pages |
| Worker | `wrangler dev` | Cloudflare Edge |
| Database | Local D1 | Cloudflare D1 |

## Monitoring

**Available Logs:**
- Native host: `$TMPDIR/claudezilla-debug.log`
- Extension: Browser console (about:debugging)
- Worker: Cloudflare dashboard
- Pages: Cloudflare dashboard

**Health Checks:**
- `GET /health` on worker
- Extension popup connection test
- `firefox_diagnose` MCP tool

## Scaling Considerations

**Current Architecture:**
- Single user machine (not multi-tenant)
- 10-tab limit per window
- Single private window

**If scaling needed:**
- Worker handles concurrent requests well (edge computing)
- D1 scales automatically
- Extension is per-user, no central scaling concern

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - System design
- [Entry Points](./entry-points.mermaid.md) - How to interact
