#!/bin/bash

# Claudezilla Installer for Linux
# - Native messaging host + manifest
# - MCP dependencies
# - Claude Code permissions + MCP config
# - Firefox permanent extension install (headless profile)
# - systemd user service + launch script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_PATH="$PROJECT_DIR/host/index.js"
NATIVE_HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"

echo "Claudezilla Installer (Linux)"
echo "=============================="
echo ""

# ---------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------

if [ ! -f "$HOST_PATH" ]; then
    echo "Error: Host script not found at $HOST_PATH"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Native messaging host
# ---------------------------------------------------------------------------

chmod 755 "$HOST_PATH"
echo "Set host permissions to 755: $HOST_PATH"

mkdir -p "$NATIVE_HOSTS_DIR"

MANIFEST_PATH="$NATIVE_HOSTS_DIR/claudezilla.json"
cat > "$MANIFEST_PATH" << EOF
{
  "name": "claudezilla",
  "description": "Claude Code Firefox browser automation bridge",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_extensions": ["claudezilla@boot.industries"]
}
EOF
chmod 644 "$MANIFEST_PATH"
echo "Native manifest: $MANIFEST_PATH"

# ---------------------------------------------------------------------------
# 3. MCP dependencies
# ---------------------------------------------------------------------------

MCP_DIR="$PROJECT_DIR/mcp"
if [ -f "$MCP_DIR/package.json" ]; then
    command -v npm >/dev/null 2>&1 || { echo "Error: npm not found. Please install Node.js and npm first."; exit 1; }
    echo "Installing MCP dependencies..."
    cd "$MCP_DIR" && npm install --quiet
    cd "$PROJECT_DIR"
    echo "MCP dependencies installed."
fi

# ---------------------------------------------------------------------------
# 4. Claude Code permissions + MCP config
# ---------------------------------------------------------------------------

CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
MCP_FILE="$CLAUDE_DIR/mcp.json"
mkdir -p "$CLAUDE_DIR"

echo "Configuring Claude Code..."

if command -v jq &> /dev/null; then
    if [ -f "$SETTINGS_FILE" ]; then
        jq '.permissions.allow = ((.permissions.allow // []) + ["mcp__claudezilla__*"] | unique)' \
            "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
    else
        echo '{"permissions":{"allow":["mcp__claudezilla__*"]}}' | jq '.' > "$SETTINGS_FILE"
    fi
    echo "  Permissions: $SETTINGS_FILE"

    MCP_SERVER_CONFIG="{\"command\":\"node\",\"args\":[\"$PROJECT_DIR/mcp/server.js\"]}"
    if [ -f "$MCP_FILE" ]; then
        jq --argjson cfg "$MCP_SERVER_CONFIG" '.mcpServers.claudezilla = $cfg' \
            "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
    else
        echo "{\"mcpServers\":{\"claudezilla\":$MCP_SERVER_CONFIG}}" | jq '.' > "$MCP_FILE"
    fi
    echo "  MCP config: $MCP_FILE"
else
    if [ ! -f "$SETTINGS_FILE" ]; then
        cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "permissions": {
    "allow": ["mcp__claudezilla__*"]
  }
}
SETTINGS_EOF
        echo "  Permissions: $SETTINGS_FILE"
    else
        echo "  [WARN] jq not found — manually add 'mcp__claudezilla__*' to permissions.allow in $SETTINGS_FILE"
    fi

    if [ ! -f "$MCP_FILE" ]; then
        cat > "$MCP_FILE" << MCP_EOF
{
  "mcpServers": {
    "claudezilla": {
      "command": "node",
      "args": ["$PROJECT_DIR/mcp/server.js"]
    }
  }
}
MCP_EOF
        echo "  MCP config: $MCP_FILE"
    else
        echo "  [WARN] jq not found — manually add claudezilla to mcpServers in $MCP_FILE"
    fi
fi

# ---------------------------------------------------------------------------
# 5. Firefox permanent extension install
# ---------------------------------------------------------------------------

echo ""
echo "Setting up Firefox headless profile..."

# Detect Firefox binary (prefer ESR)
FIREFOX_BIN=""
for candidate in firefox-esr firefox; do
    if command -v "$candidate" &> /dev/null; then
        FIREFOX_BIN="$candidate"
        break
    fi
done

if [ -z "$FIREFOX_BIN" ]; then
    echo ""
    echo "[WARN] Firefox not found — skipping extension install."
    echo "       Install firefox-esr then re-run:"
    echo "         sudo apt install firefox-esr   # Debian/Ubuntu"
    echo "         sudo dnf install firefox       # Fedora"
    echo "       Then re-run: $0"
else
    # Warn if not ESR — signature enforcement can't be disabled on release Firefox
    if ! "$FIREFOX_BIN" --version 2>/dev/null | grep -qi "esr"; then
        echo ""
        echo "  [WARN] firefox-esr is recommended for headless/unsigned extension use."
        echo "         Release Firefox may block unsigned extensions regardless of profile settings."
        echo "         sudo apt install firefox-esr"
        echo "  Continuing anyway..."
    fi

    # Build XPI (zip the extension directory)
    XPI_DIR="$PROJECT_DIR/web-ext-artifacts"
    XPI_PATH="$XPI_DIR/claudezilla.xpi"
    mkdir -p "$XPI_DIR"

    if command -v web-ext &> /dev/null; then
        web-ext build --source-dir="$PROJECT_DIR/extension" \
            --artifacts-dir="$XPI_DIR" --overwrite-dest --quiet
        # web-ext names it with the version; normalise to stable filename
        find "$XPI_DIR" -name "claudezilla-*.xpi" -exec mv {} "$XPI_PATH" \; 2>/dev/null || true
    elif command -v zip &> /dev/null; then
        cd "$PROJECT_DIR/extension" && zip -r "$XPI_PATH" . -q && cd "$PROJECT_DIR"
    else
        echo "  [ERROR] Neither web-ext nor zip found. Install zip and re-run."
        exit 1
    fi
    echo "  Built XPI: $XPI_PATH"

    # Create dedicated headless profile
    PROFILE_DIR="$HOME/.mozilla/firefox/claudezilla-headless"
    mkdir -p "$PROFILE_DIR/extensions"

    cat > "$PROFILE_DIR/user.js" << 'USERJS_EOF'
// Claudezilla headless profile — disable extension signature enforcement
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.update.enabled", false);
user_pref("app.update.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
USERJS_EOF

    # Sideload extension into profile
    [ -f "$XPI_PATH" ] || { echo "Error: XPI not found at $XPI_PATH. Build the extension first."; exit 1; }
    cp "$XPI_PATH" "$PROFILE_DIR/extensions/claudezilla@boot.industries.xpi" || { echo "Error: Failed to copy XPI to Firefox profile"; exit 1; }
    echo "  Extension sideloaded into profile: $PROFILE_DIR"

    # Register profile in profiles.ini
    PROFILES_INI="$HOME/.mozilla/firefox/profiles.ini"
    mkdir -p "$(dirname "$PROFILES_INI")"
    if [ ! -f "$PROFILES_INI" ]; then
        cat > "$PROFILES_INI" << PROFILES_EOF
[General]
StartWithLastProfile=0

[Profile0]
Name=claudezilla-headless
IsRelative=0
Path=$PROFILE_DIR
PROFILES_EOF
        echo "  Created profiles.ini"
    elif ! grep -q "claudezilla-headless" "$PROFILES_INI"; then
        # Find next available profile index
        NEXT_IDX=$(grep -c '^\[Profile' "$PROFILES_INI" 2>/dev/null || echo 0)
        cat >> "$PROFILES_INI" << PROFILES_EOF

[Profile${NEXT_IDX}]
Name=claudezilla-headless
IsRelative=0
Path=$PROFILE_DIR
PROFILES_EOF
        echo "  Registered profile in $PROFILES_INI"
    else
        echo "  Profile already registered in $PROFILES_INI"
    fi

    # Launch script
    LAUNCH_SCRIPT="$PROJECT_DIR/start-browser.sh"
    cat > "$LAUNCH_SCRIPT" << LAUNCH_EOF
#!/bin/bash
# Start Firefox headless with the Claudezilla profile.
# Usage: ./start-browser.sh
exec $FIREFOX_BIN --headless --no-remote --profile "$PROFILE_DIR" "\$@"
LAUNCH_EOF
    chmod 755 "$LAUNCH_SCRIPT"
    echo "  Launch script: $LAUNCH_SCRIPT"

    # systemd user service
    SYSTEMD_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_DIR"
    cat > "$SYSTEMD_DIR/claudezilla-browser.service" << SERVICE_EOF
[Unit]
Description=Claudezilla Firefox Headless Browser
After=network.target

[Service]
Type=simple
ExecStart=$FIREFOX_BIN --headless --no-remote --profile $PROFILE_DIR
Restart=on-failure
RestartSec=5s
StandardInput=null
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
SERVICE_EOF

    systemctl --user daemon-reload 2>/dev/null || true
    echo "  systemd service written: claudezilla-browser.service"
    echo "  Enable with: systemctl --user enable --now claudezilla-browser"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
echo "Claudezilla installation complete."
echo ""
echo "To start the browser:"
echo "  Manually:  $PROJECT_DIR/start-browser.sh"
echo "  Service:   systemctl --user enable --now claudezilla-browser"
echo ""
echo "All mcp__claudezilla__* tools will run without permission prompts."
