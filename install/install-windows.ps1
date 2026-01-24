# Claudezilla Native Messaging Host Installer for Windows
# Requires: Node.js 18+, Firefox
#
# Run from PowerShell:
#   .\install\install-windows.ps1

$ErrorActionPreference = "Stop"

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

# Create manifest directory
if (-not (Test-Path $ManifestDir)) {
    New-Item -ItemType Directory -Force -Path $ManifestDir | Out-Null
}
Write-Host "[OK] Manifest directory: $ManifestDir"

# Create native messaging manifest
# Note: path uses node.exe, args passes the host script
$ManifestContent = @"
{
    "name": "claudezilla",
    "description": "Claudezilla native messaging host for Firefox browser automation",
    "path": "$($NodeExe -replace '\\', '\\\\')",
    "args": ["$($HostPath -replace '\\', '\\\\')"],
    "type": "stdio",
    "allowed_extensions": ["claudezilla@boot.industries"]
}
"@

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
Write-Host "3. Add to Claude Code config (~/.claude/mcp.json):"
Write-Host ""
Write-Host "   {" -ForegroundColor Cyan
Write-Host "     `"mcpServers`": {" -ForegroundColor Cyan
Write-Host "       `"claudezilla`": {" -ForegroundColor Cyan
Write-Host "         `"command`": `"node`"," -ForegroundColor Cyan
Write-Host "         `"args`": [`"$($ProjectDir -replace '\\', '/')/mcp/server.js`"]" -ForegroundColor Cyan
Write-Host "       }" -ForegroundColor Cyan
Write-Host "     }" -ForegroundColor Cyan
Write-Host "   }" -ForegroundColor Cyan
Write-Host ""
