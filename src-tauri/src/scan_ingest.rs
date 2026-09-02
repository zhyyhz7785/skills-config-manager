//! Scan + ingest: full project discovery + container/library-disk assets (M4 parity).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::catalog::{
    list_projects, load_catalog, save_catalog, upsert_entry_in, upsert_project_in,
    validate_entry_paths, CatalogEntry, CatalogOrigin, CatalogProject,
};
use crate::content_sync::resolve_comparable_content_path;
use crate::hash::{content_equivalent, hash_path_auto};
use crate::path_guard::resolve_library_safe_path;
use crate::project_discovery::{
    discover_projects_merged, merge_projects_for_container_scan, normalize_path,
    registered_projects_from_settings, should_skip_path, user_cursor_root, PendingProjectItem,
};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset};
use crate::withdraw::PathConflictDto;
use crate::workspace::{list_all_workspace_scan_roots, promote_workspaces_after_scan};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRootInput {
    pub path: String,
    pub tool: String,
}

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
    /// 仅增量（未登记 / 库磁盘待登记）；已登记无变化不在此列
    pub items: Vec<DiscoveredItemDto>,
    pub pending_new_project_count: u32,
    pub scan_roots: Vec<String>,
    pub conflicts: Vec<PathConflictDto>,
    pub unchanged_count: u32,
    pub silent_relink_count: u32,
    pub skipped_content_conflict: u32,
    pub delta_count: u32,
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
    /// 同名不同哈希：扫描跳过，留给「刷新」人选（不再弹扫描冲突窗）
    pub skipped_content_conflict: u32,
    /// 同哈希静默回链 deployedPath 条数
    pub relinked: u32,
    pub failed: u32,
    pub errors: Vec<String>,
    pub projects_added: u32,
    /// 恒为空：扫描建库不再返回需决议的冲突（人选仅走刷新）
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
    /// 增量项（预览展示 + 确认入库）
    items: Vec<DiscoveredItemDto>,
    /// 同哈希需回链；不进预览列表，确认时静默处理
    silent_relinks: Vec<DiscoveredItemDto>,
    skipped_content_conflict: u32,
    library_disk_keys: Vec<String>,
    pending_projects: Vec<PendingProjectItem>,
}

#[derive(Debug, Default)]
struct ScanClassify {
    delta: Vec<DiscoveredItemDto>,
    silent_relinks: Vec<DiscoveredItemDto>,
    unchanged_count: u32,
    skipped_content_conflict: u32,
}

/// 对照台账拆分：增量 / 静默回链 / 无变化 / 异哈希（留给刷新）
fn classify_against_catalog(
    settings: &AppSettings,
    items: Vec<DiscoveredItemDto>,
    library_disk_keys: &std::collections::HashSet<String>,
) -> ScanClassify {
    let lib = settings.skills_library_root.trim();
    let load = load_catalog(lib);
    let by_id: HashMap<String, CatalogEntry> = load
        .catalog
        .entries
        .iter()
        .cloned()
        .map(|e| (e.id.clone(), e))
        .collect();

    let mut out = ScanClassify::default();
    for item in items {
        if item.content_changed {
            out.skipped_content_conflict += 1;
            continue;
        }
        let is_library_disk =
            library_disk_keys.contains(&item.key) || item.scope == "library-disk";
        if is_library_disk {
            out.delta.push(item);
            continue;
        }
        let Some(eid) = item.existing_entry_id.as_ref() else {
            out.delta.push(item);
            continue;
        };
        let Some(existing) = by_id.get(eid) else {
            out.delta.push(item);
            continue;
        };
        if !existing.is_in_library || existing.library_path.trim().is_empty() {
            out.delta.push(item);
            continue;
        }
        let Ok(lib_full) = resolve_library_safe_path(lib, &existing.library_path) else {
            out.delta.push(item);
            continue;
        };
        if !lib_full.exists() {
            // 台账有记录但库文件缺失 → 需重新复制入库
            out.delta.push(item);
            continue;
        }
        let lib_cmp =
            resolve_comparable_content_path(&lib_full.to_string_lossy(), &existing.kind);
        let src_cmp = resolve_comparable_content_path(&item.source_path, &item.kind);
        let (lib_hash, lib_path) = if lib_cmp.is_file() {
            (
                hash_path_auto(&lib_cmp)
                    .map(|(h, _)| h)
                    .unwrap_or_default(),
                lib_cmp.clone(),
            )
        } else {
            (
                hash_path_auto(&lib_full)
                    .map(|(h, _)| h)
                    .unwrap_or_default(),
                lib_full.clone(),
            )
        };
        let (src_hash, src_path) = if src_cmp.is_file() {
            (
                hash_path_auto(&src_cmp)
                    .map(|(h, _)| h)
                    .unwrap_or_default(),
                src_cmp.clone(),
            )
        } else if !item.content_hash.is_empty() {
            (item.content_hash.clone(), src_cmp.clone())
        } else {
            (String::new(), src_cmp.clone())
        };
        if !lib_hash.is_empty()
            && !src_hash.is_empty()
            && !content_equivalent(&lib_hash, &src_hash, &lib_path, &src_path)
        {
            out.skipped_content_conflict += 1;
            continue;
        }
        // 同哈希（或无法比哈希时保守视为已登记）
        let dep = existing.deployed_path.trim();
        let src_n = norm_key(&item.source_path);
        let dep_n = if dep.is_empty() {
            String::new()
        } else {
            norm_key(dep)
        };
        if dep_n.is_empty() || dep_n != src_n {
            out.silent_relinks.push(item);
        } else {
            out.unchanged_count += 1;
        }
    }
    out
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

pub(crate) fn sanitize_id(raw: &str) -> String {
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
        // skill = 整目录单元（含 SKILL.md 时仍登记目录，附属文件一并入库）
        let is_folder = path.is_dir();
        let (source, is_folder, suggested) = if is_folder {
            (path.clone(), true, name.clone())
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
            if NESTED_SCAN_SKIP_DIRS.iter().any(|s| *s == name_lower)
                || crate::project_discovery::BUILD_OUTPUT_DIR_NAMES
                    .iter()
                    .any(|s| *s == name_lower)
            {
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
            // skill 目录（含有 SKILL.md）一律按文件夹登记，避免永久库只剩主文件
            let (source, is_folder) = if path.is_dir() {
                (path.clone(), true)
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

fn resolve_scan_root_inputs(
    settings: &AppSettings,
    roots: Option<&[ScanRootInput]>,
) -> Vec<ScanRootInput> {
    match roots {
        Some(list) => list
            .iter()
            .filter_map(|r| {
                let path = r.path.trim();
                let tool = r.tool.trim();
                if path.is_empty() || tool.is_empty() {
                    return None;
                }
                Some(ScanRootInput {
                    path: crate::project_discovery::to_display_path(path),
                    tool: tool.to_string(),
                })
            })
            .collect(),
        None => {
            let skip: std::collections::HashSet<String> = settings
                .scan_skip_workspace_ids
                .iter()
                .map(|s| s.trim().to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .collect();
            let mut out: Vec<ScanRootInput> = list_all_workspace_scan_roots(settings)
                .into_iter()
                .filter(|(tool, _)| !skip.contains(&tool.to_ascii_lowercase()))
                .map(|(tool, path)| ScanRootInput { path, tool })
                .collect();
            let mut seen: std::collections::HashSet<String> = out
                .iter()
                .map(|r| crate::project_discovery::normalize_path(&r.path))
                .collect();
            for extra in &settings.scan_extra_roots {
                let path = extra.path.trim();
                if path.is_empty() {
                    continue;
                }
                let path = crate::project_discovery::to_display_path(path);
                let key = crate::project_discovery::normalize_path(&path);
                if !seen.insert(key) {
                    continue;
                }
                let tool = extra.tool.trim();
                out.push(ScanRootInput {
                    path,
                    tool: if tool.is_empty() {
                        "cursor".into()
                    } else {
                        tool.to_string()
                    },
                });
            }
            out
        }
    }
}

pub fn scan_and_ingest_preview(
    settings: &AppSettings,
    roots: Option<&[ScanRootInput]>,
) -> Result<ScanPreviewResult, String> {
    let settings = settings.clone();
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        return Err("请先配置永久库目录".into());
    }

    let root_inputs = resolve_scan_root_inputs(&settings, roots);
    let mut scanned_roots = Vec::new();
    let mut container_items = Vec::new();
    for r in &root_inputs {
        let p = Path::new(&r.path);
        if !p.is_dir() {
            continue;
        }
        scanned_roots.push(r.path.clone());
        container_items.extend(scan_container(p, &r.tool, "user-global"));
    }

    // 项目容器：按 ProjectScanRoots（空=默认盘符）发现未登记项目，并扫其 .cursor/.claude/.agents
    let project_roots_unconfigured = settings
        .project_scan_roots
        .iter()
        .all(|r| r.trim().is_empty());
    let registered = registered_projects_from_settings(&settings);
    let (_project_scan_roots, discovered) = discover_projects_merged(&settings, &registered);
    let (merged, pending_new) = merge_projects_for_container_scan(&registered, &discovered);
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

    // 标记 content_changed；conflicts 不返回前端（人选仅走刷新）
    let _ = attach_existing_and_conflicts(&settings, &mut items);
    let library_disk_set: std::collections::HashSet<String> =
        library_disk_keys.iter().cloned().collect();
    let classified = classify_against_catalog(&settings, items, &library_disk_set);
    let delta = classified.delta;
    let delta_count = delta.len() as u32;
    let unchanged_count = classified.unchanged_count;
    let silent_relink_count = classified.silent_relinks.len() as u32;
    let skipped_content_conflict = classified.skipped_content_conflict;

    *pending_store().lock().unwrap_or_else(|e| e.into_inner()) = Some(PendingPreview {
        items: delta.clone(),
        silent_relinks: classified.silent_relinks,
        skipped_content_conflict,
        library_disk_keys: library_disk_keys.clone(),
        pending_projects: pending_new.clone(),
    });

    let mut notes = Vec::new();
    if scanned_roots.is_empty() {
        if pending_new.is_empty() && delta_count == 0 && silent_relink_count == 0 {
            notes.push("所选扫描目录均不存在或不可读".into());
        }
    } else if scanned_roots.len() <= 4 {
        notes.push(format!("扫描根：{}", scanned_roots.join("、")));
    } else {
        notes.push(format!(
            "扫描根：{} 等 {} 个",
            scanned_roots[..4].join("、"),
            scanned_roots.len()
        ));
    }
    if !pending_new.is_empty() {
        notes.push(format!(
            "未登记项目 {} 个（确认后写入导航）",
            pending_new.len()
        ));
    }
    if project_roots_unconfigured {
        notes.push(
            "项目扫描根未配置，已按默认盘符发现项目（可能较慢；建议在设置中指定如 E:\\Code）"
                .into(),
        );
    }
    if delta_count > 0 {
        notes.push(format!("待登记变更 {delta_count} 项"));
    }
    if silent_relink_count > 0 {
        notes.push(format!("将静默回链 {silent_relink_count} 项"));
    }
    if unchanged_count > 0 {
        notes.push(format!("已登记无变化 {unchanged_count} 项（不显示）"));
    }
    if skipped_content_conflict > 0 {
        notes.push(format!(
            "同名不同哈希 {skipped_content_conflict} 项请用「刷新」对账"
        ));
    }
    if delta_count == 0 && pending_new.is_empty() {
        notes.clear();
        let mut msg = "无变更".to_string();
        if skipped_content_conflict > 0 {
            msg.push_str(&format!(
                "；同名不同哈希 {skipped_content_conflict} 项请用「刷新」对账"
            ));
        } else if silent_relink_count > 0 {
            msg.push_str(&format!("（确认后将静默回链 {silent_relink_count} 项）"));
        }
        notes.push(msg);
        if project_roots_unconfigured {
            notes.push(
                "项目扫描根未配置时按盘符发现，建议在设置中指定目录".into(),
            );
        }
    }

    Ok(ScanPreviewResult {
        ok: true,
        message: notes.join("；"),
        items: delta,
        pending_new_project_count: pending_new.len() as u32,
        scan_roots: scanned_roots,
        conflicts: vec![],
        unchanged_count,
        silent_relink_count,
        skipped_content_conflict,
        delta_count,
        snapshot: snap(&settings),
    })
}

pub fn confirm_scan_build(
    settings: &mut AppSettings,
    selected_keys: &[String],
    resolutions: &[ScanResolution],
) -> Result<ScanConfirmResult, String> {
    let lib = settings.skills_library_root.trim().to_string();
    if lib.is_empty() || !settings.library_root_configured {
        return Err("请先配置永久库目录".into());
    }
    let lib = lib.as_str();

    let pending = pending_store()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .ok_or_else(|| "无预览缓存，请先执行扫描建库预览".to_string())?;

    let pending_projects = pending.pending_projects.clone();
    let silent_relinks = pending.silent_relinks.clone();
    let preview_skipped_conflict = pending.skipped_content_conflict;
    let mut discovered_tools: Vec<String> = Vec::new();
    let mut push_tool = |tool: &str| {
        let t = tool.trim();
        if t.is_empty() {
            return;
        }
        if !discovered_tools
            .iter()
            .any(|x| x.eq_ignore_ascii_case(t))
        {
            discovered_tools.push(t.to_string());
        }
    };

    let key_set: std::collections::HashSet<String> = selected_keys
        .iter()
        .map(|k| norm_key(k))
        .filter(|k| !k.is_empty())
        .collect();

    // 空 selectedKeys = 不处理增量项（仍可静默回链 + 登记新项目）
    let selected: Vec<DiscoveredItemDto> = if key_set.is_empty() {
        vec![]
    } else {
        pending
            .items
            .into_iter()
            .filter(|i| key_set.contains(&i.key))
            .collect()
    };

    // resolutions 保留 API 兼容，扫描建库不再用人选覆盖库/容器（同名异哈希一律跳过）
    let _res_map: HashMap<String, String> = resolutions
        .iter()
        .map(|r| (norm_key(&r.key), r.choice.to_lowercase()))
        .collect();

    let mut work = selected.clone();
    let _ = attach_existing_and_conflicts(&settings, &mut work);

    // H1：一次 load → 内存批量修改 → 结尾一次原子 save，避免逐条整份重写 catalog.json
    let catalog_load = load_catalog(lib);
    if !catalog_load.healthy {
        // 台账损坏时旧逐条 upsert 会全部失败；等价地整体拒绝写盘、增量项逐项计失败
        let unhealthy = format!(
            "catalog unhealthy, refuse write: {}",
            catalog_load.error.unwrap_or_else(|| "unknown".into())
        );
        let mut failed = 0u32;
        let mut skipped_content_conflict = preview_skipped_conflict;
        let mut errors = Vec::new();
        for item in &work {
            if item.content_changed {
                skipped_content_conflict += 1;
                continue;
            }
            failed += 1;
            errors.push(format!("{}: {unhealthy}", item.suggested_id));
        }
        let mut msg = format!(
            "扫描建库：新项目 0，登记资产 0，复制入库 0，回链 0，跳过 0，失败 {failed}"
        );
        if skipped_content_conflict > 0 {
            msg.push_str(&format!(
                "；跳过同名不同哈希 {skipped_content_conflict} 项，请用「刷新」对账"
            ));
        }
        return Ok(ScanConfirmResult {
            ok: failed == 0,
            message: msg,
            registered: 0,
            origins_appended: 0,
            skipped: 0,
            skipped_content_conflict,
            relinked: 0,
            failed,
            errors,
            projects_added: 0,
            conflicts: vec![],
            open_auto_classify: false,
            copied_into_library: 0,
            snapshot: snap(settings),
        });
    }
    let mut catalog = catalog_load.catalog;
    let mut catalog_dirty = false;

    // Register newly discovered projects first
    let mut projects_added = 0u32;
    {
        let mut existing_norm: std::collections::HashSet<String> = list_projects(&catalog)
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
                ..Default::default()
            };
            upsert_project_in(&mut catalog, &project);
            catalog_dirty = true;
            existing_norm.insert(key);
            projects_added += 1;
        }
    }

    let mut registered = 0u32;
    let skipped = 0u32;
    let mut skipped_content_conflict = preview_skipped_conflict;
    let mut relinked = 0u32;
    let mut failed = 0u32;
    let mut copied = 0u32;
    let mut origins_appended = 0u32;
    let mut errors = Vec::new();

    // 静默回链：同哈希只写 deployedPath，不进预览、不计「登记资产」
    for item in &silent_relinks {
        let Some(eid) = item.existing_entry_id.as_ref() else {
            continue;
        };
        let Some(entry) = catalog.entries.iter_mut().find(|e| e.id == *eid) else {
            continue;
        };
        entry.deployed_path = item.source_path.clone();
        entry.is_missing = false;
        crate::list_cluster::apply_inferred_level_if_missing(entry);
        catalog_dirty = true;
        relinked += 1;
        push_tool(&item.tool);
    }

    let library_disk_set: std::collections::HashSet<String> =
        pending.library_disk_keys.into_iter().collect();

    for item in work {
        // 同名不同哈希：扫描不人选，留给刷新
        if item.content_changed {
            skipped_content_conflict += 1;
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
                let _ = crate::rule_layout::repath_rule_entry_to_nested(lib, &mut entry);
            }
            crate::list_cluster::apply_inferred_level_if_missing(&mut entry);
            upsert_entry_in(&mut catalog, entry);
            catalog_dirty = true;
            registered += 1;
            push_tool(&item.tool);
            continue;
        }

        // Container discovery → register into library（安全路径：新文件或缺库复制；同哈希回链）
        let item_tool = item.tool.clone();
        let existing_entry = item
            .existing_entry_id
            .as_ref()
            .and_then(|eid| catalog.entries.iter().find(|e| e.id == *eid).cloned());

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

        if dest.exists() {
            let src_cmp = resolve_comparable_content_path(&item.source_path, &item.kind);
            let lib_cmp = resolve_comparable_content_path(&dest.to_string_lossy(), &item.kind);
            let src_h = if src_cmp.is_file() {
                hash_path_auto(&src_cmp).map(|(x, _)| x).unwrap_or_default()
            } else {
                item.content_hash.clone()
            };
            let lib_h = if lib_cmp.is_file() {
                hash_path_auto(&lib_cmp).map(|(x, _)| x).unwrap_or_default()
            } else {
                hash_path_auto(&dest).map(|(x, _)| x).unwrap_or_default()
            };
            if !lib_h.is_empty()
                && !src_h.is_empty()
                && !lib_h.eq_ignore_ascii_case(&src_h)
            {
                // 防御：预览未标 content_changed 时仍不覆盖
                skipped_content_conflict += 1;
                continue;
            }
            // 同哈希：仅回链台账，不改写正文
        } else if let Err(e) = copy_path(&source, &dest) {
            if !dest.exists() {
                failed += 1;
                errors.push(format!("{}: {e}", item.suggested_id));
                continue;
            }
        } else {
            copied += 1;
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
        if let Some(eid) = &item.existing_entry_id {
            entry.id = eid.clone();
            origins_appended += 1;
            if let Some(ref e) = existing_entry {
                if !e.library_path.trim().is_empty() {
                    entry.library_path = e.library_path.clone();
                }
                // 保留已有 tags / extra，再补推断 level
                entry.extra = e.extra.clone();
            }
        }
        entry.origins.push(CatalogOrigin {
            original_path: item.source_path.clone(),
            tool: item.tool.clone(),
            scope: item.scope.clone(),
        });
        if entry.kind.eq_ignore_ascii_case("rule") {
            let _ = crate::rule_layout::repath_rule_entry_to_nested(lib, &mut entry);
        }
        crate::list_cluster::apply_inferred_level_if_missing(&mut entry);
        upsert_entry_in(&mut catalog, entry);
        catalog_dirty = true;
        registered += 1;
        push_tool(&item_tool);
    }

    if catalog_dirty {
        save_catalog(lib, &catalog)?;
    }

    // 有成功入库/回链时：Cursor + 发现 tool 进入可见工作区域（只加不减；由调用方 save）
    if registered > 0 || relinked > 0 || copied > 0 {
        let _ = promote_workspaces_after_scan(settings, &discovered_tools);
    }

    let mut msg = format!(
        "扫描建库：新项目 {projects_added}，登记资产 {registered}，复制入库 {copied}，回链 {relinked}，跳过 {skipped}，失败 {failed}"
    );
    if skipped_content_conflict > 0 {
        msg.push_str(&format!(
            "；跳过同名不同哈希 {skipped_content_conflict} 项，请用「刷新」对账"
        ));
    }
    if registered > 0 || copied > 0 || projects_added > 0 {
        match crate::tags_purpose::apply_default_suggestions(settings) {
            Ok((ln, pn)) if ln > 0 || pn > 0 => {
                msg.push_str(&format!("；已按默认逻辑写入层级 {ln} 项、用途 {pn} 项"));
            }
            Ok(_) => {}
            Err(e) => {
                msg.push_str(&format!("；自动归类未写入：{e}"));
            }
        }
    }

    Ok(ScanConfirmResult {
        ok: failed == 0,
        message: msg,
        registered,
        origins_appended,
        skipped,
        skipped_content_conflict,
        relinked,
        failed,
        errors,
        projects_added,
        conflicts: vec![],
        open_auto_classify: false,
        copied_into_library: copied,
        snapshot: snap(settings),
    })
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, load_catalog, upsert_entry, CatalogEntry};
    use std::sync::{Mutex, MutexGuard, OnceLock};

    /// 预览/确认共用全局 pending；并行单测会互相踩，整测串行化。
    fn serial() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn root(path: &Path, tool: &str) -> ScanRootInput {
        ScanRootInput {
            path: path.to_string_lossy().to_string(),
            tool: tool.into(),
        }
    }

    /// 避免单测触发全盘符项目发现（空 ProjectScanRoots = 默认盘符）。
    fn isolate_project_scan(dir: &Path, settings: &mut AppSettings) {
        let empty = dir.join("empty-scan");
        let _ = fs::create_dir_all(&empty);
        settings.project_scan_roots = vec![empty.to_string_lossy().to_string()];
        if settings.project_scan_max_depth <= 0 {
            settings.project_scan_max_depth = 2;
        }
    }

    #[test]
    fn none_roots_skips_workspace_ids_and_appends_extra() {
        let dir = tempfile::tempdir().unwrap();
        let extra = dir.path().join("extra-root");
        fs::create_dir_all(&extra).unwrap();
        let mut settings = AppSettings::default();
        settings.scan_skip_workspace_ids = vec!["claude".into(), " CLAUDE ".into()];
        settings.scan_extra_roots = vec![crate::settings::ScanExtraRoot {
            path: extra.to_string_lossy().to_string(),
            tool: String::new(),
        }];
        let inputs = resolve_scan_root_inputs(&settings, None);
        assert!(
            !inputs.iter().any(|r| r.tool.eq_ignore_ascii_case("claude")),
            "skipped workspace must not appear"
        );
        let extra_disp = crate::project_discovery::to_display_path(&extra.to_string_lossy());
        let extra_key = normalize_path(&extra_disp);
        assert!(
            inputs.iter().any(|r| {
                normalize_path(&r.path) == extra_key && r.tool == "cursor"
            }),
            "extra root must be appended with default tool cursor; got {:?}",
            inputs
                .iter()
                .map(|r| format!("{}:{}", r.tool, r.path))
                .collect::<Vec<_>>()
        );
        let explicit = resolve_scan_root_inputs(
            &settings,
            Some(&[ScanRootInput {
                path: extra_disp.clone(),
                tool: "claude".into(),
            }]),
        );
        assert_eq!(explicit.len(), 1);
        assert_eq!(explicit[0].tool, "claude");
    }

    /// H1 计时（默认忽略）：N=200 条容器 skill，预览后计时确认阶段，并统计 save_catalog 次数。
    /// 运行：`cargo test --lib bench_confirm_200 -- --ignored --nocapture --test-threads=1`
    #[test]
    #[ignore]
    fn bench_confirm_200_items_timing() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let cursor = dir.path().join("cursor-home");
        let n = 200usize;
        for i in 0..n {
            let d = cursor.join(format!("skills/bench-{i:03}"));
            fs::create_dir_all(&d).unwrap();
            fs::write(d.join("SKILL.md"), format!("# bench {i}\ncontent {i}\n")).unwrap();
        }
        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let roots = [root(&cursor, "cursor")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert_eq!(preview.items.len(), n, "{}", preview.message);
        let keys: Vec<_> = preview.items.iter().map(|i| i.key.clone()).collect();

        let saves_before = crate::catalog::save_stats::count();
        let t0 = std::time::Instant::now();
        let confirm = confirm_scan_build(&mut settings, &keys, &[]).unwrap();
        let ms = t0.elapsed().as_secs_f64() * 1000.0;
        let save_calls = crate::catalog::save_stats::count() - saves_before;

        assert!(confirm.ok, "{}", confirm.message);
        assert_eq!(confirm.registered, n as u32, "{}", confirm.message);
        let load = load_catalog(&lib_root);
        assert_eq!(load.catalog.entries.len(), n);
        // H1 后：确认阶段只允许一次整份写盘（改前为每条一次 = 200）
        assert_eq!(save_calls, 1, "confirm should save catalog exactly once");
        eprintln!("confirm {n} items: {ms:.1} ms, save_catalog calls: {save_calls}");
    }

    #[test]
    fn nested_cursor_walk_skips_build_output_dirs() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src/mod-a/.cursor/skills")).unwrap();
        fs::create_dir_all(dir.path().join("target/debug/pkg/.cursor/skills")).unwrap();
        fs::create_dir_all(dir.path().join(".next/cache/.cursor")).unwrap();
        let found = find_nested_cursor_dirs(dir.path(), 5);
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].to_string_lossy().to_lowercase().contains("mod-a"));
    }

    #[test]
    fn preview_then_confirm_registers_container_skill() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let cursor = dir.path().join("cursor-home");
        fs::create_dir_all(cursor.join("skills/hello")).unwrap();
        fs::write(
            cursor.join("skills/hello/SKILL.md"),
            b"# hello\nfrom container\n",
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);

        let roots = [root(&cursor, "cursor")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert!(!preview.items.is_empty(), "{}", preview.message);
        let key = preview
            .items
            .iter()
            .find(|i| i.source_path.to_lowercase().contains("hello"))
            .map(|i| i.key.clone())
            .unwrap_or_else(|| preview.items[0].key.clone());

        let confirm = confirm_scan_build(&mut settings, &[key], &[]).unwrap();
        assert!(confirm.ok, "{}", confirm.message);
        assert!(confirm.registered >= 1);
        assert!(
            !confirm.open_auto_classify,
            "scan confirm must not open auto-classify modal"
        );

        let load = load_catalog(&lib_root);
        assert!(load.catalog.entries.iter().any(|e| e.id.contains("hello")));
        let hello = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id.contains("hello"))
            .unwrap();
        let tags = crate::catalog::get_entry_tags(hello);
        assert_eq!(tags.level.as_deref(), Some("L1"), "{tags:?}");
        assert!(
            tags.purposes.iter().any(|p| p == "通用"),
            "{:?}",
            tags.purposes
        );
        assert_eq!(
            hello.library_path.replace('\\', "/"),
            "skills/L1-hello",
            "skill should register as directory unit"
        );
        assert!(
            Path::new(&lib_root).join("skills/L1-hello/SKILL.md").is_file(),
            "SKILL.md copied into library"
        );
        assert!(
            hello.origins.iter().any(|o| o.tool.eq_ignore_ascii_case("cursor")),
            "origin tool should be cursor"
        );
    }

    #[test]
    fn preview_discovers_and_confirm_registers_project_container() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let scan_root = dir.path().join("scan");
        let proj = scan_root.join("ExtProj");
        fs::create_dir_all(proj.join(".cursor/skills/ext")).unwrap();
        fs::write(
            proj.join(".cursor/skills/ext/SKILL.md"),
            b"# ext\nfrom project\n",
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            project_scan_roots: vec![scan_root.to_string_lossy().to_string()],
            project_scan_max_depth: 4,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };

        // 无工作区根也可：项目发现应单独登记容器并扫到资产
        let preview = scan_and_ingest_preview(&settings, Some(&[])).unwrap();
        assert!(
            preview.pending_new_project_count >= 1,
            "expected pending project, got: {}",
            preview.message
        );
        assert!(
            preview.items.iter().any(|i| i.suggested_id.contains("ext")),
            "expected project skill in delta: {}",
            preview.message
        );
        let keys: Vec<_> = preview.items.iter().map(|i| i.key.clone()).collect();
        let confirm = confirm_scan_build(&mut settings, &keys, &[]).unwrap();
        assert!(confirm.ok, "{}", confirm.message);
        assert!(confirm.projects_added >= 1, "{}", confirm.message);
        assert!(confirm.registered >= 1, "{}", confirm.message);
        let load = load_catalog(&lib_root);
        assert!(
            load.catalog.projects.iter().any(|p| {
                p.get("name")
                    .or_else(|| p.get("Name"))
                    .and_then(|v| v.as_str())
                    .map(|n| n.to_lowercase().contains("extproj"))
                    .unwrap_or(false)
            }),
            "project should be in catalog"
        );
    }

    #[test]
    fn confirm_scan_copies_skill_sidecars_into_library() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let cursor = dir.path().join("cursor-home");
        fs::create_dir_all(cursor.join("skills/bundle")).unwrap();
        fs::write(cursor.join("skills/bundle/SKILL.md"), b"# bundle\n").unwrap();
        fs::write(cursor.join("skills/bundle/notes.md"), b"notes\n").unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let roots = [root(&cursor, "cursor")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        let item = preview
            .items
            .iter()
            .find(|i| i.suggested_id.contains("bundle"))
            .expect("bundle skill discovered");
        assert!(item.is_folder, "skill discovery must be folder unit");
        let confirm = confirm_scan_build(&mut settings, &[item.key.clone()], &[]).unwrap();
        assert!(confirm.ok, "{}", confirm.message);
        assert!(Path::new(&lib_root).join("skills/L1-bundle/SKILL.md").is_file());
        assert!(Path::new(&lib_root).join("skills/L1-bundle/notes.md").is_file());
        let n = fs::read_dir(Path::new(&lib_root).join("skills/L1-bundle"))
            .unwrap()
            .filter(|e| e.as_ref().map(|x| x.path().is_file()).unwrap_or(false))
            .count();
        assert_eq!(n, 2);
        let load = load_catalog(&lib_root);
        let e = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id.contains("bundle"))
            .unwrap();
        assert_eq!(e.library_path.replace('\\', "/"), "skills/L1-bundle");
    }

    #[test]
    fn confirm_promotes_discovered_workspace_and_keeps_cursor() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        // gemini 默认在工具池（非 PRIMARY），便于验证晋升
        let gemini = dir.path().join("gemini-home");
        fs::create_dir_all(gemini.join("skills/fromgemini")).unwrap();
        fs::write(
            gemini.join("skills/fromgemini/SKILL.md"),
            b"# from gemini\n",
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            visible_workspace_ids: vec!["cursor".into()],
            workspaces: vec![
                crate::workspace::WorkspaceConfig {
                    id: "cursor".into(),
                    enabled: true,
                    in_work_area: true,
                    display_name: "Cursor".into(),
                    container_root: dir.path().join("empty-cursor").to_string_lossy().to_string(),
                },
                crate::workspace::WorkspaceConfig {
                    id: "gemini".into(),
                    enabled: true,
                    in_work_area: false,
                    display_name: "Gemini CLI".into(),
                    container_root: gemini.to_string_lossy().to_string(),
                },
            ],
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let _ = crate::workspace::ensure_workspaces_migrated(&mut settings);
        // 迁移后强制 gemini 仍在池内、不可见
        if let Some(w) = settings
            .workspaces
            .iter_mut()
            .find(|w| w.id.eq_ignore_ascii_case("gemini"))
        {
            w.in_work_area = false;
            w.container_root = gemini.to_string_lossy().to_string();
        }
        settings.visible_workspace_ids = vec!["cursor".into()];

        let roots = [root(&gemini, "gemini")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert_eq!(preview.pending_new_project_count, 0);
        let keys: Vec<_> = preview.items.iter().map(|i| i.key.clone()).collect();
        assert!(!keys.is_empty(), "{}", preview.message);
        let confirm = confirm_scan_build(&mut settings, &keys, &[]).unwrap();
        assert!(confirm.ok, "{}", confirm.message);
        assert!(confirm.registered >= 1);
        assert!(
            settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case("cursor")),
            "cursor must stay visible"
        );
        assert!(
            settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case("gemini")),
            "gemini must be promoted visible"
        );
        let gemini_ws = settings
            .workspaces
            .iter()
            .find(|w| w.id.eq_ignore_ascii_case("gemini"))
            .unwrap();
        assert!(gemini_ws.in_work_area && gemini_ws.enabled);
    }

    #[test]
    fn explicit_roots_override_default_and_skip_missing() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let cursor = dir.path().join("cursor-home");
        fs::create_dir_all(cursor.join("skills/onlyme")).unwrap();
        fs::write(cursor.join("skills/onlyme/SKILL.md"), b"# only\n").unwrap();
        let missing = dir.path().join("does-not-exist");
        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let roots = [root(&cursor, "cursor"), root(&missing, "claude")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert_eq!(preview.scan_roots.len(), 1);
        assert!(preview.items.iter().any(|i| i.suggested_id.contains("onlyme")));
        assert!(
            !preview.items.iter().any(|i| i.tool.eq_ignore_ascii_case("claude")),
            "missing root must not invent items"
        );
        assert_eq!(preview.pending_new_project_count, 0);
    }

    #[test]
    fn content_conflict_skipped_no_blocking_conflicts() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let container = dir.path().join("cursor-home");
        let lib_skill = Path::new(&lib_root).join("skills/hello/SKILL.md");
        fs::create_dir_all(lib_skill.parent().unwrap()).unwrap();
        fs::write(&lib_skill, b"# lib\n").unwrap();
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

        fs::create_dir_all(container.join("skills/hello")).unwrap();
        fs::write(
            container.join("skills/hello/SKILL.md"),
            b"# container DIFFERENT\n",
        )
        .unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let roots = [root(&container, "cursor")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert!(
            preview.conflicts.is_empty(),
            "scan must not return blocking conflicts: {}",
            preview.message
        );
        assert!(
            !preview.items.iter().any(|i| i.suggested_id == "hello"),
            "content conflict must not appear in delta items"
        );
        assert!(
            preview.skipped_content_conflict >= 1,
            "preview: {}",
            preview.message
        );
        assert!(
            preview.message.contains("刷新"),
            "preview should hint refresh: {}",
            preview.message
        );
        let confirm = confirm_scan_build(&mut settings, &[], &[]).unwrap();
        assert!(confirm.conflicts.is_empty());
        assert!(
            confirm.skipped_content_conflict >= 1,
            "{}",
            confirm.message
        );
        let lib_body = fs::read_to_string(&lib_skill).unwrap();
        assert!(
            lib_body.contains("# lib"),
            "library must not be overwritten by scan"
        );
        assert!(!lib_body.contains("DIFFERENT"));
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
        assert_eq!(rel, "rules/L0-02-terminology/L0-02-terminology.mdc");
    }

    #[test]
    fn scan_same_hash_silent_relink_not_in_delta() {
        let _g = serial();
        let dir = tempfile::tempdir().unwrap();
        let lib_root = dir.path().to_string_lossy().to_string();
        ensure_library_layout(&lib_root).unwrap();
        let body = b"# hello\nsame content\n";
        let lib_skill = Path::new(&lib_root).join("skills/hello/SKILL.md");
        fs::create_dir_all(lib_skill.parent().unwrap()).unwrap();
        fs::write(&lib_skill, body).unwrap();
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

        let cursor = dir.path().join("cursor-home");
        let ctr_skill = cursor.join("skills/hello/SKILL.md");
        fs::create_dir_all(ctr_skill.parent().unwrap()).unwrap();
        fs::write(&ctr_skill, body).unwrap();

        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            backup_root: dir.path().join("nobackup").to_string_lossy().to_string(),
            ..Default::default()
        };
        isolate_project_scan(dir.path(), &mut settings);
        let roots = [root(&cursor, "cursor")];
        let preview = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert!(preview.conflicts.is_empty());
        assert!(
            !preview.items.iter().any(|i| i.suggested_id == "hello"),
            "same-hash relink must not appear in delta"
        );
        assert!(preview.silent_relink_count >= 1, "{}", preview.message);
        let r = confirm_scan_build(&mut settings, &[], &[]).unwrap();
        assert!(r.ok, "{} {:?}", r.message, r.errors);
        assert_eq!(r.skipped_content_conflict, 0);
        assert_eq!(r.registered, 0);
        assert!(r.relinked >= 1, "{}", r.message);
        assert!(!r.open_auto_classify);
        let load = load_catalog(&settings.skills_library_root);
        let entry = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == "hello")
            .unwrap();
        assert!(
            entry.deployed_path.to_lowercase().contains("hello"),
            "{}",
            entry.deployed_path
        );

        let preview2 = scan_and_ingest_preview(&settings, Some(&roots)).unwrap();
        assert!(
            !preview2.items.iter().any(|i| i.suggested_id == "hello"),
            "hello must stay out of delta after relink"
        );
        assert!(preview2.unchanged_count >= 1, "{}", preview2.message);
    }
}
