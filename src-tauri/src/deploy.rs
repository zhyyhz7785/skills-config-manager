//! Deploy library entries into the active nav container.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::active_container::{
    is_user_global_container_root, resolve_active_container_root, resolve_project_container_slot,
};
use crate::catalog::{load_catalog, upsert_entry, validate_entry_paths, CatalogEntry};
use crate::path_guard::{assert_managed_container_path, resolve_library_safe_path};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub ok: bool,
    pub succeeded: u32,
    pub failed: u32,
    pub errors: Vec<String>,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
}

fn kind_folder(kind: &str) -> &str {
    match kind {
        "skill" => "skills",
        "rule" => "rules",
        "agent" => "agents",
        "command" => "commands",
        "hook" => "hooks",
        _ => "skills",
    }
}

/// Canonical container path from kind+id（ignore stale origins）.
pub fn canonical_deploy_target(entry: &CatalogEntry, container_root: &str) -> PathBuf {
    let root = Path::new(container_root);
    let folder = kind_folder(&entry.kind);
    let lib = entry.library_path.replace('\\', "/").to_lowercase();
    match entry.kind.as_str() {
        "skill" if lib.ends_with(".skill") => root.join(folder).join(format!("{}.skill", entry.id)),
        // Skill unit is always skills/{id}/ (multi-file); not a lone SKILL.md path.
        "skill" => root.join(folder).join(&entry.id),
        "rule" => {
            let ext = if entry.library_path.trim().is_empty() {
                ".mdc".into()
            } else {
                crate::rule_layout::ext_from_path(Path::new(&entry.library_path))
            };
            // 本仓约定：rules/{id}/{id}{ext}（文件夹壳）
            root.join(folder)
                .join(&entry.id)
                .join(format!("{}{}", entry.id, ext))
        }
        "agent" | "command" => root.join(folder).join(format!("{}.md", entry.id)),
        "hook" if lib.ends_with(".json") => root.join("hooks.json"),
        "hook" => root.join(folder).join(format!("{}.ps1", entry.id)),
        _ => root.join(folder).join(&entry.id),
    }
}

/// Resolve deploy target under container root.
pub fn resolve_deploy_target(entry: &CatalogEntry, container_root: &str) -> PathBuf {
    // Prefer origin under this container if present（rule 接受 nested 壳或旧扁平）。
    for o in &entry.origins {
        let p = o.original_path.trim();
        if p.is_empty() {
            continue;
        }
        if !p.to_lowercase().starts_with(&container_root.to_lowercase()) {
            continue;
        }
        if !Path::new(p).exists() {
            continue;
        }
        if entry.kind.eq_ignore_ascii_case("skill") {
            return crate::skill_layout::skill_unit_path(Path::new(p));
        }
        return PathBuf::from(p);
    }
    canonical_deploy_target(entry, container_root)
}

pub(crate) fn copy_path(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let meta = fs::symlink_metadata(src).map_err(|e| format!("stat source: {e}"))?;
    if meta.is_dir() {
        copy_dir_recursive(src, dst)
    } else {
        fs::copy(src, dst).map_err(|e| format!("copy file: {e}"))?;
        Ok(())
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir dst: {e}"))?;
    for ent in fs::read_dir(src).map_err(|e| format!("read_dir: {e}"))? {
        let ent = ent.map_err(|e| format!("read_dir entry: {e}"))?;
        let ty = ent.file_type().map_err(|e| e.to_string())?;
        let to = dst.join(ent.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&ent.path(), &to)?;
        } else {
            fs::copy(ent.path(), &to).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

/// Create a symlink at `dst` pointing to `src`. Never falls back to copy.
pub(crate) fn symlink_path(src: &Path, dst: &Path) -> Result<(), String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    let meta = fs::symlink_metadata(src).map_err(|e| format!("stat source: {e}"))?;
    let is_dir = meta.is_dir();
    #[cfg(windows)]
    {
        use std::os::windows::fs::{symlink_dir, symlink_file};
        let r = if is_dir {
            symlink_dir(src, dst)
        } else {
            symlink_file(src, dst)
        };
        r.map_err(|e| {
            format!(
                "创建符号链接失败（非默认工作区需系统允许创建 symlink，例如开启开发者模式）：{e}"
            )
        })?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(src, dst).map_err(|e| {
            format!("创建符号链接失败：{e}")
        })?;
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = (src, dst, is_dir);
        return Err("当前平台不支持符号链接布置".into());
    }
    Ok(())
}

fn place_entry(
    src: &Path,
    dst: &Path,
    mode: crate::workspace::DeployMode,
) -> Result<(), String> {
    match mode {
        crate::workspace::DeployMode::Copy => copy_path(src, dst),
        crate::workspace::DeployMode::Symlink => symlink_path(src, dst),
    }
}

pub(crate) fn remove_path_any(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => remove_deploy_target(path, &meta),
        Err(_) => Ok(()),
    }
}

fn remove_deploy_target(path: &Path, meta: &fs::Metadata) -> Result<(), String> {
    if meta.file_type().is_symlink() {
        // Windows: directory symlinks need remove_dir; file symlinks need remove_file.
        if fs::remove_dir(path).is_ok() {
            return Ok(());
        }
        fs::remove_file(path).map_err(|e| format!("remove symlink: {e}"))
    } else if meta.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("remove existing dir: {e}"))
    } else {
        fs::remove_file(path).map_err(|e| format!("remove existing file: {e}"))
    }
}

#[allow(dead_code)]
pub fn deploy_one(settings: &AppSettings, entry_id: &str) -> Result<(), String> {
    let container_root = resolve_active_container_root(settings);
    let ws = crate::workspace::normalize_workspace_id(&settings.selected_global_tool)
        .unwrap_or("cursor");
    deploy_one_to(settings, entry_id, &container_root, ws)
}

/// Deploy one entry into an explicit container root.
/// Mode: default workspace → copy; any other work-area slot → symlink to permanent library.
pub fn deploy_one_to(
    settings: &AppSettings,
    entry_id: &str,
    container_root: &str,
    workspace_id: &str,
) -> Result<(), String> {
    let library_root = settings.skills_library_root.trim();
    if library_root.is_empty() || !settings.library_root_configured {
        return Err("library not configured".into());
    }
    if container_root.trim().is_empty() {
        return Err("container root empty".into());
    }
    let container_root = container_root.trim();
    if !Path::new(container_root).exists() {
        fs::create_dir_all(container_root).map_err(|e| format!("mkdir container: {e}"))?;
    }

    let load = load_catalog(library_root);
    if !load.healthy {
        return Err(format!(
            "catalog unhealthy: {}",
            load.error.unwrap_or_else(|| "unknown".into())
        ));
    }
    let mut entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("entry not found: {entry_id}"))?;

    if entry.kind.eq_ignore_ascii_case("rule") {
        let changed = crate::rule_layout::repath_rule_entry_to_nested(library_root, &mut entry)?;
        if changed {
            upsert_entry(library_root, entry.clone())?;
        }
    }

    if entry.kind.eq_ignore_ascii_case("skill") {
        if crate::skill_layout::normalize_skill_entry_paths(&mut entry) {
            upsert_entry(library_root, entry.clone())?;
        }
    }

    if entry.library_path.trim().is_empty() {
        return Err(format!("「{entry_id}」无库路径，无法部署"));
    }
    let library_full_raw = resolve_library_safe_path(library_root, &entry.library_path)
        .map_err(|e| format!("library path: {e}"))?;
    let library_full = if entry.kind.eq_ignore_ascii_case("skill") {
        crate::skill_layout::skill_unit_path(&library_full_raw)
    } else {
        library_full_raw
    };
    if !library_full.exists() {
        return Err(format!("库中文件不存在：{}", library_full.display()));
    }

    let target = resolve_deploy_target(&entry, container_root);
    let target_s = target.to_string_lossy().to_string();
    let allow_global = is_user_global_container_root(container_root);
    assert_managed_container_path(&target_s, &[container_root], allow_global)
        .map_err(|e| format!("部署目标不受管：{e}：{target_s}"))?;

    let mode = crate::workspace::deploy_mode_for(settings, workspace_id);

    // 再次部署：删旧再布置（含既有 symlink；不跟随链接）。
    if let Ok(meta) = fs::symlink_metadata(&target) {
        remove_deploy_target(&target, &meta)?;
    }
    // 旧台账曾部署到 skills/{id}/SKILL.md：清掉父目录残留后再写整树
    if entry.kind.eq_ignore_ascii_case("skill") && !entry.library_path.to_lowercase().ends_with(".skill")
    {
        let skill_dir = Path::new(container_root).join("skills").join(&entry.id);
        if skill_dir != target {
            if let Ok(meta) = fs::symlink_metadata(&skill_dir) {
                if meta.file_type().is_symlink() || meta.is_file() {
                    let _ = fs::remove_file(&skill_dir);
                } else if meta.is_dir() {
                    let _ = fs::remove_dir_all(&skill_dir);
                }
            }
        }
    }

    place_entry(&library_full, &target, mode)?;

    // Drop leftover flat sibling in container if we wrote nested shell.
    if entry.kind.eq_ignore_ascii_case("rule") {
        let ext = if entry.library_path.trim().is_empty() {
            ".mdc".into()
        } else {
            crate::rule_layout::ext_from_path(Path::new(&entry.library_path))
        };
        let flat = Path::new(container_root)
            .join("rules")
            .join(format!("{}{}", entry.id, ext));
        if flat.is_file() {
            let _ = fs::remove_file(&flat);
        }
    }

    let mut updated = entry;
    updated.is_in_library = true;
    updated.is_missing = false;
    updated.deployed_path = target_s;
    if updated.kind.eq_ignore_ascii_case("skill") {
        let _ = crate::skill_layout::normalize_skill_entry_paths(&mut updated);
    }
    upsert_entry(library_root, updated)?;
    Ok(())
}

/// Resolve deploy target roots. Empty `workspace_ids` → active focus only.
pub fn resolve_deploy_roots(
    settings: &AppSettings,
    workspace_ids: &[String],
) -> Result<Vec<(String, String)>, String> {
    use crate::active_container::{
        resolve_active_container_root, resolve_project_tool_container,
    };
    use crate::catalog::{list_projects, load_catalog};
    use crate::workspace::{normalize_workspace_id, resolve_workspace_container_root};

    if workspace_ids.is_empty() {
        let root = resolve_active_container_root(settings);
        if root.trim().is_empty() {
            return Err("active container root empty".into());
        }
        let id = normalize_workspace_id(&settings.selected_global_tool)
            .unwrap_or("cursor")
            .to_string();
        return Ok(vec![(id, root)]);
    }

    let kind = settings.nav_kind.trim().to_lowercase();
    let mut out = Vec::new();

    if kind == "project" {
        let pid = settings
            .selected_project_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| "未选择项目".to_string())?;
        let lib = settings.skills_library_root.trim();
        let load = load_catalog(lib);
        let proj = list_projects(&load.catalog)
            .into_iter()
            .find(|p| p.id == pid)
            .ok_or_else(|| format!("项目不存在：{pid}"))?;
        for raw in workspace_ids {
            let Some(tid) = normalize_workspace_id(raw) else {
                continue;
            };
            let root =
                resolve_project_tool_container(&proj.root_path, tid, &proj.tool_container_roots);
            if root.trim().is_empty() {
                return Err(format!("项目工具容器根为空：{tid}"));
            }
            if !out.iter().any(|(id, _)| id == tid) {
                out.push((tid.into(), root));
            }
        }
    } else {
        for raw in workspace_ids {
            let Some(wid) = normalize_workspace_id(raw) else {
                continue;
            };
            let root = resolve_workspace_container_root(settings, wid);
            if root.trim().is_empty() {
                return Err(format!("工作区容器根为空：{wid}"));
            }
            if !out.iter().any(|(id, _)| id == wid) {
                out.push((wid.into(), root));
            }
        }
    }

    if out.is_empty() {
        return Err("未解析到任何部署目标".into());
    }
    Ok(out)
}

pub fn deploy_entries(settings: &AppSettings, entry_ids: &[String]) -> Result<DeployResult, String> {
    deploy_entries_to_workspaces(settings, entry_ids, &[])
}

/// Plan/04 Should：部署到一个或多个工作区/项目工具容器。
pub fn deploy_entries_to_workspaces(
    settings: &AppSettings,
    entry_ids: &[String],
    workspace_ids: &[String],
) -> Result<DeployResult, String> {
    let roots = resolve_deploy_roots(settings, workspace_ids)?;
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    let mut errors = Vec::new();
    for (ws_id, container_root) in &roots {
        for id in entry_ids {
            let id = id.trim();
            if id.is_empty() {
                continue;
            }
            match deploy_one_to(settings, id, container_root, ws_id) {
                Ok(()) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(format!("{id}@{ws_id}: {e}"));
                }
            }
        }
    }
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    let snapshot = build_snapshot_subset(settings, &load, warnings);
    let targets = roots
        .iter()
        .map(|(id, _)| id.as_str())
        .collect::<Vec<_>>()
        .join(",");
    let mut message = format!("放入（{targets}）：成功 {succeeded}，失败 {failed}");
    // 用户级 ~/.cursor/rules ≠ Cursor Settings → Rules；成功部署 rule 时点明，避免误以为全局生效
    if succeeded > 0 {
        let deployed_rule_to_user_global = roots.iter().any(|(_, root)| {
            is_user_global_container_root(root)
                && entry_ids.iter().any(|id| {
                    load.catalog
                        .entries
                        .iter()
                        .any(|e| e.id == id.trim() && e.kind.eq_ignore_ascii_case("rule"))
                })
        });
        if deployed_rule_to_user_global {
            message.push_str(
                "。注意：已写入 ~/.cursor/rules，但 Cursor 不会当作全局 User Rules；跨项目请复制正文到 Settings → Rules；项目内请部署到该项目的 .cursor/rules",
            );
        }
    }
    Ok(DeployResult {
        ok: failed == 0,
        succeeded,
        failed,
        errors,
        message,
        snapshot,
    })
}

/// Resolve one container root per project id. Dedupes by container path, not tool id.
/// Missing / empty-root projects are returned as errors so the caller can continue.
pub fn resolve_deploy_roots_for_projects(
    settings: &AppSettings,
    project_ids: &[String],
) -> (Vec<(String, String)>, Vec<String>) {
    use crate::project_discovery::normalize_path;

    let mut out: Vec<(String, String)> = Vec::new();
    let mut errors = Vec::new();
    for raw in project_ids {
        let pid = raw.trim();
        if pid.is_empty() {
            continue;
        }
        match resolve_project_container_slot(settings, pid) {
            Some((ws_id, root)) => {
                let key = normalize_path(&root);
                if out
                    .iter()
                    .any(|(_, existing)| normalize_path(existing) == key)
                {
                    continue;
                }
                out.push((ws_id, root));
            }
            None => errors.push(format!("项目容器根为空或不存在：{pid}")),
        }
    }
    (out, errors)
}

/// Deploy selected library entries into each listed project's focus tool container.
pub fn deploy_entries_to_projects(
    settings: &AppSettings,
    entry_ids: &[String],
    project_ids: &[String],
) -> Result<DeployResult, String> {
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("library not configured".into());
    }
    let (roots, resolve_errors) = resolve_deploy_roots_for_projects(settings, project_ids);
    let mut succeeded = 0u32;
    let mut failed = resolve_errors.len() as u32;
    let mut errors = resolve_errors;
    for (ws_id, container_root) in &roots {
        for id in entry_ids {
            let id = id.trim();
            if id.is_empty() {
                continue;
            }
            match deploy_one_to(settings, id, container_root, ws_id) {
                Ok(()) => succeeded += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(format!("{id}@{ws_id}: {e}"));
                }
            }
        }
    }
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        validate_entry_paths(settings.skills_library_root.trim(), &load.catalog.entries)
    } else {
        vec![]
    };
    let snapshot = build_snapshot_subset(settings, &load, warnings);
    let n = roots.len();
    let mut message = format!("放入（{n} 个开眼容器）：成功 {succeeded}，失败 {failed}");
    if succeeded > 0 {
        let deployed_rule_to_user_global = roots.iter().any(|(_, root)| {
            is_user_global_container_root(root)
                && entry_ids.iter().any(|id| {
                    load.catalog
                        .entries
                        .iter()
                        .any(|e| e.id == id.trim() && e.kind.eq_ignore_ascii_case("rule"))
                })
        });
        if deployed_rule_to_user_global {
            message.push_str(
                "。注意：已写入 ~/.cursor/rules，但 Cursor 不会当作全局 User Rules；跨项目请复制正文到 Settings → Rules；项目内请部署到该项目的 .cursor/rules",
            );
        }
    }
    Ok(DeployResult {
        ok: failed == 0,
        succeeded,
        failed,
        errors,
        message,
        snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, save_catalog, CatalogEntry};

    #[test]
    fn deploy_skill_file_then_exists_in_container() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        let container = proj.join(".cursor");
        fs::create_dir_all(&container).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/demo")).unwrap();
        let lib_file = dir.path().join("skills/demo/SKILL.md");
        fs::write(&lib_file, b"# demo\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "demo".into(),
                    kind: "skill".into(),
                    library_path: "skills/demo/SKILL.md".into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["demo".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        let target = container.join("skills/demo/SKILL.md");
        assert!(target.exists());
        let load = load_catalog(&settings.skills_library_root);
        let e = load.catalog.entries.iter().find(|e| e.id == "demo").unwrap();
        assert!(!e.deployed_path.is_empty());
        assert!(
            e.library_path.replace('\\', "/") == "skills/demo",
            "library_path should normalize to dir: {}",
            e.library_path
        );
        let dep = e.deployed_path.replace('/', "\\").to_lowercase();
        assert!(
            dep.ends_with("\\skills\\demo"),
            "deployed_path should be skill dir: {}",
            e.deployed_path
        );

        // 再次部署：覆盖容器副本（库侧改写后应反映到容器）。
        fs::write(&lib_file, b"# demo v2\n").unwrap();
        let r2 = deploy_entries(&settings, &["demo".into()]).unwrap();
        assert!(r2.ok, "{}", r2.message);
        assert_eq!(fs::read_to_string(&target).unwrap(), "# demo v2\n");
    }

    #[test]
    fn deploy_skill_directory_copies_sidecar_files() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        let container = proj.join(".cursor");
        fs::create_dir_all(&container).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        let lib_skill = dir.path().join("skills/multi");
        fs::create_dir_all(&lib_skill).unwrap();
        fs::write(lib_skill.join("SKILL.md"), b"# multi\n").unwrap();
        fs::write(lib_skill.join("helper.md"), b"helper\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "multi".into(),
                    kind: "skill".into(),
                    // 旧台账仍指向 SKILL.md
                    library_path: "skills/multi/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["multi".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(container.join("skills/multi/SKILL.md").is_file());
        assert!(container.join("skills/multi/helper.md").is_file());
        let n = fs::read_dir(container.join("skills/multi"))
            .unwrap()
            .filter(|e| e.as_ref().map(|x| x.path().is_file()).unwrap_or(false))
            .count();
        assert_eq!(n, 2, "container skill file count");
    }

    /// Plan/04 GUI 契约：焦点 Claude 后部署写入 Claude 容器根（同工具栏「部署 → Claude」IPC）。
    #[test]
    fn deploy_to_focus_global_workspace_claude() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let claude = dir.path().join(".claude");
        fs::create_dir_all(&claude).unwrap();
        fs::create_dir_all(dir.path().join("skills/g1")).unwrap();
        fs::write(dir.path().join("skills/g1/SKILL.md"), b"# g1\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "g1".into(),
                    kind: "skill".into(),
                    library_path: "skills/g1/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "claude".into(),
            default_workspace_id: "claude".into(),
            ..Default::default()
        };
        crate::workspace::ensure_workspaces_migrated(&mut settings);
        settings.default_workspace_id = "claude".into();
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.container_root = claude.to_string_lossy().to_string();
            w.enabled = true;
            w.in_work_area = true;
        }
        settings.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let r = deploy_entries(&settings, &["g1".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(
            claude.join("skills/g1/SKILL.md").is_file(),
            "expected deploy into Claude container"
        );
        // Default workspace → real copy, not symlink.
        let skill_dir = claude.join("skills/g1");
        let meta = fs::symlink_metadata(&skill_dir).unwrap();
        assert!(
            !meta.file_type().is_symlink(),
            "default workspace must copy, not symlink"
        );
    }

    fn symlink_probe_ok(dir: &std::path::Path) -> bool {
        let t = dir.join("_ccm_symlink_probe_t");
        let l = dir.join("_ccm_symlink_probe_l");
        let _ = fs::write(&t, b"x");
        #[cfg(windows)]
        let ok = std::os::windows::fs::symlink_file(&t, &l).is_ok();
        #[cfg(unix)]
        let ok = std::os::unix::fs::symlink(&t, &l).is_ok();
        #[cfg(not(any(windows, unix)))]
        let ok = false;
        let _ = fs::remove_file(&l);
        let _ = fs::remove_file(&t);
        ok
    }

    /// Non-default work-area slot deploys as symlink into permanent library.
    #[test]
    fn deploy_non_default_workspace_creates_symlink() {
        let dir = tempfile::tempdir().unwrap();
        if !symlink_probe_ok(dir.path()) {
            eprintln!("skip: environment cannot create symlinks");
            return;
        }
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let claude = dir.path().join(".claude");
        fs::create_dir_all(&claude).unwrap();
        fs::create_dir_all(dir.path().join("skills/sym1")).unwrap();
        fs::write(dir.path().join("skills/sym1/SKILL.md"), b"# sym1\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "sym1".into(),
                    kind: "skill".into(),
                    library_path: "skills/sym1".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "claude".into(),
            default_workspace_id: "cursor".into(),
            ..Default::default()
        };
        crate::workspace::ensure_workspaces_migrated(&mut settings);
        settings.default_workspace_id = "cursor".into();
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.container_root = claude.to_string_lossy().to_string();
            w.enabled = true;
            w.in_work_area = true;
        }
        settings.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        settings.selected_global_tool = "claude".into();
        let r = deploy_entries(&settings, &["sym1".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        let skill_dir = claude.join("skills/sym1");
        let meta = fs::symlink_metadata(&skill_dir).expect("symlink meta");
        assert!(meta.file_type().is_symlink(), "non-default must be symlink");
        assert!(skill_dir.join("SKILL.md").is_file());
        // Withdraw must not delete library.
        let lib_skill = Path::new(&lib_root).join("skills/sym1/SKILL.md");
        assert!(lib_skill.is_file());
        crate::withdraw::remove_path(&skill_dir).unwrap();
        assert!(!skill_dir.exists());
        assert!(lib_skill.is_file(), "library must remain after unlink");
    }

    #[test]
    fn deploy_rule_writes_nested_mdc() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        let container = proj.join(".cursor");
        fs::create_dir_all(container.join("rules")).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        // 旧扁平台账 → 触达升格为文件夹壳
        let flat = dir.path().join("rules/L0-01-thinking-and-explanation.mdc");
        fs::create_dir_all(flat.parent().unwrap()).unwrap();
        fs::write(&flat, b"# L0-01\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "L0-01-thinking-and-explanation".into(),
                    kind: "rule".into(),
                    library_path: "rules/L0-01-thinking-and-explanation.mdc".into(),
                    is_in_library: true,
                    deployed_path: String::new(),
                    is_missing: false,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["L0-01-thinking-and-explanation".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(container
            .join("rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc")
            .is_file());
        assert!(!container
            .join("rules/L0-01-thinking-and-explanation.mdc")
            .exists());
        let entry = load_catalog(&lib_root)
            .catalog
            .entries
            .into_iter()
            .find(|e| e.id == "L0-01-thinking-and-explanation")
            .unwrap();
        assert_eq!(
            entry.library_path,
            "rules/L0-01-thinking-and-explanation/L0-01-thinking-and-explanation.mdc"
        );
    }

    /// Plan/04 Should：多目标部署写入两个全局工作区容器。
    #[test]
    fn deploy_to_multiple_global_workspaces() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let cursor = dir.path().join(".cursor-ws");
        let claude = dir.path().join(".claude-ws");
        fs::create_dir_all(&cursor).unwrap();
        fs::create_dir_all(&claude).unwrap();
        fs::create_dir_all(dir.path().join("skills/m1")).unwrap();
        fs::write(dir.path().join("skills/m1/SKILL.md"), b"# m1\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "m1".into(),
                    kind: "skill".into(),
                    library_path: "skills/m1/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        crate::workspace::ensure_workspaces_migrated(&mut settings);
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "cursor") {
            w.container_root = cursor.to_string_lossy().to_string();
        }
        if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.container_root = claude.to_string_lossy().to_string();
            w.enabled = true;
        }
        settings.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let r = deploy_entries_to_workspaces(
            &settings,
            &["m1".into()],
            &["cursor".into(), "claude".into()],
        )
        .unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(cursor.join("skills/m1/SKILL.md").is_file());
        assert!(claude.join("skills/m1/SKILL.md").is_file());

        fs::write(dir.path().join("skills/m1/SKILL.md"), b"# m1 v2\n").unwrap();
        let r2 = deploy_entries_to_workspaces(
            &settings,
            &["m1".into()],
            &["cursor".into(), "claude".into()],
        )
        .unwrap();
        assert!(r2.ok, "{}", r2.message);
        assert_eq!(
            fs::read_to_string(cursor.join("skills/m1/SKILL.md")).unwrap(),
            "# m1 v2\n"
        );
        assert_eq!(
            fs::read_to_string(claude.join("skills/m1/SKILL.md")).unwrap(),
            "# m1 v2\n"
        );
    }

    /// Plan/04 Should：项目侧多工具部署写入 `.cursor` 与 `.claude`。
    #[test]
    fn deploy_to_multiple_project_tools() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("Proj");
        fs::create_dir_all(proj.join(".cursor")).unwrap();
        fs::create_dir_all(proj.join(".claude")).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "p1".into(),
                name: "Proj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                visible_tools: vec!["cursor".into(), "claude".into()],
                tool_container_roots: Default::default(),
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/pmt")).unwrap();
        fs::write(dir.path().join("skills/pmt/SKILL.md"), b"# pmt\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "pmt".into(),
                    kind: "skill".into(),
                    library_path: "skills/pmt/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("p1".into()),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        let r = deploy_entries_to_workspaces(
            &settings,
            &["pmt".into()],
            &["cursor".into(), "claude".into()],
        )
        .unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(proj.join(".cursor/skills/pmt/SKILL.md").is_file());
        assert!(proj.join(".claude/skills/pmt/SKILL.md").is_file());
    }

    #[test]
    fn deploy_to_multiple_pinned_projects() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let a = dir.path().join("ProjA");
        let b = dir.path().join("ProjB");
        fs::create_dir_all(a.join(".cursor")).unwrap();
        fs::create_dir_all(b.join(".cursor")).unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "pa".into(),
                name: "ProjA".into(),
                root_path: a.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                visible_tools: vec!["cursor".into()],
                tool_container_roots: Default::default(),
            },
        )
        .unwrap();
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "pb".into(),
                name: "ProjB".into(),
                root_path: b.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                visible_tools: vec!["cursor".into()],
                tool_container_roots: Default::default(),
            },
        )
        .unwrap();
        fs::create_dir_all(dir.path().join("skills/open-eye")).unwrap();
        fs::write(dir.path().join("skills/open-eye/SKILL.md"), b"# open-eye\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "open-eye".into(),
                    kind: "skill".into(),
                    library_path: "skills/open-eye/SKILL.md".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        let r = deploy_entries_to_projects(&settings, &["open-eye".into()], &["pa".into(), "pb".into()])
            .unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(
            r.message.contains("2 个开眼容器"),
            "expected project-count message, got: {}",
            r.message
        );
        assert!(a.join(".cursor/skills/open-eye/SKILL.md").is_file());
        assert!(b.join(".cursor/skills/open-eye/SKILL.md").is_file());
    }

    #[test]
    fn deploy_rule_to_user_global_message_mentions_settings() {
        let home = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        std::env::set_var("USERPROFILE", home.path());
        std::env::set_var("HOME", home.path());
        std::env::set_var("APPDATA", appdata.path());

        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let rule_path = dir.path().join("rules/hint-rule.mdc");
        fs::create_dir_all(rule_path.parent().unwrap()).unwrap();
        fs::write(&rule_path, b"# hint\n").unwrap();
        save_catalog(
            &lib_root,
            &{
                let mut c = load_catalog(&lib_root).catalog;
                c.entries.push(CatalogEntry {
                    id: "hint-rule".into(),
                    kind: "rule".into(),
                    library_path: "rules/hint-rule.mdc".into(),
                    is_in_library: true,
                    ..Default::default()
                });
                c
            },
        )
        .unwrap();

        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        let r = deploy_entries(&settings, &["hint-rule".into()]).unwrap();
        assert!(r.ok, "{}", r.message);
        assert!(
            r.message.contains("Settings") || r.message.contains("User Rules"),
            "expected Settings/User Rules hint, got: {}",
            r.message
        );
        assert!(home
            .path()
            .join(".cursor/rules/hint-rule/hint-rule.mdc")
            .is_file());
    }
}
