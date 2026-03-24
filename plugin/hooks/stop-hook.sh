#!/bin/bash
#
# Claudezilla Loop Stop Hook
#
# Intercepts Claude Code session exit to enable persistent iteration.
# Queries loop state from Claudezilla host via Unix socket.
#
# Exit with no output: allow normal exit
# Output JSON with decision=block: continue loop
#
set -euo pipefail

# Socket path: mirrors host/ipc.js getSafeTempDir() logic
if [[ -n "${XDG_RUNTIME_DIR:-}" ]] && [[ -d "$XDG_RUNTIME_DIR" ]]; then
  SOCKET_PATH="$XDG_RUNTIME_DIR/claudezilla.sock"
elif [[ -d "$HOME/.claudezilla" ]]; then
  SOCKET_PATH="$HOME/.claudezilla/claudezilla.sock"
else
  SOCKET_PATH="${TMPDIR:-/tmp}/claudezilla.sock"
fi

# If socket doesn't exist, Claudezilla isn't running - allow exit
if [[ ! -S "$SOCKET_PATH" ]]; then
  exit 0
fi

# Query loop state from Claudezilla host
RESPONSE=$(echo '{"command":"getLoopState","params":{}}' | nc -U "$SOCKET_PATH" 2>/dev/null || echo '{"success":false}')

# Check if query succeeded
if ! echo "$RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
  # Failed to query - allow exit
  exit 0
fi

# Extract loop state
ACTIVE=$(echo "$RESPONSE" | jq -r '.result.active // false')

# If no active loop, allow exit
if [[ "$ACTIVE" != "true" ]]; then
  exit 0
fi

# Get loop details
PROMPT=$(echo "$RESPONSE" | jq -r '.result.prompt // ""')
ITERATION=$(echo "$RESPONSE" | jq -r '.result.iteration // 0')
MAX=$(echo "$RESPONSE" | jq -r '.result.maxIterations // 0')

# Validate iteration is numeric
if ! [[ "$ITERATION" =~ ^[0-9]+$ ]]; then
  ITERATION=0
fi

# Check max iterations (0 = unlimited)
if [[ "$MAX" -gt 0 ]] && [[ "$ITERATION" -ge "$MAX" ]]; then
  # Max iterations reached - stop loop and allow exit
  echo '{"command":"stopLoop","params":{}}' | nc -U "$SOCKET_PATH" 2>/dev/null || true
  exit 0
fi

# TODO: Add completion promise detection
# Would need to read Claude's last output and search for <promise>TEXT</promise>
# For now, rely on max iterations for safety

# Increment iteration counter
echo '{"command":"incrementLoopIteration","params":{}}' | nc -U "$SOCKET_PATH" 2>/dev/null || true

# Calculate next iteration number
NEXT_ITERATION=$((ITERATION + 1))

# Build system message
if [[ "$MAX" -gt 0 ]]; then
  SYSTEM_MSG="Claudezilla loop iteration ${NEXT_ITERATION}/${MAX}"
else
  SYSTEM_MSG="Claudezilla loop iteration ${NEXT_ITERATION} (unlimited)"
fi

# Block exit and inject prompt
jq -n \
  --arg prompt "$PROMPT" \
  --arg msg "$SYSTEM_MSG" \
  '{
    "decision": "block",
    "reason": $prompt,
    "systemMessage": $msg
  }'
