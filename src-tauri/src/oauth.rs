//! OAuth 2.1 + PKCE (S256) against the Skywalker authorization server.
//! Pure logic lives here (verifier, challenge, query parsing, token expiry) so it can
//! be unit tested. Network calls take a reqwest client so tests can avoid them.
use crate::error::AppError;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const SCOPE: &str = "mcp";
/// Refresh this many seconds before the access token actually expires.
pub const REFRESH_SKEW_SECS: i64 = 120;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    /// Unix seconds when the access token expires.
    pub expires_at: i64,
    pub scope: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct TokenResponse {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct Discovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub revocation_endpoint: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct Registration {
    pub client_id: String,
}

/// A PKCE verifier and its S256 challenge.
#[derive(Clone, Debug, PartialEq)]
pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn random_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

/// RFC 7636: 43-128 unreserved characters; we use 64 random bytes (86 chars).
pub fn pkce() -> Pkce {
    let verifier = random_urlsafe(64);
    Pkce {
        challenge: challenge_for(&verifier),
        verifier,
    }
}

pub fn challenge_for(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Parse "k=v&k=v" from the redirect query, percent-decoding values.
pub fn parse_query(q: &str) -> HashMap<String, String> {
    url::form_urlencoded::parse(q.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

/// Pull the request target out of the first line of an HTTP request, e.g.
/// "GET /callback?code=x&state=y HTTP/1.1" -> ("/callback", "code=x&state=y").
pub fn request_target(first_line: &str) -> Option<(String, String)> {
    let mut parts = first_line.split_whitespace();
    let method = parts.next()?;
    let target = parts.next()?;
    if method != "GET" {
        return None;
    }
    Some(match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target.to_string(), String::new()),
    })
}

/// The authorization URL the browser opens.
pub fn authorize_url(
    d: &Discovery,
    client_id: &str,
    redirect_uri: &str,
    pkce: &Pkce,
    state: &str,
) -> Result<String, AppError> {
    let mut u = url::Url::parse(&d.authorization_endpoint)
        .map_err(|e| AppError::new("oauth", format!("bad authorization endpoint: {e}")))?;
    u.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("code_challenge", &pkce.challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", SCOPE)
        .append_pair("state", state);
    Ok(u.to_string())
}

/// Convert a /token reply into stored tokens. `now` is unix seconds.
pub fn tokens_from_response(
    r: TokenResponse,
    now: i64,
    previous_refresh: Option<&str>,
) -> Result<Tokens, AppError> {
    if let Some(err) = r.error {
        let msg = r.error_description.unwrap_or_else(|| err.clone());
        let kind = if err == "invalid_grant" {
            "reauth"
        } else {
            "oauth"
        };
        return Err(AppError::new(kind, msg));
    }
    let access = r
        .access_token
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::new("oauth", "token reply had no access_token"))?;
    Ok(Tokens {
        access_token: access,
        // Refresh tokens rotate, but a reply may omit it: keep the old one then.
        refresh_token: r
            .refresh_token
            .or_else(|| previous_refresh.map(str::to_string)),
        expires_at: now + r.expires_in.unwrap_or(3600).max(60),
        scope: r.scope,
        email: None,
    })
}

/// True when the access token should be refreshed before use.
pub fn needs_refresh(t: &Tokens, now: i64) -> bool {
    now + REFRESH_SKEW_SECS >= t.expires_at
}

/// Token endpoint form bodies.
pub fn exchange_form(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
    client_id: &str,
) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "authorization_code".into()),
        ("code", code.into()),
        ("code_verifier", verifier.into()),
        ("redirect_uri", redirect_uri.into()),
        ("client_id", client_id.into()),
    ]
}

pub fn refresh_form(refresh_token: &str, client_id: &str) -> Vec<(&'static str, String)> {
    vec![
        ("grant_type", "refresh_token".into()),
        ("refresh_token", refresh_token.into()),
        ("client_id", client_id.into()),
    ]
}

/// Minimal HTML the loopback listener returns after the redirect.
pub fn callback_page(ok: bool, text: &str) -> String {
    let title = if ok { "Signed in" } else { "Sign-in failed" };
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Telescope</title>\
         <body style=\"font:16px -apple-system,system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;\
         display:grid;place-items:center;height:100vh;margin:0\"><div><h2>{title}</h2><p>{}</p></div></body>",
        html_escape(text)
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 7636 appendix B test vector.
    #[test]
    fn s256_matches_rfc7636_vector() {
        let v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(v),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn pkce_is_long_and_unique() {
        let a = pkce();
        let b = pkce();
        assert!(a.verifier.len() >= 43 && a.verifier.len() <= 128);
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.challenge, challenge_for(&a.verifier));
        assert!(!a.challenge.contains('='));
    }

    #[test]
    fn authorize_url_carries_pkce_and_state() {
        let d = Discovery {
            authorization_endpoint: "https://srv.example/authorize".into(),
            token_endpoint: "https://srv.example/token".into(),
            registration_endpoint: None,
            revocation_endpoint: None,
        };
        let p = Pkce {
            verifier: "v".into(),
            challenge: "c".into(),
        };
        let u = authorize_url(&d, "cid", "http://127.0.0.1:5555/callback", &p, "st").unwrap();
        let parsed = url::Url::parse(&u).unwrap();
        let q: HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        assert_eq!(q["code_challenge"], "c");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_eq!(q["response_type"], "code");
        assert_eq!(q["state"], "st");
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555/callback");
        assert_eq!(q["scope"], SCOPE);
    }

    #[test]
    fn request_target_parses_callback() {
        let (p, q) = request_target("GET /callback?code=a%2Bb&state=s HTTP/1.1").unwrap();
        assert_eq!(p, "/callback");
        let m = parse_query(&q);
        assert_eq!(m["code"], "a+b");
        assert_eq!(m["state"], "s");
        assert!(request_target("POST /callback HTTP/1.1").is_none());
        assert_eq!(request_target("GET /favicon.ico HTTP/1.1").unwrap().1, "");
    }

    #[test]
    fn token_expiry_and_refresh_window() {
        let t = Tokens {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: 10_000,
            scope: None,
            email: None,
        };
        assert!(!needs_refresh(&t, 9_000));
        assert!(needs_refresh(&t, 9_900)); // within 120 s of expiry
        assert!(needs_refresh(&t, 10_500));
    }

    #[test]
    fn refresh_keeps_old_refresh_token_when_omitted() {
        let r = TokenResponse {
            access_token: Some("new".into()),
            refresh_token: None,
            expires_in: Some(3600),
            scope: Some("mcp".into()),
            error: None,
            error_description: None,
        };
        let t = tokens_from_response(r, 1_000, Some("old-refresh")).unwrap();
        assert_eq!(t.access_token, "new");
        assert_eq!(t.refresh_token.as_deref(), Some("old-refresh"));
        assert_eq!(t.expires_at, 4_600);
    }

    #[test]
    fn invalid_grant_is_reauth_not_oauth() {
        let r = TokenResponse {
            access_token: None,
            refresh_token: None,
            expires_in: None,
            scope: None,
            error: Some("invalid_grant".into()),
            error_description: Some("refresh token expired".into()),
        };
        let e = tokens_from_response(r, 0, None).unwrap_err();
        assert_eq!(e.kind, "reauth");
        assert_eq!(e.message, "refresh token expired");
    }

    #[test]
    fn callback_page_escapes_text() {
        let p = callback_page(false, "<script>x</script>");
        assert!(p.contains("&lt;script&gt;"));
        assert!(!p.contains("<script>x"));
        assert!(p.starts_with("HTTP/1.1 200"));
    }
}
