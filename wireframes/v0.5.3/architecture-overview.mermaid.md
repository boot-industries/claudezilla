%% Claudezilla Architecture Overview v0.5.3
%% High-level system design showing all layers and external services
%% Last updated: 2026-01-18

flowchart TB
    subgraph CLAUDE["Claude Code CLI"]
        SDK["Anthropic SDK"]
        MCP_CLIENT["MCP Client"]
    end

    subgraph MCP_LAYER["MCP Server Layer"]
        MCP_SERVER["MCP Server<br/>(mcp/server.js)"]
        TOOLS["30+ Browser Tools"]
        HEARTBEAT["Agent Heartbeat<br/>Tracking"]
        ORPHAN["Orphan Cleanup<br/>(2min timeout)"]
    end

    subgraph HOST_LAYER["Native Host Layer"]
        SOCKET["Unix Socket Server<br/>(claudezilla.sock)"]
        AUTH["Auth Token<br/>(32-byte random)"]
        LOOP_STATE["Loop State<br/>Manager"]
        PROTO["Protocol Handler<br/>(4-byte header)"]
    end

    subgraph EXTENSION_LAYER["Firefox Extension Layer"]
        BG["Background Script<br/>(Persistent)"]
        SESSION["Session Manager<br/>(10-tab pool)"]
        MUTEX["Screenshot Mutex<br/>(Serialized)"]
        NETWORK["Network Monitor<br/>(webRequest API)"]
    end

    subgraph CONTENT_LAYER["Content Scripts"]
        DOM["DOM Manipulation"]
        VISUALS["Claudezilla Visuals<br/>(Watermark, Glow)"]
        CONSOLE["Console Capture"]
        A11Y["Accessibility Tree"]
    end

    subgraph BROWSER["Firefox Browser"]
        PRIVATE["Private Window"]
        TABS["Tab Pool<br/>(Max 10)"]
        PAGES["Web Pages"]
    end

    subgraph PLUGIN_LAYER["Claude Plugin"]
        STOP_HOOK["Stop Hook<br/>(focus-loop.sh)"]
        COMMANDS["Slash Commands<br/>(/focus, /cancel-focus)"]
    end

    subgraph CLOUD["Cloud Services"]
        CF_PAGES["Cloudflare Pages<br/>(Website)"]
        CF_WORKER["Cloudflare Worker<br/>(Stripe API)"]
        D1["D1 Database<br/>(Email signups)"]
        STRIPE["Stripe API"]
    end

    %% Main data flow
    CLAUDE -->|MCP Protocol| MCP_SERVER
    MCP_SERVER -->|Agent ID| HEARTBEAT
    HEARTBEAT -->|Timeout| ORPHAN
    MCP_SERVER -->|Commands + Auth| SOCKET
    SOCKET -->|Native Messaging| BG
    BG -->|executeInTab| DOM
    BG -->|browser.tabs| TABS
    TABS --> PAGES
    DOM --> PAGES
    VISUALS --> PAGES

    %% Plugin integration
    STOP_HOOK -.->|Query State| SOCKET
    COMMANDS -.->|Start/Stop| MCP_SERVER

    %% Security flow
    AUTH -->|Validates| SOCKET
    MUTEX -.->|Serializes| BG
    SESSION -.->|Ownership| TABS

    %% Cloud services
    CF_PAGES -.->|Serves| WEBSITE[/"Website<br/>claudezilla.com"/]
    CF_WORKER -.->|Payment| STRIPE
    CF_WORKER -.->|Store| D1

    %% Styling
    classDef security fill:#f9f,stroke:#333,stroke-width:2px
    classDef mcp fill:#bbf,stroke:#333
    classDef browser fill:#bfb,stroke:#333

    class AUTH,MUTEX,SESSION security
    class MCP_SERVER,TOOLS mcp
    class PRIVATE,TABS browser
