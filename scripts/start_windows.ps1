<#
.SYNOPSIS
  Start FinAlly in Docker (Windows PowerShell). Idempotent: safe to run repeatedly.
.PARAMETER Build
  Rebuild the image even if it already exists (recreates the container).
.PARAMETER NoOpen
  Do not open a browser.
.PARAMETER Port
  Host port (default 8000, or $env:FINALLY_PORT).
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$NoOpen,
    [int]$Port = $(if ($env:FINALLY_PORT) { [int]$env:FINALLY_PORT } else { 8000 })
)

$ErrorActionPreference = 'Stop'

$RootDir   = Split-Path -Parent $PSScriptRoot
$Image     = if ($env:FINALLY_IMAGE) { $env:FINALLY_IMAGE } else { 'finally:latest' }
$Container = 'finally'
$Volume    = 'finally-data'
$Url       = "http://localhost:$Port"

function Test-DockerOk { docker info *> $null; return ($LASTEXITCODE -eq 0) }
function Test-ImageExists { docker image inspect $Image *> $null; return ($LASTEXITCODE -eq 0) }
function Test-ContainerExists { docker container inspect $Container *> $null; return ($LASTEXITCODE -eq 0) }

if (-not (Test-DockerOk)) {
    Write-Error 'Docker does not appear to be running. Start Docker Desktop and try again.'
    exit 1
}

Push-Location $RootDir
try {
    if (-not (Test-Path '.env')) {
        if (Test-Path '.env.example') {
            Copy-Item '.env.example' '.env'
            Write-Host 'Created .env from .env.example - add your OPENROUTER_API_KEY to enable AI chat.'
        } else {
            New-Item -ItemType File '.env' | Out-Null
        }
    }

    $rebuilt = $false
    if ($Build -or -not (Test-ImageExists)) {
        Write-Host "Building image $Image ..."
        docker build -t $Image $RootDir
        if ($LASTEXITCODE -ne 0) { throw 'docker build failed' }
        $rebuilt = $true
    }

    $alreadyRunning = $false
    if (Test-ContainerExists) {
        $running = docker container inspect -f '{{.State.Running}}' $Container
        if ($running -eq 'true' -and -not $rebuilt) {
            Write-Host "FinAlly is already running at $Url"
            $alreadyRunning = $true
        } else {
            docker rm -f $Container | Out-Null
        }
    }

    if (-not $alreadyRunning) {
        docker volume create $Volume | Out-Null
        docker run -d `
            --name $Container `
            -p "${Port}:8000" `
            -v "${Volume}:/app/db" `
            --env-file .env `
            -e FINALLY_DB_PATH=/app/db/finally.db `
            --restart unless-stopped `
            $Image | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'docker run failed' }

        Write-Host -NoNewline 'Waiting for FinAlly to become healthy'
        for ($i = 0; $i -lt 60; $i++) {
            try {
                $r = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 2
                if ($r.StatusCode -eq 200) { Write-Host ' ok'; break }
            } catch { }
            Write-Host -NoNewline '.'
            Start-Sleep -Seconds 1
        }
        Write-Host ''
        Write-Host "FinAlly is running at $Url"
        Write-Host "Logs: docker logs -f $Container   Stop: scripts\stop_windows.ps1"
    }

    if (-not $NoOpen) { Start-Process $Url }
}
finally {
    Pop-Location
}
