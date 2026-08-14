$ErrorActionPreference = 'Stop'

$packageName = 'claudezilla'
$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$url = 'https://github.com/@REPO@/releases/download/v@VERSION@/claudezilla-@VERSION@-win.zip'

Install-ChocolateyZipPackage `
    -PackageName $packageName `
    -Url $url `
    -UnzipLocation $toolsDir `
    -Checksum '@SHA256@' `
    -ChecksumType 'sha256'

$root = Join-Path $toolsDir "claudezilla-@VERSION@"

# Shims for the two launchers; the setup script is run by the user, not here,
# because it writes into the invoking user's home directory.
Install-BinFile -Name 'claudezilla-host' -Path (Join-Path $root 'bin\\claudezilla-host.cmd')
Install-BinFile -Name 'claudezilla-mcp' -Path (Join-Path $root 'bin\\claudezilla-mcp.cmd')

Write-Host ''
Write-Host 'Finish setup for your user with:'
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$root\\bin\\claudezilla-setup.ps1`""
