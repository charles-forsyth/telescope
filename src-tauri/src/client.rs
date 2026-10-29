//! The Skywalker client: sign-in (loopback PKCE), token refresh, MCP session,
//! cached tool calls, at most three calls in flight, and 429 backoff.
use crate::cache::{self, Cache};
use crate::error::AppError;
use crate::mcp::{self, notification, request, result_of, tool_output};
use crate::oauth::{self, Discovery, Registration, TokenResponse, Tokens};
use crate::settings::Settings;
use crate::store;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, Semaphore};

pub const MAX_CONCURRENT: usize = 3;
const MIN_BACKOFF: u64 = 30;
const MAX_BACKOFF: u64 = 300;
const SIGNIN_TIMEOUT: Duration = Duration::from_secs(300);

pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Client {
    http: reqwest::Client,
    settings: Mutex<Settings>,
    settings_path: std::path::PathBuf,
    tokens: Mutex<Option<Tokens>>,
    cache: Mutex<Cache>,
    /// Limits in-flight Skywalker calls to MAX_CONCURRENT.
    gate: Arc<Semaphore>,
    /// Set after a 429: calls fail fast until this instant.
    backoff: Mutex<Option<(Instant, u64)>>,
    /// Consecutive 429s, for exponential backoff.
    strikes: Mutex<u32>,
    session_id: Mutex<Option<String>>,
    next_id: Mutex<u64>,
    initialized: Mutex<bool>,
    /// Serializes refresh so two calls cannot rotate the refresh token twice.
    refresh_lock: Mutex<()>,
}

pub struct Status {
    pub signed_in: bool,
    pub email: Option<String>,
    pub scope: Option<String>,
    pub expires_at: Option<i64>,
    pub server_url: String,
}

impl Client {
    pub fn new(settings: Settings, settings_path: std::path::PathBuf) -> Result<Self, AppError> {
        Ok(Self {
            http: mcp::http_client()?,
            settings: Mutex::new(settings),
            settings_path,
            tokens: Mutex::new(None),
            cache: Mutex::new(Cache::default()),
            gate: Arc::new(Semaphore::new(MAX_CONCURRENT)),
            backoff: Mutex::new(None),
            strikes: Mutex::new(0),
            session_id: Mutex::new(None),
            next_id: Mutex::new(1),
            initialized: Mutex::new(false),
            refresh_lock: Mutex::new(()),
        })
    }

    pub async fn settings(&self) -> Settings {
        self.settings.lock().await.clone()
    }

    /// Replace settings. A changed server URL signs out locally first, so server A's
    /// token is never sent to server B. The registered client id is server-specific
    /// too, so it is dropped with the change (see `settings_for_new_url`).
    pub async fn set_settings(&self, s: Settings) -> Result<(), AppError> {
        let old_url = self.settings.lock().await.server_url.clone();
        if url_changed(&old_url, &s.server_url) {
            self.forget_local().await?;
        }
        *self.settings.lock().await = s;
        Ok(())
    }

    pub async fn load_tokens(&self) -> Result<(), AppError> {
        let t = store::load()?;
        *self.tokens.lock().await = t;
        Ok(())
    }

    pub async fn status(&self) -> Status {
        let s = self.settings.lock().await.clone();
        let t = self.tokens.lock().await.clone();
        Status {
            signed_in: t.is_some(),
            email: t.as_ref().and_then(|t| t.email.clone()),
            scope: t.as_ref().and_then(|t| t.scope.clone()),
            expires_at: t.as_ref().map(|t| t.expires_at),
            server_url: s.server_url,
        }
    }

    async fn base(&self) -> String {
        self.settings.lock().await.server_url.clone()
    }

    fn check_backoff(&self, b: &Option<(Instant, u64)>) -> Result<(), AppError> {
        if let Some((until, _)) = b {
            let now = Instant::now();
            if now < *until {
                let left = (*until - now).as_secs().max(1);
                let mut e = AppError::new(
                    "rate_limited",
                    format!("Skywalker asked us to slow down. Retrying in {left}s."),
                );
                e.retry_after = Some(left);
                return Err(e);
            }
        }
        Ok(())
    }

    // ---- OAuth -----------------------------------------------------------------

    async fn discovery(&self) -> Result<Discovery, AppError> {
        let url = format!(
            "{}/.well-known/oauth-authorization-server",
            self.base().await
        );
        let r = self.http.get(&url).send().await?;
        if !r.status().is_success() {
            return Err(AppError::new(
                "network",
                format!("discovery failed: HTTP {}", r.status()),
            ));
        }
        r.json::<Discovery>()
            .await
            .map_err(|e| AppError::new("protocol", format!("bad discovery document: {e}")))
    }

    /// Sign in: loopback listener, system browser, code exchange, keychain save.
    /// `open_url` opens the browser (the Tauri layer passes the opener).
    pub async fn sign_in<F>(&self, open_url: F) -> Result<Status, AppError>
    where
        F: FnOnce(&str) -> Result<(), AppError>,
    {
        let disc = self.discovery().await?;
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| AppError::new("io", format!("cannot open a local port: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| AppError::new("io", e.to_string()))?
            .port();
        let redirect = format!("http://127.0.0.1:{port}/callback");

        let client_id = self.ensure_client(&disc, &redirect).await?;
        let pkce = oauth::pkce();
        let state = oauth::random_urlsafe(24);
        let url = oauth::authorize_url(&disc, &client_id, &redirect, &pkce, &state)?;
        open_url(&url)?;

        let code = tokio::time::timeout(SIGNIN_TIMEOUT, wait_for_code(listener, &state))
            .await
            .map_err(|_| {
                AppError::new("timeout", "Sign-in was not finished within 5 minutes.")
            })??;

        let form = oauth::exchange_form(&code, &pkce.verifier, &redirect, &client_id);
        let reply = self.post_form(&disc.token_endpoint, &form).await?;
        let mut tokens = oauth::tokens_from_response(reply, now_secs(), None)?;
        tokens.email = self.whoami_email(&tokens.access_token).await.ok();
        store::save(&tokens)?;
        *self.tokens.lock().await = Some(tokens);
        *self.initialized.lock().await = false;
        self.cache.lock().await.clear();
        Ok(self.status().await)
    }

    async fn ensure_client(&self, disc: &Discovery, redirect: &str) -> Result<String, AppError> {
        if let Some(id) = self.settings.lock().await.client_id.clone() {
            return Ok(id);
        }
        let reg_url = disc
            .registration_endpoint
            .clone()
            .ok_or_else(|| AppError::new("oauth", "server does not allow client registration"))?;
        let body = json!({
            "client_name": "Telescope",
            "redirect_uris": [redirect],
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "none",
        });
        let r = self.http.post(&reg_url).json(&body).send().await?;
        if !r.status().is_success() {
            return Err(AppError::new(
                "oauth",
                format!("client registration failed: HTTP {}", r.status()),
            ));
        }
        let reg: Registration = r
            .json()
            .await
            .map_err(|e| AppError::new("protocol", format!("bad registration reply: {e}")))?;
        let snapshot = {
            let mut s = self.settings.lock().await;
            s.client_id = Some(reg.client_id.clone());
            s.clone()
        };
        crate::settings::save(&self.settings_path, &snapshot)?;
        Ok(reg.client_id)
    }

    async fn post_form(
        &self,
        url: &str,
        form: &[(&'static str, String)],
    ) -> Result<TokenResponse, AppError> {
        let r = self.http.post(url).form(form).send().await?;
        let status = r.status().as_u16();
        let text = r.text().await?;
        classify_token_reply(status, &text)
    }

    async fn whoami_email(&self, access: &str) -> Result<String, AppError> {
        let url = format!("{}/whoami", self.base().await);
        let r = self.http.get(&url).bearer_auth(access).send().await?;
        let v: Value = r
            .json()
            .await
            .map_err(|e| AppError::new("protocol", e.to_string()))?;
        v.get("email")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| AppError::new("protocol", "whoami had no email"))
    }

    /// A valid access token, refreshing first when it is close to expiry.
    async fn access_token(&self) -> Result<String, AppError> {
        if self.tokens.lock().await.is_none() {
            self.load_tokens().await?;
        }
        let current = self
            .tokens
            .lock()
            .await
            .clone()
            .ok_or_else(AppError::not_signed_in)?;
        if !oauth::needs_refresh(&current, now_secs()) {
            return Ok(current.access_token);
        }
        self.refresh(false).await
    }

    /// Refresh the access token. `force` skips the expiry check (used after a 401).
    async fn refresh(&self, force: bool) -> Result<String, AppError> {
        let _g = self.refresh_lock.lock().await;
        // Another caller may have refreshed while we waited for the lock.
        let current = self
            .tokens
            .lock()
            .await
            .clone()
            .ok_or_else(AppError::not_signed_in)?;
        if !force && !oauth::needs_refresh(&current, now_secs()) {
            return Ok(current.access_token);
        }
        let refresh = current
            .refresh_token
            .clone()
            .ok_or_else(|| AppError::new("reauth", "Your session ended. Sign in again."))?;
        let disc = self.discovery().await?;
        let client_id = self
            .settings
            .lock()
            .await
            .client_id
            .clone()
            .ok_or_else(AppError::not_signed_in)?;
        let form = oauth::refresh_form(&refresh, &client_id);
        let reply = match self.post_form(&disc.token_endpoint, &form).await {
            Ok(r) => r,
            Err(e) => {
                // Only a definitive refusal (invalid_grant) ends the session. A 5xx,
                // a proxy page or a network blip keeps the tokens and retries later.
                if should_forget_tokens(&e) {
                    self.forget_local().await?;
                    return Err(AppError::new(
                        "reauth",
                        "Your session ended. Sign in again.",
                    ));
                }
                return Err(e);
            }
        };
        let mut next = oauth::tokens_from_response(reply, now_secs(), Some(&refresh))?;
        next.email = current.email.clone();
        store::save(&next)?;
        let token = next.access_token.clone();
        *self.tokens.lock().await = Some(next);
        Ok(token)
    }

    /// Drop tokens and cached results from memory and the keychain.
    async fn forget_local(&self) -> Result<(), AppError> {
        *self.tokens.lock().await = None;
        self.cache.lock().await.clear();
        *self.initialized.lock().await = false;
        *self.session_id.lock().await = None;
        store::delete()
    }

    /// Revoke the refresh token at the server, then delete local copies.
    pub async fn sign_out(&self) -> Result<Option<String>, AppError> {
        let tokens = self.tokens.lock().await.clone();
        let mut warn = None;
        if let Some(t) = tokens {
            if let Some(rt) = t.refresh_token.clone() {
                let disc = self.discovery().await;
                let client_id = self.settings.lock().await.client_id.clone();
                match disc.ok().and_then(|d| d.revocation_endpoint) {
                    Some(url) => {
                        let form = revoke_form(&rt, client_id.as_deref());
                        match self.http.post(&url).form(&form).send().await {
                            Ok(r) => warn = revoke_warning(r.status().as_u16()),
                            Err(e) => warn = Some(format!("server revoke failed: {e}")),
                        }
                    }
                    None => warn = Some("server did not offer revocation".into()),
                }
            }
        }
        self.forget_local().await?;
        Ok(warn)
    }

    // ---- MCP -------------------------------------------------------------------

    async fn next_id(&self) -> u64 {
        let mut g = self.next_id.lock().await;
        let id = *g;
        *g += 1;
        id
    }

    /// One JSON-RPC POST. Returns the matching `result`. Retries once after a 401
    /// with a forced refresh, and resets the session on a 404 (expired session).
    async fn rpc(&self, method: &str, params: Option<Value>) -> Result<Value, AppError> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let token = self.access_token().await?;
            let id = self.next_id().await;
            let body = request(id, method, params.clone());
            let base = self.base().await;
            let mut req = self
                .http
                .post(format!("{base}/mcp"))
                .bearer_auth(&token)
                .header("Accept", "application/json, text/event-stream")
                .header("MCP-Protocol-Version", mcp::PROTOCOL_VERSION)
                .json(&body);
            if let Some(sid) = self.session_id.lock().await.clone() {
                req = req.header("Mcp-Session-Id", sid);
            }
            let resp = req.send().await?;
            let status = resp.status();
            if let Some(sid) = resp
                .headers()
                .get("mcp-session-id")
                .and_then(|v| v.to_str().ok())
            {
                *self.session_id.lock().await = Some(sid.to_string());
            }
            if status == reqwest::StatusCode::UNAUTHORIZED && attempt == 1 {
                self.refresh(true).await?;
                continue;
            }
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                let ra = mcp::retry_after_secs(
                    resp.headers()
                        .get("retry-after")
                        .and_then(|v| v.to_str().ok()),
                );
                return Err(self.note_rate_limit(ra).await);
            }
            if status == reqwest::StatusCode::UNAUTHORIZED {
                self.forget_local().await?;
                return Err(AppError::new(
                    "reauth",
                    "Your session ended. Sign in again.",
                ));
            }
            if status == reqwest::StatusCode::NOT_FOUND && method != "initialize" && attempt == 1 {
                *self.session_id.lock().await = None;
                *self.initialized.lock().await = false;
                continue;
            }
            if !status.is_success() {
                return Err(AppError::new(
                    "http",
                    format!("Skywalker replied HTTP {status}"),
                ));
            }
            *self.strikes.lock().await = 0;
            *self.backoff.lock().await = None;
            let ct = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let text = resp.text().await?;
            if text.trim().is_empty() {
                // Notifications and some replies have no body.
                return Ok(Value::Null);
            }
            let msg = mcp::response_for_id(&ct, &text, id)?;
            return result_of(&msg);
        }
    }

    async fn note_rate_limit(&self, retry_after: Option<u64>) -> AppError {
        let mut strikes = self.strikes.lock().await;
        *strikes = strikes.saturating_add(1);
        let secs =
            retry_after.unwrap_or_else(|| (MIN_BACKOFF << (*strikes - 1).min(4)).min(MAX_BACKOFF));
        *self.backoff.lock().await = Some((Instant::now() + Duration::from_secs(secs), secs));
        let mut e = AppError::new(
            "rate_limited",
            format!("Skywalker is rate limiting us. Waiting {secs}s before the next call."),
        );
        e.retry_after = Some(secs);
        e
    }

    async fn ensure_initialized(&self) -> Result<(), AppError> {
        let mut init = self.initialized.lock().await;
        if *init {
            return Ok(());
        }
        self.rpc("initialize", Some(mcp::initialize_params()))
            .await?;
        // Notification: no id, no reply body expected.
        let base = self.base().await;
        let token = self.access_token().await?;
        let _ = self
            .http
            .post(format!("{base}/mcp"))
            .bearer_auth(token)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", mcp::PROTOCOL_VERSION)
            .json(&notification("notifications/initialized"))
            .send()
            .await?;
        *init = true;
        Ok(())
    }

    /// tools/list, straight from the server.
    pub async fn list_tools(&self) -> Result<Value, AppError> {
        let _permit = self
            .gate
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| AppError::new("internal", e.to_string()))?;
        self.check_backoff(&*self.backoff.lock().await)?;
        self.ensure_initialized().await?;
        self.rpc("tools/list", None).await
    }

    /// Call a Skywalker tool. `max_age_ms` returns a cached result when it is at
    /// most that old; `None` or 0 always goes to the server.
    pub async fn call_tool(
        &self,
        name: &str,
        args: Value,
        max_age_ms: Option<i64>,
    ) -> Result<CallResult, AppError> {
        let key = cache::key(name, &args);
        if let Some(age) = max_age_ms.filter(|a| *a > 0) {
            if let Some(hit) = self.cache.lock().await.fresh(&key, now_ms(), age) {
                return Ok(CallResult {
                    data: hit.value,
                    fetched_at_ms: hit.fetched_at_ms,
                    cached: true,
                });
            }
        }
        let _permit = self
            .gate
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| AppError::new("internal", e.to_string()))?;
        self.check_backoff(&*self.backoff.lock().await)?;
        self.ensure_initialized().await?;
        let result = self
            .rpc("tools/call", Some(json!({"name": name, "arguments": args})))
            .await?;
        let data = tool_output(&result)?;
        let now = now_ms();
        self.cache.lock().await.put(key, data.clone(), now);
        Ok(CallResult {
            data,
            fetched_at_ms: now,
            cached: false,
        })
    }

    pub async fn clear_cache(&self) {
        self.cache.lock().await.clear();
    }
}

#[derive(serde::Serialize)]
pub struct CallResult {
    pub data: Value,
    pub fetched_at_ms: i64,
    pub cached: bool,
}

/// Did the server address change? Compared as the normalized string the UI saved.
pub fn url_changed(old: &str, new: &str) -> bool {
    old != new
}

/// Settings after a save: a new server gets a fresh client registration.
pub fn settings_for_new_url(old: &Settings, mut new: Settings) -> Settings {
    if url_changed(&old.server_url, &new.server_url) {
        new.client_id = None;
    } else {
        new.client_id = old.client_id.clone();
    }
    new
}

/// Only an invalid_grant reply (kind "reauth") means the grant is gone.
pub fn should_forget_tokens(e: &AppError) -> bool {
    e.kind == "reauth"
}

/// Read a /token reply. A non-2xx reply with no OAuth JSON is a transient server
/// problem (kind "http"), not a verdict on the tokens.
pub fn classify_token_reply(status: u16, text: &str) -> Result<TokenResponse, AppError> {
    match serde_json::from_str::<TokenResponse>(text) {
        Ok(t) if t.access_token.is_some() || t.error.is_some() => Ok(t),
        _ if !(200..300).contains(&status) => Err(AppError::new(
            "http",
            format!("Skywalker unavailable, retrying (HTTP {status})"),
        )),
        _ => Err(AppError::new(
            "oauth",
            "token endpoint replied without a token",
        )),
    }
}

/// RFC 7009 form. Telescope is a public client, so client_id is sent too.
pub fn revoke_form(refresh: &str, client_id: Option<&str>) -> Vec<(&'static str, String)> {
    let mut f = vec![
        ("token", refresh.to_string()),
        ("token_type_hint", "refresh_token".to_string()),
    ];
    if let Some(id) = client_id {
        f.push(("client_id", id.to_string()));
    }
    f
}

/// RFC 7009 says 200 on success (even for an already-revoked token). Anything else is reported.
pub fn revoke_warning(status: u16) -> Option<String> {
    if (200..300).contains(&status) {
        None
    } else {
        Some(format!("server revoke returned HTTP {status}; the grant may still be active on the server"))
    }
}

/// Accept connections on the loopback listener until the real /callback arrives.
async fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, AppError> {
    loop {
        let (sock, _) = listener
            .accept()
            .await
            .map_err(|e| AppError::new("io", e.to_string()))?;
        let mut reader = BufReader::new(sock);
        let mut first = String::new();
        if reader.read_line(&mut first).await.is_err() {
            continue;
        }
        // Drain headers so the browser gets a clean close.
        let mut hdr = String::new();
        loop {
            hdr.clear();
            match reader.read_line(&mut hdr).await {
                Ok(0) | Err(_) => break,
                Ok(_) if hdr == "\r\n" || hdr == "\n" => break,
                Ok(_) => continue,
            }
        }
        let sock = reader.get_mut();
        let Some((path, query)) = oauth::request_target(first.trim_end()) else {
            reply(
                sock,
                "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
            continue;
        };
        if path != "/callback" {
            reply(
                sock,
                "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            )
            .await;
            continue;
        }
        let q = oauth::parse_query(&query);
        if let Some(err) = q.get("error") {
            let msg = q
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| err.clone());
            reply(sock, &oauth::callback_page(false, &msg)).await;
            return Err(AppError::new("oauth", msg));
        }
        if q.get("state").map(String::as_str) != Some(state) {
            reply(
                sock,
                &oauth::callback_page(false, "State mismatch. Try again."),
            )
            .await;
            return Err(AppError::new("oauth", "state mismatch on sign-in callback"));
        }
        let Some(code) = q.get("code").cloned() else {
            reply(sock, &oauth::callback_page(false, "No code returned.")).await;
            return Err(AppError::new("oauth", "no authorization code on callback"));
        };
        reply(
            sock,
            &oauth::callback_page(true, "You can close this tab and return to Telescope."),
        )
        .await;
        return Ok(code);
    }
}

async fn reply(sock: &mut tokio::net::TcpStream, text: &str) {
    let _ = sock.write_all(text.as_bytes()).await;
    let _ = sock.shutdown().await;
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::oauth::tokens_from_response;

    #[test]
    fn server_change_drops_client_id_and_is_detected() {
        let old = Settings { server_url: "https://a.example".into(), client_id: Some("cid-a".into()), ..Settings::default() };
        let moved = Settings { server_url: "https://b.example".into(), client_id: None, ..Settings::default() };
        assert!(url_changed(&old.server_url, &moved.server_url));
        // A save that changes the URL must not carry server A's client id to B.
        let kept = settings_for_new_url(&old, Settings { client_id: Some("cid-a".into()), ..moved });
        assert_eq!(kept.client_id, None);
        assert_eq!(kept.server_url, "https://b.example");
    }

    #[test]
    fn same_server_keeps_client_id() {
        let old = Settings { client_id: Some("cid".into()), ..Settings::default() };
        let new = Settings { theme: "light".into(), client_id: None, ..Settings::default() };
        assert!(!url_changed(&old.server_url, &new.server_url));
        assert_eq!(settings_for_new_url(&old, new).client_id.as_deref(), Some("cid"));
    }

    #[test]
    fn transient_5xx_html_keeps_tokens() {
        let e = classify_token_reply(503, "<html>Service Unavailable</html>").unwrap_err();
        assert_eq!(e.kind, "http");
        assert!(e.message.contains("Skywalker unavailable, retrying"));
        assert!(!should_forget_tokens(&e));
    }

    #[test]
    fn invalid_grant_is_the_only_forget() {
        let r = classify_token_reply(400, r#"{"error":"invalid_grant","error_description":"expired"}"#).unwrap();
        let e = tokens_from_response(r, 0, Some("rt")).unwrap_err();
        assert_eq!(e.kind, "reauth");
        assert!(should_forget_tokens(&e));
        // A non-invalid_grant error JSON (e.g. server_error on a 500) must not sign out.
        let r = classify_token_reply(500, r#"{"error":"server_error"}"#).unwrap();
        let e = tokens_from_response(r, 0, Some("rt")).unwrap_err();
        assert_eq!(e.kind, "oauth");
        assert!(!should_forget_tokens(&e));
    }

    #[test]
    fn revoke_sends_client_id_and_reports_non_2xx() {
        let f = revoke_form("rt-1", Some("cid"));
        assert!(f.iter().any(|(k, v)| *k == "client_id" && v == "cid"));
        assert!(f.iter().any(|(k, v)| *k == "token" && v == "rt-1"));
        assert!(revoke_form("rt", None).iter().all(|(k, _)| *k != "client_id"));
        assert_eq!(revoke_warning(200), None);
        assert!(revoke_warning(503).unwrap().contains("HTTP 503"));
    }
}
