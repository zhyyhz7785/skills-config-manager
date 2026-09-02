//! Projects CRUD (M3 domain 5 MVP).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{
    find_project, list_projects, load_catalog, new_project_id, remove_project, reorder_project,
    upsert_project, validate_entry_paths, CatalogProject,
};
use crate::settings::{save_settings, AppSettings};
use crate::shell_ops::open_path;
use crate::snapshot::{build_snapshot_subset, build_snapshot_subset_ex, AppSnapshotSubset};

const MARKER_DIRS: &[&str] = &[".cursor", ".claude", ".agents"];
const CURSOR_SUBDIRS: &[&str] = &["skills", "rules", "agents", "commands", "hooks"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteInspect {
    pub project_name: String,
    pub root_path: String,
    pub cursor_path: String,
    pub cursor_exists: bool,
    pub file_count: u32,
    pub managed_count: u32,
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

/// Pin / eye / reorder: omit network list (~MB index) like network `snap_nav_only`.
fn snap_nav_only(settings: &AppSettings) -> AppSnapshotSubset {
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    build_snapshot_subset_ex(settings, &load, warnings, true)
}

fn require_library(settings: &AppSettings) -> Result<&str, String> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    Ok(lib)
}

fn norm_path(p: &str) -> String {
    use crate::project_discovery::to_display_path;
    Path::new(p.trim())
        .canonicalize()
        .map(|x| to_display_path(&x.to_string_lossy()))
        .unwrap_or_else(|_| to_display_path(p))
}

fn paths_equal(a: &str, b: &str) -> bool {
    norm_path(a).eq_ignore_ascii_case(&norm_path(b))
}

/// Reject user home and user-level `.cursor` as project roots.
pub fn assert_not_user_home_or_cursor(root: &str) -> Result<(), String> {
    let home = dirs_home().ok_or_else(|| "无法解析用户主目录".to_string())?;
    let root_n = norm_path(root);
    if paths_equal(&root_n, &home) {
        return Err("不能将用户主目录或 .cursor 登记为项目".into());
    }
    let user_cursor = Path::new(&home).join(".cursor");
    if paths_equal(&root_n, &user_cursor.to_string_lossy()) {
        return Err("不能将用户主目录或用户级 .cursor 作为项目容器根".into());
    }
    Ok(())
}

fn dirs_home() -> Option<String> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
}

pub fn ensure_cursor_project_layout(project_root: &str) -> Result<PathBuf, String> {
    let root = Path::new(project_root.trim());
    if project_root.trim().is_empty() {
        return Err("项目根路径不能为空".into());
    }
    if !root.is_dir() {
        return Err(format!("项目根不是已存在的文件夹：{}", root.display()));
    }
    let cursor = root.join(".cursor");
    fs::create_dir_all(&cursor).map_err(|e| format!("mkdir .cursor: {e}"))?;
    for sub in CURSOR_SUBDIRS {
        fs::create_dir_all(cursor.join(sub)).map_err(|e| format!("mkdir {sub}: {e}"))?;
    }
    if !cursor.is_dir() {
        return Err(format!("未能创建容器目录：{}", cursor.display()));
    }
    Ok(cursor)
}

fn count_files_recursive(dir: &Path) -> u32 {
    let mut n = 0u32;
    let Ok(rd) = fs::read_dir(dir) else {
        return 0;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            n = n.saturating_add(count_files_recursive(&p));
        } else {
            n = n.saturating_add(1);
        }
    }
    n
}

fn is_dir_empty_shallow(dir: &Path) -> bool {
    match fs::read_dir(dir) {
        Ok(mut rd) => rd.next().is_none(),
        Err(_) => true,
    }
}

fn purge_empty_markers(project_root: &Path) -> (Vec<String>, Vec<String>) {
    let mut purged = Vec::new();
    let mut kept = Vec::new();
    for name in MARKER_DIRS {
        let dir = project_root.join(name);
        if !dir.exists() {
            continue;
        }
        if is_dir_empty_shallow(&dir) || count_files_recursive(&dir) == 0 {
            // also try remove nested empty managed dirs first
            if name == &".cursor" {
                for sub in CURSOR_SUBDIRS {
                    let s = dir.join(sub);
                    if s.is_dir() && count_files_recursive(&s) == 0 {
                        let _ = fs::remove_dir_all(&s);
                    }
                }
            }
            if count_files_recursive(&dir) == 0 {
                match fs::remove_dir_all(&dir) {
                    Ok(()) => purged.push((*name).to_string()),
                    Err(_) => kept.push((*name).to_string()),
                }
            } else {
                kept.push((*name).to_string());
            }
        } else {
            kept.push((*name).to_string());
        }
    }
    (purged, kept)
}

fn select_project(settings: &mut AppSettings, id: &str) {
    settings.nav_kind = "project".into();
    settings.selected_project_id = Some(id.to_string());
}

pub fn create_project_container(
    settings: &mut AppSettings,
    name: Option<String>,
    root_path: String,
    category: Option<String>,
) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?.to_string();
    let root = root_path.trim().to_string();
    if root.is_empty() {
        return Err("根路径不能为空".into());
    }
    assert_not_user_home_or_cursor(&root)?;
    let abs = Path::new(&root)
        .canonicalize()
        .map(|p| crate::project_discovery::to_display_path(&p.to_string_lossy()))
        .unwrap_or_else(|_| crate::project_discovery::to_display_path(&root));
    let cursor = ensure_cursor_project_layout(&abs)?;
    let cursor_s = crate::project_discovery::to_display_path(&cursor.to_string_lossy());

    let existing = list_projects(&load_catalog(&lib).catalog)
        .into_iter()
        .find(|p| paths_equal(&p.root_path, &abs));
    if let Some(mut ex) = existing {
        if !ex.pinned {
            ex.pinned = true;
            upsert_project(&lib, ex.clone())?;
        }
        select_project(settings, &ex.id);
        save_settings(settings)?;
        return Ok(ProjectOpResult {
            ok: true,
            message: format!("容器目录已就绪：{cursor_s}（已选中并显示「{}」）", ex.name),
            data: Some(serde_json::to_value(&ex).unwrap_or_default()),
            snapshot: snap(settings),
        });
    }

    let project = CatalogProject {
        id: new_project_id(),
        name: name
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                Path::new(&abs)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "project".into())
            }),
        root_path: abs,
        category: category
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "其它项目".into()),
        pinned: true,
        ..Default::default()
    };
    upsert_project(&lib, project.clone())?;
    select_project(settings, &project.id);
    save_settings(settings)?;
    Ok(ProjectOpResult {
        ok: true,
        message: format!(
            "已在磁盘创建 {}\\skills 等，并登记显示「{}」",
            cursor_s, project.name
        ),
        data: Some(serde_json::to_value(&project).unwrap_or_default()),
        snapshot: snap(settings),
    })
}

pub fn edit_project(
    settings: &AppSettings,
    id: String,
    name: String,
    root_path: String,
    category: Option<String>,
) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?;
    let mut project = find_project(lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    let n = name.trim();
    if !n.is_empty() {
        project.name = n.to_string();
    }
    let r = root_path.trim();
    if !r.is_empty() {
        assert_not_user_home_or_cursor(r)?;
        project.root_path = Path::new(r)
            .canonicalize()
            .map(|p| crate::project_discovery::to_display_path(&p.to_string_lossy()))
            .unwrap_or_else(|_| crate::project_discovery::to_display_path(r));
    }
    if let Some(c) = category {
        let t = c.trim();
        if !t.is_empty() {
            project.category = t.to_string();
        }
    }
    upsert_project(lib, project)?;
    Ok(ProjectOpResult {
        ok: true,
        message: "项目已更新".into(),
        data: None,
        snapshot: snap(settings),
    })
}

/// Plan/04 Should：项目侧多工具可见性与容器根覆盖。
pub fn update_project_tools(
    settings: &AppSettings,
    id: String,
    visible_tools: Vec<String>,
    tool_container_roots: Option<std::collections::HashMap<String, String>>,
) -> Result<ProjectOpResult, String> {
    use crate::workspace::normalize_workspace_id;

    let lib = require_library(settings)?;
    let mut project = find_project(lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    let mut cleaned = Vec::new();
    for t in visible_tools {
        if let Some(nid) = normalize_workspace_id(&t) {
            if !cleaned.iter().any(|x: &String| x == nid) {
                cleaned.push(nid.into());
            }
        }
    }
    if cleaned.is_empty() {
        cleaned.push("cursor".into());
    }
    project.visible_tools = cleaned;
    if let Some(map) = tool_container_roots {
        let mut roots = std::collections::BTreeMap::new();
        for (k, v) in map {
            if let Some(nid) = normalize_workspace_id(&k) {
                let t = v.trim();
                if !t.is_empty() {
                    roots.insert(nid.into(), crate::project_discovery::to_display_path(t));
                }
            }
        }
        project.tool_container_roots = roots;
    }
    upsert_project(lib, project)?;
    Ok(ProjectOpResult {
        ok: true,
        message: "项目工具已更新".into(),
        data: None,
        snapshot: snap(settings),
    })
}

/// Toggle catalog `pinned`（侧栏开眼=显示；关眼=隐藏容器池）。IPC 名暂留 toggle_pin_project。
pub fn toggle_pin_project(settings: &AppSettings, id: String) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?;
    let mut project = find_project(lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    project.pinned = !project.pinned;
    let shown = project.pinned;
    upsert_project(lib, project)?;
    let snapshot = snap_nav_only(settings);
    Ok(ProjectOpResult {
        ok: true,
        message: if shown {
            "已显示到侧栏".into()
        } else {
            "已隐藏（可在齿轮池找回）".into()
        },
        data: None,
        snapshot,
    })
}

pub fn reorder_project_cmd(
    settings: &AppSettings,
    id: String,
    direction: String,
    to_index: Option<usize>,
) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?;
    reorder_project(lib, &id, direction.trim(), to_index)?;
    Ok(ProjectOpResult {
        ok: true,
        message: "顺序已更新".into(),
        data: None,
        snapshot: snap_nav_only(settings),
    })
}

pub fn inspect_project_for_delete(
    settings: &AppSettings,
    id: String,
) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?;
    let project = find_project(lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    let cursor = Path::new(&project.root_path).join(".cursor");
    let cursor_exists = cursor.is_dir();
    let file_count = if cursor_exists {
        count_files_recursive(&cursor)
    } else {
        0
    };
    let data = ProjectDeleteInspect {
        project_name: project.name,
        root_path: project.root_path,
        cursor_path: cursor.to_string_lossy().to_string(),
        cursor_exists,
        file_count,
        managed_count: 0,
    };
    Ok(ProjectOpResult {
        ok: true,
        message: String::new(),
        data: Some(serde_json::to_value(&data).unwrap_or_default()),
        snapshot: snap(settings),
    })
}

pub fn remove_project_cmd(
    settings: &mut AppSettings,
    id: String,
    force_delete_markers: bool,
    purge_empty_markers_flag: bool,
) -> Result<ProjectOpResult, String> {
    let lib = require_library(settings)?.to_string();
    let project = find_project(&lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    let root = Path::new(&project.root_path);
    let mut parts = Vec::new();

    if force_delete_markers {
        let mut removed = Vec::new();
        for name in MARKER_DIRS {
            let dir = root.join(name);
            if !dir.exists() {
                continue;
            }
            fs::remove_dir_all(&dir).map_err(|e| format!("强制删除 {name} 失败：{e}"))?;
            removed.push(*name);
        }
        if !removed.is_empty() {
            parts.push(format!("已强制删除：{}", removed.join(", ")));
        }
    } else if purge_empty_markers_flag {
        let (purged, kept) = purge_empty_markers(root);
        if !purged.is_empty() {
            parts.push(format!("已删除空目录：{}", purged.join(", ")));
        }
        if !kept.is_empty() {
            return Ok(ProjectOpResult {
                ok: false,
                message: format!(
                    "仍有文件未清空（{}）。请用「打开当前目录」手动处理，或选「直接删除」",
                    kept.join(", ")
                ),
                data: None,
                snapshot: snap(settings),
            });
        }
    }

    remove_project(&lib, &id)?;
    if settings.selected_project_id.as_deref() == Some(id.as_str()) {
        settings.selected_project_id = None;
        settings.nav_kind = "library".into();
        save_settings(settings)?;
    }
    parts.push(format!("已移除项目「{}」", project.name));
    Ok(ProjectOpResult {
        ok: true,
        message: parts.join("；"),
        data: None,
        snapshot: snap(settings),
    })
}

pub fn open_project_cursor(settings: &AppSettings, id: String) -> Result<(), String> {
    let lib = require_library(settings)?;
    let project = find_project(lib, &id)?.ok_or_else(|| "项目不存在".to_string())?;
    let cursor = Path::new(&project.root_path).join(".cursor");
    let target = if cursor.is_dir() {
        cursor.to_string_lossy().to_string()
    } else {
        project.root_path.clone()
    };
    open_path(target)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::ensure_library_layout;

    #[test]
    fn create_then_edit_pin_reorder_remove() {
        let appdata = tempfile::tempdir().unwrap();
        std::env::set_var("APPDATA", appdata.path());

        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        let proj = dir.path().join("myproj");
        fs::create_dir_all(&proj).unwrap();
        ensure_library_layout(&lib).unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            ..Default::default()
        };

        let created = create_project_container(
            &mut settings,
            Some("Demo".into()),
            proj.to_string_lossy().to_string(),
            None,
        )
        .unwrap();
        assert!(created.ok, "{}", created.message);
        assert!(proj.join(".cursor/skills").is_dir());
        let id = created
            .data
            .as_ref()
            .and_then(|v| v.get("id"))
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        // second project for reorder
        let proj2 = dir.path().join("other");
        fs::create_dir_all(&proj2).unwrap();
        let c2 = create_project_container(
            &mut settings,
            Some("Other".into()),
            proj2.to_string_lossy().to_string(),
            None,
        )
        .unwrap();
        assert!(c2.ok);
        let id2 = c2
            .data
            .as_ref()
            .and_then(|v| v.get("id"))
            .and_then(|v| v.as_str())
            .unwrap()
            .to_string();

        toggle_pin_project(&settings, id.clone()).unwrap(); // unpin
        let pinned_again = toggle_pin_project(&settings, id.clone()).unwrap(); // pin again
        assert!(pinned_again.snapshot.omit_network_library_list);
        assert!(pinned_again.snapshot.network_library_items.is_empty());
        let _ = reorder_project_cmd(&settings, id2.clone(), "up".into(), None);

        edit_project(
            &settings,
            id.clone(),
            "Demo2".into(),
            proj.to_string_lossy().to_string(),
            Some("测试".into()),
        )
        .unwrap();

        let insp = inspect_project_for_delete(&settings, id.clone()).unwrap();
        assert!(insp.ok);
        assert!(insp.data.is_some());

        let rem = remove_project_cmd(&mut settings, id.clone(), false, true).unwrap();
        assert!(rem.ok, "{}", rem.message);
        assert!(find_project(&lib, &id).unwrap().is_none());
    }

    #[test]
    fn rejects_user_home() {
        let home = dirs_home().unwrap();
        assert!(assert_not_user_home_or_cursor(&home).is_err());
    }
}
