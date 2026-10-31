# Bundles the Python worker + (optional) FFmpeg/Node into desktop/resources for electron-builder.
# Usage (from repo root or desktop/):
#   powershell -ExecutionPolicy Bypass -File desktop/scripts/bundle-engine.ps1
#
# Does NOT download FFmpeg/Node automatically (license/size). Place binaries under:
#   desktop/resources/ffmpeg/ffmpeg.exe + ffprobe.exe
#   desktop/resources/node/node.exe
# Or leave empty and rely on PATH during local `npm run dev` (engine.js falls back to worker\.venv).

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Resolve-Path (Join-Path $ScriptDir "..")
$RepoRoot = Resolve-Path (Join-Path $DesktopDir "..")
$WorkerSrc = Join-Path $RepoRoot "worker"
$Resources = Join-Path $DesktopDir "resources"
$EngineRoot = Join-Path $Resources "engine"
$WorkerDest = Join-Path $EngineRoot "worker"
$VenvDir = Join-Path $EngineRoot ".venv"

Write-Host "Repo:     $RepoRoot"
Write-Host "Worker:   $WorkerSrc"
Write-Host "Engine -> $EngineRoot"

New-Item -ItemType Directory -Force -Path $EngineRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Resources "ffmpeg") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Resources "node") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Resources "bin") | Out-Null

if (Test-Path $WorkerDest) {
  Remove-Item -Recurse -Force $WorkerDest
}

# Copy worker sources (exclude heavy/local junk)
$exclude = @(".venv", "tmp", "__pycache__", ".pytest_cache", "*.pyc", ".env")
New-Item -ItemType Directory -Force -Path $WorkerDest | Out-Null
Get-ChildItem -Path $WorkerSrc -Force | Where-Object {
  $name = $_.Name
  -not ($exclude -contains $name) -and -not ($name -like "*.pyc")
} | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination (Join-Path $WorkerDest $_.Name) -Recurse -Force
}

# Create venv + install requirements into resources/engine/.venv
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) {
  Write-Error "python not found on PATH. Install Python 3.11+ to bundle the engine."
}

if (-not (Test-Path $VenvDir)) {
  & python -m venv $VenvDir
}

$pip = Join-Path $VenvDir "Scripts\pip.exe"
$pythonExe = Join-Path $VenvDir "Scripts\python.exe"
& $pip install --upgrade pip
& $pip install -r (Join-Path $WorkerSrc "requirements.txt")

$manifest = @{
  bundledAt = (Get-Date).ToUniversalTime().ToString("o")
  python = $pythonExe
  worker = $WorkerDest
  note = "Place ffmpeg.exe/ffprobe.exe under resources/ffmpeg and node.exe under resources/node before packaging."
} | ConvertTo-Json

Set-Content -Path (Join-Path $EngineRoot "engine-manifest.json") -Value $manifest -Encoding UTF8

# README for packagers
@"
Shortlio engine bundle
======================
- worker/     Python pipeline + local_runner.py
- .venv/      Python deps (yt-dlp, opencv, mediapipe, ...)

Also required next to this folder (electron-builder extraResources):
- ../ffmpeg/ffmpeg.exe
- ../ffmpeg/ffprobe.exe
- ../node/node.exe   (portable Node for yt-dlp JS runtime)

Never place GROQ_API_KEY or SUPABASE_SERVICE_ROLE_KEY in this tree.
"@ | Set-Content -Path (Join-Path $EngineRoot "README.txt") -Encoding UTF8

Write-Host "Engine bundle ready."
Write-Host "Python: $pythonExe"
Write-Host "Add FFmpeg + Node under desktop/resources before npm run dist:win"
