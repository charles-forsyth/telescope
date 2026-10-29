//! Tauri commands: the only surface the web UI can reach. Read-only by design:
//! every command either reads Skywalker or changes local settings and sign-in.
use crate::client::{CallResult, Client};
use crate::error::AppError;
use crate::settings::{self, Settings};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub client: Client,
    pub settings_path: PathBuf,
    /// One-shot nonce minted by `begin_sign_in` (a button click). `sign_in` needs it,
    /// so a stray call can never open the browser on its own.
    pub pending: std::sync::Mutex<Option<(String, std::time::Instant)>>,
}

#[derive(Serialize)]
pub struct StatusOut {
    pub signed_in: bool,
    pub email: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub server_url: String,
    pub settings: Settings,
    pub build: &'static str,
}

fn build_kind() -> &'static str {
    if cfg!(feature = "demo") {
        "demo"
    } else {
        "release"
    }
}

/// `app_status` reads the Keychain only when no token is in memory. Pure, so the decision
/// is tested without touching the real Keychain. It never authorizes: it only reads.
pub fn should_load_at_startup(signed_in_in_memory: bool) -> bool {
    !signed_in_in_memory
}

#[tauri::command]
pub async fn app_status(state: State<'_, AppState>) -> Result<StatusOut, AppError> {
    // A launch with a stored token must show "signed in", not invite a new Google grant.
    // This is a local Keychain read: no network, no authorize, no browser.
    if should_load_at_startup(state.client.status().await.signed_in) {
        let _ = state.client.load_tokens().await;
    }
    let st = state.client.status().await;
    Ok(StatusOut {
        signed_in: st.signed_in,
        email: st.email,
        scope: st.scope,
        expires_at: st.expires_at,
        server_url: st.server_url,
        settings: state.client.settings().await,
        build: build_kind(),
    })
}

#[tauri::command]
pub async fn begin_sign_in(state: State<'_, AppState>) -> Result<String, AppError> {
    let nonce = crate::oauth::random_urlsafe(16);
    *state.pending.lock().unwrap() = Some((nonce.clone(), std::time::Instant::now()));
    Ok(nonce)
}

#[tauri::command]
pub async fn sign_in(app: AppHandle, state: State<'_, AppState>, nonce: String) -> Result<StatusOut, AppError> {
    // Audit: every browser sign-in is logged with a timestamp (SIGN-IN-NEEDED.txt).
    audit_line(&app, "sign_in invoked");
    let ok = {
        let mut g = state.pending.lock().unwrap();
        nonce_ok(&mut g, &nonce, std::time::Instant::now())
    };
    // The window must be focused: a press can't come from a window the user isn't using.
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);
    if !focused {
        audit_line(&app, "sign_in refused: window not focused");
        return Err(AppError::new("refused", "Sign-in starts only from the Sign in button."));
    }
    if !ok {
        audit_line(&app, "sign_in refused: no user gesture");
        return Err(AppError::new("refused", "Sign-in starts only from the Sign in button."));
    }
    state.client.load_tokens().await.ok();
    let handle = app.clone();
    state
        .client
        .sign_in(move |url| {
            handle
                .opener()
                .open_url(url, None::<&str>)
                .map_err(|e| AppError::new("browser", format!("could not open the browser: {e}")))
        })
        .await?;
    app_status(state).await
}

/// The sign-in nonce gate: single use, must match, and must be between
/// NONCE_MIN_AGE and NONCE_TTL old. The minimum age means `begin_sign_in` and
/// `sign_in` can't be fired back to back by one stray event: the UI mints the
/// nonce on the first click (Sign in) and spends it on a second, separate click
/// (Open browser).
pub const NONCE_MIN_AGE: std::time::Duration = std::time::Duration::from_millis(300);
pub const NONCE_TTL: std::time::Duration = std::time::Duration::from_secs(60);

pub fn nonce_ok(
    pending: &mut Option<(String, std::time::Instant)>,
    nonce: &str,
    now: std::time::Instant,
) -> bool {
    match pending.take() {
        Some((n, at)) => {
            let age = now.saturating_duration_since(at);
            n == nonce && age >= NONCE_MIN_AGE && age < NONCE_TTL
        }
        None => false,
    }
}

/// Append one line to <app config dir>/audit.log. Never contains tokens.
pub fn audit_line(app: &AppHandle, what: &str) {
    if let Ok(dir) = app.path().app_config_dir() {
        let _ = std::fs::create_dir_all(&dir);
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("audit.log")) {
            let _ = writeln!(f, "{} {}", chrono::Utc::now().to_rfc3339(), what);
        }
    }
}

#[tauri::command]
pub async fn sign_out(state: State<'_, AppState>) -> Result<Option<String>, AppError> {
    state.client.sign_out().await
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, AppError> {
    let n = settings.normalized()?;
    // The registered client id is not a user setting: keep it for the same server,
    // drop it when the server changes (a new server needs its own registration).
    let old = state.client.settings().await;
    let merged = crate::client::settings_for_new_url(&old, n);
    settings::save(&state.settings_path, &merged)?;
    state.client.set_settings(merged.clone()).await?;
    Ok(merged)
}

#[tauri::command]
pub async fn list_tools(state: State<'_, AppState>) -> Result<Value, AppError> {
    state.client.list_tools().await
}

/// Call any Skywalker tool. `max_age_secs` lets the UI reuse a cached answer.
#[tauri::command]
pub async fn call_tool(
    state: State<'_, AppState>,
    name: String,
    args: Option<Value>,
    max_age_secs: Option<i64>,
) -> Result<CallResult, AppError> {
    if !name.starts_with("skywalker_") || name.len() > 64 {
        return Err(AppError::new("invalid", "unknown tool"));
    }
    let max_age_ms = max_age_secs.map(|s| s.saturating_mul(1000));
    state
        .client
        .call_tool(
            &name,
            args.unwrap_or_else(|| serde_json::json!({})),
            max_age_ms,
        )
        .await
}

#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Result<(), AppError> {
    state.client.clear_cache().await;
    Ok(())
}

#[tauri::command]
pub fn app_dirs(app: AppHandle) -> Result<String, AppError> {
    app.path()
        .app_config_dir()
        .map(|p| p.display().to_string())
        .map_err(|e| AppError::new("io", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{nonce_ok, NONCE_MIN_AGE, NONCE_TTL};
    use std::time::{Duration, Instant};

    fn at(age: Duration) -> (Instant, Instant) {
        let now = Instant::now() + Duration::from_secs(600);
        (now - age, now)
    }

    #[test]
    fn startup_reads_the_keychain_only_when_nothing_is_in_memory() {
        // A stored token must be found at launch (no "Sign in" for a signed-in user).
        assert!(super::should_load_at_startup(false));
        // Once a token is in memory, startup never re-reads or re-authorizes.
        assert!(!super::should_load_at_startup(true));
    }

    #[test]
    fn sign_in_without_a_click_is_refused() {
        let mut none: Option<(String, Instant)> = None;
        assert!(!nonce_ok(&mut none, "anything", Instant::now()));
    }

    #[test]
    fn nonce_is_single_use_and_must_match() {
        let (minted, now) = at(Duration::from_secs(1));
        let mut p = Some(("abc".to_string(), minted));
        assert!(!nonce_ok(&mut p, "wrong", now));
        assert!(!nonce_ok(&mut p, "abc", now)); // the failed attempt consumed it
    }

    #[test]
    fn stale_nonce_is_refused() {
        let (minted, now) = at(NONCE_TTL + Duration::from_secs(1));
        let mut p = Some(("abc".to_string(), minted));
        assert!(!nonce_ok(&mut p, "abc", now));
    }

    #[test]
    fn back_to_back_begin_and_sign_in_is_refused() {
        // One stray event can't mint and spend the nonce in the same instant.
        let (minted, now) = at(Duration::from_millis(5));
        let mut p = Some(("abc".to_string(), minted));
        assert!(!nonce_ok(&mut p, "abc", now));
    }

    #[test]
    fn deliberate_second_click_is_accepted_once() {
        let (minted, now) = at(NONCE_MIN_AGE + Duration::from_millis(200));
        let mut p = Some(("abc".to_string(), minted));
        assert!(nonce_ok(&mut p, "abc", now));
        assert!(!nonce_ok(&mut p, "abc", now));
    }
}
