//! Withdraw dual-copy: batch + conflict resolutions (M3 domain 3).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{load_catalog, upsert_entry, validate_entry_paths, CatalogEntry};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::{content_equivalent, hash_path_auto};
use crate::list_cluster::find_live_path_in_active_container;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_created: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_created: Option<String>,
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
    let source_stat = file_stat(src);
    let target_stat = file_stat(tgt);
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
        source_size: source_stat.size,
        target_size: target_stat.size,
        source_modified: source_stat.modified,
        target_modified: target_stat.modified,
        source_created: source_stat.created,
        target_created: target_stat.created,
    }
}

struct FileStat {
    size: Option<u64>,
    modified: Option<String>,
    created: Option<String>,
}

fn file_stat(path: &Path) -> FileStat {
    match fs::metadata(path) {
        Ok(meta) => FileStat {
            size: Some(meta.len()),
            modified: meta.modified().ok().and_then(system_time_iso_utc),
            created: meta.created().ok().and_then(system_time_iso_utc),
        },
        Err(_) => FileStat {
            size: None,
            modified: None,
            created: None,
        },
    }
}

fn system_time_iso_utc(t: std::time::SystemTime) -> Option<String> {
    let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs();
    Some(unix_secs_to_rfc3339_utc(secs))
}

/// UTC 秒 → `YYYY-MM-DDTHH:MM:SSZ`（不引入 chrono）。
fn unix_secs_to_rfc3339_utc(secs: u64) -> String {
    let z = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3600;
    let min = (rem % 3600) / 60;
    let sec = rem % 60;
    let (year, month, day) = civil_from_unix_days(z);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{min:02}:{sec:02}Z")
}

/// 自 1970-01-01 起的整天数 → 公历年月日（Howard Hinnant `civil_from_days`）。
fn civil_from_unix_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
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
    if meta.file_type().is_symlink() {
        // Unlink only — never delete the permanent-library target through the link.
        if fs::remove_dir(path).is_err() {
            fs::remove_file(path).map_err(|e| format!("unlink: {e}"))?;
        }
    } else if meta.is_dir() {
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
    let container_root = crate::active_container::resolve_active_container_root(settings);
    let user_global = settings.nav_kind.trim().eq_ignore_ascii_case("global")
        || settings.nav_kind.trim().is_empty()
        || crate::active_container::is_user_global_container_root(&container_root);
    withdraw_entries_at(
        settings,
        entry_ids,
        resolutions,
        &container_root,
        user_global,
        "withdraw",
        "withdraw",
        None,
    )
}

pub fn withdraw_entries_at(
    settings: &AppSettings,
    entry_ids: &[String],
    resolutions: &[ConflictResolution],
    container_root: &str,
    user_global: bool,
    key_prefix: &str,
    operation: &str,
    kind: Option<&str>,
) -> Result<WithdrawBatchResult, String> {
    let library_root = settings.skills_library_root.trim();
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
        let Some(mut entry) = load
            .catalog
            .entries
            .iter()
            .find(|e| {
                e.id == id
                    && kind
                        .map(|k| e.kind.eq_ignore_ascii_case(k))
                        .unwrap_or(true)
            })
            .cloned()
        else {
            failed += 1;
            continue;
        };
        if entry.kind.eq_ignore_ascii_case("skill") {
            let _ = crate::skill_layout::normalize_skill_entry_paths(&mut entry);
        }
        let library_full_raw = match resolve_library_safe_path(library_root, &entry.library_path) {
            Ok(p) => p,
            Err(_) => {
                failed += 1;
                continue;
            }
        };
        let library_full = if entry.kind.eq_ignore_ascii_case("skill") {
            crate::skill_layout::skill_unit_path(&library_full_raw)
        } else {
            library_full_raw
        };
        if !library_full.exists() {
            failed += 1;
            continue;
        }
        // 与列表/canWithdraw 一致：用 live 探测，不依赖可能空/过期的 deployedPath。
        let Some(source) =
            find_live_path_in_active_container(&entry, library_root, container_root, user_global)
        else {
            // 台账仍残留 deployedPath、磁盘已无副本 → 清标记
            if !entry.deployed_path.trim().is_empty() {
                let _ = finish_withdraw_ok(&entry, library_root);
                moved += 1;
            } else {
                skipped += 1;
            }
            continue;
        };
        let source_owned = if entry.kind.eq_ignore_ascii_case("skill") {
            crate::skill_layout::skill_unit_path(Path::new(&source))
        } else {
            PathBuf::from(&source)
        };
        let source_path = source_owned.as_path();
        let source = source_owned.to_string_lossy().to_string();
        if !source_path.exists() {
            let _ = finish_withdraw_ok(&entry, library_root);
            moved += 1;
            continue;
        }
        if let Err(e) = assert_managed_container_path(&source, &[container_root], true) {
            failed += 1;
            let _ = e;
            continue;
        }

        // skill 整目录：比对整树哈希，避免只比 SKILL.md 却漏附属文件
        let (source_hash, library_hash, cmp_src, cmp_lib) = if entry.kind.eq_ignore_ascii_case("skill")
            && source_path.is_dir()
            && library_full.is_dir()
        {
            let (sh, _) = hash_path_auto(source_path)?;
            let (lh, _) = hash_path_auto(&library_full)?;
            (
                sh,
                lh,
                source_path.to_path_buf(),
                library_full.clone(),
            )
        } else {
            let src_cmp = resolve_comparable_content_path(&source, &entry.kind);
            let lib_cmp =
                resolve_comparable_content_path(&library_full.to_string_lossy(), &entry.kind);
            let (sh, _) = if src_cmp.is_file() {
                hash_path_auto(&src_cmp)?
            } else {
                hash_path_auto(source_path)?
            };
            let (lh, _) = if lib_cmp.is_file() {
                hash_path_auto(&lib_cmp)?
            } else {
                hash_path_auto(&library_full)?
            };
            let cmp_s = if src_cmp.is_file() {
                src_cmp
            } else {
                source_path.to_path_buf()
            };
            let cmp_l = if lib_cmp.is_file() {
                lib_cmp
            } else {
                library_full.clone()
            };
            (sh, lh, cmp_s, cmp_l)
        };
        let same = content_equivalent(&source_hash, &library_hash, &cmp_src, &cmp_lib);

        let key = format!("{key_prefix}:{id}");
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
        let src_cmp = resolve_comparable_content_path(&source, &entry.kind);
        let lib_cmp = resolve_comparable_content_path(&library_full.to_string_lossy(), &entry.kind);
        if choice.is_empty() {
            let mut dto = path_conflict_dto(
                key,
                operation,
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
                // skill 整目录：容器树覆盖永久库树；其它 kind 仍同步主文件。
                let ok = if entry.kind.eq_ignore_ascii_case("skill") && source_path.is_dir() {
                    match copy_over(source_path, &library_full) {
                        Ok(()) => {
                            let mut updated = entry.clone();
                            updated.library_path = crate::skill_layout::skill_dir_rel(&entry.id);
                            updated.deployed_path = String::new();
                            updated.is_in_library = true;
                            updated.is_missing = false;
                            upsert_entry(library_root, updated).is_ok()
                                && remove_path(source_path).is_ok()
                        }
                        Err(_) => false,
                    }
                } else {
                    let dep_cmp = if src_cmp.is_file() {
                        src_cmp.clone()
                    } else {
                        resolve_comparable_content_path(&source, &entry.kind)
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
                    sync_main_file(&dep_cmp, &lib_dest).is_ok()
                        && verify_content_hash_match(&dep_cmp, &lib_dest).is_ok()
                        && remove_path(source_path).is_ok()
                        && finish_withdraw_ok(&entry, library_root).is_ok()
                };
                if ok {
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
        "移入永久库：移动 {moved}，跳过 {skipped}，失败 {failed}，冲突 {}",
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
                ..Default::default()
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
        assert!(!ctr_file.parent().unwrap().exists(), "skill dir should be gone");
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

    /// 台账 deployedPath 为空但磁盘约定路径有副本时，仍应能撤回（与列表 probe 对齐）。
    #[test]
    fn withdraw_probes_skill_when_deployed_path_empty() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let container = dir.path().join(".cursor");
        fs::create_dir_all(container.join("skills/probe-w")).unwrap();
        let lib_file = dir.path().join("skills/probe-w/SKILL.md");
        fs::create_dir_all(lib_file.parent().unwrap()).unwrap();
        fs::write(&lib_file, b"# skill\nbody\n").unwrap();
        let ctr_file = container.join("skills/probe-w/SKILL.md");
        fs::write(&ctr_file, b"# skill\nbody\n").unwrap();

        let entry = CatalogEntry {
            id: "probe-w".into(),
            kind: "skill".into(),
            library_path: "skills/probe-w/SKILL.md".into(),
            is_in_library: true,
            deployed_path: String::new(),
            is_missing: false,
            ..Default::default()
        };
        let mut cat = load_catalog(&lib_root).catalog;
        cat.entries.push(entry);
        save_catalog(&lib_root, &cat).unwrap();

        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        // 将活动容器指到本 fixture（默认全局 .cursor 在用户主目录）
        let mut settings = settings;
        use crate::workspace::WorkspaceConfig;
        settings.workspaces = vec![WorkspaceConfig {
            id: "cursor".into(),
            enabled: true,
            in_work_area: true,
            display_name: "Cursor".into(),
            container_root: container.to_string_lossy().to_string(),
        }];
        settings.selected_global_tool = "cursor".into();
        settings.visible_workspace_ids = vec!["cursor".into()];

        let r = withdraw_entry(&settings, "probe-w").unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(!ctr_file.exists(), "container copy should be removed");
        assert!(
            !ctr_file.parent().unwrap().exists(),
            "entire skill directory should be removed"
        );
        assert!(lib_file.exists());
    }

    #[test]
    fn withdraw_removes_sidecar_files_with_skill_dir() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("WProj");
        let container = proj.join(".cursor");
        let lib_skill = dir.path().join("skills/side");
        let ctr_skill = container.join("skills/side");
        fs::create_dir_all(&lib_skill).unwrap();
        fs::create_dir_all(&ctr_skill).unwrap();
        fs::write(lib_skill.join("SKILL.md"), b"# side\n").unwrap();
        fs::write(lib_skill.join("extra.md"), b"lib\n").unwrap();
        fs::write(ctr_skill.join("SKILL.md"), b"# side\n").unwrap();
        fs::write(ctr_skill.join("extra.md"), b"lib\n").unwrap();
        fs::write(ctr_skill.join("only-in-container.md"), b"x\n").unwrap();

        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "wp".into(),
                name: "WProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        let entry = CatalogEntry {
            id: "side".into(),
            kind: "skill".into(),
            library_path: "skills/side".into(),
            is_in_library: true,
            deployed_path: ctr_skill.to_string_lossy().to_string(),
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
        // different tree hash → conflict; merge keeps library, deletes container tree
        let r = withdraw_entries(
            &settings,
            &["side".into()],
            &[ConflictResolution {
                key: "withdraw:side".into(),
                choice: "merge".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(!ctr_skill.exists());
        assert!(lib_skill.join("extra.md").is_file());
    }

    #[test]
    fn unix_epoch_formats_rfc3339() {
        assert_eq!(unix_secs_to_rfc3339_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(unix_secs_to_rfc3339_utc(1_786_579_200), "2026-08-13T00:00:00Z");
    }

    #[test]
    fn path_conflict_dto_fills_size_and_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("src.md");
        let tgt = dir.path().join("tgt.md");
        fs::write(&src, b"hello source\n").unwrap();
        fs::write(&tgt, b"hello target!!\n").unwrap();
        let dto = path_conflict_dto(
            "k".into(),
            "refresh",
            "id".into(),
            "skill".into(),
            src.to_string_lossy().into(),
            tgt.to_string_lossy().into(),
            "id".into(),
            "h1".into(),
            "h2".into(),
        );
        assert_eq!(dto.source_size, Some(13));
        assert!(dto.target_size.is_some());
        let sm = dto.source_modified.as_deref().expect("mtime must be filled");
        assert!(sm.ends_with('Z'), "{sm}");
        assert!(sm.contains('T'), "{sm}");
        assert!(dto.target_modified.is_some());
    }
}
