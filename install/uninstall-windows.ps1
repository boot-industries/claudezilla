# Claudezilla Uninstaller for Windows
#
# Removes:
# - Registry key for native messaging
# - Native manifest file
# - Auth token directory
#
# Run from PowerShell:
#   .\install\uninstall-windows.ps1

$ErrorActionPreference = "Continue"

$RegistryPath = "HKCU:\Software\Mozilla\NativeMessagingHosts\claudezilla"
$ManifestDir = "$env:APPDATA\claudezilla"
$AuthDir = "$env:LOCALAPPDATA\claudezilla"

Write-Host ""
Write-Host "Claudezilla Uninstaller for Windows"
Write-Host "===================================="
Write-Host ""

$itemsRemoved = 0

# Remove registry key
if (Test-Path $RegistryPath) {
    Remove-Item -Path $RegistryPath -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Removed registry key: $RegistryPath"
    $itemsRemoved++
} else {
    Write-Host "[--] Registry key not found (already removed)"
}

# Remove manifest directory
if (Test-Path $ManifestDir) {
    Remove-Item -Path $ManifestDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Removed manifest directory: $ManifestDir"
    $itemsRemoved++
} else {
    Write-Host "[--] Manifest directory not found (already removed)"
}

# Remove auth directory
if (Test-Path $AuthDir) {
    Remove-Item -Path $AuthDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "[OK] Removed auth directory: $AuthDir"
    $itemsRemoved++
} else {
    Write-Host "[--] Auth directory not found (already removed)"
}

Write-Host ""
Write-Host "===================================="
if ($itemsRemoved -gt 0) {
    Write-Host "Uninstall complete! ($itemsRemoved items removed)" -ForegroundColor Green
} else {
    Write-Host "Nothing to uninstall (Claudezilla was not installed)" -ForegroundColor Yellow
}
Write-Host "===================================="
Write-Host ""
Write-Host "Note: The Claudezilla extension in Firefox must be removed separately:"
Write-Host "  Firefox -> Add-ons and themes -> Extensions -> Claudezilla -> Remove"
Write-Host ""
Write-Host "The source code in this directory has not been removed."
Write-Host ""
