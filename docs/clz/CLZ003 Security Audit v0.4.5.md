# CLZ001 Security Audit v0.4.5

**Date:** 2026-01-05
**Version:** 0.4.5
**Status:** Complete

## Summary

Comprehensive security audit of Claudezilla addressing 15 vulnerabilities across the native messaging host, MCP server, and Firefox extension.

## Vulnerabilities Identified

### Critical (4)

| ID | Issue | Location | Fix |
|----|-------|----------|-----|
| C1 | Socket world-accessible | host/index.js:188 | chmod 0600 after bind |
| C2 | Request body capture | background.js:64 | Remove requestBody from listener |
| C3 | Tab ownership bypass | background.js:507 | Require agentId for close |
| C4 | Debug log world-readable | host/index.js:21 | Create with 0600 permissions |

### High (8)

| ID | Issue | Fix |
|----|-------|-----|
| H1 | No URL scheme validation | Whitelist http/https/about only |
| H2 | Agent ID weak entropy (32-bit) | Increase to 128-bit (16 bytes) |
| H3 | No ownership check on content commands | Verify agent owns tab before getContent, click, etc. |
| H4 | Window close no ownership check | Block if other agents have tabs |
| H5 | Console capture always on | Make opt-in, enable on first request |
| H6 | Unbounded socket buffer | Add 10MB limit |
| H7 | TMPDIR hijacking | Prefer XDG_RUNTIME_DIR |
| H8 | Install scripts use default umask | Explicit chmod 755/644 |

### Medium (3)

| ID | Issue | Fix |
|----|-------|-----|
| M1 | CSS selector injection | Validate selector syntax, 1000 char limit |
| M2 | Screenshot race condition | Verify active tab after delay |
| M3 | Request ID overflow | Use UUID instead of counter |

## Files Modified

| File | Changes |
|------|---------|
| `host/index.js` | Socket permissions, buffer limits, TMPDIR, UUID requests |
| `extension/background.js` | URL validation, ownership checks, screenshot fix |
| `extension/content.js` | Selector validation, opt-in console |
| `mcp/server.js` | 128-bit agent ID, ownership command injection |
| `install/install-macos.sh` | Explicit chmod |
| `install/install-linux.sh` | Explicit chmod |
| `SECURITY.md` | 11 security principles documented |

## Commits

1. `3b21d11` - Security: Comprehensive security audit and hardening (v0.4.5)
2. `503184e` - Feat: Content command ownership, opt-in console capture, selector validation

## Security Model

After this audit, Claudezilla implements 11 security principles:

1. Command whitelist
2. Structured data model
3. No content-as-instructions
4. Local socket security (0600)
5. Extension permission gating
6. URL scheme validation
7. Multi-agent tab isolation
8. Sensitive data handling
9. Content command ownership
10. Console capture opt-in
11. CSS selector validation

See [[../../SECURITY.md]] for full documentation.

## Tags

#security #audit #clz
