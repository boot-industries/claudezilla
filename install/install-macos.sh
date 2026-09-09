#!/bin/bash

# Claudezilla Native Messaging Host Installer for macOS
# Installs the native manifest for Firefox

set -e

# Target harness: claude (default), omp, hermes, pi, all
TARGET="claude"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --target|-t)
            TARGET="${2:-claude}"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_PATH="$PROJECT_DIR/host/index.js"

# Firefox native messaging hosts directory (macOS path)
NATIVE_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

echo "Claudezilla Multi-Harness Installer (macOS)"
echo "=========================================="
echo "Target: $TARGET"
echo ""
# Check if host script exists
if [ ! -f "$HOST_PATH" ]; then
    echo "Error: Host script not found at $HOST_PATH"
    exit 1
fi

# SECURITY: Make host script executable with explicit permissions
chmod 755 "$HOST_PATH"
echo "Set host script permissions to 755: $HOST_PATH"

# Resolve absolute node path (GUI apps like Firefox don't inherit shell PATH)
NODE_PATH="$(command -v node 2>/dev/null)"
if [ -z "$NODE_PATH" ]; then
    echo "Error: node not found in PATH. Please install Node.js first."
    exit 1
fi
echo "Found Node.js at: $NODE_PATH"

# Create wrapper script that Firefox will execute
# This ensures node is found even when Firefox lacks /opt/homebrew/bin in PATH
WRAPPER_PATH="$PROJECT_DIR/host/run.sh"
cat > "$WRAPPER_PATH" << WRAPPER_EOF
#!/bin/bash
exec "$NODE_PATH" "$HOST_PATH" "\$@"
WRAPPER_EOF
chmod 755 "$WRAPPER_PATH"
echo "Created host wrapper: $WRAPPER_PATH"

# Install MCP server dependencies
MCP_DIR="$PROJECT_DIR/mcp"
if [ -f "$MCP_DIR/package.json" ]; then
    command -v npm >/dev/null 2>&1 || { echo "Error: npm not found. Please install Node.js and npm first."; exit 1; }
    echo "Installing MCP dependencies..."
    cd "$MCP_DIR" && npm install --quiet --ignore-scripts
    echo "MCP dependencies installed."
fi

# Create native messaging hosts directory if it doesn't exist
mkdir -p "$NATIVE_HOSTS_DIR"
echo "Created native hosts directory: $NATIVE_HOSTS_DIR"

# Create native manifest with correct path
MANIFEST_PATH="$NATIVE_HOSTS_DIR/claudezilla.json"

cat > "$MANIFEST_PATH" << EOF
{
  "name": "claudezilla",
  "description": "Claude Code Firefox browser automation bridge",
  "path": "$WRAPPER_PATH",
  "type": "stdio",
  "allowed_extensions": ["claudezilla@boot.industries"]
}
EOF

# SECURITY: Set manifest file permissions explicitly
chmod 644 "$MANIFEST_PATH"
echo "Created native manifest with permissions 644: $MANIFEST_PATH"
echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Open Firefox and go to about:debugging"
echo "2. Click 'This Firefox' in the sidebar"
echo "3. Click 'Load Temporary Add-on'"
echo "4. Navigate to: $PROJECT_DIR/extension/"
echo "5. Select manifest.json"
echo ""
echo "The extension should now be loaded. Click the Claudezilla icon"
echo "in the toolbar to test the connection."
echo ""

# ---------------------------------------------------------------------------
# Client Registration by Target
# ---------------------------------------------------------------------------

install_claude() {
    echo "Configuring Claude Code for autonomous Claudezilla operations..."
    local CLAUDE_DIR="$HOME/.claude"
    local SETTINGS_FILE="$CLAUDE_DIR/settings.json"
    local MCP_FILE="$CLAUDE_DIR/mcp.json"
    mkdir -p "$CLAUDE_DIR"

    if command -v jq &> /dev/null; then
        if [ -f "$SETTINGS_FILE" ]; then
            jq '.permissions.allow = ((.permissions.allow // []) + ["mcp__claudezilla__*"] | unique)' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
        else
            echo '{"permissions":{"allow":["mcp__claudezilla__*"]}}' | jq '.' > "$SETTINGS_FILE"
        fi
        local MCP_SERVER_CONFIG="{\"command\":\"node\",\"args\":[\"$PROJECT_DIR/mcp/server.js\"]}"
        if [ -f "$MCP_FILE" ]; then
            jq --argjson cfg "$MCP_SERVER_CONFIG" '.mcpServers.claudezilla = $cfg' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
        else
            echo "{\"mcpServers\":{\"claudezilla\":$MCP_SERVER_CONFIG}}" | jq '.' > "$MCP_FILE"
        fi
        echo "Updated Claude Code configuration: $MCP_FILE"
    else
        echo "[WARN] jq not found; skipping automated Claude Code config merge. Please add claudezilla to $MCP_FILE manually."
    fi
}

install_omp() {
    echo "Configuring Oh My Pi (OMP)..."
    local OMP_DIR="$HOME/.omp"
    local MCP_FILE="$OMP_DIR/mcp.json"
    mkdir -p "$OMP_DIR"

    # OMP uses eager tool loading (--all-tools) and 120s timeout
    local MCP_SERVER_CONFIG="{\"command\":\"node\",\"args\":[\"$PROJECT_DIR/mcp/server.js\",\"--all-tools\"],\"timeout\":120000}"
    if command -v jq &> /dev/null; then
        if [ -f "$MCP_FILE" ]; then
            jq --argjson cfg "$MCP_SERVER_CONFIG" '.mcpServers.claudezilla = $cfg' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
        else
            echo "{\"mcpServers\":{\"claudezilla\":$MCP_SERVER_CONFIG}}" | jq '.' > "$MCP_FILE"
        fi
        echo "Updated OMP configuration: $MCP_FILE"
    else
        echo "[WARN] jq not found; skipping automated OMP config merge."
    fi
}

install_hermes() {
    echo "Configuring Hermes Agent..."
    local HERMES_DIR="${HERMES_HOME:-$HOME/.hermes}"
    echo "For Hermes Agent, add Claudezilla to mcp_servers in your Hermes configuration ($HERMES_DIR/config.yaml):"
    echo ""
    echo "mcp_servers:"
    echo "  claudezilla:"
    echo "    command: node"
    echo "    args:"
    echo "      - $PROJECT_DIR/mcp/server.js"
    echo "      - --all-tools"
    echo ""
}

install_pi() {
    echo "Configuring Pi Agent..."
    local PI_DIR="${PI_HOME:-$HOME/.pi}"
    echo "For Pi Agent, register Claudezilla MCP server in $PI_DIR/config.json or active profile:"
    echo ""
    echo "{"
    echo "  \"mcpServers\": {"
    echo "    \"claudezilla\": {"
    echo "      \"command\": \"node\","
    echo "      \"args\": [\"$PROJECT_DIR/mcp/server.js\", \"--all-tools\"]"
    echo "    }"
    echo "  }"
    echo "}"
    echo ""
}

case "$TARGET" in
    claude)
        install_claude
        ;;
    omp)
        install_omp
        ;;
    hermes)
        install_hermes
        ;;
    pi)
        install_pi
        ;;
    all)
        install_claude
        install_omp
        install_hermes
        install_pi
        ;;
    *)
        echo "Unknown target: $TARGET. Choose from: claude, omp, hermes, pi, all."
        exit 1
        ;;
esac

echo ""
echo "Claudezilla installation complete for target: $TARGET."
