//! 0ctx Desktop — local-first tray + desktop dashboard shell.
//!
//! Responsibilities:
//! - Keep connector runtime supervised in tray mode.
//! - Expose typed daemon IPC commands to frontend via Tauri invoke.
//! - Poll daemon posture and emit posture updates to the desktop UI.

use serde::Serialize;
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, RunEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_updater::UpdaterExt;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

// ── Posture state ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub enum Posture {
    Connected,
    Degraded,
    Offline,
}

impl std::fmt::Display for Posture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Posture::Connected => write!(f, "Connected"),
            Posture::Degraded => write!(f, "Degraded"),
            Posture::Offline => write!(f, "Offline"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AppState {
    pub posture: Posture,
    pub connector_version: Option<String>,
    pub daemon_session_token: Option<String>,
    pub event_subscription_id: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            posture: Posture::Offline,
            connector_version: None,
            daemon_session_token: None,
            event_subscription_id: None,
        }
    }
}

// ── Connector child process ───────────────────────────────────────────────────

struct ConnectorProcess {
    child: Option<Child>,
    restart_count: u32,
}

impl ConnectorProcess {
    fn new() -> Self {
        Self {
            child: None,
            restart_count: 0,
        }
    }
}

fn connector_bin() -> String {
    std::env::var("CTX_CONNECTOR_BIN").unwrap_or_else(|_| "0ctx".to_string())
}

#[derive(Debug, Clone)]
struct ConnectorCommand {
    program: String,
    args: Vec<String>,
    source: String,
}

fn connector_commands() -> Vec<ConnectorCommand> {
    let mut commands: Vec<ConnectorCommand> = Vec::new();
    let mut push_command = |program: String, args: Vec<String>, source: &str| {
        if commands
            .iter()
            .any(|item| item.program == program && item.args == args)
        {
            return;
        }
        commands.push(ConnectorCommand {
            program,
            args,
            source: source.to_string(),
        });
    };

    if let Ok(custom) = std::env::var("CTX_CONNECTOR_BIN") {
        if custom.to_ascii_lowercase().ends_with(".ps1") {
            push_command(
                "powershell.exe".to_string(),
                vec![
                    "-NoProfile".to_string(),
                    "-ExecutionPolicy".to_string(),
                    "Bypass".to_string(),
                    "-File".to_string(),
                    custom,
                    "connector".to_string(),
                    "run".to_string(),
                    "--quiet".to_string(),
                ],
                "CTX_CONNECTOR_BIN.ps1",
            );
        } else {
            push_command(
                custom,
                vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
                "CTX_CONNECTOR_BIN",
            );
        }
    }

    #[cfg(windows)]
    {
        if let Ok(nvm_symlink) = std::env::var("NVM_SYMLINK") {
            let candidate = PathBuf::from(nvm_symlink).join("0ctx.cmd");
            if candidate.exists() {
                push_command(
                    candidate.to_string_lossy().to_string(),
                    vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
                    "nvm-symlink",
                );
            }
        }

        if let Ok(appdata) = std::env::var("APPDATA") {
            let candidate = PathBuf::from(appdata).join("npm").join("0ctx.cmd");
            if candidate.exists() {
                push_command(
                    candidate.to_string_lossy().to_string(),
                    vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
                    "appdata-npm",
                );
            }
        }

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let candidate = PathBuf::from(program_files).join("nodejs").join("0ctx.cmd");
            if candidate.exists() {
                push_command(
                    candidate.to_string_lossy().to_string(),
                    vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
                    "programfiles-nodejs",
                );
            }
        }

        push_command(
            "0ctx.cmd".to_string(),
            vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
            "windows-cmd-shim",
        );

        push_command(
            "cmd.exe".to_string(),
            vec![
                "/C".to_string(),
                "0ctx.cmd".to_string(),
                "connector".to_string(),
                "run".to_string(),
                "--quiet".to_string(),
            ],
            "windows-cmd-shell",
        );
    }

    push_command(
        connector_bin(),
        vec!["connector".to_string(), "run".to_string(), "--quiet".to_string()],
        "default",
    );

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(repo_root) = manifest_dir.parent().and_then(|path| path.parent()) {
        let cli_entry = repo_root.join("packages").join("cli").join("dist").join("index.js");
        if cli_entry.exists() {
            push_command(
                "node".to_string(),
                vec![
                    cli_entry.to_string_lossy().to_string(),
                    "connector".to_string(),
                    "run".to_string(),
                    "--quiet".to_string(),
                ],
                "workspace-cli-dist",
            );
        }
    }

    commands
}

fn launch_connector(proc: &Arc<Mutex<ConnectorProcess>>) {
    let attempts = connector_commands();
    let mut errors: Vec<String> = Vec::new();

    for attempt in attempts {
        match std::process::Command::new(&attempt.program)
            .args(&attempt.args)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(child) => {
                let mut p = proc.lock().unwrap();
                p.child = Some(child);
                p.restart_count = 0;
                eprintln!(
                    "[0ctx-desktop] Connector launched via {} (pid: {})",
                    attempt.source,
                    p.child.as_ref().unwrap().id()
                );
                return;
            }
            Err(e) => {
                errors.push(format!(
                    "{}: {} {} ({})",
                    attempt.source,
                    attempt.program,
                    attempt.args.join(" "),
                    e
                ));
            }
        }
    }

    eprintln!("[0ctx-desktop] Failed to launch connector. Tried:");
    for line in errors {
        eprintln!("[0ctx-desktop]   - {}", line);
    }
    eprintln!(
        "[0ctx-desktop] Tip: run `npm run cli:install-local` or set CTX_CONNECTOR_BIN to a valid 0ctx executable."
    );
}

async fn monitor_connector(proc: Arc<Mutex<ConnectorProcess>>) {
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        let should_restart = {
            let mut p = proc.lock().unwrap();
            if let Some(ref mut child) = p.child {
                match child.try_wait() {
                    Ok(Some(_status)) => {
                        p.child = None;
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        p.child = None;
                        true
                    }
                }
            } else {
                true
            }
        };

        if should_restart {
            let backoff = {
                let mut p = proc.lock().unwrap();
                p.restart_count += 1;
                std::cmp::min(2u64.pow(p.restart_count), 60)
            };
            eprintln!(
                "[0ctx-desktop] Connector exited, restarting in {}s...",
                backoff
            );
            tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
            launch_connector(&proc);
        }
    }
}

// ── Daemon IPC bridge ─────────────────────────────────────────────────────────

fn daemon_socket_path() -> String {
    if let Ok(path) = std::env::var("CTX_SOCKET_PATH") {
        return path;
    }
    #[cfg(windows)]
    {
        return r"\\.\pipe\0ctx.sock".to_string();
    }
    #[cfg(unix)]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{}/.0ctx/0ctx.sock", home)
    }
}

fn home_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Ok(dir) = env::var("USERPROFILE") {
            return PathBuf::from(dir);
        }
    }
    #[cfg(unix)]
    {
        if let Ok(dir) = env::var("HOME") {
            return PathBuf::from(dir);
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn data_dir_path() -> PathBuf {
    if let Ok(dir) = env::var("CTX_DATA_DIR") {
        return PathBuf::from(dir);
    }
    home_dir().join(".0ctx")
}

fn db_path() -> String {
    env::var("CTX_DB_PATH")
        .unwrap_or_else(|_| data_dir_path().join("0ctx.db").to_string_lossy().to_string())
}

fn hook_state_path() -> String {
    env::var("CTX_HOOK_STATE_PATH")
        .unwrap_or_else(|_| data_dir_path().join("hooks-state.json").to_string_lossy().to_string())
}

#[cfg(unix)]
async fn send_ipc_line(line: &str) -> Result<String, String> {
    use tokio::net::UnixStream;

    let socket_path = daemon_socket_path();
    let stream = UnixStream::connect(&socket_path)
        .await
        .map_err(|e| format!("daemon connect failed ({socket_path}): {e}"))?;
    let (reader, mut writer) = stream.into_split();
    writer
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("daemon write failed: {e}"))?;
    let _ = writer.shutdown().await;

    let mut response = String::new();
    let mut buffered = BufReader::new(reader);
    buffered
        .read_line(&mut response)
        .await
        .map_err(|e| format!("daemon read failed: {e}"))?;
    Ok(response)
}

#[cfg(windows)]
async fn send_ipc_line(line: &str) -> Result<String, String> {
    use tokio::net::windows::named_pipe::ClientOptions;

    let pipe = daemon_socket_path();
    let mut client = ClientOptions::new()
        .open(&pipe)
        .map_err(|e| format!("daemon pipe open failed ({pipe}): {e}"))?;
    client
        .write_all(line.as_bytes())
        .await
        .map_err(|e| format!("daemon write failed: {e}"))?;
    let _ = client.shutdown().await;

    let mut response = String::new();
    let mut buffered = BufReader::new(client);
    buffered
        .read_line(&mut response)
        .await
        .map_err(|e| format!("daemon read failed: {e}"))?;
    Ok(response)
}

async fn daemon_request(
    method: &str,
    params: Value,
    session_token: Option<&str>,
) -> Result<Value, String> {
    let mut request = json!({
        "method": method,
        "params": params,
        "requestId": format!("desktop-{}-{}", method, chrono_like_now_ms()),
        "apiVersion": "2"
    });
    if let Some(token) = session_token {
        request["sessionToken"] = Value::String(token.to_string());
    }

    let line = format!(
        "{}\n",
        serde_json::to_string(&request).map_err(|e| format!("request encode failed: {e}"))?
    );
    let raw = send_ipc_line(&line).await?;
    let envelope: Value =
        serde_json::from_str(raw.trim()).map_err(|e| format!("response decode failed: {e}"))?;

    if envelope
        .get("ok")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        Ok(envelope.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("daemon_error")
            .to_string())
    }
}

async fn ensure_daemon_session(app_state: Arc<Mutex<AppState>>) -> Result<String, String> {
    if let Some(token) = app_state.lock().unwrap().daemon_session_token.clone() {
        return Ok(token);
    }
    let created = daemon_request("createSession", json!({}), None).await?;
    let token = created
        .get("sessionToken")
        .and_then(Value::as_str)
        .ok_or_else(|| "createSession returned no sessionToken".to_string())?
        .to_string();
    app_state.lock().unwrap().daemon_session_token = Some(token.clone());
    Ok(token)
}

async fn daemon_call_with_session(
    app_state: Arc<Mutex<AppState>>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    if method == "createSession" {
        return daemon_request(method, params, None).await;
    }

    let token = ensure_daemon_session(app_state.clone()).await?;
    match daemon_request(method, params.clone(), Some(&token)).await {
        Ok(value) => Ok(value),
        Err(error) => {
            if error.contains("Invalid sessionToken") {
                app_state.lock().unwrap().daemon_session_token = None;
                let retry_token = ensure_daemon_session(app_state.clone()).await?;
                daemon_request(method, params, Some(&retry_token)).await
            } else {
                Err(error)
            }
        }
    }
}

fn chrono_like_now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_posture(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> String {
    let s = state.lock().unwrap();
    s.posture.to_string()
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(format!("Update available: v{}", update.version)),
        Ok(None) => Ok("You're on the latest version.".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn restart_connector(proc_state: tauri::State<'_, Arc<Mutex<ConnectorProcess>>>) -> String {
    {
        let mut p = proc_state.lock().unwrap();
        if let Some(ref mut child) = p.child {
            let _ = child.kill();
        }
        p.child = None;
        p.restart_count = 0;
    }
    launch_connector(&proc_state);
    "Connector restarted".to_string()
}

#[tauri::command]
fn pick_workspace_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Select workspace folder")
        .blocking_pick_folder();

    let Some(file_path) = picked else {
        return Ok(None);
    };

    let path = file_path
        .into_path()
        .map_err(|error| error.to_string())?;

    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
fn open_path(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is required.".to_string());
    }

    let target = PathBuf::from(trimmed);
    if !target.exists() {
        return Err(format!("Path does not exist: {}", trimmed));
    }

    #[cfg(target_os = "windows")]
    let status = Command::new("cmd")
        .args(["/C", "start", ""])
        .arg(target.as_os_str())
        .status()
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .arg(target.as_os_str())
        .status()
        .map_err(|error| error.to_string())?;

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = Command::new("xdg-open")
        .arg(target.as_os_str())
        .status()
        .map_err(|error| error.to_string())?;

    if !status.success() {
        return Err(format!("Failed to open path: {}", trimmed));
    }

    Ok(format!("Opened {}", trimmed))
}

#[tauri::command]
async fn daemon_call(
    method: String,
    params: Option<Value>,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Value, String> {
    daemon_call_with_session(
        state.inner().clone(),
        &method,
        params.unwrap_or_else(|| json!({})),
    )
    .await
}

#[tauri::command]
async fn daemon_status(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Value, String> {
    let app_state = state.inner().clone();
    let health = daemon_call_with_session(app_state.clone(), "health", json!({})).await?;
    let contexts = daemon_call_with_session(app_state.clone(), "listContexts", json!({}))
        .await
        .unwrap_or_else(|_| json!([]));
    let capabilities = daemon_call_with_session(app_state.clone(), "getCapabilities", json!({}))
        .await
        .unwrap_or_else(|_| json!({}));

    Ok(json!({
        "health": health,
        "contexts": contexts,
        "capabilities": capabilities,
        "storage": {
            "dataDir": data_dir_path().to_string_lossy().to_string(),
            "dbPath": db_path(),
            "socketPath": daemon_socket_path(),
            "hookStatePath": hook_state_path()
        }
    }))
}

#[tauri::command]
async fn subscribe_events(
    context_id: Option<String>,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Value, String> {
    let mut params = json!({});
    if let Some(context) = context_id {
        params["contextId"] = Value::String(context);
    }
    let result = daemon_call_with_session(state.inner().clone(), "subscribeEvents", params).await?;
    if let Some(subscription) = result.get("subscriptionId").and_then(Value::as_str) {
        state.inner().lock().unwrap().event_subscription_id = Some(subscription.to_string());
    }
    Ok(result)
}

#[tauri::command]
async fn poll_events(
    subscription_id: Option<String>,
    after_sequence: Option<u64>,
    limit: Option<u32>,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Value, String> {
    let subscription = subscription_id.or_else(|| state.inner().lock().unwrap().event_subscription_id.clone());
    let Some(subscription_id) = subscription else {
        return Err("No event subscription available. Call subscribe_events first.".to_string());
    };

    let mut params = json!({ "subscriptionId": subscription_id });
    if let Some(after) = after_sequence {
        params["afterSequence"] = json!(after);
    }
    if let Some(max) = limit {
        params["limit"] = json!(max);
    }
    daemon_call_with_session(state.inner().clone(), "pollEvents", params).await
}

// ── Background posture polling ────────────────────────────────────────────────

async fn poll_health(app: AppHandle, state: Arc<Mutex<AppState>>) {
    let mut last_posture = Posture::Offline;

    loop {
        let posture = match daemon_call_with_session(state.clone(), "health", json!({})).await {
            Ok(_) => Posture::Connected,
            Err(error) => {
                if error.contains("connect") || error.contains("pipe") || error.contains("ENOENT") {
                    Posture::Offline
                } else {
                    Posture::Degraded
                }
            }
        };

        {
            let mut s = state.lock().unwrap();
            s.posture = posture.clone();
        }

        if posture != last_posture {
            let _ = app.emit("posture-changed", posture.to_string());
            last_posture = posture.clone();
        }

        let tooltip = format!("0ctx — {}", posture);
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(&tooltip));
        }
        if let Some(menu) = app.menu() {
            if let Some(item) = menu.get("health") {
                if let Some(menu_item) = item.as_menuitem() {
                    let text = format!("Status: {}", posture);
                    let _ = menu_item.set_text(&text);
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(8)).await;
    }
}

// ── Tray setup ────────────────────────────────────────────────────────────────

fn setup_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open 0ctx", true, None::<&str>)?;
    let health = MenuItem::with_id(app, "health", "Status: checking...", false, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "Restart Connector", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for Updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &health, &restart, &updates, &quit])?;

    let tray = TrayIconBuilder::with_id("main")
        .tooltip("0ctx Desktop")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "restart" => {
                if let Some(proc) = app.try_state::<Arc<Mutex<ConnectorProcess>>>() {
                    {
                        let mut p = proc.lock().unwrap();
                        if let Some(ref mut child) = p.child {
                            let _ = child.kill();
                        }
                        p.child = None;
                        p.restart_count = 0;
                    }
                    launch_connector(&proc);
                }
            }
            "updates" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = check_for_updates(handle).await;
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    Ok(tray)
}

// ── App entry ─────────────────────────────────────────────────────────────────

pub fn run() {
    let state = Arc::new(Mutex::new(AppState::default()));
    let poll_state = state.clone();
    let connector_proc = Arc::new(Mutex::new(ConnectorProcess::new()));
    let monitor_proc = connector_proc.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .manage(connector_proc.clone())
        .invoke_handler(tauri::generate_handler![
            get_posture,
            check_for_updates,
            restart_connector,
            pick_workspace_folder,
            open_path,
            daemon_call,
            daemon_status,
            subscribe_events,
            poll_events
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            setup_tray(&handle)?;
            launch_connector(&connector_proc);
            let poll_handle = handle.clone();
            tauri::async_runtime::spawn(poll_health(poll_handle, poll_state));
            tauri::async_runtime::spawn(monitor_connector(monitor_proc));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
