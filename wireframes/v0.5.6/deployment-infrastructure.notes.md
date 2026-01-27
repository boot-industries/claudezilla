# Claudezilla Deployment Infrastructure - Notes

**Version:** 0.5.6
**Last Updated:** 2026-01-25

## What's New in v0.5.6

### Windows Support
Full Windows 10/11 support added with platform-specific paths and security:

| Component | Unix | Windows |
|-----------|------|---------|
| IPC | Unix socket (`/tmp/claudezilla.sock`) | Named pipe (`\\.\pipe\claudezilla`) |
| Auth Token | `$TMPDIR/claudezilla-auth.token` | `%LOCALAPPDATA%\claudezilla\auth.token` |
| Host Directory | `~/.claudezilla/` | `%APPDATA%\claudezilla\` |
| Permissions | `chmod 0600` | `icacls` ACL |
| Installer | `install-macos.sh`, `install-linux.sh` | `install-windows.ps1` |

### Named Pipe Benefits
- Auto-cleanup when server closes (no stale socket files)
- Built-in security via Windows ACLs
- Better integration with Windows security model

## User Machine Components

### Unix (macOS/Linux)

**Firefox Extension:**
- Installed from Firefox Add-ons (AMO)
- Runs as MV2 WebExtension
- Manages single private window with 12-tab pool

**Native Host:**
- Location: `~/.claudezilla/host/`
- Entry: `node index.js`
- IPC: Unix socket at `$TMPDIR/claudezilla.sock`

**Auth Token:**
- Location: `$TMPDIR/claudezilla-auth.token` (XDG_RUNTIME_DIR if available)
- Permissions: 0600 (user-only read/write)
- Generated: 32 random bytes, hex-encoded

### Windows (v0.5.6)

**Firefox Extension:**
- Same as Unix (cross-platform WebExtension)
- Installed from Firefox Add-ons

**Native Host:**
- Location: `%APPDATA%\claudezilla\`
- Entry: `node index.js`
- IPC: Named pipe at `\\.\pipe\claudezilla`

**Auth Token:**
- Location: `%LOCALAPPDATA%\claudezilla\auth.token`
- Security: User-only ACL via `icacls`
- Generated: Same as Unix (32 random bytes)

**Registry Key:**
- Path: `HKCU\Software\Mozilla\NativeMessagingHosts\claudezilla`
- Value: Path to `claudezilla.json` manifest

## Cloud Components

### Cloudflare Pages
Hosts the marketing website (`claudezilla.com`):

- **index.html** - Landing page
- **extension.html** - Installation guide
- **docs.html** - Documentation
- **support.html** - Donations/support

**Deployment:**
```bash
wrangler pages deploy website --project-name=claudezilla
```

**⚠️ CDN Cache:** Main domain may serve stale content for 2-5 minutes after deploy. Preview URLs are always fresh.

### Cloudflare Workers
Handles Stripe payment processing:

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/create-checkout` | POST | Create Stripe checkout session |
| `/notify` | POST | Email signup |
| `/health` | GET | Health check |

**Environment Variables:**
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Webhook signature verification

### Cloudflare D1
SQLite database for email signups:

**Schema:**
```sql
CREATE TABLE email_signups (
    id INTEGER PRIMARY KEY,
    email TEXT UNIQUE,
    created_at INTEGER
);
```

## External Services

### Stripe API
Payment processing for support donations:
- Checkout sessions for one-time and recurring payments
- Amount validation (min $3, max $500)
- Origin validation for CORS security

### Firefox Add-ons (AMO)
Extension distribution:
- Listed as unlisted (direct install link)
- Auto-updates via AMO

### GitHub
Source code and CI/CD:
- Repository: `boot-industries/claudezilla`
- Auto-deploy to Cloudflare Pages (when working)
- Manual deploy fallback via wrangler

## Installation Paths

### macOS
```bash
~/.claudezilla/
~/.mozilla/native-messaging-hosts/claudezilla.json
```

### Linux
```bash
~/.claudezilla/
~/.mozilla/native-messaging-hosts/claudezilla.json
```

### Windows
```
%APPDATA%\claudezilla\
%APPDATA%\Mozilla\NativeMessagingHosts\claudezilla.json
HKCU\Software\Mozilla\NativeMessagingHosts\claudezilla
```

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - High-level system design
- [Repository Structure](./repo-structure.mermaid.md) - Code organization
