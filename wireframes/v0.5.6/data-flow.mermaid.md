%% Claudezilla Data Flow v0.5.6
%% Request/response cycles and data transformations
%% Last updated: 2026-01-25

sequenceDiagram
    autonumber
    participant Claude as Claude Code CLI
    participant MCP as MCP Server
    participant IPC as IPC Layer
    participant Host as Native Host
    participant NM as Native Messaging
    participant BG as Background Script
    participant CS as Content Script
    participant Page as Web Page

    Note over Claude,Page: Standard Command Flow (e.g., firefox_click)

    Claude->>+MCP: CallToolRequest {name: "firefox_click", args: {selector}}
    MCP->>MCP: Inject agentId, updateHeartbeat()
    MCP->>MCP: truncateAgentId() for logging
    MCP->>+IPC: getSocketPath() (Unix socket or Named pipe)
    IPC-->>-MCP: Platform-appropriate path
    MCP->>+Host: JSON + "\n" {command, params, authToken}
    Host->>Host: Validate authToken
    Host->>Host: Check command whitelist
    Host->>+NM: sendMessage({id, type: "command", command, params})
    NM->>+BG: port.onMessage
    BG->>BG: verifyTabOwnership(tabId, agentId)
    BG->>+CS: browser.tabs.sendMessage({action: "click", params})
    CS->>+Page: element.click()
    Page-->>-CS: Event dispatched
    CS-->>-BG: {success: true, result: {clicked, tagName, text}}
    BG-->>-NM: port.postMessage({id, success, result})
    NM-->>-Host: handleExtensionMessage()
    Host-->>-MCP: JSON + "\n" {success, result}
    MCP-->>-Claude: {content: [{type: "text", text: JSON.stringify(result)}]}

    Note over Claude,Page: Screenshot Flow (with Mutex, 3s timeout)

    Claude->>+MCP: CallToolRequest {name: "firefox_screenshot", args: {tabId}}
    MCP->>+Host: {command: "screenshot", params, authToken}
    Host->>+BG: NM: screenshot command
    BG->>BG: Check screenshotMutexHolder
    alt Mutex held by another agent >3s
        BG-->>Host: {success: false, details: {code: "MUTEX_BUSY"}}
        Host-->>MCP: Error response
        MCP-->>Claude: Error with retry hint
    else Mutex available or same agent
        BG->>BG: Acquire mutex: screenshotMutexHolder = {agentId}
        BG->>BG: screenshotLock = screenshotLock.then(...)
        BG->>BG: Switch to target tab if needed
        BG->>+CS: waitForPageReady(tabId, options)
        CS->>CS: Double RAF + requestIdleCallback
        CS-->>-BG: {totalWaitMs, timeline}
        BG->>BG: browser.tabs.captureVisibleTab()
        BG->>+CS: resizeImage(dataUrl, scale)
        CS->>CS: Canvas resize to 50% scale
        CS-->>-BG: Compressed JPEG dataUrl
        BG->>BG: Release mutex
        BG-->>-Host: {success: true, result: {dataUrl, readiness}}
        Host-->>-MCP: Response
        MCP-->>-Claude: {content: [{type: "image", data: base64}]}
    end

    Note over Claude,Page: Expression Validation (v0.5.6)

    Claude->>+MCP: firefox_evaluate({expression: "fetch(...)"})
    MCP->>MCP: validateExpression(expression)
    alt Expression blocked
        MCP-->>Claude: Error: Expression contains blocked pattern 'fetch('
    else Expression allowed
        MCP->>+Host: {command: "evaluate", params}
        Host->>+BG: Forward to content script
        BG->>+CS: evaluate(expression)
        CS->>+Page: Execute in page context
        Page-->>-CS: Result
        CS-->>-BG: {success: true, result}
        BG-->>-Host: Response
        Host-->>-MCP: Response
        MCP-->>-Claude: {content: [{type: "text", text: result}]}
    end

    Note over Claude,Page: Focus Loop Flow (cross-platform)

    Claude->>+MCP: firefox_start_loop({prompt, maxIterations})
    MCP->>+IPC: getSocketPath()
    IPC-->>-MCP: Unix socket or Named pipe path
    MCP->>+Host: {command: "startLoop", params}
    Host->>Host: Validate: no active loop, bounds check
    Host->>Host: loopState = {active: true, prompt, ...}
    Host-->>-MCP: {success: true, result: loopState}
    MCP-->>-Claude: Loop started

    Note over Claude,Host: Later: Claude tries to exit

    Claude->>Claude: Session ending...
    Claude->>+StopHook: plugin/hooks/stop-hook.sh
    StopHook->>+IPC: getSocketPath()
    IPC-->>-StopHook: Platform path
    StopHook->>+Host: {command: "getLoopState", authToken}
    Host-->>-StopHook: {active: true, iteration: 5}
    StopHook->>StopHook: Block exit, re-inject prompt
    StopHook->>+Host: {command: "incrementLoopIteration"}
    Host->>Host: loopState.iteration++
    Host-->>-StopHook: {iteration: 6}
    StopHook-->>-Claude: Continue with same prompt

    Note over Claude,Page: Orphaned Tab Cleanup Flow

    loop Every 60 seconds
        MCP->>MCP: cleanupOrphanedAgents()
        MCP->>MCP: Find agents with lastSeen > 2min ago
        alt Orphaned agents found
            MCP->>+Host: {command: "cleanupOrphanedTabs", params: {agentId}}
            Host->>+BG: cleanupOrphanedTabs
            BG->>BG: Find tabs with ownerId === agentId
            BG->>BG: browser.tabs.remove(tabIds)
            BG->>BG: Update claudezillaWindow.tabs
            BG-->>-Host: {tabsClosed: N}
            Host-->>-MCP: Cleanup complete
            MCP->>MCP: agentHeartbeats.delete(agentId)
        end
    end
