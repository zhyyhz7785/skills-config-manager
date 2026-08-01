//! Catalog.json ring backups (max 5) under `{library}/catalog-backups/`.

use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::catalog::{load_catalog, save_catalog, LibraryCatalog};

pub const MAX_CATALOG_BACKUPS: usize = 5;
const BACKUP_DIR: &str = "catalog-backups";
const BAK_PREFIX: &str = "catalog-bak-";
const BAK_SUFFIX: &str = ".json";
const MAX_SAMPLE_ENTRIES: usize = 8;
const MAX_SAMPLE_PROJECTS: usize = 5;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogBackupInfo {
    pub id: String,
    pub path: String,
    pub created_at_unix: u64,
    pub entry_count: u32,
    pub project_count: u32,
    pub file_size_bytes: u64,
    pub label: String,
    /// kind → count，如 skill/rule/agent
    pub kind_counts: BTreeMap<String, u32>,
    /// 前若干条目 id，便于扫一眼区分
    pub sample_entry_ids: Vec<String>,
    /// 前若干项目名
    pub sample_project_names: Vec<String>,
}

fn backups_dir(library_root: &str) -> PathBuf {
    Path::new(library_root.trim()).join(BACKUP_DIR)
}

fn catalog_path(library_root: &str) -> PathBuf {
    Path::new(library_root.trim()).join("catalog.json")
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn parse_unix_from_id(id: &str) -> Option<u64> {
    let stem = id
        .strip_prefix(BAK_PREFIX)?
        .strip_suffix(BAK_SUFFIX)?;
    stem.parse().ok()
}

fn format_kind_label(kind_counts: &BTreeMap<String, u32>) -> String {
    if kind_counts.is_empty() {
        return "空台账".into();
    }
    // 稳定顺序：常见 kind 优先，其余按字母
    const ORDER: &[&str] = &["skill", "rule", "agent", "command", "hook"];
    let mut parts: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for k in ORDER {
        if let Some(n) = kind_counts.get(*k) {
            parts.push(format!("{k}×{n}"));
            seen.insert(*k);
        }
    }
    for (k, n) in kind_counts {
        if seen.contains(k.as_str()) {
            continue;
        }
        parts.push(format!("{k}×{n}"));
    }
    parts.join(" · ")
}

fn summarize_catalog(c: &LibraryCatalog) -> (BTreeMap<String, u32>, Vec<String>, Vec<String>) {
    let mut kind_counts: BTreeMap<String, u32> = BTreeMap::new();
    for e in &c.entries {
        let key = if e.kind.trim().is_empty() {
            "unknown".to_string()
        } else {
            e.kind.trim().to_lowercase()
        };
        *kind_counts.entry(key).or_insert(0) += 1;
    }
    let sample_entry_ids: Vec<String> = c
        .entries
        .iter()
        .filter(|e| !e.id.trim().is_empty())
        .take(MAX_SAMPLE_ENTRIES)
        .map(|e| e.id.clone())
        .collect();
    let sample_project_names: Vec<String> = c
        .projects
        .iter()
        .filter_map(|p| {
            p.get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        })
        .take(MAX_SAMPLE_PROJECTS)
        .collect();
    (kind_counts, sample_entry_ids, sample_project_names)
}

fn summarize_file(path: &Path, id: &str, unix: u64) -> CatalogBackupInfo {
    let meta = fs::metadata(path).ok();
    let size = meta.map(|m| m.len()).unwrap_or(0);
    let (entry_count, project_count, kind_counts, sample_entry_ids, sample_project_names) =
        match fs::read_to_string(path) {
            Ok(raw) => match serde_json::from_str::<LibraryCatalog>(&raw) {
                Ok(c) => {
                    let (kinds, entries, projects) = summarize_catalog(&c);
                    (
                        c.entries.len() as u32,
                        c.projects.len() as u32,
                        kinds,
                        entries,
                        projects,
                    )
                }
                Err(_) => (0, 0, BTreeMap::new(), vec![], vec![]),
            },
            Err(_) => (0, 0, BTreeMap::new(), vec![], vec![]),
        };
    let label = format_kind_label(&kind_counts);
    CatalogBackupInfo {
        id: id.to_string(),
        path: path.to_string_lossy().replace('/', "\\"),
        created_at_unix: unix,
        entry_count,
        project_count,
        file_size_bytes: size,
        label,
        kind_counts,
        sample_entry_ids,
        sample_project_names,
    }
}

fn list_backup_files(dir: &Path) -> Vec<(u64, PathBuf, String)> {
    let Ok(rd) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut out = Vec::new();
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        let name = ent.file_name().to_string_lossy().to_string();
        let Some(unix) = parse_unix_from_id(&name) else {
            continue;
        };
        out.push((unix, path, name));
    }
    out.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    out
}

fn prune_backups(dir: &Path) -> Result<(), String> {
    let files = list_backup_files(dir);
    if files.len() <= MAX_CATALOG_BACKUPS {
        return Ok(());
    }
    for (_, path, _) in files.into_iter().skip(MAX_CATALOG_BACKUPS) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

/// Copy current catalog.json into the ring (if present). Prunes to 5.
pub fn push_catalog_backup(library_root: &str) -> Result<Option<CatalogBackupInfo>, String> {
    let lib = library_root.trim();
    if lib.is_empty() {
        return Err("永久库根为空".into());
    }
    let src = catalog_path(lib);
    if !src.is_file() {
        return Ok(None);
    }
    let dir = backups_dir(lib);
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir catalog-backups: {e}"))?;

    let mut stamp = now_unix();
    let mut dest = dir.join(format!("{BAK_PREFIX}{stamp}{BAK_SUFFIX}"));
    // Avoid collision if called twice in the same second.
    let mut n = 0u32;
    while dest.exists() && n < 20 {
        stamp += 1;
        n += 1;
        dest = dir.join(format!("{BAK_PREFIX}{stamp}{BAK_SUFFIX}"));
    }

    fs::copy(&src, &dest).map_err(|e| format!("备份 catalog.json 失败: {e}"))?;
    prune_backups(&dir)?;
    let id = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(Some(summarize_file(&dest, &id, stamp)))
}

pub fn list_catalog_backups(library_root: &str) -> Result<Vec<CatalogBackupInfo>, String> {
    let lib = library_root.trim();
    if lib.is_empty() {
        return Ok(vec![]);
    }
    let dir = backups_dir(lib);
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    Ok(list_backup_files(&dir)
        .into_iter()
        .map(|(unix, path, id)| summarize_file(&path, &id, unix))
        .collect())
}

/// Restore backup `id` over catalog.json. Pushes current catalog first when present.
pub fn restore_catalog_backup(library_root: &str, id: &str) -> Result<(), String> {
    let lib = library_root.trim();
    if lib.is_empty() {
        return Err("永久库根为空".into());
    }
    let id = id.trim();
    if id.is_empty() || id.contains(['/', '\\']) || !id.starts_with(BAK_PREFIX) {
        return Err("无效备份 id".into());
    }
    let bak = backups_dir(lib).join(id);
    if !bak.is_file() {
        return Err(format!("备份不存在: {id}"));
    }
    let raw = fs::read_to_string(&bak).map_err(|e| format!("读备份失败: {e}"))?;
    let catalog: LibraryCatalog =
        serde_json::from_str(&raw).map_err(|e| format!("备份 JSON 无效: {e}"))?;

    // Push current before overwrite (ignore if missing).
    let _ = push_catalog_backup(lib)?;

    save_catalog(lib, &catalog)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, save_catalog, CatalogEntry};

    #[test]
    fn push_prunes_to_five() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        for i in 0..6 {
            let mut c = crate::catalog::empty_catalog();
            c.entries.push(CatalogEntry {
                id: format!("e{i}"),
                kind: "skill".into(),
                library_path: format!("skills/e{i}/SKILL.md"),
                is_in_library: true,
                ..Default::default()
            });
            save_catalog(&lib, &c).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(20));
            push_catalog_backup(&lib).unwrap();
        }
        let list = list_catalog_backups(&lib).unwrap();
        assert_eq!(list.len(), MAX_CATALOG_BACKUPS, "{list:?}");
    }

    #[test]
    fn restore_replaces_entries() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();

        let mut c = crate::catalog::empty_catalog();
        c.entries.push(CatalogEntry {
            id: "keep-me".into(),
            kind: "skill".into(),
            library_path: "skills/keep-me/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        });
        save_catalog(&lib, &c).unwrap();
        let info = push_catalog_backup(&lib).unwrap().expect("backup");

        let empty = crate::catalog::empty_catalog();
        save_catalog(&lib, &empty).unwrap();
        assert!(load_catalog(&lib).catalog.entries.is_empty());

        restore_catalog_backup(&lib, &info.id).unwrap();
        let load = load_catalog(&lib);
        assert_eq!(load.catalog.entries.len(), 1);
        assert_eq!(load.catalog.entries[0].id, "keep-me");
    }

    #[test]
    fn summarize_includes_kind_and_samples() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();

        let mut c = crate::catalog::empty_catalog();
        c.entries.push(CatalogEntry {
            id: "skill-a".into(),
            kind: "skill".into(),
            library_path: "skills/a/SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        });
        c.entries.push(CatalogEntry {
            id: "rule-b".into(),
            kind: "rule".into(),
            library_path: "rules/b.mdc".into(),
            is_in_library: true,
            ..Default::default()
        });
        c.projects.push(serde_json::json!({
            "id": "proj-1",
            "name": "Demo App",
            "rootPath": "E:\\\\demo"
        }));
        save_catalog(&lib, &c).unwrap();
        let info = push_catalog_backup(&lib).unwrap().expect("backup");

        assert_eq!(info.kind_counts.get("skill"), Some(&1));
        assert_eq!(info.kind_counts.get("rule"), Some(&1));
        assert!(info.sample_entry_ids.contains(&"skill-a".into()));
        assert!(info.sample_entry_ids.contains(&"rule-b".into()));
        assert_eq!(info.sample_project_names, vec!["Demo App".to_string()]);
        assert!(info.label.contains("skill×1"));
        assert!(info.label.contains("rule×1"));

        let list = list_catalog_backups(&lib).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].kind_counts.get("skill"), Some(&1));
    }
}
