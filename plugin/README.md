# Claudezilla Loop Plugin

Focus loop feature for Claudezilla - enables persistent iterative development.

## Overview

This plugin provides Ralph Wiggum-style focus loops for Claudezilla. It uses Claude Code's Stop hook to intercept session exits and re-inject prompts, allowing Claude to work iteratively on a task.

## How It Works

1. You start a loop via `firefox_start_loop({ prompt: "...", maxIterations: 20 })`
2. Claude works on the task and eventually tries to exit
3. This plugin's Stop hook intercepts the exit
4. Hook queries Claudezilla for loop state over the host socket, sending the host's auth token. It looks for `claudezilla.sock` and `claudezilla-auth.token` in `CLAUDEZILLA_IPC_DIR`, else `XDG_RUNTIME_DIR`, else `~/.claudezilla/`, else `${TMPDIR:-/tmp}` (the host's order); with no socket or no readable token it lets the session exit
5. While the loop is active and below `maxIterations`, the hook blocks exit and re-injects the prompt
6. Claude continues working, seeing its previous changes in files
7. Loop ends when max iterations reached (or manually stopped)

## Installation

The plugin is bundled with Claudezilla. To install:

```bash
# From claudezilla directory
ln -s "$(pwd)/plugin" ~/.claude/plugins/claudezilla-loop
```

No release currently publishes the plugin as a zip archive, so install it from a clone as above.

The plugin manifest (`.claude-plugin/plugin.json`) declares the
`name`, `version`, `homepage`, `bugs`, and `license` fields that Claude Code
reads when registering the plugin.

## Usage

```javascript
// Start a focus loop
firefox_start_loop({
  prompt: "Build a REST API for todos",
  maxIterations: 20,
  completionPromise: "DONE"  // Optional: stored with the loop state; the stop hook does not detect it yet
})

// Check loop status
firefox_loop_status()
// Returns: { active: true, iteration: 5, maxIterations: 20, ... }

// Stop the loop manually
firefox_stop_loop()
```

## Requirements

- Claudezilla extension running in Firefox
- Claudezilla native host running
- `jq` and `nc` (netcat) available in PATH

## Architecture

```
Claude Code Session
    ↓
Stop Hook (this plugin)
    ↓ (authenticated socket query)
Claudezilla Host
    ↓ (in-memory state)
Loop State: { active, iteration, prompt, ... }
```

## Files

- `.claude-plugin/plugin.json` - Plugin metadata
- `hooks/hooks.json` - Hook registration
- `hooks/stop-hook.sh` - Stop hook script
- `commands/` - `/focus`, `/cancel-focus` and `/help` slash commands
- `skills/claudezilla-browser/SKILL.md` - Portable Agent Skill for driving Firefox through the Claudezilla MCP tools (the installers link it into the harness skills directories)

## Safety

- **Max iterations**: Always set a reasonable limit to prevent infinite loops
- **Memory-only state**: Loop resets if Claudezilla host restarts
- **Wall-clock limit**: The host stops a loop after 1 hour
- **Manual stop**: Use `firefox_stop_loop()` or Ctrl+C to exit immediately

## Version

- **0.3.0** — Claudezilla 0.7.7: stop hook authenticates with the host token and honours `CLAUDEZILLA_IPC_DIR`; `claudezilla-browser` Agent Skill
- **0.2.0** — Claudezilla 0.6.5: session-scoped loops via `CLAUDE_CODE_SESSION_ID`, hardened stop hook (bounded `nc -w` timeouts, JSON validation), marketplace metadata
- **0.1.0** — Initial release with Claudezilla 0.4.7
