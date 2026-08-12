# Fedora / EPEL packaging (COPR)

Releases are built in [COPR](https://copr.fedorainfracloud.org) from an SRPM
uploaded by `copr-publish.yml`. The workflow vendors `mcp/node_modules` into
the source tarball on the runner, so the COPR builder needs no network access.

## Using the repository

```sh
dnf copr enable <copr-user>/claudezilla
dnf install claudezilla
claudezilla-setup
```

## One-time setup (repo owner)

1. Log in at copr.fedorainfracloud.org (Fedora account).
2. Copy the config from <https://copr.fedorainfracloud.org/api/> and add its
   full contents as the `COPR_API_CONFIG` repository secret.
3. The first tagged run creates the `claudezilla` project with the
   `fedora-rawhide-x86_64` chroot; enable additional chroots (current Fedora
   releases, EPEL) in the COPR web UI — the package is noarch, so any x86_64
   chroot produces rpms installable everywhere.

Without the secret, the workflow still builds and uploads the SRPM as a CI
artifact and skips the COPR submission.
