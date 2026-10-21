{ lib
, stdenv
, nodejs
, importNpmLock
, makeWrapper
, zip
, version ? "dev"
, src ? ../..
}:

stdenv.mkDerivation {
  pname = "claudezilla";
  inherit version src;

  nativeBuildInputs = [ makeWrapper zip nodejs importNpmLock.npmConfigHook ];
  buildInputs = [ nodejs ];

  npmDeps = importNpmLock.buildNodeModules {
    npmRoot = ../../mcp;
    inherit nodejs;
  };

  buildPhase = ''
    runHook preBuild
    cp -r ${importNpmLock.buildNodeModules { npmRoot = ../../mcp; inherit nodejs; }}/node_modules mcp/node_modules
    (cd extension && zip -qr ../claudezilla.xpi .)
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    DESTDIR="$out" PREFIX="" \
      LIBDIR="/lib/claudezilla" BINDIR="/bin" \
      MOZDIR="/lib/mozilla/native-messaging-hosts" \
      UNITDIR="/lib/systemd/user" \
      DOCDIR="/share/doc/claudezilla" \
      LICENSEDIR="/share/licenses/claudezilla" \
      NODE_BIN="${lib.getExe nodejs}" \
      ./packaging/common/install-tree.sh
    runHook postInstall
  '';

  meta = with lib; {
    description = "Firefox browser automation for Claude Code";
    homepage = "https://github.com/boot-industries/claudezilla";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
