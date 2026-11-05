#!/bin/bash

# Claudezilla Native Messaging Host Installer for macOS
# Installs the native manifest for Firefox

set -e

# Target harness: claude (default), omp, hermes, pi, mercury, all
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
    echo "Configuring Claude Code..."
    local CLAUDE_DIR="$HOME/.claude"
    local SETTINGS_FILE="$CLAUDE_DIR/settings.json"
    local MCP_FILE="$CLAUDE_DIR/mcp.json"
    local MCP_SERVER_PATH="$PROJECT_DIR/mcp/server.js"
    local PERMISSIONS_FILE="$PROJECT_DIR/install/claude-permissions.json"
    mkdir -p "$CLAUDE_DIR"

    # Permission allow-list. The old blanket "mcp__claudezilla__*" entry also
    # allowed firefox_evaluate without a prompt, so it is removed and replaced
    # by the explicit tool list (install/claude-permissions.json).
    if command -v jq &> /dev/null; then
        local ALLOWED_TOOLS
        ALLOWED_TOOLS="$(jq -c '.allow' "$PERMISSIONS_FILE")"
        if [ -f "$SETTINGS_FILE" ]; then
            jq --argjson tools "$ALLOWED_TOOLS" \
                '.permissions.allow = (((.permissions.allow // []) | map(select(. != "mcp__claudezilla__*"))) + $tools | unique)' \
                "$SETTINGS_FILE" > "$SETTINGS_FILE.tmp" && mv "$SETTINGS_FILE.tmp" "$SETTINGS_FILE" \
                || echo "  [WARN] could not update $SETTINGS_FILE"
        else
            jq -n --argjson tools "$ALLOWED_TOOLS" '{permissions:{allow:$tools}}' > "$SETTINGS_FILE"
        fi
        echo "  Permissions: $SETTINGS_FILE"
    else
        echo "  [WARN] jq not found — manually add the tool names from"
        echo "         $PERMISSIONS_FILE to permissions.allow in $SETTINGS_FILE"
    fi
    echo "  Note: firefox_evaluate is not allowed by default. Enable it in the Claudezilla"
    echo "        popup (Settings -> Allow JavaScript evaluation) and add"
    echo "        \"mcp__claudezilla__firefox_evaluate\" to permissions.allow in $SETTINGS_FILE."

    # Register the MCP server via the Claude Code CLI (user scope -> ~/.claude.json).
    # ~/.claude/mcp.json is not read by Claude Code (see issue #24).
    if command -v claude &> /dev/null; then
        claude mcp remove --scope user claudezilla &> /dev/null || true
        if claude mcp add --scope user claudezilla -- node "$MCP_SERVER_PATH"; then
            echo "  MCP server registered (user scope)"
        else
            echo "  [WARN] 'claude mcp add' failed — run manually:"
            echo "    claude mcp add --scope user claudezilla -- node \"$MCP_SERVER_PATH\""
        fi
    else
        echo "  [WARN] claude CLI not found — after installing Claude Code, run:"
        echo "    claude mcp add --scope user claudezilla -- node \"$MCP_SERVER_PATH\""
    fi

    # Older installers wrote the server into ~/.claude/mcp.json, which Claude
    # Code does not read. Drop the stale entry so the file does not suggest a
    # registration that is not there.
    if [ -f "$MCP_FILE" ] && command -v jq &> /dev/null; then
        jq 'del(.mcpServers.claudezilla) | (if ((.mcpServers // {}) | length) == 0 then del(.mcpServers) else . end)' \
            "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE" \
            && echo "  Removed stale entry from $MCP_FILE"
    fi

    link_skill "$HOME/.claude/skills"
}

# Symlink the portable claudezilla-browser Agent Skill into a skills directory.
link_skill() {
    local SKILLS_DIR="$1"
    mkdir -p "$SKILLS_DIR"
    ln -sfn "$PROJECT_DIR/plugin/skills/claudezilla-browser" "$SKILLS_DIR/claudezilla-browser"
    echo "  Skill: $SKILLS_DIR/claudezilla-browser"
}

install_omp() {
    echo "Configuring Oh My Pi (OMP)..."
    local OMP_AGENT_DIR="$HOME/.omp/agent"
    local MCP_FILE="$OMP_AGENT_DIR/mcp.json"
    local LEGACY_MCP_FILE="$HOME/.omp/mcp.json"
    mkdir -p "$OMP_AGENT_DIR"

    # omp does not show MCP images inline, so screenshots are also written to disk.
    local MCP_SERVER_CONFIG="{\"command\":\"node\",\"args\":[\"$PROJECT_DIR/mcp/server.js\"],\"timeout\":120000,\"env\":{\"CLAUDEZILLA_SCREENSHOT_FILES\":\"1\"}}"
    if command -v jq &> /dev/null; then
        if [ -f "$MCP_FILE" ]; then
            jq --argjson cfg "$MCP_SERVER_CONFIG" '.mcpServers.claudezilla = $cfg' \
                "$MCP_FILE" > "$MCP_FILE.tmp" && mv "$MCP_FILE.tmp" "$MCP_FILE"
        else
            echo "{\"mcpServers\":{\"claudezilla\":$MCP_SERVER_CONFIG}}" | jq '.' > "$MCP_FILE"
        fi
        echo "  OMP MCP config: $MCP_FILE"
        if [ -f "$LEGACY_MCP_FILE" ] && jq -e '.mcpServers.claudezilla' "$LEGACY_MCP_FILE" &> /dev/null; then
            echo "  [NOTE] ~/.omp/mcp.json is not omp's user MCP file; its claudezilla entry can be removed."
        fi
    else
        echo "  [WARN] jq not found — manually add claudezilla to $MCP_FILE under mcpServers:"
        echo "    \"claudezilla\": $MCP_SERVER_CONFIG"
    fi

    link_skill "$HOME/.agents/skills"
}

install_hermes() {
    echo "Configuring Hermes Agent..."
    local HERMES_DIR="${HERMES_HOME:-$HOME/.hermes}"
    echo "  Add Claudezilla to $HERMES_DIR/config.yaml:"
    echo ""
    echo "    mcp_servers:"
    echo "      claudezilla:"
    echo "        command: node"
    echo "        args: [\"$PROJECT_DIR/mcp/server.js\"]"
    echo "        env:"
    echo "          CLAUDEZILLA_SCREENSHOT_FILES: \"1\""
    echo ""
    echo "  Hermes reads skills only from $HERMES_DIR/skills. To load the claudezilla-browser"
    echo "  skill, also add to $HERMES_DIR/config.yaml:"
    echo ""
    echo "    skills:"
    echo "      external_dirs: [~/.agents/skills]"
    echo ""

    link_skill "$HOME/.agents/skills"
}

install_pi() {
    echo "Configuring Pi Agent..."
    echo "  Add Claudezilla to ~/.pi/agent/mcp.json:"
    echo ""
    echo "    {\"mcpServers\":{\"claudezilla\":{\"command\":\"node\",\"args\":[\"$PROJECT_DIR/mcp/server.js\"],\"env\":{\"CLAUDEZILLA_SCREENSHOT_FILES\":\"1\"}}}}"
    echo ""

    link_skill "$HOME/.agents/skills"
}

install_mercury() {
    echo "Configuring Mercury..."
    local MCP_SERVER_PATH="$PROJECT_DIR/mcp/server.js"
    echo "  (a) Mercury Agent: add Claudezilla to ~/.mercury/mercury.yaml:"
    echo ""
    echo "    mcp:"
    echo "      servers:"
    echo "        claudezilla:"
    echo "          transport: stdio"
    echo "          command: $NODE_PATH"
    echo "          args: [\"$MCP_SERVER_PATH\"]"
    echo "          env:"
    echo "            CLAUDEZILLA_SCREENSHOT_FILES: \"1\""
    echo "          tools:"
    echo "            allow: [\"*\"]"
    echo ""
    echo "  (b) Mercury CLI: run"
    echo ""
    echo "    mercury mcp add -s user claudezilla -- node \"$MCP_SERVER_PATH\""
    echo ""
    echo "    (see https://mercury-cli.ai/docs/mcps-and-skills/ if your version's flags differ)"
    echo ""

    if [ -d "$HOME/.mercury" ]; then
        link_skill "$HOME/.mercury/skills"
    else
        echo "  Skill: skipped (~/.mercury not found; re-run with --target mercury after installing Mercury Agent)"
    fi
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
    mercury)
        install_mercury
        ;;
    all)
        install_claude
        install_omp
        install_hermes
        install_pi
        install_mercury
        ;;
    *)
        echo "Unknown target: $TARGET. Choose from: claude, omp, hermes, pi, mercury, all."
        exit 1
        ;;
esac

echo ""
echo "Claudezilla installation complete for target: $TARGET."
