//! unmanage / purgeMissing (M3 domain 3).

use serde::Serialize;

use crate::catalog::{load_catalog, remove_entry, validate_entry_paths};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageResult {
    pub ok: bool,
    pub count: u32,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
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

/// Spike unmanage: clear deployedPath and remove catalog row (keep library files).
pub fn unmanage_entries(settings: &AppSettings, entry_ids: &[String]) -> Result<ManageResult, String> {
    let library_root = settings.skills_library_root.trim();
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    let mut n = 0u32;
    for id in entry_ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        // Clear deploy path then remove from catalog (library files remain on disk).
        let load = load_catalog(library_root);
        if let Some(mut e) = load.catalog.entries.iter().find(|e| e.id == id).cloned() {
            e.deployed_path.clear();
            let _ = crate::catalog::upsert_entry(library_root, e);
        }
        match remove_entry(library_root, id) {
            Ok(_) => n += 1,
            Err(_) => {}
        }
    }
    Ok(ManageResult {
        ok: true,
        count: n,
        message: format!("已去除管理 {n} 项"),
        snapshot: snap(settings),
    })
}

pub fn purge_missing(settings: &AppSettings, entry_ids: &[String]) -> Result<ManageResult, String> {
    let library_root = settings.skills_library_root.trim();
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(load.error.unwrap_or_else(|| "catalog unhealthy".into()));
    }
    let ids: Vec<String> = if entry_ids.is_empty() {
        load.catalog
            .entries
            .iter()
            .filter(|e| e.is_missing)
            .map(|e| e.id.clone())
            .collect()
    } else {
        entry_ids
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    };
    let mut n = 0u32;
    for id in ids {
        let Some(e) = load.catalog.entries.iter().find(|e| e.id == id) else {
            continue;
        };
        if !e.is_missing {
            continue;
        }
        if remove_entry(library_root, &id).is_ok() {
            n += 1;
        }
    }
    Ok(ManageResult {
        ok: true,
        count: n,
        message: format!("已清理缺失台账 {n} 项"),
        snapshot: snap(settings),
    })
}
