#!/bin/bash

# Claudezilla Native Messaging Host Installer for macOS
# Installs the native manifest for Firefox

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOST_PATH="$PROJECT_DIR/host/index.js"

# Firefox native messaging hosts directory
NATIVE_HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"

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

# Create native messaging hosts directory if it doesn't exist
mkdir -p "$NATIVE_HOSTS_DIR"
echo "Created native hosts directory: $NATIVE_HOSTS_DIR"

# Create native manifest with correct path
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
