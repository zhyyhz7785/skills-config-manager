//! Read-only catalog.json loader (camelCase, align Electron catalog).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

use crate::path_guard::resolve_library_safe_path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCatalog {
    #[serde(default)]
    pub version: i32,
    #[serde(default)]
    pub projects: Vec<serde_json::Value>,
    #[serde(default)]
    pub entries: Vec<CatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub library_path: String,
    #[serde(default)]
    pub is_in_library: bool,
    #[serde(default)]
    pub deployed_path: String,
    #[serde(default)]
    pub is_missing: bool,
    #[serde(default)]
    pub remark_zh: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub trigger: String,
    #[serde(default)]
    pub origins: Vec<CatalogOrigin>,
    /// Preserve unknown catalog entry fields.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogOrigin {
    #[serde(default)]
    pub original_path: String,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub scope: String,
}

#[derive(Debug, Clone)]
pub struct CatalogLoadResult {
    pub catalog: LibraryCatalog,
    pub healthy: bool,
    pub error: Option<String>,
}

pub fn empty_catalog() -> LibraryCatalog {
    LibraryCatalog {
        version: 2,
        projects: vec![],
        entries: vec![],
    }
}

pub fn load_catalog(library_root: &str) -> CatalogLoadResult {
    let root = library_root.trim();
    if root.is_empty() {
        return CatalogLoadResult {
            catalog: empty_catalog(),
            healthy: true,
            error: None,
        };
    }
    let path = Path::new(root).join("catalog.json");
    if !path.exists() {
        return CatalogLoadResult {
            catalog: empty_catalog(),
            healthy: true,
            error: None,
        };
    }
    match fs::read_to_string(&path) {
        Ok(raw) => {
            let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
            match serde_json::from_str::<LibraryCatalog>(raw) {
                Ok(catalog) => CatalogLoadResult {
                    catalog,
                    healthy: true,
                    error: None,
                },
                Err(e) => CatalogLoadResult {
                    catalog: empty_catalog(),
                    healthy: false,
                    error: Some(format!("parse catalog.json: {e}")),
                },
            }
        }
        Err(e) => CatalogLoadResult {
            catalog: empty_catalog(),
            healthy: false,
            error: Some(format!("read catalog.json: {e}")),
        },
    }
}

pub fn write_empty_catalog(library_root: &str) -> Result<(), String> {
    save_catalog(library_root, &empty_catalog())
}

/// Merge entries/projects present in `from_root` but missing under `to_root` (by id / rootPath).
/// Does not overwrite existing records. Used when reclaiming an ephemeral Temp library.
pub fn merge_missing_catalog_records(from_root: &str, to_root: &str) -> Result<(u32, u32), String> {
    let from_load = load_catalog(from_root);
    if !from_load.healthy {
        return Ok((0, 0));
    }
    if from_load.catalog.entries.is_empty() && from_load.catalog.projects.is_empty() {
        return Ok((0, 0));
    }
    let to_load = load_catalog(to_root);
    if !to_load.healthy {
        return Err(format!(
            "target catalog unhealthy, refuse merge: {}",
            to_load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut dest = to_load.catalog;
    let mut entries_added = 0u32;
    let mut projects_added = 0u32;
    for e in &from_load.catalog.entries {
        if e.id.trim().is_empty() {
            continue;
        }
        if dest.entries.iter().any(|x| x.id == e.id) {
            continue;
        }
        dest.entries.push(e.clone());
        entries_added += 1;
    }
    for pv in &from_load.catalog.projects {
        let Some(p) = project_from_value(pv) else {
            continue;
        };
        if p.id.trim().is_empty() {
            continue;
        }
        let root_n = crate::project_discovery::normalize_path(&p.root_path);
        let exists = dest.projects.iter().any(|x| {
            project_from_value(x)
                .map(|q| {
                    q.id == p.id
                        || crate::project_discovery::normalize_path(&q.root_path) == root_n
                })
                .unwrap_or(false)
        });
        if exists {
            continue;
        }
        dest.projects.push(project_to_value(&p));
        projects_added += 1;
    }
    if entries_added > 0 || projects_added > 0 {
        if dest.version <= 0 {
            dest.version = 2;
        }
        save_catalog(to_root, &dest)?;
    }
    Ok((entries_added, projects_added))
}

/// 单测用写盘计数：验证批量路径把 save 次数从 N 降到 1。
#[cfg(test)]
pub(crate) mod save_stats {
    use std::sync::atomic::{AtomicUsize, Ordering};
    pub static CALLS: AtomicUsize = AtomicUsize::new(0);
    pub fn count() -> usize {
        CALLS.load(Ordering::SeqCst)
    }
}

/// Atomic write: `{pid}.tmp` → validate parse → rename over `catalog.json`.
pub fn save_catalog(library_root: &str, catalog: &LibraryCatalog) -> Result<(), String> {
    #[cfg(test)]
    save_stats::CALLS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let root = Path::new(library_root.trim());
    if !root.exists() {
        fs::create_dir_all(root).map_err(|e| format!("mkdir library: {e}"))?;
    }
    let final_path = root.join("catalog.json");
    let tmp_path = root.join(format!("catalog.{}.tmp", std::process::id()));
    let raw = serde_json::to_string_pretty(catalog).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, &raw).map_err(|e| format!("write catalog tmp: {e}"))?;
    // Validate round-trip before replacing.
    let check = fs::read_to_string(&tmp_path).map_err(|e| format!("read catalog tmp: {e}"))?;
    serde_json::from_str::<LibraryCatalog>(&check).map_err(|e| format!("tmp catalog invalid: {e}"))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("rename catalog: {e}")
    })?;
    Ok(())
}

/// In-memory replace-or-append by id（不写盘）。批量写路径与 `upsert_entry` 共用同一语义。
pub fn upsert_entry_in(catalog: &mut LibraryCatalog, entry: CatalogEntry) {
    if let Some(idx) = catalog.entries.iter().position(|e| e.id == entry.id) {
        catalog.entries[idx] = entry;
    } else {
        catalog.entries.push(entry);
    }
}

/// Replace or append entry by id; then atomic save. Refuses if current on-disk catalog is corrupt.
pub fn upsert_entry(library_root: &str, entry: CatalogEntry) -> Result<LibraryCatalog, String> {
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy, refuse write: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut catalog = load.catalog;
    upsert_entry_in(&mut catalog, entry);
    if catalog.version <= 0 {
        catalog.version = 2;
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

/// Replace the catalog slot for `old_id` with `entry` (id may change). Preserves list order.
pub fn replace_entry_id(
    library_root: &str,
    old_id: &str,
    entry: CatalogEntry,
) -> Result<LibraryCatalog, String> {
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy, refuse write: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut catalog = load.catalog;
    let idx = catalog
        .entries
        .iter()
        .position(|e| e.id == old_id)
        .ok_or_else(|| format!("entry not found: {old_id}"))?;
    if entry.id != old_id && catalog.entries.iter().any(|e| e.id == entry.id) {
        return Err(format!("id already exists: {}", entry.id));
    }
    catalog.entries[idx] = entry;
    if catalog.version <= 0 {
        catalog.version = 2;
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

/// Remove entry by id; refuses if catalog unhealthy.
pub fn remove_entry(library_root: &str, entry_id: &str) -> Result<LibraryCatalog, String> {
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy, refuse write: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut catalog = load.catalog;
    let before = catalog.entries.len();
    catalog.entries.retain(|e| e.id != entry_id);
    if catalog.entries.len() == before {
        return Err(format!("entry not found: {entry_id}"));
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

// ─── Projects + entry tags (M3 domain 5) ───────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogProject {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub pinned: bool,
    /// Plan/04 Should：项目侧可见工具槽（空 = 仅 cursor）。
    #[serde(default)]
    pub visible_tools: Vec<String>,
    /// 可选：工具 id → 容器根覆盖（空则 `{root}/.{tool}`）。
    #[serde(default)]
    pub tool_container_roots: std::collections::BTreeMap<String, String>,
}

impl CatalogProject {
    /// Effective visible tool ids (normalized; default `cursor`).
    pub fn effective_visible_tools(&self) -> Vec<String> {
        use crate::workspace::normalize_workspace_id;
        let mut out = Vec::new();
        for t in &self.visible_tools {
            if let Some(nid) = normalize_workspace_id(t) {
                if !out.iter().any(|x: &String| x == nid) {
                    out.push(nid.into());
                }
            }
        }
        if out.is_empty() {
            out.push("cursor".into());
        }
        out
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EntryTags {
    #[serde(default = "default_tag_scope")]
    pub scope: String,
    #[serde(default)]
    pub purposes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub level: Option<String>,
    /// Manual order within a library cluster region (lower first).
    #[serde(default)]
    pub sort_index: i32,
}

fn default_tag_scope() -> String {
    "global".into()
}

pub fn new_project_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("proj-{ms}-{:04}", (ms % 9973) as u32)
}

pub fn project_from_value(v: &serde_json::Value) -> Option<CatalogProject> {
    serde_json::from_value(v.clone()).ok().filter(|p: &CatalogProject| !p.id.is_empty())
}

pub fn project_to_value(p: &CatalogProject) -> serde_json::Value {
    serde_json::to_value(p).unwrap_or(serde_json::Value::Null)
}

pub fn list_projects(catalog: &LibraryCatalog) -> Vec<CatalogProject> {
    catalog
        .projects
        .iter()
        .filter_map(project_from_value)
        .collect()
}

fn load_healthy(library_root: &str) -> Result<LibraryCatalog, String> {
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy, refuse write: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    Ok(load.catalog)
}

pub fn find_project(library_root: &str, id: &str) -> Result<Option<CatalogProject>, String> {
    let catalog = load_healthy(library_root)?;
    Ok(list_projects(&catalog).into_iter().find(|p| p.id == id))
}

/// In-memory replace-or-append project by id（不写盘）。
pub fn upsert_project_in(catalog: &mut LibraryCatalog, project: &CatalogProject) {
    if let Some(idx) = catalog.projects.iter().position(|v| {
        v.get("id")
            .and_then(|x| x.as_str())
            .map(|s| s == project.id)
            .unwrap_or(false)
    }) {
        catalog.projects[idx] = project_to_value(project);
    } else {
        catalog.projects.push(project_to_value(project));
    }
}

pub fn upsert_project(
    library_root: &str,
    project: CatalogProject,
) -> Result<LibraryCatalog, String> {
    let mut catalog = load_healthy(library_root)?;
    upsert_project_in(&mut catalog, &project);
    if catalog.version <= 0 {
        catalog.version = 2;
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

pub fn remove_project(library_root: &str, id: &str) -> Result<LibraryCatalog, String> {
    let mut catalog = load_healthy(library_root)?;
    let before = catalog.projects.len();
    catalog.projects.retain(|v| {
        v.get("id")
            .and_then(|x| x.as_str())
            .map(|s| s != id)
            .unwrap_or(true)
    });
    if catalog.projects.len() == before {
        return Err(format!("project not found: {id}"));
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

/// Reorder within same pin group: `direction` = up|down|top|bottom, or absolute `to_index`.
pub fn reorder_project(
    library_root: &str,
    id: &str,
    direction: &str,
    to_index: Option<usize>,
) -> Result<LibraryCatalog, String> {
    let mut catalog = load_healthy(library_root)?;
    let projects = list_projects(&catalog);
    let idx = projects
        .iter()
        .position(|p| p.id == id)
        .ok_or_else(|| "项目不存在".to_string())?;
    let pinned = projects[idx].pinned;
    let peers: Vec<usize> = projects
        .iter()
        .enumerate()
        .filter(|(_, p)| p.pinned == pinned)
        .map(|(i, _)| i)
        .collect();
    let peer_pos = peers
        .iter()
        .position(|&i| i == idx)
        .ok_or_else(|| "无法重排".to_string())?;
    let mut peer_ids: Vec<String> = peers
        .iter()
        .filter_map(|&i| {
            catalog.projects[i]
                .get("id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    let dir = if to_index.is_some() {
        None
    } else if direction.is_empty() {
        Some("down")
    } else {
        Some(direction)
    };
    crate::list_order::reorder_ids(&mut peer_ids, id, dir, to_index)?;
    // Rewrite peer slots in catalog order.
    let mut by_id: std::collections::HashMap<String, serde_json::Value> =
        std::collections::HashMap::new();
    for &i in &peers {
        if let Some(pid) = catalog.projects[i].get("id").and_then(|v| v.as_str()) {
            by_id.insert(pid.to_string(), catalog.projects[i].clone());
        }
    }
    for (slot, pid) in peers.iter().zip(peer_ids.iter()) {
        if let Some(val) = by_id.get(pid) {
            catalog.projects[*slot] = val.clone();
        }
    }
    let _ = peer_pos;
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

/// Reassign `sortIndex` for entries in `ordered_ids` (0..n-1).
pub fn apply_entry_sort_indices(
    library_root: &str,
    ordered_ids: &[String],
) -> Result<LibraryCatalog, String> {
    let mut catalog = load_healthy(library_root)?;
    for (i, eid) in ordered_ids.iter().enumerate() {
        if let Some(e) = catalog
            .entries
            .iter_mut()
            .find(|e| e.id.eq_ignore_ascii_case(eid))
        {
            let mut tags = get_entry_tags(e);
            tags.sort_index = i as i32;
            set_entry_tags(e, tags);
        }
    }
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

pub fn get_entry_tags(e: &CatalogEntry) -> EntryTags {
    match e.extra.get("tags") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_else(|_| EntryTags {
            scope: default_tag_scope(),
            purposes: vec![],
            level: None,
            sort_index: 0,
        }),
        None => EntryTags {
            scope: default_tag_scope(),
            purposes: vec![],
            level: None,
            sort_index: 0,
        },
    }
}

/// Rule first, then other kinds, skills last. Within the same kind: sortIndex then id.
pub fn kind_sort_rank(kind: &str) -> u8 {
    match kind.trim().to_ascii_lowercase().as_str() {
        "rule" => 0,
        "skill" => 2,
        _ => 1,
    }
}

pub fn entry_sort_key(entry: &CatalogEntry) -> (u8, i32, String) {
    let tags = get_entry_tags(entry);
    (
        kind_sort_rank(&entry.kind),
        tags.sort_index,
        entry.id.to_lowercase(),
    )
}

pub fn set_entry_tags(e: &mut CatalogEntry, tags: EntryTags) {
    if let Ok(v) = serde_json::to_value(&tags) {
        e.extra.insert("tags".into(), v);
    }
}

pub fn update_entry_tags(
    library_root: &str,
    entry_id: &str,
    scope: &str,
    purposes: &[String],
) -> Result<(), String> {
    let load = load_healthy(library_root)?;
    let mut entry = load
        .entries
        .into_iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;
    let mut tags = get_entry_tags(&entry);
    tags.scope = if scope.trim().is_empty() {
        "global".into()
    } else {
        scope.trim().to_string()
    };
    let mut seen = std::collections::HashSet::new();
    tags.purposes = purposes
        .iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty() && seen.insert(p.clone()))
        .collect();
    set_entry_tags(&mut entry, tags);
    upsert_entry(library_root, entry)?;
    Ok(())
}

pub fn ensure_library_layout(library_root: &str) -> Result<(), String> {
    let root = Path::new(library_root);
    fs::create_dir_all(root).map_err(|e| format!("mkdir library: {e}"))?;
    for sub in ["skills", "rules", "agents", "commands", "hooks"] {
        fs::create_dir_all(root.join(sub)).map_err(|e| format!("mkdir {sub}: {e}"))?;
    }
    let catalog_path = root.join("catalog.json");
    if !catalog_path.exists() {
        write_empty_catalog(library_root)?;
    }
    Ok(())
}

/// Kind label for list UI (zh short).
pub fn kind_label(kind: &str) -> String {
    match kind {
        "skill" => "技能".into(),
        "rule" => "规则".into(),
        "agent" => "代理".into(),
        "command" => "命令".into(),
        "hook" => "钩子".into(),
        other => other.to_string(),
    }
}

/// Validate libraryPath of each in-library entry via path guard (does not require file exists).
pub fn validate_entry_paths(library_root: &str, entries: &[CatalogEntry]) -> Vec<String> {
    let mut errs = Vec::new();
    for e in entries {
        if !e.is_in_library || e.library_path.trim().is_empty() {
            continue;
        }
        if let Err(err) = resolve_library_safe_path(library_root, &e.library_path) {
            errs.push(format!("{}: {}", e.id, err));
        }
    }
    errs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn entry_sort_key_rules_before_skills() {
        let rule = CatalogEntry {
            id: "z-rule".into(),
            kind: "rule".into(),
            ..Default::default()
        };
        let skill = CatalogEntry {
            id: "a-skill".into(),
            kind: "skill".into(),
            ..Default::default()
        };
        assert!(entry_sort_key(&rule) < entry_sort_key(&skill));
        assert_eq!(kind_sort_rank("rule"), 0);
        assert_eq!(kind_sort_rank("skill"), 2);
    }

    #[test]
    fn ensure_layout_then_empty_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&root).unwrap();
        assert!(dir.path().join("skills").is_dir());
        assert!(dir.path().join("catalog.json").is_file());
        let load = load_catalog(&root);
        assert!(load.healthy);
        assert!(load.catalog.entries.is_empty());
    }

    #[test]
    fn loads_in_library_entries() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&root).unwrap();
        let fake = r#"{
  "version": 2,
  "projects": [],
  "entries": [
    {
      "id": "demo-skill",
      "kind": "skill",
      "libraryPath": "skills/demo-skill/SKILL.md",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    },
    {
      "id": "bad-path",
      "kind": "rule",
      "libraryPath": "..\\escape.md",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    }
  ]
}"#;
        fs::write(dir.path().join("catalog.json"), fake).unwrap();
        let load = load_catalog(&root);
        assert!(load.healthy);
        assert_eq!(load.catalog.entries.len(), 2);
        let warnings = validate_entry_paths(&root, &load.catalog.entries);
        assert!(
            warnings.iter().any(|w| w.contains("bad-path")),
            "expected path guard warning, got {warnings:?}"
        );
    }

    #[test]
    fn corrupt_catalog_not_healthy() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        fs::create_dir_all(&root).unwrap();
        fs::write(dir.path().join("catalog.json"), "{not-json").unwrap();
        let load = load_catalog(&root);
        assert!(!load.healthy);
        assert!(load.error.is_some());
    }

    #[test]
    fn merge_missing_catalog_records_adds_only_new() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from");
        let to = dir.path().join("to");
        fs::create_dir_all(&from).unwrap();
        fs::create_dir_all(&to).unwrap();
        fs::write(
            from.join("catalog.json"),
            r#"{
  "version": 2,
  "projects": [
    {"id":"proj-a","name":"A","rootPath":"E:\\Code\\A","pinned":true},
    {"id":"proj-b","name":"B","rootPath":"E:\\Code\\B","pinned":true}
  ],
  "entries": [
    {"id":"e1","kind":"skill","description":"E1","libraryPath":"skills/e1","isInLibrary":true},
    {"id":"e2","kind":"skill","description":"E2","libraryPath":"skills/e2","isInLibrary":true}
  ]
}"#,
        )
        .unwrap();
        fs::write(
            to.join("catalog.json"),
            r#"{
  "version": 2,
  "projects": [
    {"id":"proj-a","name":"A-keep","rootPath":"E:\\Code\\A","pinned":false}
  ],
  "entries": [
    {"id":"e1","kind":"skill","description":"E1-keep","libraryPath":"skills/e1","isInLibrary":true}
  ]
}"#,
        )
        .unwrap();

        let (entries_added, projects_added) = merge_missing_catalog_records(
            &from.to_string_lossy(),
            &to.to_string_lossy(),
        )
        .unwrap();
        assert_eq!(entries_added, 1);
        assert_eq!(projects_added, 1);
        let load = load_catalog(&to.to_string_lossy());
        assert!(load.healthy);
        assert_eq!(load.catalog.entries.len(), 2);
        assert_eq!(load.catalog.projects.len(), 2);
        let e1 = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == "e1")
            .unwrap();
        assert_eq!(
            e1.description, "E1-keep",
            "existing entry must not be overwritten"
        );
        let pa = project_from_value(
            load.catalog
                .projects
                .iter()
                .find(|p| {
                    project_from_value(p)
                        .map(|q| q.id == "proj-a")
                        .unwrap_or(false)
                })
                .unwrap(),
        )
        .unwrap();
        assert_eq!(pa.name, "A-keep");
        assert!(!pa.pinned);
    }
}
