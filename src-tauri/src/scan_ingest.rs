//! Scan + ingest: full project discovery + container/library-disk assets (M4 parity).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::catalog::{
    list_projects, load_catalog, upsert_entry, upsert_project, validate_entry_paths, CatalogEntry,
    CatalogOrigin, CatalogProject,
};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::hash_path_auto;
use crate::path_guard::resolve_library_safe_path;
use crate::project_discovery::{
    discover_projects_merged, merge_projects_for_container_scan, normalize_path,
    registered_projects_from_settings, should_skip_path, user_cursor_root, PendingProjectItem,
};
use crate::settings::{resolve_backup_root, AppSettings};
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};
use crate::withdraw::PathConflictDto;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredItemDto {
    pub key: String,
    pub kind: String,
    pub suggested_id: String,
    pub source_path: String,
    pub tool: String,
    pub scope: String,
    pub is_folder: bool,
    pub content_hash: String,
    pub remark_zh: String,
    pub content_changed: bool,
    pub needs_attention: bool,
    pub is_selected: bool,
    pub existing_entry_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanPreviewResult {
    pub ok: bool,
    pub message: String,
    pub items: Vec<DiscoveredItemDto>,
    pub pending_new_project_count: u32,
    pub scan_roots: Vec<String>,
    pub conflicts: Vec<PathConflictDto>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanConfirmResult {
    pub ok: bool,
    pub message: String,
    pub registered: u32,
    pub origins_appended: u32,
    pub skipped: u32,
    pub failed: u32,
    pub errors: Vec<String>,
    pub projects_added: u32,
    pub conflicts: Vec<PathConflictDto>,
    pub open_auto_classify: bool,
    pub copied_into_library: u32,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResolution {
    pub key: String,
    pub choice: String,
}

#[derive(Debug, Clone)]
struct PendingPreview {
    items: Vec<DiscoveredItemDto>,
    library_disk_keys: Vec<String>,
    pending_projects: Vec<PendingProjectItem>,
}

fn pending_store() -> &'static Mutex<Option<PendingPreview>> {
    static STORE: OnceLock<Mutex<Option<PendingPreview>>> = OnceLock::new();
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

fn strip_win_extended_prefix(p: &str) -> &str {
    crate::project_discovery::strip_win_extended_prefix(p)
}

fn norm_key(p: &str) -> String {
    strip_win_extended_prefix(p.trim())
        .replace('\\', "/")
        .to_lowercase()
}

fn sanitize_id(raw: &str) -> String {
    let s: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let s = s.trim_matches('-').to_string();
    if s.is_empty() {
        "item".into()
    } else {
        s
    }
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

fn library_rel_for(kind: &str, id: &str, source: &Path, is_folder: bool) -> String {
    let folder = folder_for_kind(kind);
    if kind.eq_ignore_ascii_case("rule") && !is_folder {
        return crate::rule_layout::flat_rule_rel(id, &crate::rule_layout::ext_from_path(source));
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

/// Scan one container root for skills/rules/agents/commands/hooks.
pub fn scan_container(container: &Path, tool: &str, scope: &str) -> Vec<DiscoveredItemDto> {
    let mut out = Vec::new();
    if !container.is_dir() {
        return out;
    }
    for (folder, kind) in [
        ("skills", "skill"),
        ("rules", "rule"),
        ("agents", "agent"),
        ("commands", "command"),
        ("hooks", "hook"),
    ] {
        let dir = container.join(folder);
        if kind == "skill" {
            out.extend(scan_skill_dirs(&dir, tool, scope));
            continue;
        }
        if kind == "rule" {
            out.extend(scan_rule_files(&dir, tool, scope));
            continue;
        }
        if !dir.is_dir() {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for ent in rd.flatten() {
            let path = ent.path();
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let is_folder = path.is_dir();
            if is_folder {
                continue;
            }
            let id = Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(name.clone());
            let Ok((hash, _)) = hash_path_auto(&path) else {
                continue;
            };
            let source_s = strip_win_extended_prefix(&path.to_string_lossy()).to_string();
            out.push(DiscoveredItemDto {
                key: norm_key(&source_s),
                kind: kind.into(),
                suggested_id: sanitize_id(&id),
                source_path: source_s,
                tool: tool.into(),
                scope: scope.into(),
                is_folder: false,
                content_hash: hash,
                remark_zh: format!("容器发现 · {folder}"),
                content_changed: false,
                needs_attention: false,
                is_selected: true,
                existing_entry_id: None,
            });
        }
    }
    out
}

/// Recursively find `.mdc` under rules/ (flat or nested shells).
fn scan_rule_files(dir: &Path, tool: &str, scope: &str) -> Vec<DiscoveredItemDto> {
    let mut out = Vec::new();
    if !dir.is_dir() {
        return out;
    }
    fn walk(dir: &Path, tool: &str, scope: &str, out: &mut Vec<DiscoveredItemDto>) {
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        for ent in rd.flatten() {
            let path = ent.path();
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            if path.is_dir() {
                walk(&path, tool, scope, out);
                continue;
            }
            let lower = name.to_lowercase();
            if !lower.ends_with(".mdc") {
                continue;
            }
            let id = Path::new(&name)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(name.clone());
            let Ok((hash, _)) = hash_path_auto(&path) else {
                continue;
            };
            let source_s = strip_win_extended_prefix(&path.to_string_lossy()).to_string();
            out.push(DiscoveredItemDto {
                key: norm_key(&source_s),
                kind: "rule".into(),
                suggested_id: sanitize_id(&id),
                source_path: source_s,
                tool: tool.into(),
                scope: scope.into(),
                is_folder: false,
                content_hash: hash,
                remark_zh: "容器发现 · rules".into(),
                content_changed: false,
                needs_attention: false,
                is_selected: true,
                existing_entry_id: None,
            });
        }
    }
    walk(dir, tool, scope, &mut out);
    out
}

/// Scan a `skills/` directory (Electron `scanSkillDirs`; also used for backup / .claude / .agents).
pub fn scan_skill_dirs(skills_dir: &Path, tool: &str, scope: &str) -> Vec<DiscoveredItemDto> {
    let mut out = Vec::new();
    if !skills_dir.is_dir() {
        return out;
    }
    let Ok(rd) = fs::read_dir(skills_dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let path = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_folder = path.is_dir();
        let (source, is_folder, suggested) = if is_folder {
            let skill_md = path.join("SKILL.md");
            if skill_md.is_file() {
                (skill_md, false, name.clone())
            } else {
                (path.clone(), true, name.clone())
            }
        } else {
            continue;
        };
        let Ok((hash, _)) = hash_path_auto(&source) else {
            continue;
        };
        let source_s = strip_win_extended_prefix(&source.to_string_lossy()).to_string();
        out.push(DiscoveredItemDto {
            key: norm_key(&source_s),
            kind: "skill".into(),
            suggested_id: sanitize_id(&suggested),
            source_path: source_s,
            tool: tool.into(),
            scope: scope.into(),
            is_folder,
            content_hash: hash,
            remark_zh: "容器发现 · skills".into(),
            content_changed: false,
            needs_attention: false,
            is_selected: true,
            existing_entry_id: None,
        });
    }
    out
}

/// Electron `NESTED_SCAN_SKIP_DIRS` for nested `.cursor` walk under a project root.
const NESTED_SCAN_SKIP_DIRS: &[&str] = &[
    "node_modules",
    ".git",
    "bin",
    "obj",
    ".vs",
    "skills-library",
    "dist",
    "dist-electron",
    "out",
    "build",
    "coverage",
    "$recycle.bin",
    "system volume information",
    "recovery",
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
];

/// Find nested `.cursor` dirs under `project_root` (excluding `{root}/.cursor` itself).
/// Depth semantics align Electron `findNestedCursorDirs`: walk starts at depth 0; stop when
/// `depth > max_depth`.
pub fn find_nested_cursor_dirs(project_root: &Path, max_depth: i32) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if !project_root.is_dir() {
        return results;
    }
    let direct_cursor = normalize_path(&project_root.join(".cursor").to_string_lossy());
    let depth_limit = if max_depth < 0 { 5 } else { max_depth };

    fn walk(
        dir: &Path,
        depth: i32,
        depth_limit: i32,
        direct_cursor: &str,
        results: &mut Vec<PathBuf>,
    ) {
        if depth > depth_limit {
            return;
        }
        let Ok(rd) = fs::read_dir(dir) else {
            return;
        };
        for ent in rd.flatten() {
            let Ok(ft) = ent.file_type() else {
                continue;
            };
            if !ft.is_dir() {
                continue;
            }
            let name_lower = ent.file_name().to_string_lossy().to_lowercase();
            if NESTED_SCAN_SKIP_DIRS.iter().any(|s| *s == name_lower) {
                continue;
            }
            let full = ent.path();
            let full_s = full.to_string_lossy().to_string();
            if should_skip_path(&full_s) {
                continue;
            }
            if name_lower == ".cursor" {
                let norm = normalize_path(&full_s);
                if norm != direct_cursor {
                    results.push(full);
                }
                continue;
            }
            walk(&full, depth + 1, depth_limit, direct_cursor, results);
        }
    }

    walk(project_root, 0, depth_limit, &direct_cursor, &mut results);
    results
}

/// Electron `enumerateProjectContainerItems` for one registered/pending project.
fn enumerate_project_container_items(
    root_path: &str,
    project_id: &str,
    max_depth: i32,
) -> Vec<DiscoveredItemDto> {
    let mut items = Vec::new();
    let root = Path::new(root_path);
    if root_path.trim().is_empty() || !root.is_dir() {
        return items;
    }
    if normalize_path(root_path) == normalize_path(&user_cursor_root()) {
        return items;
    }
    let scope = format!("project:{project_id}");
    items.extend(scan_container(&root.join(".cursor"), "cursor", &scope));
    items.extend(scan_skill_dirs(
        &root.join(".claude").join("skills"),
        "claude",
        &scope,
    ));
    items.extend(scan_skill_dirs(
        &root.join(".agents").join("skills"),
        "codex",
        &scope,
    ));
    for nested in find_nested_cursor_dirs(root, max_depth) {
        items.extend(scan_container(&nested, "cursor", &scope));
    }
    items
}

fn discover_library_disk_adds(settings: &AppSettings) -> Vec<DiscoveredItemDto> {
    let mut out = Vec::new();
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() || !settings.library_root_configured {
        return out;
    }
    let load = load_catalog(lib);
    let known: std::collections::HashSet<String> = load
        .catalog
        .entries
        .iter()
        .filter(|e| e.is_in_library && !e.library_path.trim().is_empty())
        .map(|e| norm_key(&format!("{lib}/{}", e.library_path.replace('\\', "/"))))
        .collect();
    let known_ids: std::collections::HashSet<String> =
        load.catalog.entries.iter().map(|e| e.id.clone()).collect();

    for (folder, kind) in [
        ("skills", "skill"),
        ("rules", "rule"),
        ("agents", "agent"),
        ("commands", "command"),
        ("hooks", "hook"),
    ] {
        let dir = Path::new(lib).join(folder);
        if !dir.is_dir() {
            continue;
        }
        if kind == "rule" {
            // Recurse so nested rules/{id}/{id}.mdc still surfaces for repath/register.
            for item in scan_rule_files(&dir, "library", "library-disk") {
                if known_ids.contains(&item.suggested_id) {
                    continue;
                }
                if known.contains(&item.key) {
                    continue;
                }
                out.push(item);
            }
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        for ent in rd.flatten() {
            let path = ent.path();
            let name = ent.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == "catalog.json" {
                continue;
            }
            let id = sanitize_id(
                Path::new(&name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(name.clone())
                    .as_str(),
            );
            if known_ids.contains(&id) {
                continue;
            }
            let (source, is_folder) = if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.is_file() {
                    (skill_md, false)
                } else {
                    (path.clone(), true)
                }
            } else {
                (path.clone(), false)
            };
            let source_s = strip_win_extended_prefix(&source.to_string_lossy()).to_string();
            if known.contains(&norm_key(&source_s)) {
                continue;
            }
            let Ok((hash, _)) = hash_path_auto(&source) else {
                continue;
            };
            out.push(DiscoveredItemDto {
                key: norm_key(&source_s),
                kind: kind.into(),
                suggested_id: id,
                source_path: source_s,
                tool: "library".into(),
                scope: "library-disk".into(),
                is_folder,
                content_hash: hash,
                remark_zh: "永久库磁盘有、台账无".into(),
                content_changed: false,
                needs_attention: true,
                is_selected: true,
                existing_entry_id: None,
            });
        }
    }
    out
}

fn attach_existing_and_conflicts(
    settings: &AppSettings,
    items: &mut [DiscoveredItemDto],
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

    let mut conflicts = Vec::new();
    let mut conflict_ids = std::collections::HashSet::new();
    for item in items.iter_mut() {
        if let Some(existing) = by_id.get(&item.suggested_id) {
            item.existing_entry_id = Some(existing.id.clone());
            if existing.is_in_library && !existing.library_path.trim().is_empty() {
                if let Ok(lib_full) =
                    resolve_library_safe_path(lib, &existing.library_path)
                {
                    if lib_full.exists() {
                        let lib_cmp = resolve_comparable_content_path(
                            &lib_full.to_string_lossy(),
                            &existing.kind,
                        );
                        let src_cmp = resolve_comparable_content_path(
                            &item.source_path,
                            &item.kind,
                        );
                        let lib_hash = if lib_cmp.is_file() {
                            hash_path_auto(&lib_cmp).map(|(h, _)| h).unwrap_or_default()
                        } else {
                            hash_path_auto(&lib_full)
                                .map(|(h, _)| h)
                                .unwrap_or_default()
                        };
                        let src_hash = if src_cmp.is_file() {
                            hash_path_auto(&src_cmp).map(|(h, _)| h).unwrap_or_default()
                        } else if !item.content_hash.is_empty() {
                            item.content_hash.clone()
                        } else {
                            String::new()
                        };
                        if !lib_hash.is_empty()
                            && !src_hash.is_empty()
                            && !lib_hash.eq_ignore_ascii_case(&src_hash)
                        {
                            item.content_changed = true;
                            item.needs_attention = true;
                            // 同一 suggested_id 只出一条冲突（避免 C:\ 与 \\?\C:\ 双窗）
                            if !conflict_ids.insert(item.suggested_id.to_lowercase()) {
                                continue;
                            }
                            let source_path =
                                strip_win_extended_prefix(&item.source_path).to_string();
                            let target_path = strip_win_extended_prefix(
                                &lib_full.to_string_lossy(),
                            )
                            .to_string();
                            let mut dto = crate::withdraw::path_conflict_dto(
                                norm_key(&source_path),
                                "scanBuild",
                                item.suggested_id.clone(),
                                item.kind.clone(),
                                source_path,
                                target_path,
                                existing.id.clone(),
                                src_hash,
                                lib_hash,
                            );
                            if src_cmp.is_file() {
                                dto.source_compare_path =
                                    Some(src_cmp.to_string_lossy().to_string());
                            }
                            if lib_cmp.is_file() {
                                dto.target_compare_path =
                                    Some(lib_cmp.to_string_lossy().to_string());
                            }
                            conflicts.push(dto);
                        }
                    }
                }
            }
        }
    }
    conflicts
}

pub fn scan_and_ingest_preview(settings: &AppSettings) -> Result<ScanPreviewResult, String> {
    let settings = settings.clone();
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }

    let registered = registered_projects_from_settings(&settings);
    let (roots, discovered) = discover_projects_merged(&settings, &registered);
    let (merged, pending_new) = merge_projects_for_container_scan(&registered, &discovered);

    let mut container_items = Vec::new();
    // User-global ~/.cursor (Electron scanUserCursorOnly subset)
    let user_cursor = user_cursor_root();
    if !user_cursor.is_empty() {
        container_items.extend(scan_container(
            Path::new(&user_cursor),
            "cursor",
            "user-global",
        ));
    }
    // BackupRoot/skills (Electron getBackupRoot → default E:\cursorBf)
    let backup = resolve_backup_root(&settings);
    container_items.extend(scan_skill_dirs(
        &backup.join("skills"),
        "cursor",
        "backup",
    ));
    // Registered + pending projects (nested .cursor / .claude / .agents)
    let max_depth = settings.project_scan_max_depth;
    for p in &merged {
        container_items.extend(enumerate_project_container_items(
            &p.root_path,
            &p.id,
            max_depth,
        ));
    }

    let library_adds = discover_library_disk_adds(&settings);
    let library_disk_keys: Vec<String> = library_adds.iter().map(|i| i.key.clone()).collect();

    let mut seen = std::collections::HashSet::new();
    let mut items = Vec::new();
    for i in library_adds {
        if seen.insert(i.key.clone()) {
            items.push(i);
        }
    }
    for i in container_items.drain(..) {
        if seen.insert(i.key.clone()) {
            items.push(i);
        }
    }

    let conflicts = attach_existing_and_conflicts(&settings, &mut items);

    *pending_store().lock().unwrap_or_else(|e| e.into_inner()) = Some(PendingPreview {
        items: items.clone(),
        library_disk_keys: library_disk_keys.clone(),
        pending_projects: pending_new.clone(),
    });

    let mut notes = Vec::new();
    if roots.is_empty() {
        notes.push("未配置扫描根且无可用盘符".into());
    } else if roots.len() <= 4 {
        notes.push(format!("扫描根：{}", roots.join("、")));
    } else {
        notes.push(format!(
            "扫描根：{} 等 {} 个",
            roots[..4].join("、"),
            roots.len()
        ));
    }
    if !pending_new.is_empty() {
        notes.push(format!("未登记项目 {} 个（确认后写入导航）", pending_new.len()));
    }
    if !library_disk_keys.is_empty() {
        notes.push(format!("永久库磁盘待登记 {} 项", library_disk_keys.len()));
    }
    if !conflicts.is_empty() {
        notes.push(format!("同名内容不同 {} 项（需决议）", conflicts.len()));
    }
    if items.is_empty() {
        notes.push("无新发现项".into());
    }

    Ok(ScanPreviewResult {
        ok: true,
        message: notes.join("；"),
        items,
        pending_new_project_count: pending_new.len() as u32,
        scan_roots: roots,
        conflicts,
        snapshot: snap(&settings),
    })
}

pub fn confirm_scan_build(
    settings: &AppSettings,
    selected_keys: &[String],
    resolutions: &[ScanResolution],
) -> Result<ScanConfirmResult, String> {
    let settings = settings.clone();
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() || !settings.library_root_configured {
        return Err("请先配置永久库目录".into());
    }

    let pending = pending_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or_else(|| "无预览缓存，请先执行扫描建库预览".to_string())?;

    let pending_projects = pending.pending_projects.clone();

    let key_set: std::collections::HashSet<String> = selected_keys
        .iter()
        .map(|k| norm_key(k))
        .filter(|k| !k.is_empty())
        .collect();

    let selected: Vec<DiscoveredItemDto> = pending
        .items
        .into_iter()
        .filter(|i| {
            if key_set.is_empty() {
                i.is_selected
            } else {
                key_set.contains(&i.key)
            }
        })
        .collect();

    let res_map: HashMap<String, String> = resolutions
        .iter()
        .map(|r| (norm_key(&r.key), r.choice.to_lowercase()))
        .collect();

    // Recompute conflicts for selected
    let mut work = selected.clone();
    let conflicts_all = attach_existing_and_conflicts(&settings, &mut work);
    let unresolved: Vec<_> = conflicts_all
        .into_iter()
        .filter(|c| !res_map.contains_key(&norm_key(&c.key)))
        .collect();
    if !unresolved.is_empty() {
        return Ok(ScanConfirmResult {
            ok: true,
            message: format!("扫描建库：有 {} 项同名内容不同，请先决议", unresolved.len()),
            registered: 0,
            origins_appended: 0,
            skipped: 0,
            failed: 0,
            errors: vec![],
            projects_added: 0,
            conflicts: unresolved,
            open_auto_classify: false,
            copied_into_library: 0,
            snapshot: snap(&settings),
        });
    }

    // Register newly discovered projects first
    let mut projects_added = 0u32;
    {
        let load = load_catalog(lib);
        let mut existing_norm: std::collections::HashSet<String> = list_projects(&load.catalog)
            .iter()
            .map(|p| crate::project_discovery::normalize_path(&p.root_path))
            .filter(|k| !k.is_empty())
            .collect();
        for p in &pending_projects {
            let key = crate::project_discovery::normalize_path(&p.root_path);
            if key.is_empty() || existing_norm.contains(&key) {
                continue;
            }
            let project = CatalogProject {
                id: p.id.clone(),
                name: p.name.clone(),
                root_path: p.root_path.clone(),
                category: p.category.clone(),
                pinned: p.pinned,
            };
            if upsert_project(lib, project).is_ok() {
                existing_norm.insert(key);
                projects_added += 1;
            }
        }
    }

    let mut registered = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    let mut copied = 0u32;
    let mut origins_appended = 0u32;
    let mut errors = Vec::new();

    let library_disk_set: std::collections::HashSet<String> =
        pending.library_disk_keys.into_iter().collect();

    for item in work {
        let choice = res_map
            .get(&item.key)
            .map(|s| s.as_str())
            .unwrap_or("");
        if choice == "skip" {
            skipped += 1;
            continue;
        }

        let source = PathBuf::from(&item.source_path);
        if !source.exists() {
            failed += 1;
            errors.push(format!("{}: source missing", item.suggested_id));
            continue;
        }

        let is_library_disk = library_disk_set.contains(&item.key)
            || item.scope == "library-disk";

        if is_library_disk {
            // Already on disk under library — just register catalog
            let disk_rel = source
                .strip_prefix(lib)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| {
                    library_rel_for(&item.kind, &item.suggested_id, &source, item.is_folder)
                });
            if resolve_library_safe_path(lib, &disk_rel).is_err() {
                failed += 1;
                errors.push(format!("{}: bad library rel", item.suggested_id));
                continue;
            }
            let mut entry = CatalogEntry {
                id: item.suggested_id.clone(),
                kind: item.kind.clone(),
                library_path: disk_rel,
                is_in_library: true,
                deployed_path: String::new(),
                is_missing: false,
                ..Default::default()
            };
            if entry.kind.eq_ignore_ascii_case("rule") {
                let _ = crate::rule_layout::repath_rule_entry_to_flat(lib, &mut entry);
            }
            if upsert_entry(lib, entry).is_ok() {
                registered += 1;
            } else {
                failed += 1;
            }
            continue;
        }

        // Container discovery → register (+ optional sync) into library
        let existing_entry = item
            .existing_entry_id
            .as_ref()
            .and_then(|eid| {
                load_catalog(lib)
                    .catalog
                    .entries
                    .into_iter()
                    .find(|e| e.id == *eid)
            });

        // saveAs: keep original library entry; copy container to a new id
        if choice == "saveas" {
            let mut new_id = format!("{}-scan", item.suggested_id);
            let known: std::collections::HashSet<String> = load_catalog(lib)
                .catalog
                .entries
                .iter()
                .map(|e| e.id.clone())
                .collect();
            let mut n = 2u32;
            while known.contains(&new_id) {
                new_id = format!("{}-scan{n}", item.suggested_id);
                n += 1;
            }
            let rel = library_rel_for(&item.kind, &new_id, &source, item.is_folder);
            let dest = match resolve_library_safe_path(lib, &rel) {
                Ok(p) => p,
                Err(e) => {
                    failed += 1;
                    errors.push(format!("{}: {e}", item.suggested_id));
                    continue;
                }
            };
            if let Err(e) = copy_path(&source, &dest) {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
            copied += 1;
            let mut entry = CatalogEntry {
                id: new_id,
                kind: item.kind.clone(),
                library_path: rel,
                is_in_library: true,
                deployed_path: item.source_path.clone(),
                is_missing: false,
                ..Default::default()
            };
            entry.origins.push(CatalogOrigin {
                original_path: item.source_path.clone(),
                tool: item.tool.clone(),
                scope: item.scope.clone(),
            });
            if entry.kind.eq_ignore_ascii_case("rule") {
                let _ = crate::rule_layout::repath_rule_entry_to_flat(lib, &mut entry);
            }
            match upsert_entry(lib, entry) {
                Ok(_) => registered += 1,
                Err(e) => {
                    failed += 1;
                    errors.push(e);
                }
            }
            continue;
        }

        // Prefer existing library path when re-registering over a known entry
        let rel = if let Some(ref e) = existing_entry {
            if !e.library_path.trim().is_empty() {
                e.library_path.clone()
            } else {
                library_rel_for(&item.kind, &item.suggested_id, &source, item.is_folder)
            }
        } else {
            library_rel_for(&item.kind, &item.suggested_id, &source, item.is_folder)
        };
        let dest = match resolve_library_safe_path(lib, &rel) {
            Ok(p) => p,
            Err(e) => {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
        };

        if choice == "merge" {
            // Keep library; sync library main file → container so both align to library
            if !dest.exists() {
                failed += 1;
                errors.push(format!("{}: merge 需要库文件存在", item.suggested_id));
                continue;
            }
            let lib_cmp = resolve_comparable_content_path(&dest.to_string_lossy(), &item.kind);
            let src_cmp = resolve_comparable_content_path(&item.source_path, &item.kind);
            if let Err(e) = sync_main_file(&lib_cmp, &src_cmp) {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
            if let Err(e) = verify_content_hash_match(&lib_cmp, &src_cmp) {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
        } else if choice == "overwrite" {
            // Container main file → library
            let src_cmp = resolve_comparable_content_path(&item.source_path, &item.kind);
            let lib_cmp = resolve_comparable_content_path(&dest.to_string_lossy(), &item.kind);
            let lib_dest = match resolve_library_main_dest(&dest, lib_cmp, &item.kind) {
                Ok(p) => p,
                Err(e) => {
                    failed += 1;
                    errors.push(format!("{}: {e}", item.suggested_id));
                    continue;
                }
            };
            if let Err(e) = sync_main_file(&src_cmp, &lib_dest) {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
            if let Err(e) = verify_content_hash_match(&src_cmp, &lib_dest) {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
            copied += 1;
        } else {
            // No conflict resolution needed — copy if missing / same content already ok
            if dest.exists() && choice.is_empty() {
                if let Ok((h, _)) = hash_path_auto(&dest) {
                    let src_cmp =
                        resolve_comparable_content_path(&item.source_path, &item.kind);
                    let src_h = if src_cmp.is_file() {
                        hash_path_auto(&src_cmp).map(|(x, _)| x).unwrap_or_default()
                    } else {
                        item.content_hash.clone()
                    };
                    if !h.is_empty()
                        && !src_h.is_empty()
                        && !h.eq_ignore_ascii_case(&src_h)
                    {
                        // Comparable content may still differ if whole-path hash differed
                        let lib_cmp =
                            resolve_comparable_content_path(&dest.to_string_lossy(), &item.kind);
                        if lib_cmp.is_file() && src_cmp.is_file() {
                            let lh = hash_path_auto(&lib_cmp).map(|(x, _)| x).unwrap_or_default();
                            if !lh.is_empty()
                                && !src_h.is_empty()
                                && !lh.eq_ignore_ascii_case(&src_h)
                            {
                                failed += 1;
                                errors.push(format!(
                                    "{}: dest exists without resolution",
                                    item.suggested_id
                                ));
                                continue;
                            }
                        }
                    }
                }
            } else if !dest.exists() {
                if let Err(e) = copy_path(&source, &dest) {
                    if !dest.exists() {
                        failed += 1;
                        errors.push(format!("{}: {e}", item.suggested_id));
                        continue;
                    }
                } else {
                    copied += 1;
                }
            }
        }

        let mut entry = CatalogEntry {
            id: item.suggested_id.clone(),
            kind: item.kind.clone(),
            library_path: rel,
            is_in_library: true,
            deployed_path: item.source_path.clone(),
            is_missing: false,
            ..Default::default()
        };
        // If registering over existing, keep id
        if let Some(eid) = &item.existing_entry_id {
            entry.id = eid.clone();
            if choice == "overwrite" || choice == "merge" || choice.is_empty() {
                origins_appended += 1;
            }
            if let Some(ref e) = existing_entry {
                if !e.library_path.trim().is_empty() {
                    entry.library_path = e.library_path.clone();
                }
            }
        }
        entry.origins.push(CatalogOrigin {
            original_path: item.source_path.clone(),
            tool: item.tool.clone(),
            scope: item.scope.clone(),
        });
        if entry.kind.eq_ignore_ascii_case("rule") {
            let _ = crate::rule_layout::repath_rule_entry_to_flat(lib, &mut entry);
        }
        match upsert_entry(lib, entry) {
            Ok(_) => registered += 1,
            Err(e) => {
                failed += 1;
                errors.push(e);
            }
        }
    }

    let snapshot = snap(&settings);
    let msg = format!(
        "扫描建库：新项目 {projects_added}，登记资产 {registered}，复制入库 {copied}，跳过 {skipped}，失败 {failed}"
    );
    Ok(ScanConfirmResult {
        ok: failed == 0,
        message: msg,
        registered,
        origins_appended,
        skipped,
        failed,
        errors,
        projects_added,
        conflicts: vec![],
        open_auto_classify: registered > 0 || copied > 0 || projects_added > 0,
        copied_into_library: copied,
        snapshot,
    })
}

fn last_discovered_store() -> &'static Mutex<Vec<crate::project_discovery::DiscoveredProject>> {
    static STORE: OnceLock<Mutex<Vec<crate::project_discovery::DiscoveredProject>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(Vec::new()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProjectsPreviewResult {
    pub ok: bool,
    pub message: String,
    pub projects: Vec<crate::project_discovery::DiscoveredProject>,
    pub snapshot: AppSnapshotSubset,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProjectsConfirmResult {
    pub ok: bool,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
}

pub fn scan_projects_preview(settings: &AppSettings) -> Result<ScanProjectsPreviewResult, String> {
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let registered = registered_projects_from_settings(settings);
    let (roots, discovered) = discover_projects_merged(settings, &registered);
    *last_discovered_store().lock().unwrap_or_else(|e| e.into_inner()) = discovered.clone();

    let root_note = if roots.is_empty() {
        "未配置扫描根且无可用盘符".to_string()
    } else if roots.len() <= 4 {
        format!("扫描根：{}", roots.join("、"))
    } else {
        format!("扫描根：{} 等 {} 个", roots[..4].join("、"), roots.len())
    };
    let msg = format!("{root_note} · 发现 {} 个", discovered.len());
    Ok(ScanProjectsPreviewResult {
        ok: true,
        message: msg,
        projects: discovered,
        snapshot: snap(settings),
    })
}

pub fn confirm_scan_projects(
    settings: &AppSettings,
    selected_root_paths: &[String],
) -> Result<ScanProjectsConfirmResult, String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() || !settings.library_root_configured {
        return Err("请先配置永久库目录".into());
    }
    let selected: std::collections::HashSet<String> = selected_root_paths
        .iter()
        .map(|p| crate::project_discovery::normalize_path(p))
        .filter(|p| !p.is_empty())
        .collect();
    let discovered = last_discovered_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let load = load_catalog(lib);
    let mut existing_norm: std::collections::HashSet<String> = list_projects(&load.catalog)
        .iter()
        .map(|p| crate::project_discovery::normalize_path(&p.root_path))
        .collect();
    let mut added = 0u32;
    for d in &discovered {
        let key = crate::project_discovery::normalize_path(&d.root_path);
        if !selected.contains(&key) || d.already_registered || existing_norm.contains(&key) {
            continue;
        }
        let project = CatalogProject {
            id: crate::project_discovery::stable_project_id_for_root(&d.root_path),
            name: d.suggested_name.clone(),
            root_path: d.root_path.clone(),
            category: d.suggested_category.clone(),
            pinned: true,
        };
        if upsert_project(lib, project).is_ok() {
            existing_norm.insert(key);
            added += 1;
        }
    }
    Ok(ScanProjectsConfirmResult {
        ok: true,
        message: format!("已添加 {added} 个项目"),
        snapshot: snap(settings),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, upsert_entry, CatalogEntry};

    #[test]
    fn preview_then_confirm_registers_container_skill() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("HelloProj");
        fs::create_dir_all(proj.join(".cursor/skills/hello")).unwrap();
        fs::write(
            proj.join(".cursor/skills/hello/SKILL.md"),
            b"# hello\nfrom container\n",
        )
        .unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "hp".into(),
                name: "HelloProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();

        let empty_scan = dir.path().join("empty-scan");
        fs::create_dir_all(&empty_scan).unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            project_scan_roots: vec![empty_scan.to_string_lossy().to_string()],
            project_scan_max_depth: 2,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };

        let preview = scan_and_ingest_preview(&settings).unwrap();
        assert!(!preview.items.is_empty(), "{}", preview.message);
        let key = preview
            .items
            .iter()
            .find(|i| i.source_path.to_lowercase().contains("hello"))
            .map(|i| i.key.clone())
            .unwrap_or_else(|| preview.items[0].key.clone());

        let confirm = confirm_scan_build(&settings, &[key], &[]).unwrap();
        assert!(confirm.ok, "{}", confirm.message);
        assert!(confirm.registered >= 1);

        let load = load_catalog(&lib_root);
        assert!(load.catalog.entries.iter().any(|e| e.id.contains("hello")));
    }

    #[test]
    fn preview_discovers_and_confirm_adds_project() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        let scan_root = dir.path().join("scan");
        let proj = scan_root.join("ExtProj");
        ensure_library_layout(&lib_root).unwrap();
        fs::create_dir_all(proj.join(".cursor/skills/ext")).unwrap();
        fs::write(proj.join(".cursor/skills/ext/SKILL.md"), b"# ext\n").unwrap();

        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            project_scan_roots: vec![scan_root.to_string_lossy().to_string()],
            project_scan_max_depth: 4,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };

        let preview = scan_and_ingest_preview(&settings).unwrap();
        assert!(
            preview.pending_new_project_count >= 1,
            "{}",
            preview.message
        );
        let keys: Vec<_> = preview.items.iter().map(|i| i.key.clone()).collect();
        let confirm = confirm_scan_build(&settings, &keys, &[]).unwrap();
        assert!(confirm.projects_added >= 1, "{}", confirm.message);
        let load = load_catalog(&lib_root);
        assert!(
            list_projects(&load.catalog)
                .iter()
                .any(|p| p.name.contains("ExtProj") || p.root_path.contains("ExtProj")),
            "{:?}",
            load.catalog.projects
        );
    }

    #[test]
    fn conflict_requires_resolution() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let proj = dir.path().join("CProj");
        let container = proj.join(".cursor");
        fs::create_dir_all(dir.path().join("skills/hello")).unwrap();
        fs::write(dir.path().join("skills/hello/SKILL.md"), b"# lib\n").unwrap();
        upsert_entry(
            &lib_root,
            CatalogEntry {
                id: "hello".into(),
                kind: "skill".into(),
                library_path: "skills/hello/SKILL.md".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "cp".into(),
                name: "CProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();

        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# container DIFFERENT\n",
        )
        .unwrap();

        let empty_scan = dir.path().join("empty-scan");
        fs::create_dir_all(&empty_scan).unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            project_scan_roots: vec![empty_scan.to_string_lossy().to_string()],
            project_scan_max_depth: 1,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        let preview = scan_and_ingest_preview(&settings).unwrap();
        assert!(!preview.conflicts.is_empty());
        let key = preview.conflicts[0].key.clone();
        let confirm = confirm_scan_build(&settings, &[key.clone()], &[]).unwrap();
        assert!(!confirm.conflicts.is_empty());
        let confirm2 = confirm_scan_build(
            &settings,
            &[key.clone()],
            &[ScanResolution {
                key,
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(confirm2.conflicts.is_empty());
        assert!(confirm2.registered >= 1 || confirm2.copied_into_library >= 1 || confirm2.ok);
    }

    #[test]
    fn preview_finds_nested_cursor_when_depth_allows() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        let proj = dir.path().join("NestProj");
        ensure_library_layout(&lib_root).unwrap();
        fs::create_dir_all(proj.join(".cursor/skills/top")).unwrap();
        fs::write(proj.join(".cursor/skills/top/SKILL.md"), b"# top\n").unwrap();
        fs::create_dir_all(proj.join("sub/.cursor/skills/nested")).unwrap();
        fs::write(
            proj.join("sub/.cursor/skills/nested/SKILL.md"),
            b"# nested\n",
        )
        .unwrap();
        // Pre-register so ProjectScanMaxDepth only gates nested container walk, not discovery.
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "nestproj".into(),
                name: "NestProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();
        let empty_scan = dir.path().join("empty-scan");
        fs::create_dir_all(&empty_scan).unwrap();
        let backup_root = dir.path().join("nobackup").to_string_lossy().to_string();

        let deep = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            project_scan_roots: vec![empty_scan.to_string_lossy().to_string()],
            project_scan_max_depth: 4,
            backup_root: backup_root.clone(),
            ..Default::default()
        };
        let preview_deep = scan_and_ingest_preview(&deep).unwrap();
        assert!(
            preview_deep
                .items
                .iter()
                .any(|i| i.source_path.to_lowercase().contains("nested")),
            "depth=4 should find nested: {:?}",
            preview_deep
                .items
                .iter()
                .map(|i| &i.source_path)
                .collect::<Vec<_>>()
        );

        let shallow = AppSettings {
            project_scan_max_depth: 0,
            ..deep
        };
        let preview_shallow = scan_and_ingest_preview(&shallow).unwrap();
        assert!(
            !preview_shallow
                .items
                .iter()
                .any(|i| i.source_path.to_lowercase().contains("nested")),
            "depth=0 must not find nested"
        );
        assert!(
            preview_shallow
                .items
                .iter()
                .any(|i| i.source_path.to_lowercase().contains("top")),
            "top-level .cursor still scanned"
        );
    }

    #[test]
    fn preview_includes_backup_skills() {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let backup = dir.path().join("backup");
        fs::create_dir_all(backup.join("skills/frombf")).unwrap();
        fs::write(
            backup.join("skills/frombf/SKILL.md"),
            b"# from backup\n",
        )
        .unwrap();
        let empty_scan = dir.path().join("empty-scan");
        fs::create_dir_all(&empty_scan).unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            project_scan_roots: vec![empty_scan.to_string_lossy().to_string()],
            project_scan_max_depth: 1,
            backup_root: backup.to_string_lossy().to_string(),
            ..Default::default()
        };
        let preview = scan_and_ingest_preview(&settings).unwrap();
        assert!(
            preview.items.iter().any(|i| i.scope == "backup"
                && i.source_path.to_lowercase().contains("frombf")),
            "{:?}",
            preview
                .items
                .iter()
                .map(|i| (&i.scope, &i.source_path))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn scan_container_finds_nested_rules() {
        let dir = tempfile::tempdir().unwrap();
        let cursor = dir.path().join(".cursor");
        let nested = cursor.join("rules/L0-02-terminology/L0-02-terminology.mdc");
        fs::create_dir_all(nested.parent().unwrap()).unwrap();
        fs::write(&nested, b"# L0-02\n").unwrap();
        fs::write(cursor.join("rules/flat-rule.mdc"), b"# flat\n").unwrap();
        let items = scan_container(&cursor, "cursor", "project:p1");
        assert!(
            items.iter().any(|i| i.suggested_id == "L0-02-terminology"),
            "{:?}",
            items.iter().map(|i| &i.suggested_id).collect::<Vec<_>>()
        );
        assert!(items.iter().any(|i| i.suggested_id == "flat-rule"));
        let rel = library_rel_for(
            "rule",
            "L0-02-terminology",
            Path::new("L0-02-terminology.mdc"),
            false,
        );
        assert_eq!(rel, "rules/L0-02-terminology.mdc");
    }

    fn setup_scan_conflict() -> (tempfile::TempDir, AppSettings, PathBuf, PathBuf, String) {
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let lib_skill = dir.path().join("skills/hello/SKILL.md");
        fs::create_dir_all(lib_skill.parent().unwrap()).unwrap();
        fs::write(&lib_skill, b"# hello\nfrom library\n").unwrap();
        upsert_entry(
            &lib_root,
            CatalogEntry {
                id: "hello".into(),
                kind: "skill".into(),
                library_path: "skills/hello/SKILL.md".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();

        let proj = dir.path().join("HelloProj");
        let ctr_skill = proj.join(".cursor/skills/hello/SKILL.md");
        fs::create_dir_all(ctr_skill.parent().unwrap()).unwrap();
        fs::write(&ctr_skill, b"# hello\nfrom container\n").unwrap();
        use crate::catalog::{upsert_project, CatalogProject};
        upsert_project(
            &lib_root,
            CatalogProject {
                id: "hp".into(),
                name: "HelloProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
            },
        )
        .unwrap();

        let empty_scan = dir.path().join("empty-scan");
        fs::create_dir_all(&empty_scan).unwrap();
        let settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            project_scan_roots: vec![empty_scan.to_string_lossy().to_string()],
            project_scan_max_depth: 2,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        let preview = scan_and_ingest_preview(&settings).unwrap();
        assert!(
            !preview.conflicts.is_empty(),
            "expected conflict: {}",
            preview.message
        );
        let conflict_key = preview.conflicts[0].key.clone();
        (dir, settings, lib_skill, ctr_skill, conflict_key)
    }

    #[test]
    fn scan_merge_keeps_library_syncs_container() {
        let (_dir, settings, lib_skill, ctr_skill, conflict_key) = setup_scan_conflict();
        let item_key = {
            let preview = scan_and_ingest_preview(&settings).unwrap();
            preview
                .items
                .iter()
                .find(|i| i.suggested_id == "hello")
                .map(|i| i.key.clone())
                .unwrap()
        };
        let r = confirm_scan_build(
            &settings,
            &[item_key],
            &[ScanResolution {
                key: conflict_key,
                choice: "merge".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{} {:?}", r.message, r.errors);
        let lib_body = fs::read_to_string(&lib_skill).unwrap();
        let ctr_body = fs::read_to_string(&ctr_skill).unwrap();
        assert!(lib_body.contains("from library"));
        assert!(ctr_body.contains("from library"));
        assert!(!ctr_body.contains("from container"));
    }

    #[test]
    fn scan_overwrite_writes_container_into_library() {
        let (_dir, settings, lib_skill, ctr_skill, conflict_key) = setup_scan_conflict();
        let item_key = {
            let preview = scan_and_ingest_preview(&settings).unwrap();
            preview
                .items
                .iter()
                .find(|i| i.suggested_id == "hello")
                .map(|i| i.key.clone())
                .unwrap()
        };
        let r = confirm_scan_build(
            &settings,
            &[item_key],
            &[ScanResolution {
                key: conflict_key,
                choice: "overwrite".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{} {:?}", r.message, r.errors);
        let lib_body = fs::read_to_string(&lib_skill).unwrap();
        let ctr_body = fs::read_to_string(&ctr_skill).unwrap();
        assert!(lib_body.contains("from container"));
        assert!(ctr_body.contains("from container"));
    }

    #[test]
    fn scan_saveas_creates_new_entry() {
        let (_dir, settings, lib_skill, _ctr, conflict_key) = setup_scan_conflict();
        let item_key = {
            let preview = scan_and_ingest_preview(&settings).unwrap();
            preview
                .items
                .iter()
                .find(|i| i.suggested_id == "hello")
                .map(|i| i.key.clone())
                .unwrap()
        };
        let r = confirm_scan_build(
            &settings,
            &[item_key],
            &[ScanResolution {
                key: conflict_key,
                choice: "saveas".into(),
            }],
        )
        .unwrap();
        assert!(r.ok, "{} {:?}", r.message, r.errors);
        let lib_body = fs::read_to_string(&lib_skill).unwrap();
        assert!(lib_body.contains("from library"));
        let load = load_catalog(&settings.skills_library_root);
        assert!(
            load.catalog.entries.iter().any(|e| e.id == "hello-scan"),
            "{:?}",
            load.catalog.entries.iter().map(|e| &e.id).collect::<Vec<_>>()
        );
        assert!(load.catalog.entries.iter().any(|e| e.id == "hello"));
    }
}
