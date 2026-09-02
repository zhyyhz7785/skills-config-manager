//! Refresh reconcile MVP: active container + registered project .cursor (M3 residual).
//! Does NOT scan real ~/.cursor.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use crate::catalog::{
    list_projects, load_catalog, save_catalog, upsert_entry, validate_entry_paths, CatalogEntry,
};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::{content_equivalent, hash_path_auto};
use crate::path_guard::resolve_library_safe_path;
use crate::scan_ingest::{scan_container, DiscoveredItemDto};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};
use crate::withdraw::PathConflictDto;
use std::path::PathBuf;

/// True when `deployed` is a symlink whose resolved target equals the library unit path.
fn is_symlink_pointing_at_library(deployed: &Path, library_unit: &Path) -> bool {
    let Ok(meta) = fs::symlink_metadata(deployed) else {
        return false;
    };
    if !meta.file_type().is_symlink() {
        return false;
    }
    let Ok(link) = fs::read_link(deployed) else {
        return false;
    };
    let resolved: PathBuf = if link.is_absolute() {
        link
    } else {
        match deployed.parent() {
            Some(p) => p.join(link),
            None => link,
        }
    };
    let Ok(a) = fs::canonicalize(&resolved) else {
        return false;
    };
    let Ok(b) = fs::canonicalize(library_unit) else {
        return false;
    };
    a == b
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResult {
    pub ok: bool,
    pub message: String,
    pub conflicts: Vec<PathConflictDto>,
    pub snapshot: AppSnapshotSubset,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merged: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwritten: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_as: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub errors: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResolution {
    pub key: String,
    pub choice: String,
    #[serde(default)]
    pub source_path: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingRefresh {
    conflicts: Vec<PathConflictDto>,
    discovered: Vec<DiscoveredItemDto>,
}

fn pending_store() -> &'static Mutex<Option<PendingRefresh>> {
    static STORE: OnceLock<Mutex<Option<PendingRefresh>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(None))
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

fn norm_key(p: &str) -> String {
    p.trim().replace('\\', "/").to_lowercase()
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

fn library_rel_for(kind: &str, id: &str, source: &Path, is_folder: bool) -> String {
    let folder = folder_for_kind(kind);
    if kind.eq_ignore_ascii_case("rule") && !is_folder {
        return crate::rule_layout::nested_rule_rel(id, &crate::rule_layout::ext_from_path(source));
    }
    if is_folder {
        format!("{folder}/{id}")
    } else {
        let name = source
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "SKILL.md".into());
        format!("{folder}/{id}/{name}")
    }
}

fn under_dir(path: &str, root: &str) -> bool {
    let p = norm_key(path);
    let r = norm_key(root).trim_end_matches('/').to_string();
    p == r || p.starts_with(&(r.clone() + "/"))
}

/// Collect dual-copy conflicts for entries with live deployedPath.
fn collect_live_dual_copy_conflicts(
    settings: &AppSettings,
) -> Result<Vec<PathConflictDto>, String> {
    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账未健康，拒绝刷新写盘：{}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let container = crate::active_container::resolve_active_container_root(settings);
    let container = container.trim();
    let mut out = Vec::new();
    for e in &load.catalog.entries {
        let deployed = e.deployed_path.trim();
        if deployed.is_empty() || !Path::new(deployed).exists() {
            continue;
        }
        if !container.is_empty() {
            let user_global = crate::active_container::is_user_global_container_root(container);
            if !crate::active_container::is_path_in_active_container_tree(
                deployed, container, user_global,
            ) {
                continue;
            }
        }
        if e.library_path.trim().is_empty() {
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &e.library_path) else {
            continue;
        };
        if !lib_full.exists() {
            continue;
        }
        // Non-default symlink slots: if container path is a symlink to the library unit, skip
        // content conflict UI (same inode/target = consistent; no dual-copy fake conflict).
        if is_symlink_pointing_at_library(Path::new(deployed), &lib_full) {
            continue;
        }
        let lib_cmp = resolve_comparable_content_path(&lib_full.to_string_lossy(), &e.kind);
        let dep_cmp = resolve_comparable_content_path(deployed, &e.kind);
        if !lib_cmp.is_file() || !dep_cmp.is_file() {
            continue;
        }
        let Ok((src_hash, _)) = hash_path_auto(&dep_cmp) else {
            continue;
        };
        let Ok((tgt_hash, _)) = hash_path_auto(&lib_cmp) else {
            continue;
        };
        if src_hash.is_empty() || tgt_hash.is_empty() {
            continue;
        }
        if content_equivalent(&src_hash, &tgt_hash, &dep_cmp, &lib_cmp) {
            continue;
        }
        let mut dto = crate::withdraw::path_conflict_dto(
            format!("refresh:{}", e.id),
            "refresh",
            e.id.clone(),
            e.kind.clone(),
            dep_cmp.to_string_lossy().to_string(),
            lib_cmp.to_string_lossy().to_string(),
            e.id.clone(),
            src_hash,
            tgt_hash,
        );
        dto.source_compare_path = Some(dep_cmp.to_string_lossy().to_string());
        dto.target_compare_path = Some(lib_cmp.to_string_lossy().to_string());
        out.push(dto);
    }
    Ok(out)
}

fn scan_refresh_roots(settings: &AppSettings) -> Vec<DiscoveredItemDto> {
    let mut items = Vec::new();
    let mut seen = HashSet::new();

    let active = crate::active_container::resolve_active_container_root(settings);
    if !active.trim().is_empty() {
        let scope = if crate::active_container::is_user_global_container_root(&active) {
            "user-global"
        } else {
            "active-container"
        };
        for i in scan_container(Path::new(&active), "cursor", scope) {
            if seen.insert(i.key.clone()) {
                items.push(i);
            }
        }
    }

    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    for p in list_projects(&load.catalog) {
        let cursor = Path::new(&p.root_path).join(".cursor");
        if !cursor.is_dir() {
            continue;
        }
        // Never scan user home .cursor as a "project" accidentally — projects already filtered at create
        for i in scan_container(&cursor, "cursor", &format!("project:{}", p.id)) {
            if seen.insert(i.key.clone()) {
                items.push(i);
            }
        }
    }
    items
}

/// After merge/overwrite, push winner main-file bytes to every other live copy
/// of the same entry found in the refresh scan (registered projects + active).
fn propagate_winner_to_discovered(
    pending: &Option<PendingRefresh>,
    entry_id: &str,
    kind: &str,
    winner: &Path,
    already_synced: &Path,
) -> u32 {
    let Some(p) = pending else {
        return 0;
    };
    let mut synced = 0u32;
    let winner_s = already_synced.to_string_lossy().replace('\\', "/").to_lowercase();
    let winner_norm = winner.to_string_lossy().replace('\\', "/").to_lowercase();
    for item in &p.discovered {
        let matches_id = item.suggested_id == entry_id
            || item
                .existing_entry_id
                .as_ref()
                .map(|e| e == entry_id)
                .unwrap_or(false);
        if !matches_id {
            continue;
        }
        if !item.kind.eq_ignore_ascii_case(kind) {
            continue;
        }
        let dest = resolve_comparable_content_path(&item.source_path, kind);
        if !dest.exists() && Path::new(&item.source_path).exists() {
            continue;
        }
        let dest_s = dest.to_string_lossy().replace('\\', "/").to_lowercase();
        if dest_s == winner_s || dest_s == winner_norm {
            continue;
        }
        if !dest.is_file() && !Path::new(&item.source_path).is_file() {
            continue;
        }
        let target = if dest.is_file() {
            dest
        } else if Path::new(&item.source_path).is_file() {
            Path::new(&item.source_path).to_path_buf()
        } else {
            continue;
        };
        if sync_main_file(winner, &target).is_ok()
            && verify_content_hash_match(winner, &target).is_ok()
        {
            synced += 1;
        }
    }
    synced
}

fn collect_discovered_conflicts(
    settings: &AppSettings,
    items: &[DiscoveredItemDto],
    already: &HashSet<String>,
) -> Vec<PathConflictDto> {
    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    let by_id: HashMap<String, CatalogEntry> = load
        .catalog
        .entries
        .iter()
        .cloned()
        .map(|e| (e.id.clone(), e))
        .collect();

    let active = crate::active_container::resolve_active_container_root(settings);
    let active = active.trim().to_string();

    let mut out = Vec::new();
    let mut seen = already.clone();
    // Prefer active-container copies first so the dialog matches what the user is looking at.
    let mut ordered: Vec<&DiscoveredItemDto> = items.iter().collect();
    ordered.sort_by_key(|item| {
        let in_active = !active.is_empty()
            && crate::active_container::is_path_in_active_container_tree(
                &item.source_path,
                &active,
                crate::active_container::is_user_global_container_root(&active),
            );
        if in_active {
            0
        } else {
            1
        }
    });

    for item in ordered {
        if under_dir(&item.source_path, lib) {
            continue;
        }
        let entry = by_id
            .get(&item.suggested_id)
            .or_else(|| {
                item.existing_entry_id
                    .as_ref()
                    .and_then(|id| by_id.get(id))
            });
        let Some(entry) = entry else {
            continue;
        };
        if entry.library_path.trim().is_empty() {
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &entry.library_path) else {
            continue;
        };
        if !lib_full.exists() || !Path::new(&item.source_path).exists() {
            continue;
        }
        if is_symlink_pointing_at_library(Path::new(&item.source_path), &lib_full) {
            continue;
        }
        let src_cmp = resolve_comparable_content_path(&item.source_path, &entry.kind);
        let lib_cmp = resolve_comparable_content_path(&lib_full.to_string_lossy(), &entry.kind);
        if !src_cmp.is_file() || !lib_cmp.is_file() {
            continue;
        }
        let Ok((src_hash, _)) = hash_path_auto(&src_cmp) else {
            continue;
        };
        let Ok((tgt_hash, _)) = hash_path_auto(&lib_cmp) else {
            continue;
        };
        if src_hash.is_empty() || tgt_hash.is_empty() {
            continue;
        }
        if content_equivalent(&src_hash, &tgt_hash, &src_cmp, &lib_cmp) {
            continue;
        }
        let key = format!("refresh:{}", entry.id);
        if !seen.insert(key.clone()) {
            continue;
        }
        let mut dto = crate::withdraw::path_conflict_dto(
            key,
            "refresh",
            entry.id.clone(),
            entry.kind.clone(),
            src_cmp.to_string_lossy().to_string(),
            lib_cmp.to_string_lossy().to_string(),
            entry.id.clone(),
            src_hash,
            tgt_hash,
        );
        dto.source_compare_path = Some(src_cmp.to_string_lossy().to_string());
        dto.target_compare_path = Some(lib_cmp.to_string_lossy().to_string());
        out.push(dto);
    }
    out
}

/// Lightweight reconcile: same-hash relink deployedPath only.
/// 新容器文件入库仅走「扫描建库」，刷新不再软登记。
fn apply_reconcile_mvp(settings: &AppSettings, discovered: &[DiscoveredItemDto]) -> Result<(), String> {
    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    // H1：内存中批量回链，最后一次原子写盘（原逐条 upsert 每条整份重写 catalog.json）
    let mut catalog = load.catalog;
    let mut dirty = false;

    // Relink: matching id + same hash → set deployedPath
    for item in discovered {
        if under_dir(&item.source_path, lib) {
            continue;
        }
        let Some(pos) = catalog
            .entries
            .iter()
            .position(|e| e.id == item.suggested_id)
        else {
            continue;
        };
        let library_path = catalog.entries[pos].library_path.trim().to_string();
        if library_path.is_empty() {
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &library_path) else {
            continue;
        };
        if !lib_full.exists() {
            continue;
        }
        let Ok((lib_hash, _)) = hash_path_auto(&lib_full) else {
            continue;
        };
        if lib_hash.eq_ignore_ascii_case(&item.content_hash) {
            let entry = &mut catalog.entries[pos];
            entry.deployed_path = item.source_path.clone();
            entry.is_missing = false;
            dirty = true;
        }
    }
    if dirty {
        save_catalog(lib, &catalog)?;
    }
    Ok(())
}

pub fn refresh_with_conflict_check(settings: &AppSettings) -> Result<RefreshResult, String> {
    let mut settings = settings.clone();
    crate::settings::ensure_active_container(&mut settings)?;
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Ok(RefreshResult {
            ok: true,
            message: "请先配置永久库目录".into(),
            conflicts: vec![],
            snapshot: snap(&settings),
            merged: None,
            overwritten: None,
            saved_as: None,
            skipped: None,
            failed: None,
            errors: None,
        });
    }

    let load = load_catalog(settings.skills_library_root.trim());
    if !load.healthy {
        return Ok(RefreshResult {
            ok: true,
            message: format!(
                "台账未健康，拒绝刷新写盘：{}",
                load.error.unwrap_or_else(|| "unknown".into())
            ),
            conflicts: vec![],
            snapshot: snap(&settings),
            merged: None,
            overwritten: None,
            saved_as: None,
            skipped: None,
            failed: None,
            errors: None,
        });
    }

    let mut by_deployed = collect_live_dual_copy_conflicts(&settings)?;
    let discovered = scan_refresh_roots(&settings);
    let already: HashSet<String> = by_deployed.iter().map(|c| c.key.clone()).collect();
    let by_scan = collect_discovered_conflicts(&settings, &discovered, &already);

    let mut by_key: HashMap<String, PathConflictDto> = HashMap::new();
    for c in by_deployed.drain(..) {
        by_key.insert(c.key.clone(), c);
    }
    for c in by_scan {
        by_key.entry(c.key.clone()).or_insert(c);
    }
    let conflicts: Vec<_> = by_key.into_values().collect();

    *pending_store().lock().unwrap_or_else(|e| e.into_inner()) = Some(PendingRefresh {
        conflicts: conflicts.clone(),
        discovered: discovered.clone(),
    });

    if !conflicts.is_empty() {
        return Ok(RefreshResult {
            ok: true,
            message: format!(
                "刷新预览：发现 {} 项容器与永久库内容不同（未写盘，请决议）",
                conflicts.len()
            ),
            conflicts,
            snapshot: snap(&settings),
            merged: None,
            overwritten: None,
            saved_as: None,
            skipped: None,
            failed: None,
            errors: None,
        });
    }

    apply_reconcile_mvp(&settings, &discovered)?;
    Ok(RefreshResult {
        ok: true,
        message: "刷新完成：已应用对账，未发现内容冲突".into(),
        conflicts: vec![],
        snapshot: snap(&settings),
        merged: None,
        overwritten: None,
        saved_as: None,
        skipped: None,
        failed: None,
        errors: None,
    })
}

pub fn apply_refresh_conflicts(
    settings: &AppSettings,
    resolutions: &[RefreshResolution],
) -> Result<RefreshResult, String> {
    let mut settings = settings.clone();
    crate::settings::ensure_active_container(&mut settings)?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let load = load_catalog(lib);
    if !load.healthy {
        return Err(format!(
            "台账未健康，拒绝应用刷新：{}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }

    let pending = pending_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let conflict_by_key: HashMap<String, PathConflictDto> = pending
        .as_ref()
        .map(|p| {
            p.conflicts
                .iter()
                .cloned()
                .map(|c| (norm_key(&c.key), c))
                .collect()
        })
        .unwrap_or_default();

    let mut merged = 0u32;
    let mut overwritten = 0u32;
    let mut saved_as = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    let mut errors = Vec::new();

    for r in resolutions {
        let key = r.key.trim();
        if !key.to_lowercase().starts_with("refresh:") {
            continue;
        }
        let choice = r.choice.to_lowercase();
        let entry_id = &key["refresh:".len()..];
        let load = load_catalog(lib);
        let Some(mut entry) = load
            .catalog
            .entries
            .into_iter()
            .find(|e| e.id == entry_id)
        else {
            failed += 1;
            errors.push(format!("{entry_id}: 台账中不存在"));
            continue;
        };

        if choice == "skip" {
            skipped += 1;
            continue;
        }

        let conflict = conflict_by_key.get(&norm_key(key));
        let deployed_hint = r
            .source_path
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| conflict.map(|c| c.source_path.clone()))
            .unwrap_or_default();

        let deployed = if !deployed_hint.is_empty() && Path::new(&deployed_hint).exists() {
            deployed_hint
        } else if !entry.deployed_path.trim().is_empty()
            && Path::new(entry.deployed_path.trim()).exists()
        {
            entry.deployed_path.trim().to_string()
        } else {
            String::new()
        };

        let lib_rel = entry.library_path.trim().to_string();
        if lib_rel.is_empty() {
            skipped += 1;
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &lib_rel) else {
            failed += 1;
            errors.push(format!("{entry_id}: bad library path"));
            continue;
        };

        match choice.as_str() {
            "merge" => {
                // library → container（主文件级，对齐 Electron）
                if deployed.is_empty() || !lib_full.exists() {
                    failed += 1;
                    errors.push(format!("{entry_id}: merge 需要双份存在"));
                    continue;
                }
                let lib_cmp = conflict
                    .and_then(|c| c.target_compare_path.clone())
                    .filter(|p| !p.trim().is_empty() && Path::new(p).is_file())
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| {
                        resolve_comparable_content_path(&lib_full.to_string_lossy(), &entry.kind)
                    });
                let dep_cmp = conflict
                    .and_then(|c| c.source_compare_path.clone())
                    .filter(|p| !p.trim().is_empty() && Path::new(p).is_file())
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| resolve_comparable_content_path(&deployed, &entry.kind));
                if let Err(e) = sync_main_file(&lib_cmp, &dep_cmp) {
                    failed += 1;
                    errors.push(format!("{entry_id}: {e}"));
                    continue;
                }
                if let Err(e) = verify_content_hash_match(&lib_cmp, &dep_cmp) {
                    failed += 1;
                    errors.push(format!("{entry_id}: {e}"));
                    continue;
                }
                let _ = propagate_winner_to_discovered(
                    &pending,
                    entry_id,
                    &entry.kind,
                    &lib_cmp,
                    &dep_cmp,
                );
                entry.deployed_path = deployed;
                entry.is_missing = false;
                if let Err(e) = upsert_entry(lib, entry) {
                    failed += 1;
                    errors.push(e);
                } else {
                    merged += 1;
                }
            }
            "overwrite" => {
                // container → library（主文件级）
                if deployed.is_empty() || !Path::new(&deployed).exists() {
                    failed += 1;
                    errors.push(format!("{entry_id}: overwrite 需要容器路径"));
                    continue;
                }
                let dep_cmp = conflict
                    .and_then(|c| c.source_compare_path.clone())
                    .filter(|p| !p.trim().is_empty() && Path::new(p).is_file())
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| resolve_comparable_content_path(&deployed, &entry.kind));
                let lib_cmp = conflict
                    .and_then(|c| c.target_compare_path.clone())
                    .filter(|p| !p.trim().is_empty())
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| {
                        resolve_comparable_content_path(&lib_full.to_string_lossy(), &entry.kind)
                    });
                let lib_dest = match resolve_library_main_dest(&lib_full, lib_cmp, &entry.kind) {
                    Ok(p) => p,
                    Err(e) => {
                        failed += 1;
                        errors.push(format!("{entry_id}: {e}"));
                        continue;
                    }
                };
                if let Err(e) = sync_main_file(&dep_cmp, &lib_dest) {
                    failed += 1;
                    errors.push(format!("{entry_id}: {e}"));
                    continue;
                }
                if let Err(e) = verify_content_hash_match(&dep_cmp, &lib_dest) {
                    failed += 1;
                    errors.push(format!("{entry_id}: {e}"));
                    continue;
                }
                let _ = propagate_winner_to_discovered(
                    &pending,
                    entry_id,
                    &entry.kind,
                    &lib_dest,
                    &dep_cmp,
                );
                if entry.kind.eq_ignore_ascii_case("rule") {
                    let _ = crate::rule_layout::repath_rule_entry_to_nested(lib, &mut entry);
                } else if let Ok(rel) = lib_dest.strip_prefix(Path::new(lib)) {
                    let rel_s = rel.to_string_lossy().replace('\\', "/");
                    if !rel_s.is_empty() {
                        entry.library_path = rel_s;
                    }
                }
                entry.deployed_path = deployed;
                entry.is_in_library = true;
                entry.is_missing = false;
                if let Err(e) = upsert_entry(lib, entry) {
                    failed += 1;
                    errors.push(e);
                } else {
                    overwritten += 1;
                }
            }
            "saveas" => {
                if deployed.is_empty() || !Path::new(&deployed).exists() {
                    failed += 1;
                    errors.push(format!("{entry_id}: saveAs 需要容器路径"));
                    continue;
                }
                let new_id = format!("{entry_id}-refresh");
                let rel = library_rel_for(
                    &entry.kind,
                    &new_id,
                    Path::new(&deployed),
                    Path::new(&deployed).is_dir(),
                );
                let Ok(dest) = resolve_library_safe_path(lib, &rel) else {
                    failed += 1;
                    errors.push(format!("{entry_id}: saveAs bad path"));
                    continue;
                };
                if let Err(e) = copy_path(Path::new(&deployed), &dest) {
                    failed += 1;
                    errors.push(e);
                    continue;
                }
                let new_entry = CatalogEntry {
                    id: new_id,
                    kind: entry.kind.clone(),
                    library_path: rel,
                    is_in_library: true,
                    deployed_path: deployed,
                    is_missing: false,
                    ..Default::default()
                };
                if let Err(e) = upsert_entry(lib, new_entry) {
                    failed += 1;
                    errors.push(e);
                } else {
                    saved_as += 1;
                }
            }
            _ => {
                skipped += 1;
            }
        }
    }

    let discovered = pending
        .map(|p| p.discovered)
        .unwrap_or_else(|| scan_refresh_roots(&settings));
    let _ = apply_reconcile_mvp(&settings, &discovered);

    let msg = format!(
        "刷新冲突处理：保留库 {merged}，覆盖库 {overwritten}，另存 {saved_as}，跳过 {skipped}，失败 {failed}"
    );
    Ok(RefreshResult {
        ok: failed == 0,
        message: msg,
        conflicts: vec![],
        snapshot: snap(&settings),
        merged: Some(merged),
        overwritten: Some(overwritten),
        saved_as: Some(saved_as),
        skipped: Some(skipped),
        failed: Some(failed),
        errors: Some(errors),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ensure_library_layout;
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// refresh 预览缓存全局共享；并行单测串行化。
    fn serial() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    /// H4 计时（默认忽略）：50 条已部署条目、内容一致（无冲突）时 refresh 全程耗时
    /// （双份比对 + 扫描 + apply_reconcile_mvp + 快照构建，与 refresh 命令同路径）。
    /// 运行：`cargo test --lib bench_refresh_50 -- --ignored --nocapture --test-threads=1`
    #[test]
    #[ignore]
    fn bench_refresh_50_entries_no_conflict_timing() {
        use crate::catalog::{upsert_project, CatalogProject};
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("BenchProj");
        let container = proj.join(".cursor");
        upsert_project(
            &lib,
            CatalogProject {
                id: "bp".into(),
                name: "BenchProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        for i in 0..50 {
            let id = format!("bench-{i:03}");
            let body = format!("# {id}\n\n{}\n", "示例正文行，用于逼近真实条目体积。\n".repeat(20));
            fs::create_dir_all(container.join(format!("skills/{id}"))).unwrap();
            fs::create_dir_all(dir.path().join(format!("skills/{id}"))).unwrap();
            fs::write(container.join(format!("skills/{id}/SKILL.md")), &body).unwrap();
            fs::write(dir.path().join(format!("skills/{id}/SKILL.md")), &body).unwrap();
            upsert_entry(
                &lib,
                CatalogEntry {
                    id: id.clone(),
                    kind: "skill".into(),
                    library_path: format!("skills/{id}/SKILL.md"),
                    is_in_library: true,
                    deployed_path: container
                        .join(format!("skills/{id}/SKILL.md"))
                        .to_string_lossy()
                        .to_string(),
                    ..Default::default()
                },
            )
            .unwrap();
        }
        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("bp".into()),
            ..Default::default()
        };
        // 预热一轮（首轮含目录缓存冷启动）
        let _ = refresh_with_conflict_check(&settings).unwrap();
        let rounds = 10;
        let mut ms = Vec::with_capacity(rounds);
        for _ in 0..rounds {
            let t = std::time::Instant::now();
            let r = refresh_with_conflict_check(&settings).unwrap();
            ms.push(t.elapsed().as_secs_f64() * 1000.0);
            assert!(r.ok);
            assert!(r.conflicts.is_empty(), "{}", r.message);
        }
        ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!(
            "[bench-h4] refresh 50-entries no-conflict rounds={rounds} median={:.1}ms min={:.1}ms max={:.1}ms",
            ms[rounds / 2],
            ms[0],
            ms[rounds - 1]
        );
    }

    #[test]
    fn dual_copy_diff_returns_conflicts_then_overwrite() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("RProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# container\n",
        )
        .unwrap();
        fs::write(dir.path().join("skills/hello/SKILL.md"), b"# library\n")
            .unwrap();

        let deployed = container
            .join("skills/hello/SKILL.md")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "rp".into(),
                name: "RProj".into(),
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
            skills_library_root: lib.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("rp".into()),
            ..Default::default()
        };

        let preview = refresh_with_conflict_check(&settings).unwrap();
        assert!(
            !preview.conflicts.is_empty(),
            "expected conflicts: {}",
            preview.message
        );

        let key = preview.conflicts[0].key.clone();
        let applied = apply_refresh_conflicts(
            &settings,
            &[RefreshResolution {
                key,
                choice: "overwrite".into(),
                source_path: Some(deployed),
            }],
        )
        .unwrap();
        assert!(applied.ok, "{}", applied.message);
        assert_eq!(applied.overwritten, Some(1));

        let lib_text = fs::read_to_string(dir.path().join("skills/hello/SKILL.md")).unwrap();
        assert!(lib_text.contains("container"));
    }

    #[test]
    fn eol_only_diff_is_not_conflict() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("EolProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# same\nbody\n",
        )
        .unwrap();
        fs::write(
            dir.path().join("skills/hello/SKILL.md"),
            b"# same\r\nbody\r\n",
        )
        .unwrap();

        let deployed = container
            .join("skills/hello/SKILL.md")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "ep".into(),
                name: "EolProj".into(),
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
                deployed_path: deployed,
                ..Default::default()
            },
        )
        .unwrap();

        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("ep".into()),
            ..Default::default()
        };

        let preview = refresh_with_conflict_check(&settings).unwrap();
        assert!(
            preview.conflicts.is_empty(),
            "CRLF vs LF alone must not conflict: {}",
            preview.message
        );
    }

    #[test]
    fn merge_syncs_skill_md_when_container_path_is_dir() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("MProj");
        let container = proj.join(".cursor");
        // Container deployedPath = skill directory shell; library = SKILL.md file
        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# container dirty\n",
        )
        .unwrap();
        fs::write(dir.path().join("skills/hello/SKILL.md"), b"# library clean\n")
            .unwrap();

        let deployed_dir = container
            .join("skills/hello")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "mp".into(),
                name: "MProj".into(),
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
                deployed_path: deployed_dir.clone(),
                ..Default::default()
            },
        )
        .unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("mp".into()),
            ..Default::default()
        };

        let preview = refresh_with_conflict_check(&settings).unwrap();
        assert!(!preview.conflicts.is_empty(), "{}", preview.message);
        let key = preview.conflicts[0].key.clone();
        let applied = apply_refresh_conflicts(
            &settings,
            &[RefreshResolution {
                key,
                choice: "merge".into(),
                source_path: Some(deployed_dir),
            }],
        )
        .unwrap();
        assert!(applied.ok, "{} {:?}", applied.message, applied.errors);
        assert_eq!(applied.merged, Some(1));
        let ctr = fs::read_to_string(container.join("skills/hello/SKILL.md")).unwrap();
        assert!(ctr.contains("library clean"), "{ctr}");
        assert!(!ctr.contains("dirty"));
    }

    /// 假冲突回归：同名且内容哈希相同 → 冲突列表必须为 0（不得弹窗）。
    #[test]
    fn identical_hash_is_not_false_conflict() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("SameHashProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/twin")).unwrap();
        fs::create_dir_all(dir.path().join("skills/twin")).unwrap();
        let body = b"# twin\nsame bytes both sides\n";
        fs::write(container.join("skills/twin/SKILL.md"), body).unwrap();
        fs::write(dir.path().join("skills/twin/SKILL.md"), body).unwrap();
        let deployed = container
            .join("skills/twin/SKILL.md")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "shp".into(),
                name: "SameHashProj".into(),
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
                id: "twin".into(),
                kind: "skill".into(),
                library_path: "skills/twin/SKILL.md".into(),
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
            selected_project_id: Some("shp".into()),
            ..Default::default()
        };
        let r = refresh_with_conflict_check(&settings).unwrap();
        assert_eq!(
            r.conflicts.len(),
            0,
            "identical content must not surface as conflict: {}",
            r.message
        );
    }

    #[test]
    fn no_conflict_reconciles_clean() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("SProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/same")).unwrap();
        fs::create_dir_all(dir.path().join("skills/same")).unwrap();
        let body = b"# same\n";
        fs::write(container.join("skills/same/SKILL.md"), body).unwrap();
        fs::write(dir.path().join("skills/same/SKILL.md"), body).unwrap();
        let deployed = container
            .join("skills/same/SKILL.md")
            .to_string_lossy()
            .to_string();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "sp".into(),
                name: "SProj".into(),
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
                id: "same".into(),
                kind: "skill".into(),
                library_path: "skills/same/SKILL.md".into(),
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
            selected_project_id: Some("sp".into()),
            ..Default::default()
        };
        let r = refresh_with_conflict_check(&settings).unwrap();
        assert!(r.conflicts.is_empty(), "{}", r.message);
        assert!(r.message.contains("刷新完成"));
    }

    #[test]
    fn does_not_require_user_home_cursor() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("XProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("skills/x")).unwrap();
        fs::write(
            container.join("skills/x/SKILL.md"),
            b"# x\n",
        )
        .unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib,
            CatalogProject {
                id: "xp".into(),
                name: "XProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("xp".into()),
            ..Default::default()
        };
        let items = scan_refresh_roots(&settings);
        assert!(!items.is_empty());
        let container_s = container.to_string_lossy().to_string();
        for i in &items {
            assert!(
                under_dir(&i.source_path, &container_s) || i.scope.starts_with("project:"),
                "unexpected path {} scope {}",
                i.source_path,
                i.scope
            );
        }
    }
}
