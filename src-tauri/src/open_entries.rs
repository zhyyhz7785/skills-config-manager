//! Resolve catalog entry paths and open/reveal via shell_ops (M3 domain 1c).

use std::path::{Path, PathBuf};

use crate::catalog::{load_catalog, CatalogEntry};
use crate::path_guard::resolve_library_safe_path;
use crate::settings::{effective_library_root, load_settings, save_settings};
use crate::shell_ops::{open_path, reveal_in_folder};

fn find_entry(entry_id: &str) -> Result<(String, CatalogEntry), String> {
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
    Ok((root, entry))
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

/// Which path to open: original | current | library | reveal
#[tauri::command]
pub fn open_entry_side(entry_id: String, side: String) -> Result<String, String> {
    let (root, entry) = find_entry(&entry_id)?;
    let side = side.trim().to_lowercase();
    let target = match side.as_str() {
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
            dir_of(Path::new(&p)).to_string_lossy().to_string()
        }
        "current" => {
            let d = entry.deployed_path.trim();
            if !d.is_empty() && Path::new(d).exists() {
                dir_of(Path::new(d)).to_string_lossy().to_string()
            } else {
                let p = entry
                    .origins
                    .iter()
                    .map(|o| o.original_path.trim())
                    .find(|p| !p.is_empty() && Path::new(p).exists())
                    .ok_or_else(|| "无可用当前路径".to_string())?;
                dir_of(Path::new(p)).to_string_lossy().to_string()
            }
        }
        "library" | "reveal" => {
            let abs = library_abs(&root, &entry).ok_or_else(|| "无永久库路径".to_string())?;
            if side == "reveal" {
                reveal_in_folder(abs.to_string_lossy().to_string())?;
                return Ok(abs.to_string_lossy().to_string());
            }
            dir_of(&abs).to_string_lossy().to_string()
        }
        other => return Err(format!("未知 side: {other}")),
    };
    open_path(target.clone())?;
    Ok(target)
}

#[tauri::command]
pub fn open_active_container_dir() -> Result<String, String> {
    let settings = load_settings()?;
    let t = crate::active_container::resolve_active_container_root(&settings);
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
