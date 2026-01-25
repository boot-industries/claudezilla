%% Claudezilla Repository Structure v0.5.5
%% Directory tree showing all components and their relationships
%% Last updated: 2026-01-25

graph TB
    subgraph ROOT["claudezilla/"]
        CLAUDE["CLAUDE.md<br/>(Project docs)"]
        CHANGELOG["CHANGELOG.md"]
        README["README.md"]
        SECURITY["SECURITY.md"]
        LICENSE["LICENSE (MIT)"]
        PKG["package.json"]
    end

    subgraph EXTENSION["extension/<br/>Firefox WebExtension"]
        MANIFEST["manifest.json<br/>(MV2)"]
        BG["background.js<br/>(Native messaging)"]
        CONTENT["content.js<br/>(DOM interaction)"]
        subgraph POPUP["popup/"]
            POPUP_HTML["popup.html"]
            POPUP_JS["popup.js"]
        end
        subgraph ICONS["icons/"]
            ICON_SVG["claudezilla-48.svg"]
        end
        WELCOME["welcome.html/js"]
        SUPPORT["support.html/js"]
    end

    subgraph HOST["host/<br/>Native Messaging Host"]
        HOST_INDEX["index.js<br/>(Main entry)"]
        HOST_IPC["ipc.js<br/>(IPC abstraction - v0.5.5)"]
        HOST_PROTO["protocol.js<br/>(Message serialization)"]
        HOST_CLI["cli.js"]
        HOST_PKG["package.json"]
    end

    subgraph MCP["mcp/<br/>MCP Server"]
        MCP_SERVER["server.js<br/>(Tool definitions)"]
        MCP_TASK["task-detector.js<br/>(Auto-detection)"]
        MCP_PKG["package.json"]
    end

    subgraph PLUGIN["plugin/<br/>Claude Code Plugin"]
        subgraph CLAUDE_PLUGIN[".claude-plugin/"]
            PLUGIN_JSON["plugin.json"]
        end
        subgraph HOOKS["hooks/"]
            HOOKS_JSON["hooks.json"]
            STOP_HOOK["stop-hook.sh"]
        end
        subgraph COMMANDS["commands/"]
            CMD_FOCUS["focus.md"]
            CMD_CANCEL["cancel-focus.md"]
            CMD_HELP["help.md"]
        end
        PLUGIN_README["README.md"]
    end

    subgraph WEBSITE["website/<br/>Marketing Site"]
        WEB_INDEX["index.html"]
        WEB_EXT["extension.html"]
        WEB_DOCS["docs.html"]
        WEB_SUPPORT["support.html"]
        WEB_PRIVACY["privacy.html"]
        subgraph SCRIPTS["scripts/"]
            WEB_NOTIFY["notify.js"]
            WEB_SUPPORT_JS["support.js"]
        end
        ASSETS["assets/<br/>(CSS, images)"]
    end

    subgraph WORKER["worker/<br/>Cloudflare Worker"]
        WRANGLER["wrangler.toml"]
        subgraph SRC["src/"]
            WORKER_TS["index.ts<br/>(Stripe checkout)"]
        end
    end

    subgraph INSTALL["install/<br/>Setup Scripts"]
        MAC["install-macos.sh"]
        LINUX["install-linux.sh"]
        WIN_INSTALL["install-windows.ps1<br/>(v0.5.5)"]
        WIN_UNINSTALL["uninstall-windows.ps1<br/>(v0.5.5)"]
        NM_JSON["claudezilla.json<br/>(NM manifest template)"]
    end

    subgraph DOCS["docs/<br/>Documentation"]
        CLZ_DOCS["clz/<br/>(PREFIX docs)"]
    end

    subgraph WIREFRAMES["wireframes/<br/>Architecture"]
        WF_GALLERY["architecture-gallery.html"]
        WF_V053["v0.5.3/"]
        WF_V055["v0.5.5/<br/>(current)"]
    end

    %% Relationships
    ROOT --> EXTENSION
    ROOT --> HOST
    ROOT --> MCP
    ROOT --> PLUGIN
    ROOT --> WEBSITE
    ROOT --> WORKER
    ROOT --> INSTALL
    ROOT --> DOCS
    ROOT --> WIREFRAMES

    BG -.->|native messaging| HOST_INDEX
    HOST_INDEX -.->|imports| HOST_IPC
    HOST_INDEX -.->|IPC| MCP_SERVER
    PLUGIN -.->|stop hook| HOST_INDEX
    WEBSITE -.->|API calls| WORKER_TS

    %% Styling for new v0.5.5 components
    classDef newv055 fill:#ffd,stroke:#f90,stroke-width:2px
    class HOST_IPC,WIN_INSTALL,WIN_UNINSTALL newv055
