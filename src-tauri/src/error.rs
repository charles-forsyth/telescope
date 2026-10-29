use serde::Serialize;

/// Errors shown to the user. `kind` is a stable token the UI switches on.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct AppError {
    pub kind: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry_after: Option<u64>,
}

impl AppError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
            retry_after: None,
        }
    }
    pub fn not_signed_in() -> Self {
        Self::new(
            "not_signed_in",
            "Not signed in. Sign in with your Google account.",
        )
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::new("timeout", "Skywalker did not answer in time.")
        } else {
            Self::new(
                "network",
                format!("Cannot reach Skywalker: {}", e.without_url()),
            )
        }
    }
}
