# Claudezilla Database Schema - Notes

**Version:** 0.5.3
**Last Updated:** 2026-01-18

## Overview

Claudezilla uses minimal persistent storage (D1 database for email signups) with most state held in memory across the extension and native host.

## Persistent Storage (D1 Database)

### email_signups Table

**Purpose:** Store email addresses for update notifications

**Location:** Cloudflare D1 (bound to worker as `DB`)

**Schema:**
```sql
CREATE TABLE email_signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email ON email_signups(email);
```

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `email` | TEXT | Lowercase email, unique constraint |
| `created_at` | INTEGER | Unix timestamp in milliseconds |

**Operations:**
```sql
-- Insert (ignore duplicates)
INSERT OR IGNORE INTO email_signups (email, created_at)
VALUES (?, ?);

-- Check if duplicate
-- result.meta.changes === 0 means duplicate
```

**Validation:**
- Email format regex: `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`
- Length: 3-254 characters

## In-Memory State Structures

These structures are not persisted and reset on restart.

### Loop State (Native Host)

**Location:** `host/index.js`

```javascript
loopState = {
  active: false,           // Boolean: is loop running
  prompt: '',              // String: the task to iterate on
  iteration: 0,            // Number: current iteration count
  maxIterations: 0,        // Number: limit (0 = unlimited)
  completionPromise: null, // String|null: text that signals completion
  startedAt: null          // String|null: ISO timestamp
}
```

**Lifecycle:**
1. Created fresh on host startup
2. Modified by `startLoop` command
3. Incremented by `incrementLoopIteration`
4. Reset by `stopLoop` or wall-clock timeout (1 hour)

### Claudezilla Window (Background Script)

**Location:** `extension/background.js`

```javascript
claudezillaWindow = {
  windowId: 123,           // Firefox window ID
  tabs: [                  // Array of tab entries
    { tabId: 456, ownerId: 'agent_abc123..._1234' },
    { tabId: 789, ownerId: 'agent_def456..._5678' }
  ],
  createdAt: 1705600000000,  // Unix timestamp
  groupId: 1                 // Tab group ID (Firefox 138+)
}
```

**Constraints:**
- Maximum 10 tabs
- Single window (reused across sessions)
- Each tab tracks owner agent ID

### Agent Heartbeats (MCP Server)

**Location:** `mcp/server.js`

```javascript
agentHeartbeats = new Map([
  ['agent_abc123..._1234', 1705600000000],  // agentId -> lastSeen timestamp
  ['agent_def456..._5678', 1705599900000]
]);
```

**Cleanup:**
- Checked every 60 seconds
- Agents not seen in 2 minutes are orphaned
- Orphaned agent tabs are closed

### Pending Slot Requests (Background Script)

**Location:** `extension/background.js`

```javascript
pendingSlotRequests = [
  { agentId: 'agent_abc123..._1234', requestedAt: 1705600000000 }
];
```

**Flow:**
1. Agent blocked by POOL_FULL calls `requestTabSpace`
2. Request added to queue
3. Agents with >4 tabs see pending requests via `getSlotRequests`
4. Generous agent calls `grantTabSpace`
5. Request fulfilled, removed from queue

### Screenshot Mutex (Background Script)

**Location:** `extension/background.js`

```javascript
screenshotMutexHolder = {
  agentId: 'agent_abc123..._1234',
  acquiredAt: 1705600000000,
  requestId: 'ss_1705600000000_abc123'
};
```

**Behavior:**
- Only one screenshot at a time
- Returns MUTEX_BUSY if held >3 seconds by another agent
- Automatically released on completion or error

### Network Requests (Background Script)

**Location:** `extension/background.js`

```javascript
networkRequests = [
  {
    requestId: '123',
    url: 'https://example.com/api?token=[REDACTED]',
    method: 'GET',
    type: 'xmlhttprequest',
    tabId: 456,
    timestamp: 1705600000000,
    status: 'completed',
    statusCode: 200,
    duration: 150
  }
];
```

**Limits:**
- Maximum 200 entries (older entries removed)
- Sensitive URL parameters redacted

## Data Retention

| Data Type | Retention | Location |
|-----------|-----------|----------|
| Email signups | Permanent | D1 Database |
| Loop state | Until host restart | Host memory |
| Tab tracking | Until window close | Extension memory |
| Agent heartbeats | Until cleanup | MCP server memory |
| Network requests | 200 most recent | Extension memory |
| Screenshot mutex | Until release | Extension memory |

## Migration Strategy

Currently no migrations needed as:
1. D1 schema is simple and stable
2. In-memory structures reset on restart
3. No cross-version compatibility concerns

**If schema changes needed:**
```sql
-- Example migration (not currently used)
ALTER TABLE email_signups ADD COLUMN source TEXT;
```

## Security Considerations

1. **Emails stored lowercase** - Prevents duplicate case variations
2. **No PII beyond email** - Minimizes data exposure
3. **Agent IDs are 128-bit random** - Unpredictable, secure
4. **Sensitive URLs redacted** - Passwords/tokens not logged
5. **Request bodies never captured** - Prevents credential leak

## Related Diagrams

- [Architecture Overview](./architecture-overview.mermaid.md) - System context
- [Data Flow](./data-flow.mermaid.md) - How data moves
