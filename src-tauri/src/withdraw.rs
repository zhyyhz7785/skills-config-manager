//! Withdraw dual-copy: batch + conflict resolutions (M3 domain 3).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{load_catalog, upsert_entry, validate_entry_paths, CatalogEntry};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::hash_path_auto;
use crate::path_guard::{assert_managed_container_path, resolve_library_safe_path};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathConflictDto {
    pub key: String,
    pub operation: String,
    pub suggested_id: String,
    pub kind: String,
    pub source_path: String,
    pub target_path: String,
    pub source_preview: String,
    pub target_preview: String,
    pub existing_entry_id: String,
    pub source_hash: String,
    pub target_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_preview_lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_preview_lines: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_compare_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_compare_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_modified: Option<String>,
}

/// Build conflict DTO with Electron-parity previews (64KB / 200 lines).
pub fn path_conflict_dto(
    key: String,
    operation: &str,
    suggested_id: String,
    kind: String,
    source_path: String,
    target_path: String,
    existing_entry_id: String,
    source_hash: String,
    target_hash: String,
) -> PathConflictDto {
    use crate::conflict_preview::read_preview_enhanced;
    let src = Path::new(&source_path);
    let tgt = Path::new(&target_path);
    let sp = read_preview_enhanced(src);
    let tp = read_preview_enhanced(tgt);
    let source_size = fs::metadata(src).ok().map(|m| m.len());
    let target_size = fs::metadata(tgt).ok().map(|m| m.len());
    PathConflictDto {
        key,
        operation: operation.into(),
        suggested_id,
        kind,
        source_path: source_path.clone(),
        target_path: target_path.clone(),
        source_preview: sp.content,
        target_preview: tp.content,
        existing_entry_id,
        source_hash,
        target_hash,
        source_preview_lines: Some(sp.lines as u32),
        target_preview_lines: Some(tp.lines as u32),
        source_compare_path: Some(source_path),
        target_compare_path: Some(target_path),
        source_size,
        target_size,
        source_modified: None,
        target_modified: None,
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictResolution {
    pub key: String,
    pub choice: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawBatchResult {
    pub ok: bool,
    pub moved: u32,
    pub skipped: u32,
    pub failed: u32,
    pub conflicts: Vec<PathConflictDto>,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
}

/// Legacy single-entry result (kept for older callers/tests).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WithdrawResult {
    pub ok: bool,
    pub mode: String,
    pub entry_id: String,
    pub container_path: String,
    pub library_path: String,
    pub source_hash: Option<String>,
    pub target_hash: Option<String>,
    pub message: String,
    pub snapshot: Option<AppSnapshotSubset>,
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

pub fn remove_path(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("stat for delete: {e}"))?;
    if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("rm dir: {e}"))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("unlink: {e}"))?;
    }
    let mut parent = path.parent();
    while let Some(p) = parent {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.eq_ignore_ascii_case(".spike-container")
            || name.eq_ignore_ascii_case(".cursor")
            || name.eq_ignore_ascii_case(".claude")
            || name.eq_ignore_ascii_case(".codex")
        {
            break;
        }
        match fs::remove_dir(p) {
            Ok(()) => parent = p.parent(),
            Err(_) => break,
        }
    }
    Ok(())
}

fn copy_over(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let sm = fs::symlink_metadata(src).map_err(|e| format!("stat src: {e}"))?;
    if sm.is_dir() {
        if dst.exists() {
            remove_path(dst)?;
        }
        // recursive copy
        fn copy_dir(s: &Path, d: &Path) -> Result<(), String> {
            fs::create_dir_all(d).map_err(|e| e.to_string())?;
            for ent in fs::read_dir(s).map_err(|e| e.to_string())? {
                let ent = ent.map_err(|e| e.to_string())?;
                let to = d.join(ent.file_name());
                if ent.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    copy_dir(&ent.path(), &to)?;
                } else {
                    fs::copy(ent.path(), &to).map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        }
        copy_dir(src, dst)
    } else {
        fs::copy(src, dst).map_err(|e| format!("copy: {e}"))?;
        Ok(())
    }
}

fn conflict_key(entry_id: &str) -> String {
    format!("withdraw:{entry_id}")
}

fn finish_withdraw_ok(entry: &CatalogEntry, library_root: &str) -> Result<(), String> {
    let mut updated = entry.clone();
    updated.deployed_path = String::new();
    updated.is_missing = false;
    updated.is_in_library = true;
    upsert_entry(library_root, updated)?;
    Ok(())
}

fn save_as_conflict_copy(
    settings: &AppSettings,
    entry: &CatalogEntry,
    source: &Path,
    library_full: &Path,
) -> Result<(), String> {
    let library_root = settings.skills_library_root.trim();
    let new_id = format!("{}__conflict", entry.id);
    let parent = library_full
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(library_root));
    let file_name = library_full
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "SKILL.md".into());
    let dest_dir = parent.join(format!("{}__conflict", entry.id));
    fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = if source.is_dir() {
        dest_dir.clone()
    } else {
        dest_dir.join(&file_name)
    };
    copy_over(source, &dest)?;
    let rel = dest
        .strip_prefix(library_root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| format!("skills/{new_id}/{file_name}"));
    let mut new_entry = entry.clone();
    new_entry.id = new_id;
    new_entry.library_path = rel;
    new_entry.deployed_path = String::new();
    new_entry.is_in_library = true;
    new_entry.is_missing = false;
    upsert_entry(library_root, new_entry)?;
    // original: clear deployed only
    let mut orig = entry.clone();
    orig.deployed_path = String::new();
    upsert_entry(library_root, orig)?;
    remove_path(source)?;
    Ok(())
}

pub fn withdraw_entries(
    settings: &AppSettings,
    entry_ids: &[String],
    resolutions: &[ConflictResolution],
) -> Result<WithdrawBatchResult, String> {
    let library_root = settings.skills_library_root.trim();
    let container_root = crate::active_container::resolve_active_container_root(settings);
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    if container_root.trim().is_empty() {
        return Err("active container root empty".into());
    }
    let container_root = container_root.trim();

    let res_map: std::collections::HashMap<String, String> = resolutions
        .iter()
        .map(|r| (r.key.clone(), r.choice.to_lowercase()))
        .collect();

    let mut moved = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    let mut conflicts = Vec::new();

    for raw_id in entry_ids {
        let id = raw_id.trim();
        if id.is_empty() {
            continue;
        }
        let load = load_catalog(library_root);
        if !load.healthy {
            failed += 1;
            continue;
        }
        let Some(entry) = load.catalog.entries.iter().find(|e| e.id == id).cloned() else {
            failed += 1;
            continue;
        };
        if !entry.is_in_library {
            failed += 1;
            continue;
        }
        let library_full = match resolve_library_safe_path(library_root, &entry.library_path) {
            Ok(p) => p,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        if !library_full.exists() {
            failed += 1;
            continue;
        }
        let source = entry.deployed_path.trim();
        if source.is_empty() {
            skipped += 1;
            continue;
        }
        let source_path = Path::new(source);
        if !source_path.exists() {
            // stale deploy path
            let _ = finish_withdraw_ok(&entry, library_root);
            moved += 1;
            continue;
        }
        if let Err(e) = assert_managed_container_path(source, &[container_root], true) {
            failed += 1;
            let _ = e;
            continue;
        }

        let src_cmp = resolve_comparable_content_path(source, &entry.kind);
        let lib_cmp = resolve_comparable_content_path(&library_full.to_string_lossy(), &entry.kind);
        let (source_hash, _) = if src_cmp.is_file() {
            hash_path_auto(&src_cmp)?
        } else {
            hash_path_auto(source_path)?
        };
        let (library_hash, _) = if lib_cmp.is_file() {
            hash_path_auto(&lib_cmp)?
        } else {
            hash_path_auto(&library_full)?
        };
        let same = !source_hash.is_empty()
            && !library_hash.is_empty()
            && source_hash.eq_ignore_ascii_case(&library_hash);

        let key = conflict_key(id);
        let choice = res_map.get(&key).map(|s| s.as_str()).unwrap_or("");

        if same {
            if let Err(e) = remove_path(source_path) {
                failed += 1;
                let _ = e;
                continue;
            }
            if finish_withdraw_ok(&entry, library_root).is_ok() {
                moved += 1;
            } else {
                failed += 1;
            }
            continue;
        }

        // content conflict
        if choice.is_empty() {
            let mut dto = path_conflict_dto(
                key,
                "withdraw",
                id.to_string(),
                entry.kind.clone(),
                source.to_string(),
                library_full.to_string_lossy().to_string(),
                id.to_string(),
                source_hash.clone(),
                library_hash.clone(),
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

        match choice {
            "skip" => {
                skipped += 1;
            }
            "merge" => {
                // Keep library; delete container copy only.
                if remove_path(source_path).is_err() {
                    failed += 1;
                    continue;
                }
                if finish_withdraw_ok(&entry, library_root).is_ok() {
                    moved += 1;
                } else {
                    failed += 1;
                }
            }
            "overwrite" => {
                // Container main file → library, then delete container.
                let dep_cmp = if src_cmp.is_file() {
                    src_cmp.clone()
                } else {
                    resolve_comparable_content_path(source, &entry.kind)
                };
                let lib_dest = match resolve_library_main_dest(
                    &library_full,
                    if lib_cmp.is_file() {
                        lib_cmp.clone()
                    } else {
                        resolve_comparable_content_path(
                            &library_full.to_string_lossy(),
                            &entry.kind,
                        )
                    },
                    &entry.kind,
                ) {
                    Ok(p) => p,
                    Err(_) => {
                        failed += 1;
                        continue;
                    }
                };
                if sync_main_file(&dep_cmp, &lib_dest).is_err() {
                    failed += 1;
                    continue;
                }
                if verify_content_hash_match(&dep_cmp, &lib_dest).is_err() {
                    failed += 1;
                    continue;
                }
                if remove_path(source_path).is_err() {
                    failed += 1;
                    continue;
                }
                if finish_withdraw_ok(&entry, library_root).is_ok() {
                    moved += 1;
                } else {
                    failed += 1;
                }
            }
            "saveas" | "saveAs" => {
                if let Err(e) =
                    save_as_conflict_copy(settings, &entry, source_path, &library_full)
                {
                    failed += 1;
                    let _ = e;
                } else {
                    moved += 1;
                }
            }
            other => {
                failed += 1;
                let _ = other;
            }
        }
    }

    let snapshot = snap(settings);
    let message = format!(
        "移出到永久库：移动 {moved}，跳过 {skipped}，失败 {failed}，冲突 {}",
        conflicts.len()
    );
    // Electron returns ok even with conflicts so UI can show dialog; treat conflicts as soft.
    Ok(WithdrawBatchResult {
        ok: failed == 0,
        moved,
        skipped,
        failed,
        conflicts,
        message,
        snapshot,
    })
}

pub fn withdraw_entry(settings: &AppSettings, entry_id: &str) -> Result<WithdrawResult, String> {
    let batch = withdraw_entries(settings, &[entry_id.to_string()], &[])?;
    if !batch.conflicts.is_empty() {
        let c = &batch.conflicts[0];
        return Ok(WithdrawResult {
            ok: false,
            mode: "contentConflict".into(),
            entry_id: entry_id.to_string(),
            container_path: c.source_path.clone(),
            library_path: c.target_path.clone(),
            source_hash: Some(c.source_hash.clone()),
            target_hash: Some(c.target_hash.clone()),
            message: batch.message,
            snapshot: Some(batch.snapshot),
        });
    }
    Ok(WithdrawResult {
        ok: batch.ok && batch.failed == 0,
        mode: if batch.moved > 0 {
            "sameHashDeleted".into()
        } else {
            "noop".into()
        },
        entry_id: entry_id.to_string(),
        container_path: String::new(),
        library_path: String::new(),
        source_hash: None,
        target_hash: None,
        message: batch.message,
        snapshot: Some(batch.snapshot),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, save_catalog, CatalogEntry};

    fn setup_dual(same: bool) -> (tempfile::TempDir, AppSettings, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("WProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/p2-w")).unwrap();

        let lib_file = dir.path().join("skills/p2-w/SKILL.md");
        fs::create_dir_all(lib_file.parent().unwrap()).unwrap();
        fs::write(&lib_file, b"# skill\nbody\n").unwrap();

        let ctr_file = container.join("skills/p2-w/SKILL.md");
        if same {
            fs::write(&ctr_file, b"# skill\nbody\n").unwrap();
        } else {
            fs::write(&ctr_file, b"# skill\nDIFFERENT\n").unwrap();
        }

        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "wp".into(),
                name: "WProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();

        let entry = CatalogEntry {
            id: "p2-w".into(),
            kind: "skill".into(),
            library_path: "skills/p2-w/SKILL.md".into(),
            is_in_library: true,
            deployed_path: ctr_file.to_string_lossy().to_string(),
            is_missing: false,
            ..Default::default()
        };
        let mut cat = load_catalog(&lib_root).catalog;
        cat.entries.push(entry);
        save_catalog(&lib_root, &cat).unwrap();

        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("wp".into()),
            ..Default::default()
        };
        (dir, settings, lib_file, ctr_file)
    }

    #[test]
    fn same_hash_deletes_copy() {
        let (_dir, settings, lib_file, ctr_file) = setup_dual(true);
        let r = withdraw_entry(&settings, "p2-w").unwrap();
        assert!(r.ok);
        assert!(!ctr_file.exists());
        assert!(lib_file.exists());
    }

    #[test]
    fn diff_hash_returns_conflicts() {
        let (_dir, settings, _lib, ctr_file) = setup_dual(false);
        let r = withdraw_entries(&settings, &["p2-w".into()], &[]).unwrap();
        assert_eq!(r.conflicts.len(), 1);
        assert!(ctr_file.exists());
    }

    #[test]
    fn overwrite_resolves_conflict() {
        let (_dir, settings, lib_file, ctr_file) = setup_dual(false);
        let r = withdraw_entries(
            &settings,
            &["p2-w".into()],
            &[ConflictResolution {
                key: "withdraw:p2-w".into(),
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("DIFFERENT"));
    }

    #[test]
    fn merge_keeps_library_deletes_container() {
        let (_dir, settings, lib_file, ctr_file) = setup_dual(false);
        let r = withdraw_entries(
            &settings,
            &["p2-w".into()],
            &[ConflictResolution {
                key: "withdraw:p2-w".into(),
                choice: "merge".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{}", r.message);
        assert_eq!(r.moved, 1);
        assert!(!ctr_file.exists());
        let body = fs::read_to_string(&lib_file).unwrap();
        assert!(body.contains("body"));
        assert!(!body.contains("DIFFERENT"));
    }

    #[test]
    fn skip_leaves_container() {
        let (_dir, settings, _lib, ctr_file) = setup_dual(false);
        let r = withdraw_entries(
            &settings,
            &["p2-w".into()],
            &[ConflictResolution {
                key: "withdraw:p2-w".into(),
                choice: "skip".into(),
            }],
        )
        .unwrap();
        assert_eq!(r.skipped, 1);
        assert!(ctr_file.exists());
    }
}
