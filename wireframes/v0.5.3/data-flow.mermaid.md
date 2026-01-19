%% Claudezilla Data Flow v0.5.3
%% Request/response cycles and data transformations
%% Last updated: 2026-01-18

sequenceDiagram
    autonumber
    participant Claude as Claude Code CLI
    participant MCP as MCP Server
    participant Socket as Unix Socket
    participant Host as Native Host
    participant NM as Native Messaging
    participant BG as Background Script
    participant CS as Content Script
    participant Page as Web Page

    Note over Claude,Page: Standard Command Flow (e.g., firefox_click)

    Claude->>+MCP: CallToolRequest {name: "firefox_click", args: {selector}}
    MCP->>MCP: Inject agentId, updateHeartbeat()
    MCP->>+Socket: JSON + "\n" {command, params, authToken}
    Socket->>+Host: Validate authToken
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
    Host-->>-Socket: JSON + "\n" {success, result}
    Socket-->>-MCP: Parse response
    MCP-->>-Claude: {content: [{type: "text", text: JSON.stringify(result)}]}

    Note over Claude,Page: Screenshot Flow (with Mutex)

    Claude->>+MCP: CallToolRequest {name: "firefox_screenshot", args: {tabId}}
    MCP->>+Socket: {command: "screenshot", params, authToken}
    Socket->>+Host: Forward to extension
    Host->>+BG: NM: screenshot command
    BG->>BG: Check screenshotMutexHolder
    alt Mutex held by another agent >5s
        BG-->>Host: {success: false, details: {code: "MUTEX_BUSY"}}
        Host-->>Socket: Error response
        Socket-->>MCP: MUTEX_BUSY error
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
        Host-->>-Socket: Response
        Socket-->>-MCP: Parse response
        MCP-->>-Claude: {content: [{type: "image", data: base64}]}
    end

    Note over Claude,Page: Focus Loop Flow

    Claude->>+MCP: firefox_start_loop({prompt, maxIterations})
    MCP->>+Socket: {command: "startLoop", params}
    Socket->>+Host: handleLoopCommand()
    Host->>Host: Validate: no active loop, bounds check
    Host->>Host: loopState = {active: true, prompt, ...}
    Host-->>-Socket: {success: true, result: loopState}
    Socket-->>-MCP: Response
    MCP-->>-Claude: Loop started

    Note over Claude,Host: Later: Claude tries to exit

    Claude->>Claude: Session ending...
    Claude->>+StopHook: plugin/hooks/stop-hook.sh
    StopHook->>+Socket: {command: "getLoopState", authToken}
    Socket->>+Host: Query loopState
    Host-->>-Socket: {active: true, iteration: 5}
    Socket-->>-StopHook: Loop is active
    StopHook->>StopHook: Block exit, re-inject prompt
    StopHook->>+Socket: {command: "incrementLoopIteration"}
    Socket->>+Host: loopState.iteration++
    Host-->>-Socket: {iteration: 6}
    Socket-->>-StopHook: Incremented
    StopHook-->>-Claude: Continue with same prompt

    Note over Claude,Page: Orphaned Tab Cleanup Flow

    loop Every 60 seconds
        MCP->>MCP: cleanupOrphanedAgents()
        MCP->>MCP: Find agents with lastSeen > 2min ago
        alt Orphaned agents found
            MCP->>+Socket: {command: "cleanupOrphanedTabs", params: {agentId}}
            Socket->>+Host: Forward to extension
            Host->>+BG: cleanupOrphanedTabs
            BG->>BG: Find tabs with ownerId === agentId
            BG->>BG: browser.tabs.remove(tabIds)
            BG->>BG: Update claudezillaWindow.tabs
            BG-->>-Host: {tabsClosed: N}
            Host-->>-Socket: Response
            Socket-->>-MCP: Cleanup complete
            MCP->>MCP: agentHeartbeats.delete(agentId)
        end
    end
