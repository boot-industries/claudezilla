# Nix packaging

The flake at the repo root is the distribution channel — nothing is uploaded
anywhere. `nix.yml` CI validates that the package builds on every push.

## Installing

```sh
# Imperative
nix profile install github:boot-industries/claudezilla

# Try it out
nix run github:boot-industries/claudezilla   # runs claudezilla-mcp
```

## NixOS configuration

```nix
{
  inputs.claudezilla.url = "github:boot-industries/claudezilla";

  # in your system config:
  environment.systemPackages = [ inputs.claudezilla.packages.${pkgs.system}.default ];
  programs.firefox = {
    enable = true;
    nativeMessagingHosts.packages = [ inputs.claudezilla.packages.${pkgs.system}.default ];
  };
}
```

An overlay is also exported (`inputs.claudezilla.overlays.default`), adding
`pkgs.claudezilla`.

After installing, run `claudezilla-setup` once per user. The native messaging
manifest inside the package points at the store path of `claudezilla-host`, so
Firefox must pick it up via `nativeMessagingHosts` (NixOS/home-manager) or by
symlinking `<store-path>/lib/mozilla/native-messaging-hosts/claudezilla.json`
into `~/.mozilla/native-messaging-hosts/`.

## Notes

- Dependency hashes come from `mcp/package-lock.json` via `importNpmLock` —
  no vendor hash to bump. Regenerate the lock file when upstream changes
  `mcp/package.json`.
- Listing in [NUR](https://github.com/nix-community/NUR) is a one-time PR that
  registers this repo; the flake works as-is without it.
