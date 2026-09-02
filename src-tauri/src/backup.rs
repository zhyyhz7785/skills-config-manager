//! Move into permanent library (M3 residual: preview + move with conflicts).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    kind_label, list_projects, load_catalog, upsert_entry, validate_entry_paths, CatalogEntry,
};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::hash_path_auto;
use crate::path_guard::{assert_managed_container_path, resolve_library_safe_path};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};
use crate::withdraw::{remove_path, PathConflictDto};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreviewItem {
    pub entry_id: String,
    pub display_name: String,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePreviewResult {
    pub ok: bool,
    pub message: String,
    pub pending_count: u32,
    pub items: Vec<MovePreviewItem>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveBackupResult {
    pub ok: bool,
    pub message: String,
    pub moved: u32,
    pub skipped: u32,
    pub failed: u32,
    pub pending_count: u32,
    pub conflicts: Vec<PathConflictDto>,
    pub messages: Vec<String>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveResolution {
    pub key: String,
    pub choice: String,
}

fn snap(settings: &AppSettings) -> AppSnapshotSubset {
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    build_snapshot_subset(settings, &load, warnings)
}

fn under_dir(path: &str, root: &str) -> bool {
    let p = path.trim().replace('\\', "/").to_lowercase();
    let r = root.trim().replace('\\', "/").to_lowercase();
    let r = r.trim_end_matches('/');
    p == r || p.starts_with(&(r.to_string() + "/"))
}

fn copy_path(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let meta = fs::symlink_metadata(src).map_err(|e| format!("stat: {e}"))?;
    if meta.is_dir() {
        copy_dir(src, dst)
    } else {
        fs::copy(src, dst).map_err(|e| format!("copy: {e}"))?;
        Ok(())
    }
}

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for ent in fs::read_dir(src).map_err(|e| e.to_string())? {
        let ent = ent.map_err(|e| e.to_string())?;
        let to = dst.join(ent.file_name());
        if ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            copy_dir(&ent.path(), &to)?;
        } else {
            fs::copy(ent.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn folder_for_kind(kind: &str) -> &str {
    match kind {
        "skill" => "skills",
        "rule" => "rules",
        "agent" => "agents",
        "command" => "commands",
        "hook" => "hooks",
        _ => "skills",
    }
}

fn allowed_roots(settings: &AppSettings) -> Vec<String> {
    let mut roots = Vec::new();
    let active = crate::active_container::resolve_active_container_root(settings);
    if !active.trim().is_empty() {
        roots.push(active);
    }
    let lib = settings.skills_library_root.trim();
    for p in list_projects(&load_catalog(lib).catalog) {
        let cursor = Path::new(&p.root_path).join(".cursor");
        roots.push(cursor.to_string_lossy().to_string());
        roots.push(p.root_path);
    }
    roots
}

fn is_managed(settings: &AppSettings, path: &str) -> bool {
    let roots = allowed_roots(settings);
    let refs: Vec<&str> = roots.iter().map(|s| s.as_str()).collect();
    assert_managed_container_path(path, &refs, true).is_ok()
}

struct PendingMove {
    entry: CatalogEntry,
    current_path: String,
}

fn list_pending(settings: &AppSettings) -> Vec<PendingMove> {
    let lib = settings.skills_library_root.trim();
    let active = crate::active_container::resolve_active_container_root(settings);
    let active = active.trim();
    let load = load_catalog(lib);
    let mut out = Vec::new();
    for entry in load.catalog.entries {
        if entry.is_missing {
            continue;
        }
        let deployed = entry.deployed_path.trim();
        if !deployed.is_empty() && Path::new(deployed).exists() {
            // Spike may live under library root (.spike-container); still a container copy.
            let in_active = !active.is_empty() && under_dir(deployed, active);
            let in_pure_library = under_dir(deployed, lib) && !in_active;
            if !in_pure_library && is_managed(settings, deployed) {
                out.push(PendingMove {
                    current_path: deployed.to_string(),
                    entry,
                });
                continue;
            }
            if in_active {
                // Managed check may fail if roots not yet aligned; still accept active container
                out.push(PendingMove {
                    current_path: deployed.to_string(),
                    entry,
                });
                continue;
            }
        }
        // origins under managed container / active spike
        for o in &entry.origins {
            let p = o.original_path.trim();
            if p.is_empty() || !Path::new(p).exists() {
                continue;
            }
            let in_active = !active.is_empty() && under_dir(p, active);
            if under_dir(p, lib) && !in_active {
                continue;
            }
            if !in_active && !is_managed(settings, p) {
                continue;
            }
            if entry.deployed_path.trim().is_empty()
                || !Path::new(entry.deployed_path.trim()).exists()
            {
                out.push(PendingMove {
                    current_path: p.to_string(),
                    entry: entry.clone(),
                });
                break;
            }
        }
    }
    out
}

fn resolve_lib_compare(lib: &str, entry: &CatalogEntry) -> (PathBuf, String) {
    let folder = folder_for_kind(&entry.kind);
    let relative_dir = format!("{folder}/{}", entry.id);
    if !entry.library_path.trim().is_empty() {
        if let Ok(full) = resolve_library_safe_path(lib, &entry.library_path) {
            if full.exists() {
                return (full, entry.library_path.clone());
            }
        }
    }
    let dest = Path::new(lib).join(&relative_dir);
    (dest, relative_dir)
}

pub fn preview_move_into_backup(settings: &AppSettings) -> Result<MovePreviewResult, String> {
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let pending = list_pending(settings);
    let items: Vec<MovePreviewItem> = pending
        .iter()
        .map(|p| MovePreviewItem {
            entry_id: p.entry.id.clone(),
            display_name: format!("[{}] {}", kind_label(&p.entry.kind), p.entry.id),
            current_path: p.current_path.clone(),
        })
        .collect();
    let count = items.len() as u32;
    Ok(MovePreviewResult {
        ok: true,
        message: if count == 0 {
            "无待迁项（文件可能已在永久库）".into()
        } else {
            format!("待迁入 {count} 项")
        },
        pending_count: count,
        items,
        snapshot: snap(settings),
    })
}

pub fn move_into_backup_library(
    settings: &AppSettings,
    entry_ids: Option<&[String]>,
    resolutions: &[MoveResolution],
) -> Result<MoveBackupResult, String> {
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

    let res_map: HashMap<String, String> = resolutions
        .iter()
        .map(|r| {
            (
                r.key.trim().replace('\\', "/").to_lowercase(),
                r.choice.to_lowercase(),
            )
        })
        .collect();

    let mut pending = list_pending(settings);
    if let Some(ids) = entry_ids {
        if !ids.is_empty() {
            let set: std::collections::HashSet<_> = ids.iter().cloned().collect();
            pending.retain(|p| set.contains(&p.entry.id));
        }
    }

    let mut moved = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    let mut conflicts = Vec::new();
    let mut messages = Vec::new();
    let pending_count = pending.len() as u32;

    for PendingMove {
        mut entry,
        current_path,
    } in pending
    {
        let src = PathBuf::from(&current_path);
        if !src.exists() {
            failed += 1;
            messages.push(format!("{}: 源路径不存在", entry.id));
            continue;
        }
        let active = crate::active_container::resolve_active_container_root(settings);
        let in_active = !active.trim().is_empty() && under_dir(&current_path, active.trim());
        if !in_active && !is_managed(settings, &current_path) {
            failed += 1;
            messages.push(format!("{}: 容器路径不受管", entry.id));
            continue;
        }

        let (compare_path, rel_hint) = resolve_lib_compare(lib, &entry);
        let dest_exists = compare_path.exists();
        let src_cmp = resolve_comparable_content_path(&current_path, &entry.kind);
        let lib_cmp =
            resolve_comparable_content_path(&compare_path.to_string_lossy(), &entry.kind);
        let Ok((source_hash, _)) = (if src_cmp.is_file() {
            hash_path_auto(&src_cmp)
        } else {
            hash_path_auto(&src)
        }) else {
            failed += 1;
            messages.push(format!("{}: 无法哈希源", entry.id));
            continue;
        };
        let dest_hash = if dest_exists {
            if lib_cmp.is_file() {
                hash_path_auto(&lib_cmp)
                    .map(|(h, _)| h)
                    .unwrap_or_default()
            } else {
                hash_path_auto(&compare_path)
                    .map(|(h, _)| h)
                    .unwrap_or_default()
            }
        } else {
            String::new()
        };
        let same_as_library = dest_exists
            && !dest_hash.is_empty()
            && !source_hash.is_empty()
            && dest_hash.eq_ignore_ascii_case(&source_hash);

        if dest_exists && same_as_library {
            // delete container copy, clear deployedPath
            if let Err(e) = remove_path(&src) {
                failed += 1;
                messages.push(format!("{}: 内容相同但删除容器失败：{e}", entry.id));
                continue;
            }
            entry.is_in_library = true;
            entry.deployed_path = String::new();
            if entry.library_path.trim().is_empty() {
                entry.library_path = if compare_path.is_dir() {
                    rel_hint
                } else {
                    compare_path
                        .strip_prefix(lib)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or(rel_hint)
                };
            }
            if let Err(e) = upsert_entry(lib, entry) {
                failed += 1;
                messages.push(e);
            } else {
                moved += 1;
            }
            continue;
        }

        if dest_exists && !same_as_library {
            let key = format!("move:{}", entry.id);
            let choice = res_map.get(&key.replace('\\', "/").to_lowercase()).cloned();
            if choice.is_none() {
                let mut dto = crate::withdraw::path_conflict_dto(
                    key.clone(),
                    "moveIntoBackup",
                    entry.id.clone(),
                    entry.kind.clone(),
                    current_path.clone(),
                    compare_path.to_string_lossy().to_string(),
                    entry.id.clone(),
                    source_hash.clone(),
                    dest_hash.clone(),
                );
                if src_cmp.is_file() {
                    dto.source_compare_path = Some(src_cmp.to_string_lossy().to_string());
                }
                if lib_cmp.is_file() {
                    dto.target_compare_path = Some(lib_cmp.to_string_lossy().to_string());
                }
                conflicts.push(dto);
                continue;
            }
            let choice = choice.unwrap();
            if choice == "skip" {
                skipped += 1;
                continue;
            }
            if choice == "merge" {
                // keep library, delete container
                if let Err(e) = remove_path(&src) {
                    failed += 1;
                    messages.push(format!("{}: {e}", entry.id));
                    continue;
                }
                entry.is_in_library = true;
                entry.deployed_path = String::new();
                if entry.library_path.trim().is_empty() {
                    entry.library_path = compare_path
                        .strip_prefix(lib)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or(rel_hint);
                }
                if let Err(e) = upsert_entry(lib, entry) {
                    failed += 1;
                    messages.push(e);
                } else {
                    moved += 1;
                }
                continue;
            }
            if choice == "saveas" {
                let new_id = format!("{}-w", entry.id);
                let old_id = entry.id.clone();
                entry.id = new_id.clone();
                let folder = folder_for_kind(&entry.kind);
                let rel = if src.is_dir() {
                    format!("{folder}/{new_id}")
                } else {
                    let name = src
                        .file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "SKILL.md".into());
                    format!("{folder}/{new_id}/{name}")
                };
                let Ok(dest) = resolve_library_safe_path(lib, &rel) else {
                    failed += 1;
                    messages.push(format!("{old_id}: saveAs 路径越界"));
                    continue;
                };
                if let Err(e) = copy_path(&src, &dest) {
                    failed += 1;
                    messages.push(format!("{old_id}: {e}"));
                    continue;
                }
                let _ = remove_path(&src);
                entry.library_path = rel;
                entry.is_in_library = true;
                entry.deployed_path = String::new();
                // keep old entry? Electron removes after — for MVP leave old and add new; remove old deployed
                let mut old = load_catalog(lib)
                    .catalog
                    .entries
                    .into_iter()
                    .find(|e| e.id == old_id);
                if let Some(ref mut o) = old {
                    o.deployed_path = String::new();
                    let _ = upsert_entry(lib, o.clone());
                }
                if let Err(e) = upsert_entry(lib, entry) {
                    failed += 1;
                    messages.push(e);
                } else {
                    moved += 1;
                }
                continue;
            }
            // overwrite: container main file → library, then delete container
            if choice != "overwrite" {
                skipped += 1;
                continue;
            }
            let lib_dest = match resolve_library_main_dest(&compare_path, lib_cmp, &entry.kind) {
                Ok(p) => p,
                Err(e) => {
                    failed += 1;
                    messages.push(format!("{}: {e}", entry.id));
                    continue;
                }
            };
            let dep_cmp = if src_cmp.is_file() {
                src_cmp
            } else {
                resolve_comparable_content_path(&current_path, &entry.kind)
            };
            if let Err(e) = sync_main_file(&dep_cmp, &lib_dest) {
                failed += 1;
                messages.push(format!("{}: {e}", entry.id));
                continue;
            }
            if let Err(e) = verify_content_hash_match(&dep_cmp, &lib_dest) {
                failed += 1;
                messages.push(format!("{}: {e}", entry.id));
                continue;
            }
            if let Err(e) = remove_path(&src) {
                messages.push(format!("{}: 已覆盖库但删容器失败：{e}", entry.id));
                entry.is_in_library = true;
                if entry.library_path.trim().is_empty() {
                    entry.library_path = compare_path
                        .strip_prefix(lib)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or(rel_hint);
                }
                let _ = upsert_entry(lib, entry);
                failed += 1;
                continue;
            }
            entry.is_in_library = true;
            entry.deployed_path = String::new();
            if entry.library_path.trim().is_empty() {
                entry.library_path = compare_path
                    .strip_prefix(lib)
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or(rel_hint);
            }
            if let Err(e) = upsert_entry(lib, entry) {
                failed += 1;
                messages.push(e);
            } else {
                moved += 1;
            }
            continue;
        }

        // No library dest yet — copy source → library then clear deployed
        let folder = folder_for_kind(&entry.kind);
        let rel = if !entry.library_path.trim().is_empty() {
            entry.library_path.clone()
        } else if src.is_dir() {
            format!("{folder}/{}", entry.id)
        } else {
            let name = src
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "SKILL.md".into());
            format!("{folder}/{}/{name}", entry.id)
        };
        let Ok(dest) = resolve_library_safe_path(lib, &rel) else {
            failed += 1;
            messages.push(format!("{}: 目标路径越界", entry.id));
            continue;
        };
        if dest.exists() {
            let _ = remove_path(&dest);
        }
        // Prefer main-file sync when both sides resolve to files
        let src_cmp2 = resolve_comparable_content_path(&current_path, &entry.kind);
        let lib_cmp2 = resolve_comparable_content_path(&dest.to_string_lossy(), &entry.kind);
        let synced = if src_cmp2.is_file() {
            match resolve_library_main_dest(&dest, lib_cmp2, &entry.kind) {
                Ok(lib_dest) => sync_main_file(&src_cmp2, &lib_dest)
                    .and_then(|_| verify_content_hash_match(&src_cmp2, &lib_dest)),
                Err(e) => Err(e),
            }
        } else {
            copy_path(&src, &dest)
        };
        if let Err(e) = synced {
            failed += 1;
            messages.push(format!("{}: {e}", entry.id));
            continue;
        }
        if let Err(e) = remove_path(&src) {
            // copy ok but delete failed — still mark in library, keep deployed? Electron fails. We fail soft: keep deployed
            messages.push(format!("{}: 已复制但删容器失败：{e}", entry.id));
            entry.is_in_library = true;
            entry.library_path = rel;
            let _ = upsert_entry(lib, entry);
            failed += 1;
            continue;
        }
        entry.is_in_library = true;
        entry.library_path = rel;
        entry.deployed_path = String::new();
        if let Err(e) = upsert_entry(lib, entry) {
            failed += 1;
            messages.push(e);
        } else {
            moved += 1;
        }
    }

    // If any unresolved conflicts, don't claim full success
    let msg = format!(
        "迁入永久库：移动 {moved}，跳过 {skipped}，失败 {failed}，冲突 {}",
        conflicts.len()
    );
    Ok(MoveBackupResult {
        ok: failed == 0,
        message: msg,
        moved,
        skipped,
        failed,
        pending_count,
        conflicts,
        messages,
        snapshot: snap(settings),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ensure_library_layout;
    use crate::session::with_session;

    fn setup_dual(diff: bool) -> (tempfile::TempDir, AppSettings, String) {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("BProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# container\n",
        )
        .unwrap();
        let lib_body: &[u8] = if diff { b"# library\n" } else { b"# container\n" };
        fs::write(dir.path().join("skills/hello/SKILL.md"), lib_body).unwrap();
        let deployed = container
            .join("skills/hello/SKILL.md")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "bp".into(),
                name: "BProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "hello".into(),
                kind: "skill".into(),
                library_path: "skills/hello/SKILL.md".into(),
                is_in_library: true,
                deployed_path: deployed.clone(),
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("bp".into()),
            ..Default::default()
        };
        (dir, settings, deployed)
    }

    #[test]
    fn preview_lists_pending() {
        let (_dir, settings, _) = setup_dual(true);
        let prev = preview_move_into_backup(&settings).unwrap();
        assert!(prev.pending_count >= 1, "{}", prev.message);
    }

    #[test]
    fn conflict_then_overwrite() {
        let (dir, settings, _) = setup_dual(true);
        let r = move_into_backup_library(&settings, None, &[]).unwrap();
        assert!(!r.conflicts.is_empty(), "{}", r.message);
        let key = r.conflicts[0].key.clone();
        let r2 = move_into_backup_library(
            &settings,
            Some(&["hello".into()]),
            &[MoveResolution {
                key,
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(r2.conflicts.is_empty(), "{}", r2.message);
        assert!(r2.moved >= 1);
        let text = fs::read_to_string(dir.path().join("skills/hello/SKILL.md")).unwrap();
        assert!(text.contains("container"));
        let load = load_catalog(&settings.skills_library_root);
        let e = load.catalog.entries.iter().find(|e| e.id == "hello").unwrap();
        assert!(e.deployed_path.is_empty());
    }

    #[test]
    fn conflict_then_merge_keeps_library() {
        let (dir, settings, deployed) = setup_dual(true);
        let r = move_into_backup_library(&settings, None, &[]).unwrap();
        assert!(!r.conflicts.is_empty(), "{}", r.message);
        let key = r.conflicts[0].key.clone();
        let r2 = move_into_backup_library(
            &settings,
            Some(&["hello".into()]),
            &[MoveResolution {
                key,
                choice: "merge".into(),
            }],
        )
        .unwrap();
        assert!(r2.ok, "{} {:?}", r2.message, r2.messages);
        assert!(r2.moved >= 1);
        let text = fs::read_to_string(dir.path().join("skills/hello/SKILL.md")).unwrap();
        assert!(text.contains("library"));
        assert!(!text.contains("container"));
        assert!(!Path::new(&deployed).exists());
    }

    #[test]
    fn same_hash_clears_deployed() {
        let (_dir, settings, deployed) = setup_dual(false);
        assert!(Path::new(&deployed).exists());
        let r = move_into_backup_library(&settings, None, &[]).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert!(r.moved >= 1);
        assert!(!Path::new(&deployed).exists());
        let _ = with_session(|s| s.selected_entry_ids.clear());
    }
}
