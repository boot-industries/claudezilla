# Alpine packaging

Alpine has no low-friction path into aports, so releases are published as a
**self-hosted signed apk repository** on this repo's GitHub Pages.

## Using the repository

```sh
wget -O /etc/apk/keys/claudezilla-apk.rsa.pub \
    https://boot-industries.github.io/claudezilla/alpine/claudezilla-apk.rsa.pub
echo "https://boot-industries.github.io/claudezilla/alpine" >> /etc/apk/repositories
apk update
apk add claudezilla
claudezilla-setup
```

The package is `noarch`; the repo carries indexes for x86_64, aarch64, and
armv7. Note Alpine ships Firefox ESR, which is exactly what the unsigned
sideloaded extension needs. `claudezilla-browser.service` is not installed
here (Alpine uses OpenRC) — start the browser with
`firefox --headless --no-remote --profile ~/.mozilla/firefox/claudezilla-headless`.

## How publishing works

`alpine-publish.yml` runs `ci-build.sh` inside an `alpine:3.22` container:
`abuild -F -r` builds the apk from a tarball of the checked-out tree, then the
apk is indexed (`apk index --rewrite-arch`) into each arch directory, signed
with `abuild-sign`, merged with the previously published packages from
`gh-pages`, and deployed back to Pages.

- Signing key: RSA key in the `ABUILD_PRIVKEY` repo secret (generate with
  `openssl genrsa -out claudezilla-apk.rsa 4096`). The public half is derived
  from it during the build and published at `alpine/claudezilla-apk.rsa.pub`
  automatically — clients fetch it from there (see above).
- Without the secret, CI still does a validation build with a throwaway key;
  it just skips the Pages deploy.
- Pushes to `main` validate the build; only `v*` tags (or a manual dispatch
  with a tag) publish.
