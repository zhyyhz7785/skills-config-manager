//! Append-only user operation log: {library_root}/.ccm/oplog.jsonl.
//! Best-effort recording (never blocks the main flow); read back per entry
//! to explain "我改过什么、级别是什么、何时更新过" after upstream updates.

use serde::{Deserialize, Serialize};
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const OPLOG_REL: &str = ".ccm/oplog.jsonl";
/// 单条目回读上限（避免超长日志拖慢对话框）。
const READ_CAP: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpEvent {
    /// unix 秒
    #[serde(default)]
    pub ts: String,
    /// promote | setIntendedLevel | recordDiff | cacheUpdate | reapply
    #[serde(default)]
    pub op: String,
    /// 本地条目 id（可空，如网络侧操作）
    #[serde(default)]
    pub entry_id: String,
    #[serde(default)]
    pub network_entry_id: String,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub note: String,
}

fn now_secs() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
        .to_string()
}

pub fn oplog_path(library_root: &str) -> PathBuf {
    Path::new(library_root.trim()).join(OPLOG_REL)
}

/// Best-effort append; IO 失败静默（操作日志不阻断业务）。
pub fn append(library_root: &str, mut ev: OpEvent) {
    let root = library_root.trim();
    if root.is_empty() {
        return;
    }
    if ev.ts.is_empty() {
        ev.ts = now_secs();
    }
    let path = oplog_path(root);
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    let Ok(line) = serde_json::to_string(&ev) else {
        return;
    };
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(f, "{line}");
    }
}

/// 按本地条目 id / 网络条目 id 匹配读取；source_id 仅匹配源级事件（如 cacheUpdate，
/// 其 entry_id 与 network_entry_id 均为空）。时间正序，截取最近 READ_CAP 条。
pub fn read_for_entry(
    library_root: &str,
    entry_id: &str,
    network_entry_id: &str,
    source_id: &str,
) -> Vec<OpEvent> {
    let root = library_root.trim();
    let eid = entry_id.trim();
    let nid = network_entry_id.trim();
    let sid = source_id.trim();
    if root.is_empty() || (eid.is_empty() && nid.is_empty() && sid.is_empty()) {
        return vec![];
    }
    let Ok(raw) = fs::read_to_string(oplog_path(root)) else {
        return vec![];
    };
    let mut out: Vec<OpEvent> = raw
        .lines()
        .filter_map(|l| serde_json::from_str::<OpEvent>(l).ok())
        .filter(|ev| {
            (!eid.is_empty() && ev.entry_id == eid)
                || (!nid.is_empty() && ev.network_entry_id == nid)
                || (!sid.is_empty()
                    && ev.source_id == sid
                    && ev.entry_id.is_empty()
                    && ev.network_entry_id.is_empty())
        })
        .collect();
    if out.len() > READ_CAP {
        out.drain(0..out.len() - READ_CAP);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_and_read_filters_by_entry_or_network_id() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        append(
            &root,
            OpEvent {
                op: "promote".into(),
                entry_id: "my-skill".into(),
                network_entry_id: "net:src:my-skill".into(),
                level: "L1".into(),
                ..Default::default()
            },
        );
        append(
            &root,
            OpEvent {
                op: "setIntendedLevel".into(),
                network_entry_id: "net:src:other".into(),
                level: "L2".into(),
                ..Default::default()
            },
        );
        append(
            &root,
            OpEvent {
                op: "recordDiff".into(),
                entry_id: "my-skill".into(),
                ..Default::default()
            },
        );
        let evs = read_for_entry(&root, "my-skill", "net:src:my-skill", "");
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].op, "promote");
        assert!(!evs[0].ts.is_empty());
        assert_eq!(evs[1].op, "recordDiff");
        let other = read_for_entry(&root, "", "net:src:other", "");
        assert_eq!(other.len(), 1);
        assert_eq!(other[0].level, "L2");
    }

    #[test]
    fn source_id_only_matches_source_level_events() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        append(
            &root,
            OpEvent {
                op: "cacheUpdate".into(),
                source_id: "src-a".into(),
                ..Default::default()
            },
        );
        append(
            &root,
            OpEvent {
                op: "promote".into(),
                entry_id: "e1".into(),
                network_entry_id: "net:src-a:e1".into(),
                source_id: "src-a".into(),
                ..Default::default()
            },
        );
        // e2 未涉及，但同源的 cacheUpdate 应可见；e1 的 promote 不应混入
        let evs = read_for_entry(&root, "e2", "net:src-a:e2", "src-a");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].op, "cacheUpdate");
    }

    #[test]
    fn read_missing_file_or_empty_ids_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        assert!(read_for_entry(&root, "x", "", "").is_empty());
        assert!(read_for_entry(&root, "", "", "").is_empty());
    }
}
