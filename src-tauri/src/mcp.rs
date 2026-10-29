//! MCP Streamable HTTP client: JSON-RPC framing, SSE and JSON reply parsing,
//! tool-result unwrapping. The pure parts are unit tested; `McpClient` does the HTTP.
use crate::error::AppError;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const PROTOCOL_VERSION: &str = "2025-06-18";
pub const CLIENT_NAME: &str = "telescope";

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Request {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

pub fn request(id: u64, method: &str, params: Option<Value>) -> Request {
    Request {
        jsonrpc: "2.0",
        id,
        method: method.into(),
        params,
    }
}

pub fn notification(method: &str) -> Value {
    json!({"jsonrpc": "2.0", "method": method})
}

pub fn initialize_params() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {},
        "clientInfo": {"name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION")}
    })
}

/// Parse a Server-Sent Events body into its `data` payloads (one per event).
/// Handles CRLF, multi-line data, comments (":") and events split across chunks
/// is not needed here because the whole body is read first.
pub fn sse_events(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut data: Vec<String> = Vec::new();
    for raw in body.split('\n') {
        let line = raw.strip_suffix('\r').unwrap_or(raw);
        if line.is_empty() {
            if !data.is_empty() {
                out.push(data.join("\n"));
                data.clear();
            }
            continue;
        }
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        if field == "data" {
            data.push(value.to_string());
        }
    }
    if !data.is_empty() {
        out.push(data.join("\n"));
    }
    out
}

/// Find the JSON-RPC response with `id` in an SSE or JSON reply body.
/// `content_type` decides how the body is split.
pub fn response_for_id(content_type: &str, body: &str, id: u64) -> Result<Value, AppError> {
    let messages: Vec<Value> = if content_type.contains("text/event-stream") {
        sse_events(body)
            .iter()
            .filter_map(|d| serde_json::from_str::<Value>(d).ok())
            .collect()
    } else {
        match serde_json::from_str::<Value>(body) {
            Ok(Value::Array(a)) => a,
            Ok(v) => vec![v],
            Err(e) => {
                return Err(AppError::new(
                    "protocol",
                    format!("Skywalker sent a reply that is not JSON: {e}"),
                ))
            }
        }
    };
    messages
        .into_iter()
        .find(|m| m.get("id").and_then(Value::as_u64) == Some(id))
        .ok_or_else(|| AppError::new("protocol", "no JSON-RPC reply for this request"))
}

/// Turn a JSON-RPC response into its `result`, or an error.
pub fn result_of(msg: &Value) -> Result<Value, AppError> {
    if let Some(err) = msg.get("error") {
        let text = err
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown JSON-RPC error");
        let kind = if text.contains("401") || text.to_lowercase().contains("unauthor") {
            "reauth"
        } else {
            "rpc"
        };
        return Err(AppError::new(kind, text));
    }
    msg.get("result")
        .cloned()
        .ok_or_else(|| AppError::new("protocol", "JSON-RPC reply had neither result nor error"))
}

/// A tools/call result: `content[0].text` is JSON from Skywalker. Errors are
/// `isError: true` with a text message.
pub fn tool_output(result: &Value) -> Result<Value, AppError> {
    let text = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|a| a.iter().find_map(|c| c.get("text").and_then(Value::as_str)))
        .unwrap_or("");
    if result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let (kind, msg) = split_error(text);
        return Err(AppError::new(&kind, msg));
    }
    if text.is_empty() {
        return Ok(Value::Null);
    }
    match serde_json::from_str::<Value>(text) {
        Ok(v) => Ok(v),
        // Not JSON: hand the text through so the UI can show it.
        Err(_) => Ok(json!({ "text": text })),
    }
}

/// Skywalker errors look like "kind: message". Map known kinds, else "tool".
pub fn split_error(text: &str) -> (String, String) {
    if let Some((k, m)) = text.split_once(':') {
        let k = k.trim();
        if !k.is_empty() && k.len() <= 24 && k.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            return (k.to_string(), m.trim().to_string());
        }
    }
    ("tool".into(), text.trim().to_string())
}

/// The "Retry-After" header in seconds, if present and numeric.
pub fn retry_after_secs(value: Option<&str>) -> Option<u64> {
    value.and_then(|v| v.trim().parse::<u64>().ok())
}

/// Build the reqwest client used for MCP and OAuth calls.
pub fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .user_agent(concat!("Telescope/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::new("network", e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_splits_events_and_joins_data_lines() {
        let body = "event: message\r\ndata: {\"a\":1}\r\n\r\n: keepalive\n\ndata: x\ndata: y\n\n";
        let ev = sse_events(body);
        assert_eq!(ev, vec!["{\"a\":1}".to_string(), "x\ny".to_string()]);
    }

    #[test]
    fn sse_trailing_event_without_blank_line() {
        assert_eq!(sse_events("data: 7"), vec!["7".to_string()]);
    }

    #[test]
    fn picks_matching_id_from_sse() {
        let body = "data: {\"jsonrpc\":\"2.0\",\"method\":\"notify\"}\n\n\
                    data: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"ok\":true}}\n\n";
        let m = response_for_id("text/event-stream; charset=utf-8", body, 3).unwrap();
        assert_eq!(result_of(&m).unwrap(), json!({"ok": true}));
        assert!(response_for_id("text/event-stream", body, 4).is_err());
    }

    #[test]
    fn parses_plain_json_and_batch() {
        let m = response_for_id("application/json", r#"{"id":1,"result":{}}"#, 1).unwrap();
        assert!(result_of(&m).is_ok());
        let b = response_for_id("application/json", r#"[{"id":2,"result":1}]"#, 2).unwrap();
        assert_eq!(result_of(&b).unwrap(), json!(1));
    }

    #[test]
    fn non_json_reply_is_protocol_error() {
        let e = response_for_id("text/html", "<html>", 1).unwrap_err();
        assert_eq!(e.kind, "protocol");
    }

    #[test]
    fn rpc_error_maps_to_reauth_on_401() {
        let m = json!({"id": 1, "error": {"code": -32001, "message": "HTTP 401 unauthorized"}});
        assert_eq!(result_of(&m).unwrap_err().kind, "reauth");
        let m2 = json!({"id": 1, "error": {"code": -32600, "message": "bad"}});
        assert_eq!(result_of(&m2).unwrap_err().kind, "rpc");
    }

    #[test]
    fn tool_output_unwraps_json_text() {
        let r = json!({"content": [{"type": "text", "text": "{\"project_id\":\"p\"}"}]});
        assert_eq!(tool_output(&r).unwrap()["project_id"], "p");
    }

    #[test]
    fn tool_error_uses_kind_prefix() {
        let r = json!({"isError": true, "content": [{"type": "text", "text": "permission: no access"}]});
        let e = tool_output(&r).unwrap_err();
        assert_eq!(e.kind, "permission");
        assert_eq!(e.message, "no access");
        let r2 = json!({"isError": true, "content": [{"type": "text", "text": "not signed in"}]});
        assert_eq!(tool_output(&r2).unwrap_err().kind, "tool");
    }

    #[test]
    fn non_json_tool_text_passes_through() {
        let r = json!({"content": [{"type": "text", "text": "hello"}]});
        assert_eq!(tool_output(&r).unwrap(), json!({"text": "hello"}));
    }

    #[test]
    fn request_serializes_without_null_params() {
        let s = serde_json::to_value(request(1, "tools/list", None)).unwrap();
        assert!(s.get("params").is_none());
        assert_eq!(s["jsonrpc"], "2.0");
    }

    #[test]
    fn retry_after_parses_seconds() {
        assert_eq!(retry_after_secs(Some(" 30 ")), Some(30));
        assert_eq!(retry_after_secs(Some("Wed, 21 Oct")), None);
        assert_eq!(retry_after_secs(None), None);
    }
}
