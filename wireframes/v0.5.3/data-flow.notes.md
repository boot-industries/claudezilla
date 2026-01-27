# Claudezilla Data Flow - Notes

**Version:** 0.5.3
**Last Updated:** 2026-01-18

## Overview

Claudezilla uses a multi-layer data flow where requests traverse from Claude Code CLI through MCP, Unix socket, native messaging, and into the browser. Each layer adds security validation and state management.

## Request/Response Cycle

### Standard Command Flow

1. **Claude Code** calls MCP tool (e.g., `firefox_click`)
2. **MCP Server** injects `agentId`, updates heartbeat, sends to socket
3. **Unix Socket** validates auth token
4. **Native Host** checks command whitelist, forwards to extension
5. **Background Script** verifies tab ownership, calls content script
6. **Content Script** performs DOM action, returns result
7. Response bubbles back through same path

**Message Format:**
```
┌─────────────────────────────────────────────────────────┐
│ MCP → Socket: JSON + newline                           │
│ {"command": "click", "params": {...}, "authToken": "x"}│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Socket → Host: Validated JSON                           │
│ {command, params} (authToken already verified)          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Host → Extension: Native Messaging (4-byte header)      │
│ {id, type: "command", command, params}                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ Extension → Content: browser.tabs.sendMessage           │
│ {action: "click", params: {selector}}                   │
└─────────────────────────────────────────────────────────┘
```

### Screenshot Flow with Mutex

Screenshots require special handling because:
1. `captureVisibleTab` only captures the visible tab
2. Multiple agents could request simultaneously
3. Tab switching must be serialized

**Mutex Implementation:**
```javascript
// Background script
let screenshotLock = Promise.resolve();
let screenshotMutexHolder = null;

// Each screenshot chains onto the lock
screenshotLock = screenshotLock.then(async () => {
  screenshotMutexHolder = { agentId, acquiredAt: Date.now() };
  try {
    // Switch tab, wait for ready, capture
  } finally {
    screenshotMutexHolder = null;
  }
});
```

**MUTEX_BUSY Error:**
- Returned if mutex held by another agent for >3 seconds
- Includes holder info, wait time, retry hint
- Suggests using `getPageState` (no mutex needed)

### Page Readiness Detection

Dynamic detection replaces hardcoded delays:

```javascript
async function waitForPageReady(tabId, options) {
  // Phase 1: Wait for critical resources (scripts, XHR)
  while (criticalPending > 0 && !timedOut) {
    await sleep(25);
  }

  // Phase 2: Wait for visual resources (images, fonts)
  while (visualPending > 0 && !timedOut) {
    await sleep(25);
  }

  // Phase 3: Render frame settlement
  await contentScript.checkPageReadiness();
  // (Double RAF + requestIdleCallback)
}
```

**Timeline returned with screenshots:**
```javascript
{
  readiness: {
    waitMs: 347,
    timedOut: false,
    timeline: [
      { t: 0, event: "start" },
      { t: 45, event: "critical_idle" },
      { t: 312, event: "visual_idle" },
      { t: 347, event: "render_settled" }
    ]
  }
}
```

## Focus Loop Flow

Focus loops enable persistent iteration via the Stop hook.

**Start Loop:**
1. Claude calls `firefox_start_loop({prompt, maxIterations})`
2. Host validates: no active loop, maxIterations ≤ 10000
3. Host sets `loopState = {active: true, ...}`
4. Returns success

**During Session:**
- Normal tool calls proceed
- Loop state tracked in host memory
- Wall-clock timeout: 1 hour max

**Exit Attempt:**
1. Claude session ends → Stop hook fires
2. Hook queries `getLoopState` via socket
3. If active: block exit, increment iteration, re-inject prompt
4. If maxIterations reached: allow exit
5. If completionPromise detected in output: allow exit

**Stop Loop:**
1. Claude calls `firefox_stop_loop()`
2. Host resets `loopState = {active: false, ...}`
3. Next exit attempt succeeds

## Orphaned Tab Cleanup Flow

Prevents "ghost tabs" from crashed sessions.

**Heartbeat Tracking:**
```javascript
// MCP Server
const agentHeartbeats = new Map();

function updateAgentHeartbeat(agentId) {
  agentHeartbeats.set(agentId, Date.now());
}

// Called on every ownership-requiring command
```

**Cleanup Cycle (every 60s):**
```javascript
async function cleanupOrphanedAgents() {
  const now = Date.now();
  for (const [agentId, lastSeen] of agentHeartbeats) {
    if (now - lastSeen > 120000) { // 2 minutes
      await sendCommand('cleanupOrphanedTabs', { agentId });
      agentHeartbeats.delete(agentId);
    }
  }
}
```

**Extension Cleanup Handler:**
1. Find all tabs with `ownerId === agentId`
2. Remove each tab via `browser.tabs.remove()`
3. Update `claudezillaWindow.tabs` array
4. Return count of closed tabs

## Data Transformations

### URL Validation
```javascript
// ALLOWED_URL_SCHEMES = ['http:', 'https:', 'about:']
function validateUrlScheme(url) {
  const parsed = new URL(url);
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
    throw new Error('URL scheme not allowed');
  }
}
```

### Sensitive Parameter Redaction
```javascript
// SENSITIVE_PARAMS = ['password', 'token', 'api_key', ...]
function redactSensitiveUrl(url) {
  const parsed = new URL(url);
  for (const [key] of parsed.searchParams) {
    if (SENSITIVE_PARAMS.some(p => key.includes(p))) {
      parsed.searchParams.set(key, '[REDACTED]');
    }
  }
  return parsed.toString();
}
```

### Content Truncation
```javascript
// getContent defaults
const maxLength = params.maxLength || 50000;
const text = extractedText.slice(0, maxLength);
```

### Screenshot Compression
```javascript
// Default: JPEG 60% quality, 50% scale
const captureOpts = {
  format: 'jpeg',
  quality: 60
};

// Resize via canvas
canvas.width = originalWidth * 0.5;
canvas.height = originalHeight * 0.5;
ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
canvas.toDataURL('image/jpeg', 0.6);
```

## Error Handling

### Structured Errors
```javascript
// MUTEX_BUSY
{
  code: 'MUTEX_BUSY',
  message: 'Screenshot mutex held by another agent',
  holder: 'agent_ec2e...',
  heldForMs: 6234,
  retryAfterMs: 2000,
  hint: 'Use getPageState or retry after delay.'
}

// POOL_FULL
{
  code: 'POOL_FULL',
  message: 'Tab pool full. You have no tabs to evict.',
  tabPool: '10/10',
  ownerBreakdown: 'agent_a...: 4, agent_b...: 6',
  hint: 'Use firefox_request_tab_space.'
}
```

### Connection Retry
```javascript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  retryableCodes: ['ENOENT', 'ECONNREFUSED', 'ECONNRESET']
};
```

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - System layers
- [Component Map](./component-map.mermaid.md) - Module breakdown
