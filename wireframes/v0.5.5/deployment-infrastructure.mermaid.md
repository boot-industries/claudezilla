%% Claudezilla Deployment Infrastructure v0.5.5
%% How the code runs in production
%% Last updated: 2026-01-25

flowchart TB
    subgraph USER_MACHINE_UNIX["User's Machine (macOS/Linux)"]
        subgraph FIREFOX_UNIX["Firefox Browser"]
            EXT_UNIX["Claudezilla Extension<br/>(MV2 WebExtension)"]
            PRIVATE_UNIX["Private Window<br/>(12-tab pool)"]
        end

        subgraph NATIVE_UNIX["Native Components"]
            HOST_UNIX["Native Host<br/>(~/.claudezilla/host/)"]
            SOCKET_UNIX["Unix Socket<br/>($TMPDIR/claudezilla.sock)"]
            AUTH_UNIX["Auth Token<br/>($TMPDIR/claudezilla-auth.token)"]
        end

        subgraph CLAUDE_CODE_UNIX["Claude Code CLI"]
            MCP_UNIX["MCP Server<br/>(Node.js process)"]
            PLUGIN_UNIX["Plugin<br/>(~/.claude/plugins/claudezilla-loop)"]
        end
    end

    subgraph USER_MACHINE_WIN["User's Machine (Windows 10/11) - v0.5.5"]
        subgraph FIREFOX_WIN["Firefox Browser"]
            EXT_WIN["Claudezilla Extension<br/>(MV2 WebExtension)"]
            PRIVATE_WIN["Private Window<br/>(12-tab pool)"]
        end

        subgraph NATIVE_WIN["Native Components"]
            HOST_WIN["Native Host<br/>(%APPDATA%\\claudezilla\\)"]
            PIPE_WIN["Named Pipe<br/>(\\\\.\\pipe\\claudezilla)"]
            AUTH_WIN["Auth Token<br/>(%LOCALAPPDATA%\\claudezilla\\auth.token)"]
        end

        subgraph CLAUDE_CODE_WIN["Claude Code CLI"]
            MCP_WIN["MCP Server<br/>(Node.js process)"]
            PLUGIN_WIN["Plugin<br/>(~/.claude/plugins/claudezilla-loop)"]
        end
    end

    subgraph CLOUDFLARE["Cloudflare Edge"]
        subgraph PAGES["Cloudflare Pages"]
            WEBSITE["claudezilla.com<br/>(Static HTML/CSS/JS)"]
        end

        subgraph WORKERS["Cloudflare Workers"]
            WORKER["Stripe Worker<br/>(checkout API)"]
        end

        subgraph D1_DB["Cloudflare D1"]
            DB["SQLite Database<br/>(email_signups)"]
        end
    end

    subgraph EXTERNAL["External Services"]
        STRIPE["Stripe API<br/>(Payments)"]
        AMO["Firefox Add-ons<br/>(Distribution)"]
        GITHUB["GitHub<br/>(Source code)"]
    end

    %% Unix Extension flow
    EXT_UNIX <-->|Native Messaging| HOST_UNIX
    EXT_UNIX -->|Controls| PRIVATE_UNIX
    HOST_UNIX <-->|Unix Socket| SOCKET_UNIX
    SOCKET_UNIX <-->|Commands| MCP_UNIX
    MCP_UNIX <-->|Tool calls| CLAUDE_CODE_UNIX
    PLUGIN_UNIX -.->|Stop hook| SOCKET_UNIX

    %% Windows Extension flow
    EXT_WIN <-->|Native Messaging| HOST_WIN
    EXT_WIN -->|Controls| PRIVATE_WIN
    HOST_WIN <-->|Named Pipe| PIPE_WIN
    PIPE_WIN <-->|Commands| MCP_WIN
    MCP_WIN <-->|Tool calls| CLAUDE_CODE_WIN
    PLUGIN_WIN -.->|Stop hook| PIPE_WIN

    %% Cloud flow
    WEBSITE -->|Checkout request| WORKER
    WORKER -->|Create session| STRIPE
    WORKER -->|Store email| DB

    %% Distribution
    AMO -.->|Install| EXT_UNIX
    AMO -.->|Install| EXT_WIN
    GITHUB -.->|Deploy| PAGES
    GITHUB -.->|Deploy| WORKERS

    %% Styling
    classDef user fill:#e1f5fe,stroke:#01579b
    classDef cloud fill:#e8f5e9,stroke:#2e7d32
    classDef external fill:#fff3e0,stroke:#e65100
    classDef windows fill:#ffd,stroke:#f90,stroke-width:2px

    class EXT_UNIX,HOST_UNIX,MCP_UNIX,PLUGIN_UNIX user
    class EXT_WIN,HOST_WIN,MCP_WIN,PLUGIN_WIN,PIPE_WIN,AUTH_WIN windows
    class WEBSITE,WORKER,DB cloud
    class STRIPE,AMO,GITHUB external
