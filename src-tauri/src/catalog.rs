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

/// Atomic write: `{pid}.tmp` → validate parse → rename over `catalog.json`.
pub fn save_catalog(library_root: &str, catalog: &LibraryCatalog) -> Result<(), String> {
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
    if let Some(idx) = catalog.entries.iter().position(|e| e.id == entry.id) {
        catalog.entries[idx] = entry;
    } else {
        catalog.entries.push(entry);
    }
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

pub fn upsert_project(
    library_root: &str,
    project: CatalogProject,
) -> Result<LibraryCatalog, String> {
    let mut catalog = load_healthy(library_root)?;
    if let Some(idx) = catalog.projects.iter().position(|v| {
        v.get("id")
            .and_then(|x| x.as_str())
            .map(|s| s == project.id)
            .unwrap_or(false)
    }) {
        catalog.projects[idx] = project_to_value(&project);
    } else {
        catalog.projects.push(project_to_value(&project));
    }
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

/// Reorder within same pin group: swap with neighbor in `direction` ("up"|"down").
pub fn reorder_project(
    library_root: &str,
    id: &str,
    direction: &str,
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
    let swap_pos = if direction == "up" {
        peer_pos.checked_sub(1)
    } else {
        Some(peer_pos + 1).filter(|&p| p < peers.len())
    }
    .ok_or_else(|| {
        if direction == "up" {
            "已在最前".to_string()
        } else {
            "已在最后".to_string()
        }
    })?;
    let a = peers[peer_pos];
    let b = peers[swap_pos];
    catalog.projects.swap(a, b);
    save_catalog(library_root, &catalog)?;
    Ok(catalog)
}

pub fn get_entry_tags(e: &CatalogEntry) -> EntryTags {
    match e.extra.get("tags") {
        Some(v) => serde_json::from_value(v.clone()).unwrap_or_else(|_| EntryTags {
            scope: default_tag_scope(),
            purposes: vec![],
            level: None,
        }),
        None => EntryTags {
            scope: default_tag_scope(),
            purposes: vec![],
            level: None,
        },
    }
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

pub fn update_entry_level(
    library_root: &str,
    entry_id: &str,
    level: Option<&str>,
) -> Result<(), String> {
    let load = load_healthy(library_root)?;
    let mut entry = load
        .entries
        .into_iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;
    let mut tags = get_entry_tags(&entry);
    tags.level = level.map(|s| s.to_string());
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
}
