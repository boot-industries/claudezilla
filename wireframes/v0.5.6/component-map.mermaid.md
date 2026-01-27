%% Claudezilla Component Map v0.5.6
%% Detailed component breakdown with dependencies and APIs
%% Last updated: 2026-01-25

classDiagram
    class MCPServer {
        +Server server
        +String AGENT_ID
        +Map agentHeartbeats
        +Array EXPRESSION_BLOCKLIST
        +sendCommand(command, params)
        +runDiagnostics()
        +cleanupOrphanedAgents()
        +updateAgentHeartbeat(agentId)
        +truncateAgentId(agentId)
        +validateExpression(expression)
    }

    class IPC {
        <<module>>
        +getSocketPath() String
        +getAuthTokenPath() String
        +getSafeTempDir() String
        +getDebugLogPath() String
        +validatePath(path, context)
        +cleanupSocket(socketPath)
        +setSecurePermissions(path, mode)
        +setWindowsFileACL(path)
        +ensureParentDir(path)
        +isWindows() Boolean
        +getPaths() Object
    }

    class NativeHost {
        +Object loopState
        +Server socketServer
        +String SOCKET_AUTH_TOKEN
        +Map pendingCliRequests
        +handleLoopCommand(command, params)
        +handleCliCommand(command, params, auth)
        +handleExtensionMessage(message)
        +startSocketServer()
        +startNativeMessaging()
    }

    class Protocol {
        +readMessage() Buffer
        +sendMessage(object) void
    }

    class BackgroundScript {
        +Port port
        +Map pendingRequests
        +Object claudezillaWindow
        +Number activeTabId
        +Promise screenshotLock
        +Array pendingSlotRequests
        +connect()
        +scheduleReconnect()
        +sendToHost(command, params)
        +handleCliCommand(message)
        +getSession(windowId)
        +verifyTabOwnership(tabId, agentId)
        +waitForPageReady(tabId, options)
        +getTabNetworkStatus(tabId)
    }

    class ContentScript {
        +click(params) Object
        +type(params) Object
        +scroll(params) Object
        +getContent(params) Object
        +getConsoleLogs(params) Object
        +getPageState() Object
        +getAccessibilitySnapshot(params) Object
        +evaluate(expression) Object
        +resizeImage(dataUrl, scale) Object
        +enableClaudezillaVisuals()
        +checkPageReadiness()
    }

    class Popup {
        +testConnection()
        +loadSettings()
        +saveSettings()
        +updateLoopDisplay()
        +stopLoop()
    }

    class TaskDetector {
        +detectIterativeTask(prompt)
        +analyzeKeywords(text)
        +suggestFocusLoop(context)
    }

    class StopHook {
        +queryLoopState() Object
        +shouldBlockExit() Boolean
        +reinjectPrompt() String
    }

    class CloudflareWorker {
        +createCheckoutSession(amount, frequency)
        +handleNotify(email)
        +validateOrigin(origin)
        +validateAmount(amount)
    }

    %% MCP Server dependencies
    MCPServer --> IPC : platform paths
    MCPServer --> NativeHost : Unix socket/Named pipe
    MCPServer --> TaskDetector : auto-detection

    %% IPC to NativeHost
    IPC --> NativeHost : socket/pipe paths

    %% Native Host dependencies
    NativeHost --> Protocol : message serialization
    NativeHost --> BackgroundScript : native messaging

    %% Extension dependencies
    BackgroundScript --> ContentScript : executeInTab
    BackgroundScript --> Popup : runtime.onMessage

    %% Plugin dependencies
    StopHook --> NativeHost : query state

    %% Tool Categories
    class BrowserTools {
        <<interface>>
        firefox_create_window()
        firefox_navigate()
        firefox_close_tab()
        firefox_get_tabs()
        firefox_resize_window()
        firefox_set_viewport()
    }

    class PageTools {
        <<interface>>
        firefox_get_content()
        firefox_click()
        firefox_type()
        firefox_press_key()
        firefox_scroll()
        firefox_wait_for()
    }

    class AnalysisTools {
        <<interface>>
        firefox_screenshot()
        firefox_get_page_state()
        firefox_get_accessibility_snapshot()
        firefox_get_element()
        firefox_evaluate()
    }

    class DevtoolsTools {
        <<interface>>
        firefox_get_console()
        firefox_get_network()
    }

    class LoopTools {
        <<interface>>
        firefox_start_loop()
        firefox_stop_loop()
        firefox_loop_status()
    }

    class CoordinationTools {
        <<interface>>
        firefox_request_tab_space()
        firefox_grant_tab_space()
        firefox_get_slot_requests()
    }

    MCPServer ..> BrowserTools
    MCPServer ..> PageTools
    MCPServer ..> AnalysisTools
    MCPServer ..> DevtoolsTools
    MCPServer ..> LoopTools
    MCPServer ..> CoordinationTools
