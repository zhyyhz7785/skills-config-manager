//! Library drift report (Plan/05 W2-S4): container copies vs permanent library hashes.

use serde::Serialize;
use std::path::Path;

use crate::active_container::is_path_in_active_container_tree;
use crate::catalog::{load_catalog, CatalogEntry};
use crate::content_sync::resolve_comparable_content_path;
use crate::hash::hash_path_auto;
use crate::path_guard::resolve_library_safe_path;
use crate::settings::AppSettings;
use crate::workspace::{list_visible_workspaces, resolve_workspace_container_root};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftItemDto {
    pub entry_id: String,
    pub kind: String,
    pub workspace_id: String,
    pub container_path: String,
    pub library_path: String,
    pub container_hash: String,
    pub library_hash: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriftReportDto {
    pub ok: bool,
    pub message: String,
    pub items: Vec<DriftItemDto>,
}

fn entry_deployed_in_root(entry: &CatalogEntry, root: &str) -> Option<String> {
    let deployed = entry.deployed_path.trim();
    if deployed.is_empty() || !Path::new(deployed).exists() {
        return None;
    }
    let user_global = crate::active_container::is_user_global_container_root(root);
    if is_path_in_active_container_tree(deployed, root, user_global) {
        Some(deployed.to_string())
    } else {
        None
    }
}

/// Scan visible workspaces (global) + optional project container: list entries whose
/// live container content hash ≠ permanent library hash.
pub fn preview_library_drift(settings: &AppSettings) -> Result<DriftReportDto, String> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账未健康：{}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }

    let mut roots: Vec<(String, String)> = Vec::new();
    let kind = settings.nav_kind.trim().to_lowercase();
    if kind.is_empty() || kind == "global" {
        for w in list_visible_workspaces(settings) {
            let root = resolve_workspace_container_root(settings, &w.id);
            if !root.trim().is_empty() {
                roots.push((w.id.clone(), root));
            }
        }
    } else if kind == "project" {
        let active = crate::active_container::resolve_active_container_root(settings);
        if !active.trim().is_empty() {
            roots.push(("project".into(), active));
        }
    }

    let mut items = Vec::new();
    for e in &load.catalog.entries {
        if !e.is_in_library || e.library_path.trim().is_empty() {
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &e.library_path) else {
            continue;
        };
        if !lib_full.exists() {
            continue;
        }
        let lib_cmp = resolve_comparable_content_path(&lib_full.to_string_lossy(), &e.kind);
        if !lib_cmp.is_file() && !lib_cmp.is_dir() {
            continue;
        }
        let Ok((lib_hash, _)) = hash_path_auto(&lib_cmp) else {
            continue;
        };
        if lib_hash.is_empty() {
            continue;
        }

        for (ws_id, root) in &roots {
            let Some(deployed) = entry_deployed_in_root(e, root) else {
                continue;
            };
            let dep_cmp = resolve_comparable_content_path(&deployed, &e.kind);
            if !dep_cmp.exists() {
                continue;
            }
            let Ok((ctr_hash, _)) = hash_path_auto(&dep_cmp) else {
                continue;
            };
            if ctr_hash.is_empty() || ctr_hash.eq_ignore_ascii_case(&lib_hash) {
                continue;
            }
            items.push(DriftItemDto {
                entry_id: e.id.clone(),
                kind: e.kind.clone(),
                workspace_id: ws_id.clone(),
                container_path: dep_cmp.to_string_lossy().to_string(),
                library_path: lib_cmp.to_string_lossy().to_string(),
                container_hash: ctr_hash,
                library_hash: lib_hash.clone(),
                reason: "容器副本与永久库内容哈希不一致".into(),
            });
        }
    }

    let n = items.len();
    Ok(DriftReportDto {
        ok: true,
        message: if n == 0 {
            "未发现与永久库不一致的容器副本".into()
        } else {
            format!("发现 {n} 项漂移（与库不一致）")
        },
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{
        ensure_library_layout, upsert_entry, upsert_project, CatalogEntry, CatalogProject,
    };
    use std::fs;

    #[test]
    fn drifted_container_copy_appears_in_report() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("DProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/drift")).unwrap();
        fs::create_dir_all(dir.path().join("skills/drift")).unwrap();
        fs::write(dir.path().join("skills/drift/SKILL.md"), b"# lib\n").unwrap();
        fs::write(container.join("skills/drift/SKILL.md"), b"# dirty\n").unwrap();
        let deployed = container
            .join("skills/drift/SKILL.md")
            .to_string_lossy()
            .to_string();
        upsert_project(
            &lib,
            CatalogProject {
                id: "dp".into(),
                name: "DProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "drift".into(),
                kind: "skill".into(),
                library_path: "skills/drift/SKILL.md".into(),
                is_in_library: true,
                deployed_path: deployed,
                ..Default::default()
            },
        )
        .unwrap();

        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("dp".into()),
            ..Default::default()
        };
        let report = preview_library_drift(&settings).unwrap();
        assert!(
            report.items.iter().any(|i| i.entry_id == "drift"),
            "{:?}",
            report
        );
    }

    #[test]
    fn identical_copy_not_in_drift_report() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("CProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/clean")).unwrap();
        fs::create_dir_all(dir.path().join("skills/clean")).unwrap();
        let body = b"# clean\n";
        fs::write(dir.path().join("skills/clean/SKILL.md"), body).unwrap();
        fs::write(container.join("skills/clean/SKILL.md"), body).unwrap();
        let deployed = container
            .join("skills/clean/SKILL.md")
            .to_string_lossy()
            .to_string();
        upsert_project(
            &lib,
            CatalogProject {
                id: "cp".into(),
                name: "CProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "clean".into(),
                kind: "skill".into(),
                library_path: "skills/clean/SKILL.md".into(),
                is_in_library: true,
                deployed_path: deployed,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("cp".into()),
            ..Default::default()
        };
        let report = preview_library_drift(&settings).unwrap();
        assert!(report.items.is_empty(), "{:?}", report.items);
    }
}
