#!/bin/bash

# Claudezilla Native Messaging Host Installer for macOS
# Installs the native manifest for Firefox

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_PATH="$PROJECT_DIR/host/index.js"

# shellcheck source=lib/common.sh
. "$SCRIPT_DIR/lib/common.sh"

# Firefox native messaging hosts directory (macOS path)
NATIVE_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"

echo "Claudezilla Native Host Installer"
echo "=================================="
echo ""

# Check if host script exists
if [ ! -f "$HOST_PATH" ]; then
    echo "Error: Host script not found at $HOST_PATH"
    exit 1
fi

# SECURITY: Make host script executable with explicit permissions
chmod 755 "$HOST_PATH"
echo "Set host script permissions to 755: $HOST_PATH"

# Resolve an absolute runtime path, preferring Bun (GUI apps like Firefox
# don't inherit shell PATH)
RUNTIME_PATH="$(clz_require_runtime)"
echo "Found runtime: $RUNTIME_PATH"

# Create the wrappers Firefox and Claude Code execute
WRAPPER_PATH="$PROJECT_DIR/host/run.sh"
clz_write_wrapper "$WRAPPER_PATH" "index.js" "$RUNTIME_PATH"
echo "Created host wrapper: $WRAPPER_PATH"

MCP_WRAPPER_PATH="$PROJECT_DIR/mcp/run.sh"
clz_write_wrapper "$MCP_WRAPPER_PATH" "server.js" "$RUNTIME_PATH"
echo "Created MCP wrapper: $MCP_WRAPPER_PATH"

# Install MCP server dependencies
MCP_DIR="$PROJECT_DIR/mcp"
if [ -f "$MCP_DIR/package.json" ]; then
    clz_install_mcp_deps "$MCP_DIR"
    echo "MCP dependencies installed."
fi

# Create native manifest with correct path
clz_write_manifest "$NATIVE_HOSTS_DIR" "$WRAPPER_PATH"
echo "Created native manifest with permissions 644: $NATIVE_HOSTS_DIR/claudezilla.json"

# Firefox forks read native messaging hosts from their own data directory, not
# Mozilla's, so install the manifest for any that are present.
APP_SUPPORT="$HOME/Library/Application Support"
for fork in Zen LibreWolf Waterfox; do
    if [ -d "$APP_SUPPORT/$fork" ]; then
        clz_write_manifest "$APP_SUPPORT/$fork/NativeMessagingHosts" "$WRAPPER_PATH"
        echo "Created native manifest for $fork: $APP_SUPPORT/$fork/NativeMessagingHosts/claudezilla.json"
    fi
done
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

# Configure Claude Code permissions for autonomous operation
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
MCP_FILE="$CLAUDE_DIR/mcp.json"

echo "Configuring Claude Code for autonomous Claudezilla operations..."

# Create .claude directory if it doesn't exist
mkdir -p "$CLAUDE_DIR"

# Update settings.json to allow Claudezilla tools without prompts
if command -v jq &> /dev/null; then
    # Use jq for safe JSON manipulation
    if [ -f "$SETTINGS_FILE" ]; then
        # Merge with existing settings
        jq '.permissions.allow = ((.permissions.allow // []) + ["mcp__claudezilla__*"] | unique)' "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE"
    else
        # Create new settings file
        echo '{"permissions":{"allow":["mcp__claudezilla__*"]}}' | jq '.' > "$SETTINGS_FILE"
    fi
    echo "Updated Claude Code permissions: $SETTINGS_FILE"
else
    # Fallback: create settings if doesn't exist
    if [ ! -f "$SETTINGS_FILE" ]; then
        cat > "$SETTINGS_FILE" << 'SETTINGS_EOF'
{
  "permissions": {
    "allow": ["mcp__claudezilla__*"]
  }
}
SETTINGS_EOF
        echo "Created Claude Code permissions: $SETTINGS_FILE"
    else
        echo "[WARN] jq not found. Please manually add 'mcp__claudezilla__*' to permissions.allow in $SETTINGS_FILE"
    fi
fi

# Update mcp.json to register Claudezilla MCP server
if command -v jq &> /dev/null; then
    MCP_SERVER_CONFIG="{\"command\":\"$MCP_WRAPPER_PATH\",\"args\":[]}"
    if [ -f "$MCP_FILE" ]; then
        # Merge with existing config
        jq --argjson cfg "$MCP_SERVER_CONFIG" '.mcpServers.claudezilla = $cfg' "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
    else
        # Create new mcp.json
        echo "{\"mcpServers\":{\"claudezilla\":$MCP_SERVER_CONFIG}}" | jq '.' > "$MCP_FILE"
    fi
    echo "Updated Claude Code MCP config: $MCP_FILE"
else
    if [ ! -f "$MCP_FILE" ]; then
        cat > "$MCP_FILE" << MCP_EOF
{
  "mcpServers": {
    "claudezilla": {
      "command": "$MCP_WRAPPER_PATH",
      "args": []
    }
  }
}
MCP_EOF
        echo "Created Claude Code MCP config: $MCP_FILE"
    else
        echo "[WARN] jq not found. Please manually add claudezilla to mcpServers in $MCP_FILE"
    fi
fi

echo ""
echo "Claudezilla is now configured for autonomous operation."
echo "All mcp__claudezilla__* tools will run without permission prompts."
