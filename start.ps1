<#
  Start the whole credit underwriting console: backend (FastAPI) + frontend (React console), each in its own window,
  then open the browser.

    .\start.ps1                                   # backend 8010, frontend 5190
    .\start.ps1 -FosApi http://127.0.0.1:8011     # dedupe "New application" served by another (full LOS) server
    .\start.ps1 -BackendPort 8031                 # backend on another port (frontend follows it)

  Local development only: AUTH_ENABLED=false is honoured only when ENVIRONMENT=development (backend/.env).
  Close a window (or Ctrl+C in it) to stop that part.
#>
param(
    [int]$BackendPort = 8010,
    [int]$FrontendPort = 5190,
    [string]$FosApi = "",            # full LOS server for /api/v1/fos + /api/v1/auth; empty = the same backend
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

# the local developer's scopes: the applicant / FOS ones and the ones the agents check
$scopes = @(
    "read_applicant", "read_application", "read_documents", "read_verification", "read_pending_items",
    "read_next_action", "create_applicant", "update_applicant", "create_application", "upload_document",
    "agents:execute", "los.read", "los.write", "los.dedupe.read", "los.credit.underwrite", "los.rules.write"
) -join " "

# python: the backend's own venv; the first run creates it and installs requirements.txt
$python = @("$backend\.venv\Scripts\python.exe", "$root\.venv\Scripts\python.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) {
    Write-Host "first run: creating backend\.venv and installing the packages (takes a few minutes)..."
    python -m venv "$backend\.venv"
    $python = "$backend\.venv\Scripts\python.exe"
    & $python -m pip install --upgrade pip
    & $python -m pip install -r "$backend\requirements.txt"
}
if (-not (Test-Path "$backend\.env")) {
    Copy-Item "$backend\.env.example" "$backend\.env"
    Write-Warning "backend\.env was missing: copied .env.example - set LOS_AGENTIC_DSN to this laptop's PostgreSQL."
}

foreach ($port in @($BackendPort, $FrontendPort)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        Write-Warning "Port $port is already in use - stop what runs there or pass another port (-BackendPort / -FrontendPort)."
        return
    }
}

# 1) backend
$backendCmd = @"
`$host.UI.RawUI.WindowTitle = 'Credit underwriting - backend :$BackendPort'
Set-Location '$backend'
`$env:AUTH_ENABLED = 'false'
`$env:AUTH_LOCAL_SCOPES = '$scopes'
& '$python' -m uvicorn main:app --host 0.0.0.0 --port $BackendPort
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Write-Host "backend  -> http://127.0.0.1:$BackendPort   (python: $python)"

# 2) frontend (installs its packages the first time)
$api = "http://127.0.0.1:$BackendPort"
$frontendCmd = @"
`$host.UI.RawUI.WindowTitle = 'Credit underwriting - console :$FrontendPort'
Set-Location '$frontend'
if (-not (Test-Path 'node_modules')) { npm install }
`$env:LOS_API = '$api'
`$env:FOS_API = '$FosApi'
npm run dev -- --port $FrontendPort --strictPort
"@
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd
Write-Host "console  -> http://localhost:$FrontendPort   (API: $api$(if ($FosApi) { ", FOS: $FosApi" }))"

# 3) browser, once the backend answers
if (-not $NoBrowser) {
    Write-Host "waiting for the backend..."
    for ($i = 0; $i -lt 90; $i++) {
        try { if ((Invoke-WebRequest "$api/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { break } } catch { }
        Start-Sleep -Seconds 2
    }
    Start-Process "http://localhost:$FrontendPort"
}
