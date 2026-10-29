//! Telescope: a read-only viewer for the Ursa Major Google Cloud projects,
//! powered by the Skywalker MCP server. See PLAN.md and DECISIONS.md.

pub mod cache;
pub mod client;
pub mod commands;
pub mod error;
pub mod mcp;
pub mod oauth;
pub mod settings;
pub mod store;

use client::Client;
use commands::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let path = dir.join("settings.json");
            let settings = settings::load(&path);
            let client = Client::new(settings, path.clone()).map_err(|e| e.to_string())?;
            let state = AppState {
                client,
                settings_path: path,
                pending: std::sync::Mutex::new(None),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_status,
            commands::begin_sign_in,
            commands::sign_in,
            commands::sign_out,
            commands::save_settings,
            commands::list_tools,
            commands::call_tool,
            commands::clear_cache,
            commands::app_dirs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Telescope");
}
