# Windows desktop (0.4.5)

The Windows x64 build uses Tauri/WebView2 with a bundled Python backend. Build
the per-user NSIS installer using the instructions below. A local build is not
a published or signed release.

## Build prerequisites

Install Git, Node.js 22 or newer, Python 3.12, Rust (the x64 MSVC toolchain), and
Visual Studio 2022 Build Tools with **Desktop development with C++** and a
Windows SDK. WebView2 is needed at runtime; the installer downloads its
bootstrapper when necessary.

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
`frontend/src-tauri/target/release/bundle/nsis/`. The Windows CI workflow runs
the same packaging script and retains artifacts without publishing a release.

The execution-policy override applies only to that PowerShell process.
For development, run `powershell -NoProfile -ExecutionPolicy Bypass -File
./start-windows.ps1` and open `http://localhost:5180`.
After packaging has created the backend sidecar, `./start-windows.ps1 -Desktop`
opens the native development window.

## User data and services

Packaged app data is in `%LOCALAPPDATA%\arynwood-mcp`, outside the installation
directory: conversations, settings, generated content and logs survive upgrades.
The backend binds to `127.0.0.1:8010`. Source checkouts keep their existing
repository-local database behavior. Desktop exit also terminates its backend
and managed child processes using a Windows Job Object.

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
- Microphone/camera capture, downloads, optional external integrations and a
  clean-machine install should be manually checked before publishing 0.4.5.
- The installer is unsigned unless a release operator configures signing.
