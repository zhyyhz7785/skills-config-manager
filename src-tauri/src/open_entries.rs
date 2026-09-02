//! Resolve catalog entry paths and open/reveal via shell_ops (M3 domain 1c).
//!
//! # Path side contract（硬契约，防 UI 文案绑错）
//!
//! | side / command | 含义（唯一） |
//! |----------------|--------------|
//! | `open_active_container_dir` | 活动容器**根目录** |
//! | permanent library root (`open_path` on library root) | 永久库**根目录** |
//! | `open_entry_side(library\|reveal)` | 条目在永久库的文件/父目录（**台账路径** / `libraryPath`） |
//! | `open_entry_side(current)` | 条目容器侧 live（含 probe；打开**条目目录**，非容器根） |
//! | `open_entry_side(original)` | 原始路径（origins，回退 deployed） |

use std::path::{Path, PathBuf};

use crate::active_container::resolve_active_container_root;
use crate::catalog::{load_catalog, CatalogEntry};
use crate::list_cluster::find_live_path_in_active_container;
use crate::path_guard::resolve_library_safe_path;
use crate::settings::{effective_library_root, load_settings, save_settings, AppSettings};
use crate::shell_ops::{open_path, reveal_in_folder};

fn find_entry(entry_id: &str) -> Result<(AppSettings, String, CatalogEntry), String> {
    let settings = load_settings()?;
    let root = effective_library_root(&settings).ok_or_else(|| "尚未配置永久库".to_string())?;
    let load = load_catalog(&root);
    if !load.healthy {
        return Err(load.error.unwrap_or_else(|| "台账不可用".into()));
    }
    let entry = load
        .catalog
        .entries
        .into_iter()
        .find(|e| e.id == entry_id)
        .ok_or_else(|| format!("未找到条目: {entry_id}"))?;
    Ok((settings, root, entry))
}

fn library_abs(root: &str, entry: &CatalogEntry) -> Option<PathBuf> {
    let rel = entry.library_path.trim();
    if rel.is_empty() {
        return None;
    }
    resolve_library_safe_path(root, rel).ok()
}

fn dir_of(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| path.to_path_buf())
    }
}

/// Pure path resolution for open/reveal (testable; does not open shell).
/// Returns absolute directory (or file for `reveal`) that the UI/IPC should target.
///
/// `container_root`：活动容器根；`current` 侧用它做 live 探测（与列表一致）。
pub(crate) fn resolve_entry_open_target(
    library_root: &str,
    entry: &CatalogEntry,
    side: &str,
    container_root: Option<&str>,
) -> Result<PathBuf, String> {
    let side = side.trim().to_lowercase();
    match side.as_str() {
        "original" => {
            let p = entry
                .origins
                .iter()
                .map(|o| o.original_path.trim())
                .find(|p| !p.is_empty() && Path::new(p).exists())
                .map(|p| p.to_string())
                .or_else(|| {
                    let d = entry.deployed_path.trim();
                    if !d.is_empty() && Path::new(d).exists() {
                        Some(d.to_string())
                    } else {
                        None
                    }
                })
                .ok_or_else(|| "无可用原始/容器路径".to_string())?;
            Ok(dir_of(Path::new(&p)))
        }
        "current" => {
            if let Some(root) = container_root.map(str::trim).filter(|s| !s.is_empty()) {
                if entry.kind.eq_ignore_ascii_case("rule") {
                    if let Some(d) = crate::rule_layout::rule_open_dir(root, &entry.id) {
                        return Ok(d);
                    }
                }
                let user_global = crate::active_container::is_user_global_container_root(root);
                if let Some(live) =
                    find_live_path_in_active_container(entry, library_root, root, user_global)
                {
                    return Ok(dir_of(Path::new(&live)));
                }
            }
            // 回退：旧 deployedPath / origins（无活动容器或 probe 未命中时）
            let d = entry.deployed_path.trim();
            if !d.is_empty() && Path::new(d).exists() {
                Ok(dir_of(Path::new(d)))
            } else {
                let p = entry
                    .origins
                    .iter()
                    .map(|o| o.original_path.trim())
                    .find(|p| !p.is_empty() && Path::new(p).exists())
                    .ok_or_else(|| "无可用当前路径".to_string())?;
                Ok(dir_of(Path::new(p)))
            }
        }
        "library" | "reveal" => {
            let abs = library_abs(library_root, entry).ok_or_else(|| "无永久库路径".to_string())?;
            if side == "reveal" {
                Ok(abs)
            } else if entry.kind.eq_ignore_ascii_case("rule") {
                Ok(crate::rule_layout::rule_open_dir(library_root, &entry.id)
                    .unwrap_or_else(|| dir_of(&abs)))
            } else {
                Ok(dir_of(&abs))
            }
        }
        other => Err(format!("未知 side: {other}")),
    }
}

/// Which path to open: original | current | library | reveal
#[tauri::command]
pub fn open_entry_side(entry_id: String, side: String) -> Result<String, String> {
    let (settings, root, entry) = find_entry(&entry_id)?;
    let side_norm = side.trim().to_lowercase();
    let container_root = resolve_active_container_root(&settings);
    let target = resolve_entry_open_target(
        &root,
        &entry,
        &side_norm,
        Some(container_root.as_str()),
    )?;
    if side_norm == "reveal" {
        reveal_in_folder(target.to_string_lossy().to_string())?;
        return Ok(target.to_string_lossy().to_string());
    }
    let s = target.to_string_lossy().to_string();
    open_path(s.clone())?;
    Ok(s)
}

/// 打开活动容器**根目录**（非条目路径）。
#[tauri::command]
pub fn open_active_container_dir() -> Result<String, String> {
    let settings = load_settings()?;
    let t = resolve_active_container_root(&settings);
    if t.trim().is_empty() {
        return Err("活动容器未配置".into());
    }
    if !Path::new(&t).exists() {
        std::fs::create_dir_all(&t).map_err(|e| format!("无法创建活动容器：{e}"))?;
    }
    open_path(t.clone())?;
    Ok(t)
}

/// Open user-global workspace container (Plan/04); focus that workspace.
#[tauri::command]
pub fn open_global_container(tool: Option<String>) -> Result<String, String> {
    use std::fs;

    let tool_raw = tool.unwrap_or_else(|| "cursor".into());
    let tool = crate::workspace::normalize_workspace_id(&tool_raw).unwrap_or("cursor");

    let mut settings = load_settings()?;
    settings.nav_kind = "global".into();
    settings.selected_global_tool = tool.to_string();
    settings.selected_project_id = None;
    let _ = crate::workspace::ensure_workspaces_migrated(&mut settings);
    save_settings(&settings)?;

    let s = crate::workspace::resolve_workspace_container_root(&settings, tool);
    if s.trim().is_empty() {
        return Err("无法解析工作区容器根".into());
    }
    let dir = Path::new(&s);
    if !dir.exists() {
        fs::create_dir_all(dir).map_err(|e| {
            format!("目录不存在且无法创建：{}（{e}）", dir.display())
        })?;
    }
    open_path(s.clone())?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// fixture 同时有库文件与容器 deployedPath：library 必落库根下，current 必落容器下。
    #[test]
    fn library_side_under_library_root_current_under_container() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_root = tmp.path().join("CursorSkills");
        let container = tmp.path().join("Users").join(".cursor");
        let lib_skill = lib_root.join("skills/demo/SKILL.md");
        let container_skill = container.join("skills/demo/SKILL.md");
        fs::create_dir_all(lib_skill.parent().unwrap()).unwrap();
        fs::create_dir_all(container_skill.parent().unwrap()).unwrap();
        fs::write(&lib_skill, b"# demo lib\n").unwrap();
        fs::write(&container_skill, b"# demo container\n").unwrap();

        let entry = CatalogEntry {
            id: "demo".into(),
            kind: "skill".into(),
            library_path: "skills/demo/SKILL.md".into(),
            deployed_path: container_skill.to_string_lossy().to_string(),
            is_in_library: true,
            ..Default::default()
        };

        let lib_target =
            resolve_entry_open_target(&lib_root.to_string_lossy(), &entry, "library", None)
                .unwrap();
        let cur_target = resolve_entry_open_target(
            &lib_root.to_string_lossy(),
            &entry,
            "current",
            Some(&container.to_string_lossy()),
        )
        .unwrap();

        let lib_canon = lib_root.canonicalize().unwrap();
        let ctr_canon = container.canonicalize().unwrap();
        let lib_t = lib_target.canonicalize().unwrap();
        let cur_t = cur_target.canonicalize().unwrap();

        assert!(
            lib_t.starts_with(&lib_canon),
            "library side must be under library root: {lib_t:?} vs {lib_canon:?}"
        );
        assert!(
            cur_t.starts_with(&ctr_canon),
            "current side must be under container: {cur_t:?} vs {ctr_canon:?}"
        );
        assert!(
            !lib_t.starts_with(&ctr_canon),
            "library side must NOT open container path: {lib_t:?}"
        );
        assert!(
            !cur_t.starts_with(&lib_canon),
            "current side must NOT open library path: {cur_t:?}"
        );
        // 条目目录 = SKILL.md 父目录，不是容器根
        assert_eq!(cur_t, container_skill.parent().unwrap().canonicalize().unwrap());
    }

    #[test]
    fn current_side_probes_skill_when_deployed_path_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_root = tmp.path().join("lib");
        let container = tmp.path().join(".cursor");
        let skill_md = container.join("skills/demo/SKILL.md");
        fs::create_dir_all(skill_md.parent().unwrap()).unwrap();
        fs::write(&skill_md, b"# demo\n").unwrap();

        let entry = CatalogEntry {
            id: "demo".into(),
            kind: "skill".into(),
            library_path: "skills/demo/SKILL.md".into(),
            deployed_path: String::new(),
            is_in_library: true,
            ..Default::default()
        };

        let cur = resolve_entry_open_target(
            &lib_root.to_string_lossy(),
            &entry,
            "current",
            Some(&container.to_string_lossy()),
        )
        .unwrap();
        assert_eq!(
            cur.canonicalize().unwrap(),
            skill_md.parent().unwrap().canonicalize().unwrap()
        );
    }
}
