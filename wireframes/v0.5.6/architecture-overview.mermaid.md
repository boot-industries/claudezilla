%% Claudezilla Architecture Overview v0.5.6
%% High-level system design showing all layers and external services
%% Last updated: 2026-01-25

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
        EXPR_BLOCK["Expression Blocklist<br/>(fetch, eval, cookies)"]
    end

    subgraph HOST_LAYER["Native Host Layer"]
        IPC_LAYER["IPC Abstraction<br/>(host/ipc.js)"]
        subgraph IPC_UNIX["Unix (macOS/Linux)"]
            SOCKET["Unix Socket<br/>(claudezilla.sock)"]
        end
        subgraph IPC_WIN["Windows 10/11"]
            NAMED_PIPE["Named Pipe<br/>(\\.\pipe\claudezilla)"]
        end
        AUTH["Auth Token<br/>(32-byte random)"]
        PATH_VALID["Path Validation<br/>(validatePath)"]
        LOOP_STATE["Loop State<br/>Manager"]
        PROTO["Protocol Handler<br/>(4-byte header)"]
    end

    subgraph EXTENSION_LAYER["Firefox Extension Layer"]
        BG["Background Script<br/>(Persistent)"]
        SESSION["Session Manager<br/>(12-tab pool)"]
        MUTEX["Screenshot Mutex<br/>(3s timeout)"]
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
        TABS["Tab Pool<br/>(Max 12)"]
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
    MCP_SERVER -->|Validate| EXPR_BLOCK
    HEARTBEAT -->|Timeout| ORPHAN
    MCP_SERVER -->|Commands + Auth| IPC_LAYER
    IPC_LAYER -->|macOS/Linux| SOCKET
    IPC_LAYER -->|Windows| NAMED_PIPE
    SOCKET -->|Native Messaging| BG
    NAMED_PIPE -->|Native Messaging| BG
    BG -->|executeInTab| DOM
    BG -->|browser.tabs| TABS
    TABS --> PAGES
    DOM --> PAGES
    VISUALS --> PAGES

    %% Plugin integration
    STOP_HOOK -.->|Query State| IPC_LAYER
    COMMANDS -.->|Start/Stop| MCP_SERVER

    %% Security flow
    AUTH -->|Validates| IPC_LAYER
    PATH_VALID -->|Secure paths| IPC_LAYER
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
    classDef newv055 fill:#ffd,stroke:#f90,stroke-width:2px

    class AUTH,MUTEX,SESSION,PATH_VALID security
    class MCP_SERVER,TOOLS mcp
    class PRIVATE,TABS browser
    class IPC_LAYER,IPC_WIN,NAMED_PIPE,EXPR_BLOCK,PATH_VALID newv055
