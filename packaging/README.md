# Packaging

Distro packaging for Claudezilla, published automatically by GitHub Actions.
Pushing a `v<version>` tag (matching `package.json`) triggers every channel;
each one checks its own credentials and **skips cleanly if they are missing**,
so one unconfigured service never blocks the others.

```
git tag v0.6.9 && git push origin v0.6.9
```

| Channel | Workflow | Credentials (repo secrets) | Install |
|---|---|---|---|
| Arch (AUR) | `aur-publish.yml` | `AUR_USERNAME`, `AUR_EMAIL`, `AUR_SSH_PRIVATE_KEY` | `yay -S claudezilla` |
| Alpine (Pages apk repo) | `alpine-publish.yml` | `ABUILD_PRIVKEY` | see [alpine/README.md](alpine/README.md) |
| Fedora/EPEL (COPR) | `copr-publish.yml` | `COPR_API_CONFIG` | `dnf copr enable <user>/claudezilla && dnf install claudezilla` |
| NixOS / Nix | `nix.yml` (validation only) | none — the flake in this repo *is* the channel | `nix profile install github:boot-industries/claudezilla` |

Non-tag pushes to `main` run build-only validation for Alpine, the SRPM, and
the Nix flake (no credentials needed), so packaging breakage surfaces before a
release.

Channels deliberately not covered: Debian/Ubuntu (archive/PPA upload process),
Flathub and Snap classic confinement (human review queues; sandboxing also
fights native messaging), Void/Gentoo/openSUSE Factory (reviewed MRs).

## Layout

- `common/` — files shared by all packages:
  - `claudezilla-setup` — per-user setup installed as `/usr/bin/claudezilla-setup`
    (Firefox headless profile with the bundled XPI sideloaded, `~/.claude`
    permissions and MCP config). POSIX sh.
  - `claudezilla.json` — Firefox native messaging manifest.
  - `claudezilla-browser.service` — systemd user unit for the headless browser.
- `aur/` — PKGBUILD template + install hooks ([details](aur/README.md))
- `alpine/` — APKBUILD template + container build script ([details](alpine/README.md))
- `fedora/` — RPM spec template ([details](fedora/README.md))
- `nix/` — Nix derivation used by the top-level `flake.nix` ([details](nix/README.md))

## What every package installs

| Path | Purpose |
|---|---|
| `/usr/lib/claudezilla/host/` | Native messaging host |
| `/usr/lib/claudezilla/mcp/` | MCP server with vendored `node_modules` |
| `/usr/lib/claudezilla/claudezilla.xpi` | Built extension (unsigned) |
| `/usr/bin/claudezilla-host` | Native messaging host entry point |
| `/usr/bin/claudezilla-mcp` | MCP server entry point |
| `/usr/bin/claudezilla-setup` | Per-user setup |
| `/usr/lib/mozilla/native-messaging-hosts/claudezilla.json` | System-wide native messaging manifest |
| `/usr/lib/systemd/user/claudezilla-browser.service` | Headless browser user service (not on Alpine) |

(Nix installs the same layout under the store path, with the manifest path
rewritten accordingly.)

Note: `mcp/package-lock.json` is committed (upstream uses pnpm) because the
Nix build derives every dependency hash from it. Regenerate with
`cd mcp && npm install --package-lock-only` when upstream bumps dependencies.
