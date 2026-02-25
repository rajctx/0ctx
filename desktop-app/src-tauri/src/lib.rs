//! 0ctx Desktop — Tauri v2 system tray companion.
//!
//! Features:
//! - System tray with status icons and context menu
//! - Health polling against local connector daemon
//! - Auto-update via Tauri updater plugin
//! - Connector service launch and management
//! - Dynamic tray tooltip and posture events to webview

use serde::Serialize;
use std::process::Child;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager, RunEvent,
};

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
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            posture: Posture::Offline,
            connector_version: None,
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

/// Resolve the connector binary path.
/// Checks CTX_CONNECTOR_BIN env var, then looks for `0ctx` in PATH.
fn connector_bin() -> String {
    std::env::var("CTX_CONNECTOR_BIN").unwrap_or_else(|_| "0ctx".to_string())
}

/// Launch the connector service as a child process.
fn launch_connector(proc: &Arc<Mutex<ConnectorProcess>>) {
    let bin = connector_bin();
    match std::process::Command::new(&bin)
        .args(["connector", "run", "--quiet"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
    {
        Ok(child) => {
            let mut p = proc.lock().unwrap();
            p.child = Some(child);
            p.restart_count = 0;
            eprintln!("[0ctx-desktop] Connector launched (pid: {})", p.child.as_ref().unwrap().id());
        }
        Err(e) => {
            eprintln!("[0ctx-desktop] Failed to launch connector: {}", e);
        }
    }
}

/// Monitor the connector child process and restart with exponential backoff.
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
                    Ok(None) => false, // Still running
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
                let secs = std::cmp::min(2u64.pow(p.restart_count), 60);
                secs
            };
            eprintln!("[0ctx-desktop] Connector exited, restarting in {}s...", backoff);
            tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
            launch_connector(&proc);
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_posture(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> String {
    let s = state.lock().unwrap();
    s.posture.to_string()
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<String, String> {
    let updater = app
        .updater_builder()
        .build()
        .map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(format!("Update available: v{}", update.version)),
        Ok(None) => Ok("You're on the latest version.".to_string()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn restart_connector(proc_state: tauri::State<'_, Arc<Mutex<ConnectorProcess>>>) -> String {
    // Kill existing if running
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

// ── Health polling ────────────────────────────────────────────────────────────

async fn poll_health(app: AppHandle, state: Arc<Mutex<AppState>>) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let daemon_url = std::env::var("CTX_DAEMON_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4005".to_string());

    let mut last_posture = Posture::Offline;

    loop {
        let posture = match client.get(format!("{}/health", daemon_url)).send().await {
            Ok(resp) if resp.status().is_success() => Posture::Connected,
            Ok(_) => Posture::Degraded,
            Err(_) => Posture::Offline,
        };

        // Update state
        {
            let mut s = state.lock().unwrap();
            s.posture = posture.clone();
        }

        // Emit posture-changed event to webview if changed
        if posture != last_posture {
            let _ = app.emit("posture-changed", posture.to_string());
            last_posture = posture.clone();
        }

        // Update tray tooltip and health menu item
        let tooltip = format!("0ctx — {}", posture);
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(&tooltip));
        }
        // Update health menu item text
        if let Some(menu) = app.menu() {
            if let Some(item) = menu.get("health") {
                if let Some(menu_item) = item.as_menuitem() {
                    let text = format!("Status: {}", posture);
                    let _ = menu_item.set_text(&text);
                }
            }
        }

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
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

    let tray = TrayIconBuilder::with_id("main", "0ctx")
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
                    // Kill and relaunch
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
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .manage(connector_proc.clone())
        .invoke_handler(tauri::generate_handler![get_posture, check_for_updates, restart_connector])
        .setup(move |app| {
            let handle = app.handle().clone();
            setup_tray(&handle)?;

            // Launch connector service
            launch_connector(&connector_proc);

            // Start health polling in background (now with app handle for events)
            let poll_handle = handle.clone();
            tauri::async_runtime::spawn(poll_health(poll_handle, poll_state));

            // Monitor connector child process for restarts
            tauri::async_runtime::spawn(monitor_connector(monitor_proc));

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error building tauri application")
        .run(|_app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                // Keep running in tray when window is closed
                api.prevent_exit();
            }
        });
}
