<#
.SYNOPSIS
  Stop and remove the FinAlly container (Windows PowerShell). Idempotent.
  The finally-data volume is NOT removed - your portfolio persists.
#>
$ErrorActionPreference = 'Stop'
$Container = 'finally'

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker does not appear to be running; nothing to stop.'
    exit 0
}

docker container inspect $Container *> $null
if ($LASTEXITCODE -eq 0) {
    docker rm -f $Container | Out-Null
    Write-Host "FinAlly stopped. Data volume 'finally-data' preserved."
} else {
    Write-Host 'FinAlly is not running.'
}
