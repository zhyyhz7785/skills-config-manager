//! Read/write library-side text files (P3 Crepe gate). Path-guarded only.

use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::catalog::load_catalog;
use crate::path_guard::resolve_library_safe_path;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadLibraryTextResult {
    pub entry_id: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLibraryFileResult {
    pub ok: bool,
    pub unchanged: bool,
    pub entry_id: String,
    pub path: String,
    pub message: String,
}

fn resolve_entry_file(
    settings: &AppSettings,
    entry_id: &str,
) -> Result<(String, std::path::PathBuf), String> {
    let id = entry_id.trim();
    if id.is_empty() {
        return Err("empty entryId".into());
    }
    let library_root = settings.skills_library_root.trim();
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("entry not found: {id}"))?;
    if entry.library_path.trim().is_empty() {
        return Err(format!("entry has empty libraryPath: {id}"));
    }
    let full = resolve_library_safe_path(library_root, &entry.library_path)
        .map_err(|e| format!("library path: {e}"))?;
    if full.is_dir() {
        return Err(format!(
            "libraryPath is a directory (P3 requires a single file): {}",
            full.display()
        ));
    }
    Ok((id.to_string(), full))
}

pub fn read_library_text(
    settings: &AppSettings,
    entry_id: &str,
) -> Result<ReadLibraryTextResult, String> {
    let (id, full) = resolve_entry_file(settings, entry_id)?;
    if !full.exists() {
        return Err(format!("file missing: {}", full.display()));
    }
    let raw = fs::read(&full).map_err(|e| format!("read {}: {e}", full.display()))?;
    let content = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        String::from_utf8_lossy(&raw[3..]).into_owned()
    } else {
        String::from_utf8_lossy(&raw).into_owned()
    };
    Ok(ReadLibraryTextResult {
        entry_id: id,
        path: full.to_string_lossy().to_string(),
        content,
    })
}

pub fn save_library_file(
    settings: &AppSettings,
    entry_id: &str,
    content: &str,
) -> Result<SaveLibraryFileResult, String> {
    save_detail_markdown(settings, entry_id, content, "library")
}

/// Save detail markdown to library or active-container side (Electron `saveDetailMarkdown`).
pub fn save_detail_markdown(
    settings: &AppSettings,
    entry_id: &str,
    content: &str,
    side: &str,
) -> Result<SaveLibraryFileResult, String> {
    use crate::active_container::resolve_active_container_root;
    use crate::list_cluster::find_live_path_in_active_container;
    use crate::path_guard::assert_managed_container_path;

    let id = entry_id.trim();
    if id.is_empty() {
        return Err("empty entryId".into());
    }
    let library_root = settings.skills_library_root.trim();
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("请先配置永久库目录".into());
    }
    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("未找到条目：{id}"))?
        .clone();

    let side = side.trim().to_lowercase();
    let user_global = settings.nav_kind.trim().eq_ignore_ascii_case("global")
        || settings.nav_kind.trim().is_empty();
    let container_root = resolve_active_container_root(settings);

    let full = if side == "container" {
        let live = find_live_path_in_active_container(
            &entry,
            library_root,
            &container_root,
            user_global,
        )
        .ok_or_else(|| "无主文件可写".to_string())?;
        let meta = resolve_meta_file(&live, &entry.kind)
            .ok_or_else(|| "无主文件可写".to_string())?;
        let meta_s = meta.to_string_lossy().to_string();
        if meta_s.to_lowercase().ends_with(".skill") {
            return Err(".skill 包不可就地编辑，请用外部工具或解包目录".into());
        }
        if !meta.is_file() {
            return Err("主文件路径无效".into());
        }
        assert_managed_container_path(&meta_s, &[&container_root], true)
            .map_err(|e| format!("拒绝写入非受管路径：{e}"))?;
        meta
    } else {
        if entry.library_path.trim().is_empty() {
            return Err(format!("entry has empty libraryPath: {id}"));
        }
        let full = resolve_library_safe_path(library_root, &entry.library_path)
            .map_err(|e| format!("library path: {e}"))?;
        let meta = if full.is_dir() {
            resolve_meta_file(&full.to_string_lossy(), &entry.kind)
                .ok_or_else(|| "无主文件可写".to_string())?
        } else {
            full
        };
        let meta_s = meta.to_string_lossy().to_string();
        if meta_s.to_lowercase().ends_with(".skill") {
            return Err(".skill 包不可就地编辑，请用外部工具或解包目录".into());
        }
        meta
    };

    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }

    let existing = if full.exists() {
        let raw = fs::read(&full).map_err(|e| format!("read before write: {e}"))?;
        if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
            String::from_utf8_lossy(&raw[3..]).into_owned()
        } else {
            String::from_utf8_lossy(&raw).into_owned()
        }
    } else {
        String::new()
    };

    if existing == content {
        return Ok(SaveLibraryFileResult {
            ok: true,
            unchanged: true,
            entry_id: id.to_string(),
            path: full.to_string_lossy().to_string(),
            message: "内容未变化，未写盘".into(),
        });
    }

    fs::write(&full, content.as_bytes()).map_err(|e| format!("write {}: {e}", full.display()))?;

    if side != "container" {
        let _ = crate::network_customization::record_after_library_save(library_root, id, content);
        if let Ok(Some(new_id)) = crate::level_id::repath_if_customized_local(settings, id) {
            return Ok(SaveLibraryFileResult {
                ok: true,
                unchanged: false,
                entry_id: new_id.clone(),
                path: full.to_string_lossy().to_string(),
                message: format!("已保存详情（{side}）：{new_id}"),
            });
        }
    }

    Ok(SaveLibraryFileResult {
        ok: true,
        unchanged: false,
        entry_id: id.to_string(),
        path: full.to_string_lossy().to_string(),
        message: format!("已保存详情（{side}）：{id}"),
    })
}

fn resolve_meta_file(root: &str, kind: &str) -> Option<std::path::PathBuf> {
    let p = Path::new(root.trim());
    if !p.exists() {
        return None;
    }
    if p.is_file() {
        return Some(p.to_path_buf());
    }
    if !p.is_dir() {
        return None;
    }
    if kind.eq_ignore_ascii_case("skill") {
        let skill = p.join("SKILL.md");
        if skill.is_file() {
            return Some(skill);
        }
    }
    if let Ok(rd) = fs::read_dir(p) {
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".mdc") || name.ends_with(".md") {
                let fp = ent.path();
                if fp.is_file() {
                    return Some(fp);
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, save_catalog, CatalogEntry, LibraryCatalog};
    use crate::settings::AppSettings;
    use std::path::PathBuf;

    fn setup() -> (tempfile::TempDir, AppSettings, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let file = dir.path().join("skills/p3-edit/SKILL.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"# p3\nhello\n").unwrap();
        save_catalog(
            &lib_root,
            &LibraryCatalog {
                version: 2,
                projects: vec![],
                entries: vec![CatalogEntry {
                    id: "p3-edit".into(),
                    kind: "skill".into(),
                    library_path: "skills/p3-edit/SKILL.md".into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            active_container_root: String::new(),
            ..Default::default()
        };
        (dir, settings, file)
    }

    #[test]
    fn read_then_save_then_unchanged() {
        let (_dir, settings, file) = setup();
        let r = read_library_text(&settings, "p3-edit").unwrap();
        assert!(r.content.contains("hello"));
        let next = "# p3\nhello world\n";
        let s = save_library_file(&settings, "p3-edit", next).unwrap();
        assert!(s.ok && !s.unchanged);
        assert_eq!(fs::read_to_string(&file).unwrap(), next);
        let s2 = save_library_file(&settings, "p3-edit", next).unwrap();
        assert!(s2.unchanged);
    }

    #[test]
    fn save_customized_network_skill_renames_s_to_l() {
        use crate::catalog::{get_entry_tags, set_entry_tags, upsert_entry};
        use crate::network_customization::{
            customization_path, seed_baseline_on_promote, set_provenance, NetworkProvenance,
        };

        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let file = dir.path().join("skills/S1-map/SKILL.md");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, b"# Map\noriginal\n").unwrap();
        let mut entry = CatalogEntry {
            id: "S1-map".into(),
            kind: "skill".into(),
            library_path: "skills/S1-map".into(),
            is_in_library: true,
            ..Default::default()
        };
        set_provenance(
            &mut entry,
            &NetworkProvenance {
                source_url: "https://example.com/demo.git".into(),
                source_id: "demo".into(),
                skill_name: "map".into(),
                network_entry_id: "net:demo:map".into(),
                baseline_content_hash: "abc".into(),
                ..Default::default()
            },
        );
        let mut tags = get_entry_tags(&entry);
        tags.level = Some("L1".into());
        set_entry_tags(&mut entry, tags);
        upsert_entry(&lib_root, entry).unwrap();
        seed_baseline_on_promote(&lib_root, "S1-map", "# Map\noriginal\n", "abc").unwrap();

        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            active_container_root: String::new(),
            ..Default::default()
        };
        let s = save_library_file(&settings, "S1-map", "# Map\noriginal\nmy note\n").unwrap();
        assert!(s.ok && !s.unchanged, "{}", s.message);
        assert_eq!(s.entry_id, "L1-map");
        assert!(dir.path().join("skills/L1-map/SKILL.md").is_file());
        assert!(!dir.path().join("skills/S1-map").exists());
        assert!(customization_path(&lib_root, "L1-map").is_file());
        assert!(!customization_path(&lib_root, "S1-map").exists());
    }

    #[test]
    fn rejects_dotdot_library_path() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        save_catalog(
            &lib_root,
            &LibraryCatalog {
                version: 2,
                projects: vec![],
                entries: vec![CatalogEntry {
                    id: "evil".into(),
                    kind: "skill".into(),
                    library_path: r"..\..\Windows\win.ini".into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                }],
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            active_container_root: String::new(),
            ..Default::default()
        };
        let err = read_library_text(&settings, "evil").unwrap_err();
        assert!(
            err.contains("dotdot") || err.contains("library path"),
            "err={err}"
        );
    }
}
