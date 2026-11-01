# Bundles the Python worker + a relocatable CPython into desktop/resources for electron-builder.
# Usage (from repo root or desktop/):
#   powershell -ExecutionPolicy Bypass -File desktop/scripts/bundle-engine.ps1
#
# IMPORTANT: Do NOT ship a normal `python -m venv` tree. On Windows the venv's
# Scripts\python.exe is a redirector that reads pyvenv.cfg `home=` — on GitHub
# Actions that is C:\hostedtoolcache\... which does not exist on user PCs
# (engine exit 103: No Python at '...hostedtoolcache...').
# Instead we copy sys.base_prefix into resources/engine/python/ (self-contained).
#
# Also place binaries under:
#   desktop/resources/ffmpeg/ffmpeg.exe + ffprobe.exe
#   desktop/resources/node/node.exe
# Or leave empty and rely on PATH during local `npm run dev`.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Resolve-Path (Join-Path $ScriptDir "..")
$RepoRoot = Resolve-Path (Join-Path $DesktopDir "..")
$WorkerSrc = Join-Path $RepoRoot "worker"
$Resources = Join-Path $DesktopDir "resources"
$EngineRoot = Join-Path $Resources "engine"
$WorkerDest = Join-Path $EngineRoot "worker"
$PythonDest = Join-Path $EngineRoot "python"
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

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  Write-Error "python not found on PATH. Install Python 3.11+ to bundle the engine."
}

# Resolve the real install prefix (never a venv prefix) and copy it so the EXE
# does not depend on the build machine's absolute Python path.
$basePrefix = (& python -c "import sys; print(sys.base_prefix)").Trim()
$basePython = Join-Path $basePrefix "python.exe"
if (-not (Test-Path $basePython)) {
  Write-Error "sys.base_prefix has no python.exe: $basePrefix"
}

Write-Host "Copying relocatable Python from:"
Write-Host "  $basePrefix"
Write-Host "  -> $PythonDest"

if (Test-Path $PythonDest) {
  Remove-Item -Recurse -Force $PythonDest
}
# Drop any previous venv layout so we never package a broken redirector.
if (Test-Path $VenvDir) {
  Write-Host "Removing obsolete engine .venv (not relocatable on Windows)..."
  Remove-Item -Recurse -Force $VenvDir
}

Copy-Item -Path $basePrefix -Destination $PythonDest -Recurse

$pythonExe = Join-Path $PythonDest "python.exe"
if (-not (Test-Path $pythonExe)) {
  Write-Error "Bundled python.exe missing after copy: $pythonExe"
}

# Prefer the copied interpreter for installs so site-packages land inside the bundle.
$pipProbe = & $pythonExe -m pip --version 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "ensurepip on bundled Python..."
  & $pythonExe -m ensurepip --upgrade
}

& $pythonExe -m pip install --upgrade pip
& $pythonExe -m pip install -r (Join-Path $WorkerSrc "requirements.txt")

# Fail the build if the bundle cannot import core deps from this tree.
Write-Host "Probing bundled Python imports..."
& $pythonExe -c "import sys; from pathlib import Path; root = Path(sys.executable).resolve().parent; assert (root / 'Lib').exists() or (root / 'lib').exists() or any(root.glob('python*.dll')), 'stdlib/dlls missing next to python.exe'; import yt_dlp; import cv2; print('probe_ok', sys.executable)"
if ($LASTEXITCODE -ne 0) {
  Write-Error "Bundled Python failed import probe."
}

$manifest = @{
  bundledAt = (Get-Date).ToUniversalTime().ToString("o")
  python = $pythonExe
  pythonLayout = "relocatable-base-prefix-copy"
  worker = $WorkerDest
  note = "Place ffmpeg.exe/ffprobe.exe under resources/ffmpeg and node.exe under resources/node before packaging. Do not ship a Windows venv."
} | ConvertTo-Json

Set-Content -Path (Join-Path $EngineRoot "engine-manifest.json") -Value $manifest -Encoding UTF8

@"
Shortlio engine bundle
======================
- worker/     Python pipeline + local_runner.py
- python/     Relocatable CPython copy + site-packages (NOT a venv)

Also required next to this folder (electron-builder extraResources):
- ../ffmpeg/ffmpeg.exe
- ../ffmpeg/ffprobe.exe
- ../node/node.exe   (portable Node for yt-dlp JS runtime)

Never place GROQ_API_KEY or SUPABASE_SERVICE_ROLE_KEY in this tree.
Never ship engine/.venv — Windows venvs break off the build machine (hostedtoolcache).
"@ | Set-Content -Path (Join-Path $EngineRoot "README.txt") -Encoding UTF8

Write-Host "Engine bundle ready."
Write-Host "Python: $pythonExe"
Write-Host "Add FFmpeg + Node under desktop/resources before npm run dist:win"
