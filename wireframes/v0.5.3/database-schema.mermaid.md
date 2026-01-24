%% Claudezilla Database Schema v0.5.3
%% D1 Database and in-memory state structures
%% Last updated: 2026-01-18

erDiagram
    EMAIL_SIGNUPS {
        INTEGER id PK "Auto-increment"
        TEXT email UK "Lowercase, unique"
        INTEGER created_at "Unix timestamp (ms)"
    }

    %% In-memory state structures (not persistent DB)

    LOOP_STATE {
        BOOLEAN active "Is loop running"
        TEXT prompt "Task prompt"
        INTEGER iteration "Current iteration"
        INTEGER maxIterations "Limit (0=unlimited)"
        TEXT completionPromise "Exit signal text"
        TEXT startedAt "ISO timestamp"
    }

    CLAUDEZILLA_WINDOW {
        INTEGER windowId "Firefox window ID"
        INTEGER createdAt "Unix timestamp"
        INTEGER groupId "Tab group ID (optional)"
    }

    TAB_ENTRY {
        INTEGER tabId PK "Firefox tab ID"
        TEXT ownerId "Agent ID (128-bit)"
    }

    AGENT_HEARTBEAT {
        TEXT agentId PK "agent_<128-bit>_<pid>"
        INTEGER lastSeen "Unix timestamp (ms)"
    }

    PENDING_SLOT_REQUEST {
        TEXT agentId "Requesting agent"
        INTEGER requestedAt "Unix timestamp (ms)"
    }

    SCREENSHOT_MUTEX {
        TEXT agentId "Holding agent"
        INTEGER acquiredAt "Unix timestamp (ms)"
        TEXT requestId "Unique request ID"
    }

    NETWORK_REQUEST {
        TEXT requestId PK "Browser request ID"
        TEXT url "Redacted URL"
        TEXT method "GET, POST, etc"
        TEXT type "xhr, script, image"
        INTEGER tabId "Source tab"
        INTEGER timestamp "Unix timestamp"
        TEXT status "pending, completed, error"
        INTEGER statusCode "HTTP status"
        INTEGER duration "Response time (ms)"
    }

    %% Relationships
    CLAUDEZILLA_WINDOW ||--o{ TAB_ENTRY : "contains (max 10)"
    TAB_ENTRY }o--|| AGENT_HEARTBEAT : "owned by"
