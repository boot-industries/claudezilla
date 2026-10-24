#!/bin/sh

# Runs INSIDE an alpine container (see .github/workflows/alpine-publish.yml).
# Expects:
#   /work        - repository checkout (mounted)
#   /work/dist   - output dir; may be pre-seeded with the existing Pages repo
#   $PKGVER      - package version (x.y.z)
#   /work/dist/keys/claudezilla-apk.rsa  - private signing key (mounted by CI)
#
# Builds the apk with abuild, then assembles a signed apk repository under
# /work/dist/alpine/<arch>/ for every arch in $REPO_ARCHES (the package is
# noarch, so the same apk is indexed into each arch directory).

set -eu

REPO_ARCHES="x86_64 aarch64 armv7"
KEYNAME="claudezilla-apk.rsa"
KEYFILE="/work/dist/keys/$KEYNAME"

apk add --no-cache alpine-sdk nodejs npm zip tar >/dev/null

# --- signing key -----------------------------------------------------------
mkdir -p /root/.abuild
cp "$KEYFILE" "/root/.abuild/$KEYNAME"
chmod 600 "/root/.abuild/$KEYNAME"
openssl rsa -in "/root/.abuild/$KEYNAME" -pubout -out "/root/.abuild/$KEYNAME.pub" 2>/dev/null
echo "PACKAGER_PRIVKEY=/root/.abuild/$KEYNAME" > /root/.abuild/abuild.conf
cp "/root/.abuild/$KEYNAME.pub" /etc/apk/keys/

# --- stage APKBUILD + source tarball --------------------------------------
BUILD=/tmp/claudezilla-build
mkdir -p "$BUILD"
sed -e "s|@PKGVER@|$PKGVER|g" \
    -e "s|@REPO@|${GITHUB_REPOSITORY:-boot-industries/claudezilla}|g" \
    /work/packaging/alpine/APKBUILD.in > "$BUILD/APKBUILD"
tar -C /work --exclude-vcs --exclude='./dist' \
    --transform "s,^\.,claudezilla-$PKGVER," \
    -czf "$BUILD/claudezilla-$PKGVER.tar.gz" .

cd "$BUILD"
abuild -F checksum
REPODEST=/tmp/repodest abuild -F -r

APK=$(find /tmp/repodest -name "claudezilla-$PKGVER-r*.apk" | head -1)
[ -n "$APK" ] || { echo "ERROR: built apk not found"; exit 1; }
echo "Built: $APK"

# --- assemble the signed repository ---------------------------------------
for arch in $REPO_ARCHES; do
    dir="/work/dist/alpine/$arch"
    mkdir -p "$dir"
    cp "$APK" "$dir/"
    cd "$dir"
    apk index --rewrite-arch "$arch" -o APKINDEX.unsigned.tar.gz ./*.apk
    abuild-sign -k "/root/.abuild/$KEYNAME" APKINDEX.unsigned.tar.gz
    mv APKINDEX.unsigned.tar.gz APKINDEX.tar.gz
done

# Publish the public key alongside the repo so clients can fetch it
cp "/root/.abuild/$KEYNAME.pub" /work/dist/alpine/
echo "Repository assembled under dist/alpine/"
