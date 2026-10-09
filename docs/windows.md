# Windows desktop (alpha)

Version 0.4.5 was the first release with a Windows x64 build, and 0.4.7 is the current one: a per-user installer
for a Tauri/WebView2 app with a bundled Python backend. It is an alpha. Read the
[limitations](#windows-alpha-limitations) before relying on it.

## Install the published release

1. From the [v0.4.7 release](https://github.com/Arynwood-Technology/ArynwoodMCP/releases/tag/v0.4.7),
   download `arynwood-mcp_0.4.7_x64-setup.exe` and `SHA256SUMS-windows.txt` into the
   same folder.
2. Check the installer in PowerShell, from that folder:

   ```powershell
   $expected = (Select-String -Path .\SHA256SUMS-windows.txt -Pattern 'x64-setup.exe').Line.Split(' ')[0]
   $actual = (Get-FileHash .\arynwood-mcp_0.4.7_x64-setup.exe -Algorithm SHA256).Hash
   if ($actual -eq $expected) { 'OK: checksum matches' } else { 'MISMATCH: do not run this file' }
   ```

3. Run the installer. It installs for your user account only. If WebView2 is
   missing, it downloads Microsoft's bootstrapper and installs it.
   The installer is unsigned, so Microsoft Defender SmartScreen may say
   "Windows protected your PC". Once the checksum matches, choose **More info**,
   then **Run anyway**.
4. Install [Ollama for Windows](https://ollama.com/download/windows) separately,
   then pull the models the personas use (README [Quick Start](../README.md#quick-start),
   step 3) from PowerShell. Or point the app at an existing Ollama/API server
   on the Servers page.

To upgrade, run the newer installer. To uninstall, use **Settings → Apps →
Installed apps → arynwood-mcp**. To remove your data too, delete
`%LOCALAPPDATA%\arynwood-mcp` afterward.

## User data and services

Packaged app data is in `%LOCALAPPDATA%\arynwood-mcp`, outside the installation
directory: conversations, settings, generated content and logs survive upgrades.
That folder also holds the optional `.env`, `personas.local.json` and
`mcp_servers.json` that the Linux data directory holds (see
[installation](installation.md#where-the-app-stores-its-data)). The backend binds
to `127.0.0.1:8010`. Source checkouts keep their existing repository-local database
behavior. Desktop exit also terminates its backend and managed child processes
using a Windows Job Object.

Ollama, Qdrant, GPU tools and MusicStudio are separate services, not bundled in
the installer. Configure an existing Ollama/API server in the app or install
Ollama separately. Knowledge retrieval also requires Qdrant and embeddings.

## Windows alpha limitations

- Linux shell install commands for optional GPU tools cannot run on Windows;
  install those tools separately using their Windows instructions.
- Community's local `start.sh` lifecycle is Linux-only. Start it separately and
  set `ARYNWOOD_COMMUNITY_URL` to connect to it.
- GPU generation/training scripts, Kdenlive automation and MusicStudio providers
  need their own Windows-compatible dependencies and separate validation.
- The 0.4.5 and 0.4.6 CI builds passed the platform tests, frontend tests and the
  packaged-backend smoke test. A clean-machine install, microphone/camera capture,
  downloads and the optional external integrations have not been manually
  validated yet. Please report what you find on
  [GitHub Issues](https://github.com/Arynwood-Technology/ArynwoodMCP/issues).
- The published installer is unsigned. Signing needs a certificate configured by
  the release operator.

## Build it yourself

A local build is not the published release. Install Git, Node.js 22 or newer,
Python 3.12, Rust (the x64 MSVC toolchain), and Visual Studio 2022 Build Tools with
**Desktop development with C++** and a Windows SDK. WebView2 is needed at runtime;
the installer downloads its bootstrapper when necessary.

From PowerShell in the checkout:

```powershell
py -3.12 -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements-dev.txt pyinstaller
Push-Location frontend
npm.cmd ci
Pop-Location
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-windows.ps1
```

The script builds the backend, smoke-tests it with temporary user data, builds
the desktop installer, and writes SHA-256 checksums. Output is under
`frontend/src-tauri/target/release/bundle/nsis/`. The `Windows desktop` CI workflow
runs the same packaging script and retains artifacts without publishing a release.

The execution-policy override applies only to that PowerShell process.
For development, run `powershell -NoProfile -ExecutionPolicy Bypass -File
./start-windows.ps1` and open `http://localhost:5180`.
After packaging has created the backend sidecar, `./start-windows.ps1 -Desktop`
opens the native development window.
