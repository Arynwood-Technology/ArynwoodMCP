param([switch]$Desktop)
$ErrorActionPreference = 'Stop'
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path venv/Scripts/python.exe)) { throw 'Create venv and install requirements.txt first; see docs/windows.md.' }
    if ($Desktop) {
        Push-Location frontend
        try { & npm.cmd run tauri:dev } finally { Pop-Location }
    } else {
        $backend = Start-Process -FilePath "$PSScriptRoot\venv\Scripts\python.exe" -ArgumentList '-m','uvicorn','backend.api:app','--host','127.0.0.1','--port','8010' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
        try {
            Push-Location frontend
            try { & npm.cmd run dev -- --host 127.0.0.1 } finally { Pop-Location }
        } finally { if (-not $backend.HasExited) { Stop-Process -Id $backend.Id } }
    }
} finally { Pop-Location }
