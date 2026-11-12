<#
  ONE command, ONE window: everything the console needs. Ctrl+C stops all of it.

    .\dev                 # LOS server (8011) + console backend (8010) + console (5190), browser opens
    .\dev -NoLos          # without the LOS server (Dedupe "New application" is then not available)
    .\dev -NoBrowser
    .\dev -LosDir D:\path\to\LOS-agentic-ai     # the LOS server lives somewhere else

  What runs:
    LOS server       (the LOS-agentic-ai repo)   -> http://127.0.0.1:8011   Dedupe "New application" (/api/v1/fos, /api/v1/auth)
    console backend  (this folder's backend)     -> http://127.0.0.1:8010   all 11 agents
    console          (this folder's frontend)    -> http://localhost:5190
  The two backends run in the background of this window; their logs are backend\dev-backend.log and
  backend\dev-los.log (the last lines are shown if one fails to start). Local development only.
#>
param(
    [int]$BackendPort = 8010,
    [int]$FrontendPort = 5190,
    [int]$LosPort = 8011,
    [string]$LosDir = (Join-Path $env:USERPROFILE "Downloads\los-agentic-ai-optimised\V21\gz\LOS-agentic-ai"),
    [switch]$NoLos,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$started = @()

function Start-Api($name, $exe, $dir, $port, $log) {
    Write-Host ("{0,-16} -> http://127.0.0.1:{1}   (log: {2})" -f $name, $port, $log) -ForegroundColor Cyan
    Start-Process -FilePath $exe -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", $port `
        -WorkingDirectory $dir -NoNewWindow -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"
}
function Wait-Api($name, $proc, $port, $log) {
    for ($i = 0; $i -lt 120 -and -not $proc.HasExited; $i++) {
        try { if ((Invoke-WebRequest "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { return $true } } catch { }
        Start-Sleep -Seconds 2
    }
    Write-Host "$name did not start - last lines of its log:" -ForegroundColor Red
    Get-Content "$log.err", $log -Tail 25 -ErrorAction SilentlyContinue
    return $false
}

# ---- checks before anything starts
if (-not (Test-Path $python)) { throw "backend\.venv is missing: run start.ps1 once (it creates it), or create the venv and pip install -r requirements.txt" }
$losPython = Join-Path $LosDir "..\..\..\.venv\Scripts\python.exe"
if (-not $NoLos -and -not ((Test-Path (Join-Path $LosDir "main.py")) -and (Test-Path $losPython))) {
    Write-Host "LOS server not found at $LosDir (or its .venv) - starting without it; Dedupe 'New application' will not be available." -ForegroundColor Yellow
    $NoLos = $true
}
$ports = @($BackendPort, $FrontendPort) + $(if ($NoLos) { @() } else { @($LosPort) })
foreach ($port in $ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use - close what runs there first (an old window?), then run .\dev again."
    }
}
if (-not (Test-Path (Join-Path $frontend "node_modules"))) { Push-Location $frontend; npm install; Pop-Location }

# ---- environment for the console backend and the console (the same local-developer scopes as start.ps1)
$env:AUTH_ENABLED = "false"
$env:AUTH_LOCAL_SCOPES = @(
    "read_applicant", "read_application", "read_documents", "read_verification", "read_pending_items",
    "read_next_action", "create_applicant", "update_applicant", "create_application", "upload_document",
    "agents:execute", "los.read", "los.write", "los.dedupe.read", "los.credit.underwrite"
) -join " "
$env:LOS_API = "http://127.0.0.1:$BackendPort"
$env:FOS_API = $(if ($NoLos) { "" } else { "http://127.0.0.1:$LosPort" })

try {
    # ---- 1) both backends at once (the LOS server reads its own .env in its folder)
    if (-not $NoLos) { $los = Start-Api "LOS server" $losPython $LosDir $LosPort (Join-Path $backend "dev-los.log"); $started += $los }
    $api = Start-Api "console backend" $python $backend $BackendPort (Join-Path $backend "dev-backend.log"); $started += $api

    Write-Host "waiting for the backends..." -ForegroundColor Cyan
    if (-not (Wait-Api "console backend" $api $BackendPort (Join-Path $backend "dev-backend.log"))) { return }
    if (-not $NoLos -and -not (Wait-Api "LOS server" $los $LosPort (Join-Path $backend "dev-los.log"))) {
        Write-Host "continuing without the LOS server: Dedupe 'New application' will not be available." -ForegroundColor Yellow
        $env:FOS_API = ""
    }

    # ---- 2) the console in front: its output is what this window shows
    Write-Host "ready. console -> http://localhost:$FrontendPort   (Ctrl+C stops everything)" -ForegroundColor Green
    if (-not $NoBrowser) { Start-Process "http://localhost:$FrontendPort" }
    Push-Location $frontend
    try { npm run dev -- --port $FrontendPort --strictPort } finally { Pop-Location }
}
finally {
    # Ctrl+C, the window closing or an error: every backend this script started stops with it
    foreach ($p in $started) { if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F | Out-Null } }
    Write-Host "stopped." -ForegroundColor Cyan
}
