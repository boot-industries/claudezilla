{ lib
, stdenv
, nodejs
, importNpmLock
, zip
, makeWrapper
}:

let
  version = (builtins.fromJSON (builtins.readFile ../../package.json)).version;

  # mcp/package-lock.json is committed specifically so this needs no
  # fixed-output hash to maintain.
  mcpNodeModules = importNpmLock.buildNodeModules {
    npmRoot = ../../mcp;
    inherit nodejs;
  };
in
stdenv.mkDerivation {
  pname = "claudezilla";
  inherit version;

  src = ../..;

  nativeBuildInputs = [ zip makeWrapper ];

  buildPhase = ''
    runHook preBuild
    (cd extension && zip -qr ../claudezilla.xpi .)
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    libdir=$out/lib/claudezilla
    install -d $libdir/host $libdir/mcp

    install -m644 host/index.js host/ipc.js host/protocol.js host/cli.js \
      host/package.json $libdir/host/

    install -m644 mcp/server.js mcp/package.json $libdir/mcp/
    cp -r ${mcpNodeModules}/node_modules $libdir/mcp/node_modules

    install -m644 claudezilla.xpi $libdir/claudezilla.xpi

    mkdir -p $out/bin
    makeWrapper ${lib.getExe nodejs} $out/bin/claudezilla-host \
      --add-flags $libdir/host/index.js
    makeWrapper ${lib.getExe nodejs} $out/bin/claudezilla-mcp \
      --add-flags $libdir/mcp/server.js
    install -m755 packaging/common/claudezilla-setup $out/bin/claudezilla-setup

    # Native messaging manifest; the path must point into the store.
    # NixOS: programs.firefox.nativeMessagingHosts.packages = [ this package ]
    # picks it up from lib/mozilla/native-messaging-hosts.
    install -d $out/lib/mozilla/native-messaging-hosts
    substitute packaging/common/claudezilla.json \
      $out/lib/mozilla/native-messaging-hosts/claudezilla.json \
      --replace-fail "/usr/bin/claudezilla-host" "$out/bin/claudezilla-host"

    install -Dm644 LICENSE $out/share/licenses/claudezilla/LICENSE
    install -Dm644 README.md $out/share/doc/claudezilla/README.md

    runHook postInstall
  '';

  meta = {
    description = "Firefox browser automation for Claude Code — MCP server and native messaging host";
    homepage = "https://github.com/boot-industries/claudezilla";
    license = lib.licenses.mit;
    mainProgram = "claudezilla-mcp";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
}
