%% Claudezilla Entry Points v0.5.6
%% All ways to interact with the codebase
%% Last updated: 2026-01-25

flowchart TB
    subgraph CLAUDE_CODE["Claude Code CLI"]
        MCP_TOOLS["MCP Tools<br/>(30+ firefox_* tools)"]
        SLASH_CMDS["Slash Commands<br/>(/focus, /cancel-focus, /help)"]
    end

    subgraph PLUGIN["Claude Plugin"]
        STOP_HOOK["Stop Hook<br/>(hooks/stop-hook.sh)"]
        CMD_FOCUS["focus.md"]
        CMD_CANCEL["cancel-focus.md"]
        CMD_HELP["help.md"]
    end

    subgraph EXTENSION["Firefox Extension"]
        POPUP["Extension Popup<br/>(Click toolbar icon)"]
        BG_CONNECT["Background Script<br/>(Auto-connects on load)"]
        WELCOME["Welcome Page<br/>(Post-install)"]
    end

    subgraph HOST["Native Host"]
        subgraph IPC_UNIX["Unix"]
            SOCKET_SERVER["Unix Socket<br/>($TMPDIR/claudezilla.sock)"]
        end
        subgraph IPC_WIN["Windows"]
            PIPE_SERVER["Named Pipe<br/>(\\\\.\\pipe\\claudezilla)"]
        end
        NATIVE_MSG["Native Messaging<br/>(stdin/stdout)"]
    end

    subgraph WEBSITE["Marketing Website"]
        LANDING["Landing Page<br/>(claudezilla.com)"]
        INSTALL_PAGE["Extension Page<br/>(/extension.html)"]
        DOCS_PAGE["Documentation<br/>(/docs.html)"]
        SUPPORT_PAGE["Support<br/>(/support.html)"]
    end

    subgraph CLOUD_API["Cloud APIs"]
        CHECKOUT["POST /create-checkout<br/>(Stripe session)"]
        NOTIFY["POST /notify<br/>(Email signup)"]
        HEALTH["GET /health<br/>(Health check)"]
    end

    subgraph CLI_TOOLS["CLI Tools"]
        WEB_EXT["web-ext run<br/>(Development)"]
        NPM_PACK["npm pack<br/>(Package XPI)"]
        INSTALL_MAC["install-macos.sh"]
        INSTALL_LINUX["install-linux.sh"]
        INSTALL_WIN["install-windows.ps1<br/>(v0.5.6)"]
    end

    %% MCP Tool connections
    MCP_TOOLS -->|"firefox_create_window"| SOCKET_SERVER
    MCP_TOOLS -->|"firefox_create_window"| PIPE_SERVER
    MCP_TOOLS -->|"firefox_click"| SOCKET_SERVER
    MCP_TOOLS -->|"firefox_click"| PIPE_SERVER
    MCP_TOOLS -->|"firefox_screenshot"| SOCKET_SERVER
    MCP_TOOLS -->|"firefox_screenshot"| PIPE_SERVER
    MCP_TOOLS -->|"firefox_start_loop"| SOCKET_SERVER
    MCP_TOOLS -->|"firefox_start_loop"| PIPE_SERVER

    %% Plugin connections
    SLASH_CMDS --> CMD_FOCUS
    SLASH_CMDS --> CMD_CANCEL
    SLASH_CMDS --> CMD_HELP
    STOP_HOOK -->|Query loop state| SOCKET_SERVER
    STOP_HOOK -->|Query loop state| PIPE_SERVER

    %% Extension connections
    POPUP -->|"Test connection"| BG_CONNECT
    POPUP -->|"Stop loop"| BG_CONNECT
    BG_CONNECT <-->|Native Messaging| NATIVE_MSG

    %% Socket/Pipe connections
    SOCKET_SERVER <--> NATIVE_MSG
    PIPE_SERVER <--> NATIVE_MSG

    %% Website connections
    SUPPORT_PAGE --> CHECKOUT
    LANDING --> NOTIFY

    %% Styling
    classDef primary fill:#4CAF50,stroke:#333,color:white
    classDef secondary fill:#2196F3,stroke:#333,color:white
    classDef api fill:#FF9800,stroke:#333,color:white
    classDef newv055 fill:#ffd,stroke:#f90,stroke-width:2px

    class MCP_TOOLS,SLASH_CMDS primary
    class POPUP,BG_CONNECT secondary
    class CHECKOUT,NOTIFY,HEALTH api
    class IPC_WIN,PIPE_SERVER,INSTALL_WIN newv055
