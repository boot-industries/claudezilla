# AUR packaging

Deployed to the [AUR](https://aur.archlinux.org/packages/claudezilla) by
`.github/workflows/aur-publish.yml` on `v*` tags (or manual dispatch).
See [../README.md](../README.md) for the overall release flow and the file
layout the package installs.

## Files

- `PKGBUILD.in` — PKGBUILD template. `@PKGVER@` and `@REPO@` are substituted
  by the workflow; `sha256sums` are filled in by `updpkgsums` during the run.
  Shared assets (setup script, native messaging manifest, systemd unit) come
  from `../common/` inside the source tarball.
- `claudezilla.install` — pacman install hooks (post-install instructions).

## Required repository secrets

| Secret | Value |
|---|---|
| `AUR_USERNAME` | Your AUR account username |
| `AUR_EMAIL` | Email for the AUR git commits |
| `AUR_SSH_PRIVATE_KEY` | Private SSH key whose public half is registered in your AUR account |

Setup: create an account on aur.archlinux.org, generate a dedicated key with
`ssh-keygen -t ed25519 -f aur -C aur@github-actions`, paste `aur.pub` into
AUR → My Account → SSH Public Key, and add the private key file contents as
the `AUR_SSH_PRIVATE_KEY` secret. The first workflow run creates the AUR
package `claudezilla` (the name is unclaimed as of 2026-08). If the secrets
are missing, the workflow skips with a notice instead of failing.

## Users install with

```sh
yay -S claudezilla    # or: paru -S claudezilla
claudezilla-setup
systemctl --user enable --now claudezilla-browser
```
