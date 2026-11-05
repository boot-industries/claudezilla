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
# Loop state is scoped per Claude Code session via CLAUDE_CODE_SESSION_ID
# (Claude Code 2.1.132+). Older sessions fall back to a single global bucket.
#
set -euo pipefail

# Bound total wall-clock time spent in this hook so a stuck socket
# can never hang Claude Code's exit path. Each `nc` invocation uses -w 2.
NC_TIMEOUT=2

# IPC directory: mirrors host/ipc.js getSafeTempDir() tier order (read-only):
# CLAUDEZILLA_IPC_DIR, XDG_RUNTIME_DIR, ~/.claudezilla/, then the temp dir.
# The host creates the directory on startup; this hook is a consumer only.
if [[ -n "${CLAUDEZILLA_IPC_DIR:-}" ]] && [[ -d "$CLAUDEZILLA_IPC_DIR" ]]; then
  IPC_DIR="$CLAUDEZILLA_IPC_DIR"
elif [[ -n "${XDG_RUNTIME_DIR:-}" ]] && [[ -d "$XDG_RUNTIME_DIR" ]]; then
  IPC_DIR="$XDG_RUNTIME_DIR"
elif [[ -d "$HOME/.claudezilla" ]]; then
  IPC_DIR="$HOME/.claudezilla"
else
  IPC_DIR="${TMPDIR:-/tmp}"
fi
SOCKET_PATH="$IPC_DIR/claudezilla.sock"
TOKEN_FILE="$IPC_DIR/claudezilla-auth.token"

# If socket doesn't exist, Claudezilla isn't running - allow exit
if [[ ! -S "$SOCKET_PATH" ]]; then
  exit 0
fi

# The host rejects unauthenticated requests. No readable token: allow exit.
if [[ ! -r "$TOKEN_FILE" ]]; then
  exit 0
fi
TOKEN=$(tr -d '[:space:]' < "$TOKEN_FILE")

# Build sessionId param. Claude Code 2.1.132+ exports CLAUDE_CODE_SESSION_ID;
# host normalizes/validates and falls back to DEFAULT_SESSION if missing or
# malformed, so it is always safe to pass.
SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}"
if [[ -n "$SESSION_ID" ]]; then
  PARAMS=$(jq -n --arg s "$SESSION_ID" '{sessionId: $s}')
else
  PARAMS='{}'
fi

GET_REQ=$(jq -n --argjson p "$PARAMS" --arg t "$TOKEN" '{command: "getLoopState", params: $p, authToken: $t}')

# Query loop state from Claudezilla host. -w bounds the connection wait so
# the hook can never block Claude Code's exit path beyond NC_TIMEOUT seconds.
RESPONSE=$(printf '%s\n' "$GET_REQ" | nc -U -w "$NC_TIMEOUT" "$SOCKET_PATH" 2>/dev/null || echo '{"success":false}')

# Validate JSON before parsing — a corrupt response should not crash the hook
if ! echo "$RESPONSE" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

# Check if query succeeded
if ! echo "$RESPONSE" | jq -e '.success' >/dev/null 2>&1; then
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
  STOP_REQ=$(jq -n --argjson p "$PARAMS" --arg t "$TOKEN" '{command: "stopLoop", params: $p, authToken: $t}')
  printf '%s\n' "$STOP_REQ" | nc -U -w "$NC_TIMEOUT" "$SOCKET_PATH" >/dev/null 2>&1 || true
  exit 0
fi

# TODO (v0.6.6): completion promise detection
# Will read Claude's last output and search for <promise>TEXT</promise>.

# Increment iteration counter
INC_REQ=$(jq -n --argjson p "$PARAMS" --arg t "$TOKEN" '{command: "incrementLoopIteration", params: $p, authToken: $t}')
printf '%s\n' "$INC_REQ" | nc -U -w "$NC_TIMEOUT" "$SOCKET_PATH" >/dev/null 2>&1 || true

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
