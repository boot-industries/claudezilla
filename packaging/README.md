# Packaging

Recipes for building Claudezilla as a native package. They all install the same
tree through `common/install-tree.sh`, so the file layout is defined once.

## Layout

| Path | Contents |
|------|----------|
| `$PREFIX/lib/claudezilla/host` | native messaging host |
| `$PREFIX/lib/claudezilla/mcp` | MCP server with vendored `node_modules` |
| `$PREFIX/lib/claudezilla/claudezilla.xpi` | extension, sideloaded by `claudezilla-setup` |
| `$PREFIX/bin/claudezilla-{host,mcp,setup}` | launchers and per-user setup |
| `$PREFIX/lib/mozilla/native-messaging-hosts/claudezilla.json` | system-wide manifest |
| `$PREFIX/lib/systemd/user/claudezilla-browser.service` | headless browser unit |

`install-tree.sh` takes `DESTDIR` plus optional `PREFIX`, `LIBDIR`, `BINDIR`,
`MOZDIR`, `UNITDIR`, `NODE_BIN`, `WITH_SYSTEMD` and `WITH_MOZDIR`. Unprivileged
installs (Homebrew, MacPorts) set `WITH_SYSTEMD=0 WITH_MOZDIR=0`;
`claudezilla-setup` then writes a per-user manifest instead.

The generated launchers pick a runtime at exec time: `$CLZ_RUNTIME` if set,
then `bun` if the user has it, then the packaged Node.js. Node.js is the
declared dependency everywhere; Bun is never required.

## Recipes

| Target | Path | Notes |
|--------|------|-------|
| Arch / AUR | `aur/PKGBUILD.in` | |
| Alpine | `alpine/APKBUILD.in` | |
| Fedora / RHEL / openSUSE | `rpm/claudezilla.spec.in` | one spec, `%if 0%{?suse_version}` for the differences |
| Debian / Ubuntu | `debian/` | `debhelper-compat 13`, native source format |
| Gentoo | `gentoo/claudezilla-9999.ebuild` | live ebuild; releases use a vendored tarball |
| Void | `void/template.in` | |
| Nix | `nix/package.nix`, `../flake.nix` | pinned `nodejs`; no PATH lookups |
| Homebrew | `homebrew/claudezilla.rb.in` | |
| MacPorts | `macports/Portfile.in` | |
| winget | `winget/*.yaml.in` | zip installer, portable nested type |
| Scoop | `scoop/claudezilla.json.in` | |
| Chocolatey | `chocolatey/` | |

Flatpak and Snap are deliberately absent: both confine the sandbox in ways that
break native messaging, which needs Firefox to spawn a host binary outside its
own runtime.

## Templates

Files ending in `.in` are templates. Substituted before publishing:

| Placeholder | Meaning |
|-------------|---------|
| `@VERSION@` | release version, no `v` prefix |
| `@REPO@` | `owner/name` of the GitHub repository |
| `@SHA256@` | checksum of the referenced artifact |
| `@MAINTAINER@` | packager name and address |
| `@DATE@` | RFC 2822 date (Debian changelog only) |

The three Windows recipes reference a `claudezilla-<version>-win.zip` release
artifact containing `bin/` and `lib/`; it is produced by the release workflow.
