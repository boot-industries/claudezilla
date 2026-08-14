<#
.SYNOPSIS
    Claudezilla per-user setup for Windows.

.DESCRIPTION
    Run once after installing the package. Registers the native messaging host
    with Firefox, registers the MCP server with Claude Code, and sideloads the
    bundled extension into a dedicated profile.

    Windows locates native messaging hosts through the registry rather than a
    well-known directory, so the manifest path is written to
    HKCU:\Software\Mozilla\NativeMessagingHosts\claudezilla.

    Safe to re-run.
#>

$ErrorActionPreference = 'Stop'

# Resolve the install root from this script's own location: <root>\bin\..
$binDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $binDir
$libDir = if ($env:CLZ_LIB) { $env:CLZ_LIB } else { Join-Path $root 'lib' }

Write-Host 'Claudezilla per-user setup'
Write-Host '=========================='
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Native messaging manifest + registry key
# ---------------------------------------------------------------------------

$hostCmd = Join-Path $binDir 'claudezilla-host.cmd'
if (-not (Test-Path $hostCmd)) {
    throw "claudezilla-host.cmd not found at $hostCmd"
}

$manifestDir = Join-Path $env:LOCALAPPDATA 'Claudezilla'
New-Item -ItemType Directory -Force -Path $manifestDir | Out-Null
$manifestPath = Join-Path $manifestDir 'claudezilla.json'

# The manifest points at the .cmd shim, not at the runtime: Firefox launches
# this path directly and does not inherit a shell.
@{
    name               = 'claudezilla'
    description        = 'Claude Code Firefox browser automation bridge'
    path               = $hostCmd
    type               = 'stdio'
    allowed_extensions = @('claudezilla@boot.industries')
} | ConvertTo-Json -Depth 3 | Set-Content -Path $manifestPath -Encoding UTF8

$regKey = 'HKCU:\Software\Mozilla\NativeMessagingHosts\claudezilla'
New-Item -Path $regKey -Force | Out-Null
Set-ItemProperty -Path $regKey -Name '(Default)' -Value $manifestPath

Write-Host "  Native messaging manifest: $manifestPath"
Write-Host "  Registry key: $regKey"

# ---------------------------------------------------------------------------
# 2. Claude Code permissions + MCP config
# ---------------------------------------------------------------------------

$claudeDir = Join-Path $env:USERPROFILE '.claude'
New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null

$settingsFile = Join-Path $claudeDir 'settings.json'
$settings = if (Test-Path $settingsFile) {
    Get-Content $settingsFile -Raw | ConvertFrom-Json
} else {
    [PSCustomObject]@{}
}
if (-not $settings.PSObject.Properties['permissions']) {
    $settings | Add-Member -NotePropertyName 'permissions' -NotePropertyValue ([PSCustomObject]@{})
}
if (-not $settings.permissions.PSObject.Properties['allow']) {
    $settings.permissions | Add-Member -NotePropertyName 'allow' -NotePropertyValue @()
}
if ($settings.permissions.allow -notcontains 'mcp__claudezilla__*') {
    $settings.permissions.allow = @($settings.permissions.allow) + 'mcp__claudezilla__*'
}
$settings | ConvertTo-Json -Depth 10 | Set-Content -Path $settingsFile -Encoding UTF8
Write-Host "  Permissions: $settingsFile"

$mcpFile = Join-Path $claudeDir 'mcp.json'
$mcp = if (Test-Path $mcpFile) {
    Get-Content $mcpFile -Raw | ConvertFrom-Json
} else {
    [PSCustomObject]@{}
}
if (-not $mcp.PSObject.Properties['mcpServers']) {
    $mcp | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([PSCustomObject]@{})
}
$serverCfg = [PSCustomObject]@{
    command = (Join-Path $binDir 'claudezilla-mcp.cmd')
    args    = @()
}
if ($mcp.mcpServers.PSObject.Properties['claudezilla']) {
    $mcp.mcpServers.claudezilla = $serverCfg
} else {
    $mcp.mcpServers | Add-Member -NotePropertyName 'claudezilla' -NotePropertyValue $serverCfg
}
$mcp | ConvertTo-Json -Depth 10 | Set-Content -Path $mcpFile -Encoding UTF8
Write-Host "  MCP config: $mcpFile"

# ---------------------------------------------------------------------------
# 3. Firefox profile with the bundled extension
# ---------------------------------------------------------------------------

Write-Host ''

$firefox = Get-Command firefox -ErrorAction SilentlyContinue
if (-not $firefox) {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Mozilla Firefox\firefox.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Mozilla Firefox\firefox.exe')
    )
    $found = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $found) {
        Write-Host 'Firefox not found — skipping profile setup.'
        Write-Host '  Install Firefox and re-run this script, or install the signed'
        Write-Host '  extension from https://addons.mozilla.org/firefox/addon/claudezilla/'
        exit 0
    }
}

$profileDir = Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles\claudezilla-headless'
New-Item -ItemType Directory -Force -Path (Join-Path $profileDir 'extensions') | Out-Null

@'
// Claudezilla headless profile — disable extension signature enforcement
user_pref("xpinstall.signatures.required", false);
user_pref("extensions.autoDisableScopes", 0);
user_pref("extensions.enabledScopes", 15);
user_pref("extensions.update.enabled", false);
user_pref("app.update.enabled", false);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
'@ | Set-Content -Path (Join-Path $profileDir 'user.js') -Encoding UTF8

$xpi = Join-Path $libDir 'claudezilla.xpi'
if (-not (Test-Path $xpi)) { throw "Extension not found at $xpi" }
Copy-Item $xpi -Destination (Join-Path $profileDir 'extensions\claudezilla@boot.industries.xpi') -Force
Write-Host "  Extension sideloaded into profile: $profileDir"

Write-Host ''
Write-Host 'Setup complete. Start the browser with:'
Write-Host "  firefox --headless --no-remote --profile `"$profileDir`""
Write-Host ''
Write-Host 'Restart Claude Code to pick up the MCP server.'
