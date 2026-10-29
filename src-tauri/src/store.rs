//! Token storage in the OS keychain (macOS Keychain, Windows Credential Manager).
//! One entry holds the JSON for the current sign-in. Nothing else touches disk.
use crate::error::AppError;
use crate::oauth::Tokens;

const SERVICE: &str = "com.ucr.telescope";
const ACCOUNT: &str = "skywalker-tokens";

fn entry() -> Result<keyring::Entry, AppError> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| AppError::new("keychain", format!("keychain unavailable: {e}")))
}

pub fn load() -> Result<Option<Tokens>, AppError> {
    match entry()?.get_password() {
        Ok(text) => serde_json::from_str(&text)
            .map(Some)
            .map_err(|e| AppError::new("keychain", format!("stored tokens unreadable: {e}"))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}

pub fn save(t: &Tokens) -> Result<(), AppError> {
    let text = serde_json::to_string(t).map_err(|e| AppError::new("keychain", e.to_string()))?;
    entry()?
        .set_password(&text)
        .map_err(|e| AppError::new("keychain", e.to_string()))
}

pub fn delete() -> Result<(), AppError> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::new("keychain", e.to_string())),
    }
}
