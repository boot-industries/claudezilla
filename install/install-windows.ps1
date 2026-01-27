# Claudezilla Native Messaging Host Installer for Windows
# Requires: Node.js 18+, Firefox
#
# Run from PowerShell:
#   .\install\install-windows.ps1

$ErrorActionPreference = "Stop"

# SECURITY: Path validation function
function Test-SafePath {
    param(
        [Parameter(Mandatory=$true)][string]$Path,
        [Parameter(Mandatory=$true)][string]$Context
    )
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "$Context is empty"
    }
    if ($Path -match '\.\.') {
        throw "$Context contains path traversal"
    }
    if ($Path -match '^\\\\' -and $Path -notmatch '^\\\\\.\\pipe\\') {
        throw "$Context is UNC network path"
    }
    if ($Path -match '[<>"|?*]') {
        throw "$Context contains invalid characters"
    }
    return $true
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$HostPath = Join-Path $ProjectDir "host\index.js"

# Firefox native messaging registry path
$RegistryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\claudezilla"

# Native manifest location (user's AppData)
$ManifestDir = "$env:APPDATA\claudezilla"
$ManifestPath = Join-Path $ManifestDir "claudezilla.json"

Write-Host ""
Write-Host "Claudezilla Native Host Installer for Windows"
Write-Host "============================================="
Write-Host ""

# Check Node.js
try {
    $NodeVersion = & node --version 2>$null
    if (-not $NodeVersion) {
        throw "Node.js not found"
    }
    Write-Host "[OK] Found Node.js: $NodeVersion"
} catch {
    Write-Host ""
    Write-Host "[ERROR] Node.js not found." -ForegroundColor Red
    Write-Host "Please install Node.js 18+ from https://nodejs.org"
    Write-Host ""
    exit 1
}

# Check host script exists
if (-not (Test-Path $HostPath)) {
    Write-Host ""
    Write-Host "[ERROR] Host script not found at $HostPath" -ForegroundColor Red
    Write-Host ""
    exit 1
}
Write-Host "[OK] Found host script: $HostPath"

# Get node.exe path (full path required for native messaging manifest)
$NodeExe = (Get-Command node).Source
Write-Host "[OK] Node executable: $NodeExe"

# SECURITY: Validate paths before using them
Test-SafePath -Path $NodeExe -Context "Node.js executable"
Test-SafePath -Path $HostPath -Context "Host script path"

# Create manifest directory
if (-not (Test-Path $ManifestDir)) {
    New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
}
Write-Host "[OK] Manifest directory: $ManifestDir"

# Create native messaging manifest using ConvertTo-Json (safe serialization)
# Note: path uses node.exe, args passes the host script
$ManifestObject = @{
    name = "claudezilla"
    description = "Claudezilla native messaging host for Firefox browser automation"
    path = $NodeExe
    args = @($HostPath)
    type = "stdio"
    allowed_extensions = @("claudezilla@boot.industries")
}
$ManifestContent = $ManifestObject | ConvertTo-Json -Depth 10

Set-Content -Path $ManifestPath -Value $ManifestContent -Encoding UTF8
Write-Host "[OK] Created manifest: $ManifestPath"

# Create registry key pointing to manifest
# Firefox looks up native hosts via this registry location
if (-not (Test-Path $RegistryPath)) {
    New-Item -Path $RegistryPath -Force | Out-Null
}
Set-ItemProperty -Path $RegistryPath -Name "(Default)" -Value $ManifestPath
Write-Host "[OK] Created registry key: $RegistryPath"

# Create auth token directory (used by host at runtime)
$AuthDir = "$env:LOCALAPPDATA\claudezilla"
if (-not (Test-Path $AuthDir)) {
    New-Item -ItemType Directory -Force -Path $AuthDir | Out-Null
}
Write-Host "[OK] Auth directory: $AuthDir"

# Install MCP server dependencies
$McpDir = Join-Path $ProjectDir "mcp"
if (Test-Path (Join-Path $McpDir "package.json")) {
    Write-Host ""
    Write-Host "Installing MCP server dependencies..."
    Push-Location $McpDir
    try {
        & npm install --silent 2>$null
        Write-Host "[OK] MCP dependencies installed"
    } catch {
        Write-Host "[WARN] Could not install MCP dependencies. Run 'npm install' in mcp/ manually."
    }
    Pop-Location
}

Write-Host ""
Write-Host "============================================="
Write-Host "Native host installation complete!" -ForegroundColor Green
Write-Host "============================================="
Write-Host ""

# Configure Claude Code for autonomous Claudezilla operations
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"
$SettingsFile = Join-Path $ClaudeDir "settings.json"
$McpFile = Join-Path $ClaudeDir "mcp.json"

Write-Host "Configuring Claude Code for autonomous Claudezilla operations..."

# Create .claude directory if it doesn't exist
if (-not (Test-Path $ClaudeDir)) {
    New-Item -ItemType Directory -Force -Path $ClaudeDir | Out-Null
}

# Update settings.json to allow Claudezilla tools without prompts
try {
    if (Test-Path $SettingsFile) {
        $settings = Get-Content $SettingsFile -Raw | ConvertFrom-Json
        if (-not $settings.permissions) {
            $settings | Add-Member -NotePropertyName "permissions" -NotePropertyValue @{} -Force
        }
        if (-not $settings.permissions.allow) {
            $settings.permissions | Add-Member -NotePropertyName "allow" -NotePropertyValue @() -Force
        }
        if ($settings.permissions.allow -notcontains "mcp__claudezilla__*") {
            $settings.permissions.allow = @($settings.permissions.allow) + @("mcp__claudezilla__*")
        }
        $settings | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
    } else {
        @{
            permissions = @{
                allow = @("mcp__claudezilla__*")
            }
        } | ConvertTo-Json -Depth 10 | Set-Content $SettingsFile -Encoding UTF8
    }
    Write-Host "[OK] Updated Claude Code permissions: $SettingsFile"
} catch {
    Write-Host "[WARN] Could not update settings.json: $_" -ForegroundColor Yellow
}

# Update mcp.json to register Claudezilla MCP server
try {
    $McpServerPath = "$($ProjectDir -replace '\\', '/')/mcp/server.js"
    if (Test-Path $McpFile) {
        $mcpConfig = Get-Content $McpFile -Raw | ConvertFrom-Json
        if (-not $mcpConfig.mcpServers) {
            $mcpConfig | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue @{} -Force
        }
        $mcpConfig.mcpServers | Add-Member -NotePropertyName "claudezilla" -NotePropertyValue @{
            command = "node"
            args = @($McpServerPath)
        } -Force
        $mcpConfig | ConvertTo-Json -Depth 10 | Set-Content $McpFile -Encoding UTF8
    } else {
        @{
            mcpServers = @{
                claudezilla = @{
                    command = "node"
                    args = @($McpServerPath)
                }
            }
        } | ConvertTo-Json -Depth 10 | Set-Content $McpFile -Encoding UTF8
    }
    Write-Host "[OK] Updated Claude Code MCP config: $McpFile"
} catch {
    Write-Host "[WARN] Could not update mcp.json: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================="
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host "============================================="
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
Write-Host "1. Install the Claudezilla extension in Firefox"
Write-Host "   - Visit: https://addons.mozilla.org/firefox/addon/claudezilla/"
Write-Host "   - Or load temporarily from: $ProjectDir\extension\"
Write-Host ""
Write-Host "2. Click the Claudezilla icon in Firefox toolbar to test connection"
Write-Host ""
Write-Host "Claudezilla is now configured for autonomous operation."
Write-Host "All mcp__claudezilla__* tools will run without permission prompts." -ForegroundColor Green
Write-Host ""
