// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Child;
use std::sync::{Mutex, OnceLock};

// Global backend process handle for the dev-mode path (raw venv python3 -m uvicorn,
// see start_backend()) — killed on app exit.
static BACKEND: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
// Same, for the production path (PyInstaller sidecar, see start_backend_sidecar()).
// A separate static rather than reusing BACKEND's type because tauri_plugin_shell's
// CommandChild isn't a std::process::Child — exactly one of these two is ever
// populated in a given run, decided by cfg!(debug_assertions).
static SIDECAR_BACKEND: OnceLock<Mutex<Option<tauri_plugin_shell::process::CommandChild>>> = OnceLock::new();

/// Walk up from the compiled manifest dir to find the repo root.
/// Falls back to checking relative to the running executable (for packaged builds).
fn find_root() -> std::path::PathBuf {
    // Highest priority: ARYNWOOD_ROOT set by launch.sh.
    if let Ok(root) = std::env::var("ARYNWOOD_ROOT") {
        let path = std::path::PathBuf::from(root);
        if path.join("backend").join("api.py").exists() {
            println!("[arynwood] Root from ARYNWOOD_ROOT: {}", path.display());
            return path;
        }
    }

    // In dev / tauri dev: CARGO_MANIFEST_DIR = .../frontend/src-tauri
    // parent  → .../frontend
    // parent  → .../arynwood-mcp  (repo root)
    let compiled = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    if let Some(root) = compiled {
        if root.join("backend").join("api.py").exists() {
            return root;
        }
    }

    // Packaged binary: walk ancestors of the exe looking for backend/api.py
    if let Ok(exe) = std::env::current_exe() {
        for ancestor in exe.ancestors().skip(1) {
            if ancestor.join("backend").join("api.py").exists() {
                return ancestor.to_path_buf();
            }
        }
    }

    std::env::current_dir().unwrap_or_default()
}

/// Parse KEY=VALUE pairs from the repo's .env file.
fn parse_env_file(root: &std::path::Path) -> Vec<(String, String)> {
    let mut vars = Vec::new();
    let Ok(content) = std::fs::read_to_string(root.join(".env")) else {
        return vars;
    };
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let v = v.trim().trim_matches('"').trim_matches('\'');
            vars.push((k.trim().to_string(), v.to_string()));
        }
    }
    vars
}

/// Return true if something is already listening on the given port.
fn port_open(port: u16) -> bool {
    std::net::TcpStream::connect(("127.0.0.1", port)).is_ok()
}

/// Spawn the FastAPI/uvicorn backend from the live venv — dev mode only
/// (tauri dev / arynwood-desktop.sh). See start_backend_sidecar() for the
/// production-build equivalent, which uses the packaged PyInstaller binary
/// instead since there's no venv/repo checkout inside an installed app.
/// If port 8010 is already occupied the function is a no-op
/// (backend was started externally, e.g. via start.sh).
fn start_backend() {
    if port_open(8010) {
        println!("[arynwood] Backend already running on :8010 — skipping launch.");
        BACKEND.get_or_init(|| Mutex::new(None));
        return;
    }

    let root = find_root();
    println!("[arynwood] Project root: {}", root.display());

    // Prefer the venv Python; fall back to system python3.
    let python = {
        let venv_py = if cfg!(windows) {
            root.join("venv").join("Scripts").join("python.exe")
        } else {
            root.join("venv").join("bin").join("python3")
        };
        if venv_py.exists() {
            venv_py.to_string_lossy().to_string()
        } else {
            eprintln!("[arynwood] venv not found at {:?}, falling back to system python3", venv_py);
            "python3".to_string()
        }
    };

    let env_vars = parse_env_file(&root);

    let mut cmd = std::process::Command::new(&python);
    cmd.args([
        "-m", "uvicorn", "backend.api:app",
        "--host", "127.0.0.1",
        "--port", "8010",
    ])
    .current_dir(&root);

    // In release builds, suppress backend stdout/stderr.
    #[cfg(not(debug_assertions))]
    {
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());
    }

    for (k, v) in &env_vars {
        cmd.env(k, v);
    }

    match cmd.spawn() {
        Ok(child) => {
            println!("[arynwood] Backend started (pid {})", child.id());
            BACKEND.get_or_init(|| Mutex::new(Some(child)));
        }
        Err(e) => {
            eprintln!("[arynwood] Failed to start backend: {e}");
            BACKEND.get_or_init(|| Mutex::new(None));
            return;
        }
    }

    // Poll until the backend accepts connections (max ~15 s).
    println!("[arynwood] Waiting for backend on :8010…");
    for i in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if port_open(8010) {
            println!("[arynwood] Backend ready after ~{}ms", (i + 1) * 500);
            return;
        }
    }
    eprintln!("[arynwood] Backend did not respond within 15 s — opening window anyway.");
}

/// Spawn the packaged backend — production builds only (`tauri build`'s AppImage/
/// .deb output). Unlike start_backend(), there's no venv or repo checkout inside an
/// installed app to invoke `python3 -m uvicorn` against, so this runs the
/// PyInstaller-bundled binary registered as a Tauri sidecar (see tauri.conf.json's
/// `bundle.externalBin` and arynwood-backend.spec at the repo root) instead. Must be
/// called from inside `.setup()` — sidecar spawning needs an AppHandle, which
/// doesn't exist yet in `main()` before `tauri::Builder` runs.
fn start_backend_sidecar(app: &tauri::AppHandle) {
    use tauri_plugin_shell::ShellExt;

    if port_open(8010) {
        println!("[arynwood] Backend already running on :8010 — skipping sidecar launch.");
        SIDECAR_BACKEND.get_or_init(|| Mutex::new(None));
        return;
    }

    let sidecar = match app.shell().sidecar("arynwood-backend") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[arynwood] Failed to resolve backend sidecar: {e}");
            SIDECAR_BACKEND.get_or_init(|| Mutex::new(None));
            return;
        }
    };

    match sidecar.spawn() {
        Ok((mut rx, child)) => {
            println!("[arynwood] Backend sidecar started (pid {})", child.pid());
            SIDECAR_BACKEND.get_or_init(|| Mutex::new(Some(child)));
            // Drain stdout/stderr to a log file — a prior version of this just threw
            // the output away entirely, which meant a real sidecar-side failure (e.g.
            // an unhandled exception, a startup error) was completely invisible: the
            // window would open, but any feature depending on that failed request
            // would just look empty with no way to tell why. /tmp/arynwood-sidecar.log
            // matches the naming pattern the other launch scripts already use for
            // their own logs.
            tauri::async_runtime::spawn(async move {
                use std::io::Write;
                use tauri_plugin_shell::process::CommandEvent;
                let log_path = std::env::temp_dir().join("arynwood-sidecar.log");
                let mut log = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                    .ok();
                while let Some(event) = rx.recv().await {
                    if let Some(f) = log.as_mut() {
                        let line = match &event {
                            CommandEvent::Stdout(bytes) => Some(bytes.clone()),
                            CommandEvent::Stderr(bytes) => Some(bytes.clone()),
                            CommandEvent::Error(msg) => Some(format!("[error] {msg}\n").into_bytes()),
                            CommandEvent::Terminated(payload) => {
                                Some(format!("[terminated] {:?}\n", payload).into_bytes())
                            }
                            _ => None,
                        };
                        if let Some(bytes) = line {
                            let _ = f.write_all(&bytes);
                            let _ = f.flush();
                        }
                    }
                }
            });
        }
        Err(e) => {
            eprintln!("[arynwood] Failed to start backend sidecar: {e}");
            SIDECAR_BACKEND.get_or_init(|| Mutex::new(None));
            return;
        }
    }

    println!("[arynwood] Waiting for backend sidecar on :8010…");
    for i in 0..30 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if port_open(8010) {
            println!("[arynwood] Backend sidecar ready after ~{}ms", (i + 1) * 500);
            return;
        }
    }
    eprintln!("[arynwood] Backend sidecar did not respond within 15 s — opening window anyway.");
}

fn kill_backend() {
    if let Some(lock) = BACKEND.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(mut child) = guard.take() {
                println!("[arynwood] Killing backend process…");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
    if let Some(lock) = SIDECAR_BACKEND.get() {
        if let Ok(mut guard) = lock.lock() {
            if let Some(child) = guard.take() {
                println!("[arynwood] Killing backend sidecar…");
                let _ = child.kill();
            }
        }
    }
}

/// WebKitGTK has no built-in permission-prompt UI: by default it silently
/// denies every getUserMedia() call, which surfaces in the frontend as
/// `NotAllowedError` with no prompt ever shown. This is a single-user local
/// desktop app that only ever loads its own bundled frontend, so we auto-grant
/// mic/camera requests (needed by the Studio recorder) instead of leaving
/// recording permanently broken in the desktop build. Everything else
/// (geolocation, notifications, clipboard, etc.) still falls through to
/// WebKitGTK's default deny.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
fn allow_media_permissions(window: &tauri::WebviewWindow) {
    use webkit2gtk::{PermissionRequestExt, WebViewExt};
    use webkit2gtk::glib::prelude::*;

    let result = window.with_webview(|platform_webview| {
        let webview = platform_webview.inner();
        webview.connect_permission_request(|_webview, request| {
            if request.is::<webkit2gtk::UserMediaPermissionRequest>() {
                request.allow();
                true
            } else {
                false
            }
        });
    });
    if let Err(e) = result {
        eprintln!("[arynwood] Could not hook media permission handler: {e}");
    }
}

fn main() {
    // WebKitGTK's DMA-BUF renderer produces a blank/gray window on a real chunk of
    // Linux GPU+driver combinations (a well-known upstream WebKitGTK issue, not
    // something wrong with this app's own code) — confirmed happening on a real
    // installed packaged build, not just in theory. arynwood-desktop.sh already set
    // WEBKIT_DISABLE_DMABUF_RENDERER=1 as a shell wrapper for `tauri dev`, but that
    // only helped when launched through that exact script — anyone opening the
    // installed AppImage/.deb from their app menu or desktop icon got no such
    // protection. Set it here instead, unconditionally, so every launch path gets it
    // regardless of how the binary is started. Must happen before the webview is
    // created (WebKitGTK reads this at its own init time, not at process start), so
    // this has to run before tauri::Builder below, not just before start_backend().
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Dev builds (tauri dev / arynwood-desktop.sh) use the live venv; production
    // builds (tauri build's AppImage/.deb) use the packaged sidecar instead, spawned
    // below from inside .setup() once an AppHandle exists.
    if cfg!(debug_assertions) {
        start_backend();
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            use tauri::webview::{DownloadEvent, WebviewWindowBuilder};
            use tauri_plugin_notification::NotificationExt;

            if !cfg!(debug_assertions) {
                start_backend_sidecar(&app.handle().clone());
            }

            // Neither WebKitGTK nor WebView2 has a built-in download UI like a real
            // browser — without an explicit handler, clicking a download link (e.g. the
            // Design Center's LoRA output files) just does nothing, silently. The main
            // window's `create` is set to `false` in tauri.conf.json so we can build it
            // here ourselves with `on_download` wired up, saving into the OS Downloads dir.
            let window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("no window defined in tauri.conf.json");
            #[allow(unused_variables)]
            let window = WebviewWindowBuilder::from_config(app.handle(), &window_config)?
                .on_download(move |webview, event| {
                    match event {
                        // `destination` arrives already pointing into the Downloads folder, named the
                        // way WebKit suggests (the `download` attribute or Content-Disposition) and
                        // de-duplicated. Don't override it: deriving a name from the URL's last path
                        // segment turned a `blob:` download into "<uuid>" with no extension, and a
                        // backend file into "audio".
                        DownloadEvent::Requested { .. } => {}
                        // Native webviews have no download shelf/toast of their own, so
                        // without this the file lands in Downloads with zero visible feedback.
                        DownloadEvent::Finished { path, success, .. } => {
                            let name = path
                                .as_deref()
                                .and_then(|p| p.file_name())
                                .map(|n| n.to_string_lossy().into_owned())
                                .unwrap_or_else(|| "file".to_string());
                            let body = if success {
                                format!("{name} saved to Downloads")
                            } else {
                                format!("{name} failed to download")
                            };
                            let _ = webview
                                .notification()
                                .builder()
                                .title("Arynwood MCP")
                                .body(body)
                                .show();
                        }
                        _ => {}
                    }
                    true
                })
                .build()?;

            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "netbsd",
                target_os = "openbsd"
            ))]
            allow_media_permissions(&window);

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Arynwood MCP")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                kill_backend();
            }
        });
}
