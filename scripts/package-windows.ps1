param([string]$Python = '', [switch]$SkipSmoke)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Python) { $Python = Join-Path $root 'venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $Python)) { throw 'Create venv and install requirements-dev.txt and pyinstaller first.' }
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '2' }
Push-Location $root
try {
    & $Python -m PyInstaller arynwood-backend.spec --noconfirm
    if ($LASTEXITCODE) { throw 'Backend packaging failed' }
    if (-not $SkipSmoke) {
        & $Python scripts/smoke_windows_backend.py dist/arynwood-backend.exe
        if ($LASTEXITCODE) { throw 'Packaged backend smoke test failed' }
    }
    $triple = ((& rustc -vV | Select-String '^host:').Line -replace '^host:\s*', '').Trim()
    if ($LASTEXITCODE -or $triple -ne 'x86_64-pc-windows-msvc') { throw 'This release requires the x64 MSVC Rust toolchain.' }
    New-Item -ItemType Directory -Force frontend/src-tauri/binaries | Out-Null
    Copy-Item -LiteralPath dist/arynwood-backend.exe -Destination "frontend/src-tauri/binaries/arynwood-backend-$triple.exe"
    Push-Location frontend
    try {
        & npm.cmd run tauri:build
        if ($LASTEXITCODE) { throw 'Desktop packaging failed' }
    } finally { Pop-Location }
    $installers = @(Get-ChildItem frontend/src-tauri/target/release/bundle/nsis/*-setup.exe)
    if (-not $installers.Count) { throw 'No Windows installer was produced' }
    $lines = $installers | ForEach-Object { "$( (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLower() )  $($_.Name)" }
    $lines | Set-Content frontend/src-tauri/target/release/bundle/nsis/SHA256SUMS-windows.txt -Encoding ascii
    $installers | Select-Object FullName, Length
} finally { Pop-Location }
