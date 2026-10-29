//! Non-secret settings, stored as JSON in the app config directory.
//! Tokens never go here; they live in the OS keychain (see store.rs).
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const DEFAULT_SERVER: &str = "https://skywalker.example.org";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    pub server_url: String,
    /// "dark", "light" or "system".
    pub theme: String,
    /// Minutes between automatic refreshes of the open page (min 1, max 60).
    pub refresh_minutes: u32,
    /// Dynamic client id from /register. Public, not a secret.
    pub client_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: DEFAULT_SERVER.into(),
            theme: "dark".into(),
            refresh_minutes: 5,
            client_id: None,
        }
    }
}

impl Settings {
    /// Clamp and validate. The server must be https, or http on loopback for tests.
    pub fn normalized(mut self) -> Result<Self, AppError> {
        let url = self.server_url.trim().trim_end_matches('/').to_string();
        let parsed = url::Url::parse(&url)
            .map_err(|_| AppError::new("invalid", "Server URL is not a valid URL."))?;
        let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
        if !(parsed.scheme() == "https" || (parsed.scheme() == "http" && loopback)) {
            return Err(AppError::new("invalid", "Server URL must use https."));
        }
        self.server_url = url;
        self.theme = match self.theme.as_str() {
            "light" | "system" => self.theme.clone(),
            _ => "dark".into(),
        };
        self.refresh_minutes = self.refresh_minutes.clamp(5, 60);
        Ok(self)
    }
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Settings>(&s).ok())
        .and_then(|s| s.normalized().ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, s: &Settings) -> Result<(), AppError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| AppError::new("io", e.to_string()))?;
    }
    let text = serde_json::to_string_pretty(s).map_err(|e| AppError::new("io", e.to_string()))?;
    std::fs::write(path, text).map_err(|e| AppError::new("io", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_point_at_skywalker() {
        let s = Settings::default();
        assert_eq!(s.server_url, DEFAULT_SERVER);
        assert_eq!(s.refresh_minutes, 5);
    }

    #[test]
    fn rejects_plain_http_remote() {
        let mut s = Settings::default();
        s.server_url = "http://example.com".into();
        assert!(s.normalized().is_err());
    }

    #[test]
    fn allows_loopback_http_and_clamps() {
        let mut s = Settings::default();
        s.server_url = "http://127.0.0.1:8080/".into();
        s.refresh_minutes = 0;
        s.theme = "neon".into();
        let n = s.normalized().unwrap();
        assert_eq!(n.server_url, "http://127.0.0.1:8080");
        assert_eq!(n.refresh_minutes, 5);
        assert_eq!(n.theme, "dark");
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = std::env::temp_dir().join(format!("tele-set-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("settings.json");
        std::fs::write(&p, "{not json").unwrap();
        assert_eq!(load(&p), Settings::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
