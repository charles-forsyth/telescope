//! In-memory result cache. Entries are stamped with wall-clock time so the UI can
//! say "updated N min ago". Nothing is written to disk.
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone)]
pub struct Entry {
    pub value: Value,
    pub fetched_at_ms: i64,
}

#[derive(Default)]
pub struct Cache {
    map: HashMap<String, Entry>,
}

/// Canonical cache key: tool name plus its arguments. serde_json maps are sorted
/// (no preserve_order feature), so equal argument sets give equal keys.
pub fn key(tool: &str, args: &Value) -> String {
    format!("{tool}|{}", serde_json::to_string(args).unwrap_or_default())
}

impl Cache {
    pub fn get(&self, key: &str) -> Option<&Entry> {
        self.map.get(key)
    }

    /// Entry only if it is no older than `max_age_ms` at time `now_ms`.
    pub fn fresh(&self, key: &str, now_ms: i64, max_age_ms: i64) -> Option<Entry> {
        self.map
            .get(key)
            .filter(|e| now_ms - e.fetched_at_ms <= max_age_ms)
            .cloned()
    }

    pub fn put(&mut self, key: String, value: Value, now_ms: i64) {
        self.map.insert(
            key,
            Entry {
                value,
                fetched_at_ms: now_ms,
            },
        );
    }

    pub fn clear(&mut self) {
        self.map.clear();
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn key_is_order_independent() {
        let a = key("spend", &json!({"p": "x", "g": "service"}));
        let b = key("spend", &json!({"g": "service", "p": "x"}));
        assert_eq!(a, b);
        assert_ne!(a, key("spend", &json!({"p": "y"})));
    }

    #[test]
    fn fresh_respects_age() {
        let mut c = Cache::default();
        c.put("k".into(), json!(1), 1_000);
        assert!(c.fresh("k", 1_500, 600).is_some());
        assert!(c.fresh("k", 2_000, 600).is_none());
        assert!(c.fresh("missing", 1_000, 600).is_none());
        assert_eq!(c.get("k").unwrap().fetched_at_ms, 1_000);
    }

    #[test]
    fn put_overwrites_and_clear_empties() {
        let mut c = Cache::default();
        c.put("k".into(), json!(1), 1);
        c.put("k".into(), json!(2), 2);
        assert_eq!(c.len(), 1);
        assert_eq!(c.get("k").unwrap().value, json!(2));
        c.clear();
        assert_eq!(c.len(), 0);
    }
}
