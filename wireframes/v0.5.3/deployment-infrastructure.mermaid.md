%% Claudezilla Deployment Infrastructure v0.5.3
%% How the code runs in production
%% Last updated: 2026-01-18

flowchart TB
    subgraph USER_MACHINE["User's Machine"]
        subgraph FIREFOX["Firefox Browser"]
            EXT["Claudezilla Extension<br/>(MV2 WebExtension)"]
            PRIVATE["Private Window<br/>(10-tab pool)"]
        end

        subgraph NATIVE["Native Components"]
            HOST["Native Host<br/>(~/.claudezilla/host/)"]
            SOCKET["Unix Socket<br/>($TMPDIR/claudezilla.sock)"]
            AUTH["Auth Token<br/>($TMPDIR/claudezilla-auth.token)"]
        end

        subgraph CLAUDE_CODE["Claude Code CLI"]
            MCP["MCP Server<br/>(Node.js process)"]
            PLUGIN["Plugin<br/>(~/.claude/plugins/claudezilla-loop)"]
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

    %% Extension flow
    EXT <-->|Native Messaging| HOST
    EXT -->|Controls| PRIVATE
    HOST <-->|IPC| SOCKET
    SOCKET <-->|Commands| MCP
    MCP <-->|Tool calls| CLAUDE_CODE
    PLUGIN -.->|Stop hook| SOCKET

    %% Cloud flow
    WEBSITE -->|Checkout request| WORKER
    WORKER -->|Create session| STRIPE
    WORKER -->|Store email| DB

    %% Distribution
    AMO -.->|Install| EXT
    GITHUB -.->|Deploy| PAGES
    GITHUB -.->|Deploy| WORKERS

    %% Styling
    classDef user fill:#e1f5fe,stroke:#01579b
    classDef cloud fill:#e8f5e9,stroke:#2e7d32
    classDef external fill:#fff3e0,stroke:#e65100

    class EXT,HOST,MCP,PLUGIN user
    class WEBSITE,WORKER,DB cloud
    class STRIPE,AMO,GITHUB external
