//! 0ctx Desktop — Tauri v2 system tray companion.
//!
//! Features:
//! - System tray with status icons and context menu
//! - Health polling against local connector daemon
//! - Auto-update via Tauri updater plugin
//! - Launches webview to the hosted 0ctx UI

use serde::Serialize;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Manager, RunEvent,
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

// ── Health polling ────────────────────────────────────────────────────────────

async fn poll_health(state: Arc<Mutex<AppState>>) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    let daemon_url = std::env::var("CTX_DAEMON_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:4005".to_string());

    loop {
        let posture = match client.get(format!("{}/health", daemon_url)).send().await {
            Ok(resp) if resp.status().is_success() => Posture::Connected,
            Ok(_) => Posture::Degraded,
            Err(_) => Posture::Offline,
        };

        {
            let mut s = state.lock().unwrap();
            s.posture = posture;
        }

        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
    }
}

// ── Tray setup ────────────────────────────────────────────────────────────────

fn setup_tray(app: &AppHandle) -> Result<TrayIcon, Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open 0ctx", true, None::<&str>)?;
    let health = MenuItem::with_id(app, "health", "Status: checking...", false, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for Updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show, &health, &updates, &quit])?;

    let tray = TrayIconBuilder::new()
        .tooltip("0ctx Desktop")
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(state)
        .invoke_handler(tauri::generate_handler![get_posture, check_for_updates])
        .setup(|app| {
            let handle = app.handle().clone();
            setup_tray(&handle)?;

            // Start health polling in background
            tauri::async_runtime::spawn(poll_health(poll_state));

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
