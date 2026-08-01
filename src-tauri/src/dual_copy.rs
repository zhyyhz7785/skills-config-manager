//! Dual-copy text for detail compare (M3 residual).

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::catalog::{load_catalog, validate_entry_paths};
use crate::path_guard::resolve_library_safe_path;
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DualCopyTextsResult {
    pub ok: bool,
    pub message: String,
    pub entry_id: String,
    pub container_path: String,
    pub library_path: String,
    pub container_text: String,
    pub library_text: String,
    pub same_content: bool,
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

fn read_text(path: &str) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

/// Prefer SKILL.md under a directory for readable compare.
fn resolve_meta_file(path: &str) -> String {
    let p = Path::new(path);
    if p.is_file() {
        return path.to_string();
    }
    if p.is_dir() {
        let skill = p.join("SKILL.md");
        if skill.is_file() {
            return skill.to_string_lossy().to_string();
        }
    }
    path.to_string()
}

pub fn get_dual_copy_texts(
    settings: &AppSettings,
    entry_id: String,
) -> Result<DualCopyTextsResult, String> {
    let id = entry_id.trim().to_string();
    if id.is_empty() {
        return Err("未指定条目".into());
    }
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let load = load_catalog(lib);
    let entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == id)
        .cloned()
        .ok_or_else(|| format!("未找到条目：{id}"))?;

    let container_raw = entry.deployed_path.trim().to_string();
    if container_raw.is_empty() || !Path::new(&container_raw).exists() {
        return Ok(DualCopyTextsResult {
            ok: false,
            message: "无可用的容器副本主文件".into(),
            entry_id: id,
            container_path: String::new(),
            library_path: String::new(),
            container_text: String::new(),
            library_text: String::new(),
            same_content: false,
            snapshot: snap(settings),
        });
    }
    if entry.library_path.trim().is_empty() {
        return Ok(DualCopyTextsResult {
            ok: false,
            message: "无可用的永久库正本主文件".into(),
            entry_id: id,
            container_path: container_raw,
            library_path: String::new(),
            container_text: String::new(),
            library_text: String::new(),
            same_content: false,
            snapshot: snap(settings),
        });
    }
    let lib_full = resolve_library_safe_path(lib, &entry.library_path)
        .map_err(|e| format!("库路径不安全：{e}"))?;
    if !lib_full.exists() {
        return Ok(DualCopyTextsResult {
            ok: false,
            message: "无可用的永久库正本主文件".into(),
            entry_id: id,
            container_path: container_raw,
            library_path: lib_full.to_string_lossy().to_string(),
            container_text: String::new(),
            library_text: String::new(),
            same_content: false,
            snapshot: snap(settings),
        });
    }

    let container_path = resolve_meta_file(&container_raw);
    let library_path = resolve_meta_file(&lib_full.to_string_lossy());
    if container_path.to_lowercase().ends_with(".skill")
        || library_path.to_lowercase().ends_with(".skill")
    {
        return Ok(DualCopyTextsResult {
            ok: false,
            message: ".skill 包请用解包目录对比".into(),
            entry_id: id,
            container_path,
            library_path,
            container_text: String::new(),
            library_text: String::new(),
            same_content: false,
            snapshot: snap(settings),
        });
    }

    let container_text = read_text(&container_path);
    let library_text = read_text(&library_path);
    let same = container_text == library_text;
    Ok(DualCopyTextsResult {
        ok: true,
        message: String::new(),
        entry_id: id,
        container_path,
        library_path,
        container_text,
        library_text,
        same_content: same,
        snapshot: snap(settings),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, upsert_entry, CatalogEntry};
    use crate::settings::default_spike_container_root;

    #[test]
    fn reads_both_sides() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let container = default_spike_container_root(&lib);
        fs::create_dir_all(Path::new(&container).join("skills/x")).unwrap();
        fs::create_dir_all(dir.path().join("skills/x")).unwrap();
        fs::write(Path::new(&container).join("skills/x/SKILL.md"), b"c\n").unwrap();
        fs::write(dir.path().join("skills/x/SKILL.md"), b"l\n").unwrap();
        let deployed = Path::new(&container)
            .join("skills/x/SKILL.md")
            .to_string_lossy()
            .to_string();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "x".into(),
                kind: "skill".into(),
                library_path: "skills/x/SKILL.md".into(),
                is_in_library: true,
                deployed_path: deployed,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            active_container_root: container,
            ..Default::default()
        };
        let r = get_dual_copy_texts(&settings, "x".into()).unwrap();
        assert!(r.ok, "{}", r.message);
        assert_eq!(r.container_text.trim(), "c");
        assert_eq!(r.library_text.trim(), "l");
        assert!(!r.same_content);
    }
}
