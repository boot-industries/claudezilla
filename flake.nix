{
  description = "Firefox browser automation for Claude Code — MCP server and native messaging host";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems
        (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: rec {
        claudezilla = pkgs.callPackage ./packaging/nix/package.nix { };
        default = claudezilla;
      });

      overlays.default = final: prev: {
        claudezilla = final.callPackage ./packaging/nix/package.nix { };
      };
    };
}
