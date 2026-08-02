//! Deploy library entries into the active nav container.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::active_container::{is_user_global_container_root, resolve_active_container_root};
use crate::catalog::{load_catalog, upsert_entry, validate_entry_paths, CatalogEntry};
use crate::path_guard::{assert_managed_container_path, resolve_library_safe_path};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub ok: bool,
    pub succeeded: u32,
    pub failed: u32,
    pub errors: Vec<String>,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
}

fn kind_folder(kind: &str) -> &str {
    match kind {
        "skill" => "skills",
        "rule" => "rules",
        "agent" => "agents",
        "command" => "commands",
        "hook" => "hooks",
        _ => "skills",
    }
}

/// Resolve deploy target under container root.
pub fn resolve_deploy_target(entry: &CatalogEntry, container_root: &str) -> PathBuf {
    let root = Path::new(container_root);
    let folder = kind_folder(&entry.kind);
    let lib = entry.library_path.replace('\\', "/").to_lowercase();

    // Prefer origin under this container if present — and for rules, only if already flat.
    for o in &entry.origins {
        let p = o.original_path.trim();
        if p.is_empty() {
            continue;
        }
        if !p.to_lowercase().starts_with(&container_root.to_lowercase()) {
            continue;
        }
        if !Path::new(p).exists() {
            continue;
        }
        if entry.kind.eq_ignore_ascii_case("rule")
            && !crate::rule_layout::is_flat_rule_abs_under_container(p, container_root)
        {
            continue;
        }
        return PathBuf::from(p);
    }

    match entry.kind.as_str() {
        "skill" if lib.ends_with(".skill") => root.join(folder).join(format!("{}.skill", entry.id)),
        "skill" => {
            // File SKILL.md → skills/{id}/SKILL.md; directory → skills/{id}/
            let lib_full_guess = entry.library_path.trim();
            if lib_full_guess.to_lowercase().ends_with("skill.md")
                || lib_full_guess.to_lowercase().ends_with(".md")
            {
                root.join(folder).join(&entry.id).join(
                    Path::new(lib_full_guess)
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "SKILL.md".into()),
                )
            } else {
                root.join(folder).join(&entry.id)
            }
        }
        "rule" => {
            let ext = if entry.library_path.trim().is_empty() {
                ".mdc".into()
            } else {
                crate::rule_layout::ext_from_path(Path::new(&entry.library_path))
            };
            root.join(folder).join(format!("{}{}", entry.id, ext))
        }
        "agent" | "command" => root.join(folder).join(format!("{}.md", entry.id)),
        "hook" if lib.ends_with(".json") => root.join("hooks.json"),
        "hook" => root.join(folder).join(format!("{}.ps1", entry.id)),
        _ => root.join(folder).join(&entry.id),
    }
}

fn copy_path(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let meta = fs::symlink_metadata(src).map_err(|e| format!("stat source: {e}"))?;
    if meta.is_dir() {
        copy_dir_recursive(src, dst)
    } else {
        fs::copy(src, dst).map_err(|e| format!("copy file: {e}"))?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir dst: {e}"))?;
    for ent in fs::read_dir(src).map_err(|e| format!("read_dir: {e}"))? {
        let ent = ent.map_err(|e| format!("read_dir entry: {e}"))?;
        let ty = ent.file_type().map_err(|e| e.to_string())?;
        let to = dst.join(ent.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&ent.path(), &to)?;
        } else {
            fs::copy(ent.path(), &to).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

pub fn deploy_one(
    settings: &AppSettings,
    entry_id: &str,
) -> Result<(), String> {
    let library_root = settings.skills_library_root.trim();
    let container_root = resolve_active_container_root(settings);
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    if container_root.trim().is_empty() {
        return Err("active container root empty".into());
    }
    let container_root = container_root.trim();
    if !Path::new(container_root).exists() {
        fs::create_dir_all(container_root).map_err(|e| format!("mkdir container: {e}"))?;
    }

    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;

    if entry.kind.eq_ignore_ascii_case("rule") {
        let changed = crate::rule_layout::repath_rule_entry_to_flat(library_root, &mut entry)?;
        if changed {
            upsert_entry(library_root, entry.clone())?;
        }
    }

    if entry.library_path.trim().is_empty() {
        return Err(format!("「{entry_id}」无库路径，无法部署"));
    }
    let library_full = resolve_library_safe_path(library_root, &entry.library_path)
        .map_err(|e| format!("library path: {e}"))?;
    if !library_full.exists() {
        return Err(format!("库中文件不存在：{}", library_full.display()));
    }

    let target = resolve_deploy_target(&entry, container_root);
    let target_s = target.to_string_lossy().to_string();
    let allow_global = is_user_global_container_root(container_root);
    assert_managed_container_path(&target_s, &[container_root], allow_global)
        .map_err(|e| format!("部署目标不受管：{e}：{target_s}"))?;

    if target.exists() {
        return Err(format!("目标已存在：{target_s}"));
    }

    copy_path(&library_full, &target)?;

    // Drop leftover nested shell in container if we wrote flat.
    if entry.kind.eq_ignore_ascii_case("rule") {
        let nested = Path::new(container_root)
            .join("rules")
            .join(&entry.id);
        if nested.is_dir() {
            let _ = fs::remove_dir_all(&nested);
        }
    }

    let mut updated = entry;
    updated.is_in_library = true;
    updated.is_missing = false;
    updated.deployed_path = target_s;
    upsert_entry(library_root, updated)?;
    Ok(())
}

pub fn deploy_entries(settings: &AppSettings, entry_ids: &[String]) -> Result<DeployResult, String> {
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    let mut errors = Vec::new();
    for id in entry_ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        match deploy_one(settings, id) {
            Ok(()) => succeeded += 1,
            Err(e) => {
                failed += 1;
                errors.push(format!("{id}: {e}"));
            }
        }
    }
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    let snapshot = build_snapshot_subset(settings, &load, warnings);
    let message = format!("放入：成功 {succeeded}，失败 {failed}");
    Ok(DeployResult {
        ok: failed == 0,
        succeeded,
        failed,
        errors,
        message,
        snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, save_catalog, CatalogEntry};

    #[test]
    fn deploy_skill_file_then_exists_in_container() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        let container = proj.join(".cursor");
        fs::create_dir_all(&container).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/demo")).unwrap();
        let lib_file = dir.path().join("skills/demo/SKILL.md");
        fs::write(&lib_file, b"# demo\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "demo".into(),
                    kind: "skill".into(),
                    library_path: "skills/demo/SKILL.md".into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["demo".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        let target = container.join("skills/demo/SKILL.md");
        assert!(target.exists());
        let load = load_catalog(&settings.skills_library_root);
        let e = load.catalog.entries.iter().find(|e| e.id == "demo").unwrap();
        assert!(!e.deployed_path.is_empty());
    }

    #[test]
    fn deploy_to_focus_global_workspace_claude() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let claude = dir.path().join(".claude");
        fs::create_dir_all(&claude).unwrap();
        fs::create_dir_all(dir.path().join("skills/g1")).unwrap();
        fs::write(dir.path().join("skills/g1/SKILL.md"), b"# g1\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "g1".into(),
                    kind: "skill".into(),
                    library_path: "skills/g1/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "claude".into(),
            ..Default::default()
        };
        crate::workspace::ensure_workspaces_migrated(&mut settings);
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.container_root = claude.to_string_lossy().to_string();
            w.enabled = true;
        }
        settings.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let r = deploy_entries(&settings, &["g1".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(claude.join("skills/g1/SKILL.md").is_file());
    }

    #[test]
    fn deploy_rule_writes_flat_mdc() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("rules")).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();
        let nested = dir
            .path()
            .join("rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"# L0-01\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "L0-01-thinking-and-explanation".into(),
                    kind: "rule".into(),
                    library_path:
                        "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc"
                            .into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["L0-01-thinking-and-explanation".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(container
            .join("rules/L0-01-thinking-and-explanation.mdc")
            .is_file());
        assert!(!container
            .join("rules/L0-01-thinking-and-explanation")
            .exists());
        let entry = load_catalog(&lib_root)
            .catalog
            .entries
            .into_iter()
            .find(|e| e.id == "L0-01-thinking-and-explanation")
            .unwrap();
        assert_eq!(
            entry.library_path,
            "rules/L0-01-thinking-and-explanation.mdc"
        );
    }
}
