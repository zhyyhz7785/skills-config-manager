//! Resolve OS drag-out file paths for entries (align Electron resolveDragFilePaths).

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::Path;

use crate::catalog::load_catalog;
use crate::path_guard::resolve_library_safe_path;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveDragPathsResult {
    pub ok: bool,
    pub message: String,
    pub paths: Vec<String>,
}

fn prefer_file(path: &str) -> Option<String> {
    let p = Path::new(path);
    if p.is_file() {
        return Some(path.to_string());
    }
    if p.is_dir() {
        let skill = p.join("SKILL.md");
        if skill.is_file() {
            return Some(skill.to_string_lossy().to_string());
        }
    }
    None
}

pub fn resolve_drag_file_paths(
    settings: &AppSettings,
    entry_ids: &[String],
    path_side: &str,
) -> ResolveDragPathsResult {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() || !settings.library_root_configured {
        return ResolveDragPathsResult {
            ok: false,
            message: "请先配置永久库目录".into(),
            paths: vec![],
        };
    }
    let load = load_catalog(lib);
    let side = path_side.trim().to_lowercase();
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for id in entry_ids {
        let id = id.trim();
        if id.is_empty() {
            continue;
        }
        let Some(entry) = load.catalog.entries.iter().find(|e| e.id == id) else {
            continue;
        };
        if entry.is_missing {
            continue;
        }

        let candidate = if side == "container" {
            let dep = entry.deployed_path.trim();
            if !dep.is_empty() {
                prefer_file(dep)
            } else {
                None
            }
        } else {
            resolve_library_safe_path(lib, &entry.library_path)
                .ok()
                .and_then(|p| prefer_file(&p.to_string_lossy()))
                .or_else(|| {
                    let dep = entry.deployed_path.trim();
                    if dep.is_empty() {
                        None
                    } else {
                        prefer_file(dep)
                    }
                })
        };

        let Some(file_path) = candidate else {
            continue;
        };
        if !Path::new(&file_path).is_file() {
            continue;
        }
        // Skip UNC/SMB (plugin known crash)
        if file_path.starts_with("\\\\") {
            continue;
        }
        let key = file_path.replace('/', "\\").to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        // Ensure readable
        if fs::metadata(&file_path).is_err() {
            continue;
        }
        paths.push(file_path);
    }

    ResolveDragPathsResult {
        ok: true,
        message: if paths.is_empty() {
            "无可拖出的本地文件".into()
        } else {
            format!("resolved {}", paths.len())
        },
        paths,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, upsert_entry, CatalogEntry};
    use std::fs;

    #[test]
    fn resolves_library_skill_md() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        fs::create_dir_all(dir.path().join("skills/d")).unwrap();
        fs::write(dir.path().join("skills/d/SKILL.md"), b"# d\n").unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "d".into(),
                kind: "skill".into(),
                library_path: "skills/d/SKILL.md".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            ..Default::default()
        };
        let r = resolve_drag_file_paths(&settings, &["d".into()], "library");
        assert_eq!(r.paths.len(), 1, "{}", r.message);
        assert!(r.paths[0].to_lowercase().ends_with("skill.md"));
    }
}
