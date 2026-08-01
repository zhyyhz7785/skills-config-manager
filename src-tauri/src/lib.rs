mod active_container;
mod backup;
mod catalog;
mod catalog_backup;
mod conflict_preview;
mod content_sync;
mod rule_layout;
mod deploy;
mod drag_paths;
mod dual_copy;
mod hash;
mod library_io;
mod list_cluster;
mod manage;
mod network_library;
mod open_entries;
mod path_guard;
mod project_discovery;
mod projects;
mod refresh;
mod scan_ingest;
mod session;
mod settings;
mod shell_ops;
mod snapshot;
mod tags_purpose;
mod withdraw;
mod workspace;

use catalog::{ensure_library_layout, load_catalog, validate_entry_paths};
use deploy::{deploy_entries, DeployResult};
use library_io::{
    read_library_text as read_library_text_impl, save_detail_markdown as save_detail_markdown_impl,
    save_library_file as save_library_file_impl, ReadLibraryTextResult, SaveLibraryFileResult,
};
use manage::{purge_missing, unmanage_entries, ManageResult};
use open_entries::{open_active_container_dir, open_entry_side, open_global_container};
use serde_json::Value;
use session::with_session;
use settings::{
    effective_library_root, ensure_active_container, load_settings, save_settings,
    DEFAULT_LIBRARY_ROOT,
};
use shell_ops::{open_path, pick_folder, reveal_in_folder};
use snapshot::{build_snapshot_subset, AppSnapshotSubset};
use backup::{MoveBackupResult, MovePreviewResult, MoveResolution};
use dual_copy::DualCopyTextsResult;
use drag_paths::ResolveDragPathsResult;
use projects::ProjectOpResult;
use refresh::{RefreshResolution, RefreshResult};
use scan_ingest::{
    ScanConfirmResult, ScanPreviewResult, ScanProjectsConfirmResult, ScanProjectsPreviewResult,
    ScanResolution,
};
use tags_purpose::{ApplyPurposeItem, TagsOpResult};
use withdraw::{withdraw_entries, withdraw_entry, ConflictResolution, WithdrawBatchResult, WithdrawResult};

/// Headless perf timings for same-fixture compare vs Electron (no WebView).
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfBenchResult {
    pub ok: bool,
    pub library_root: String,
    pub scan_root: String,
    pub project_scan_max_depth: i32,
    pub snapshot_ms: f64,
    pub catalog_entry_count: usize,
    pub scan_preview_ms: f64,
    pub scan_item_count: usize,
    pub pending_new_project_count: u32,
    pub message: String,
}

pub fn run_perf_bench(
    library_root: &str,
    scan_root: &str,
    max_depth: i32,
) -> Result<PerfBenchResult, String> {
    use std::time::Instant;
    let lib = library_root.trim();
    let scan = scan_root.trim();
    if lib.is_empty() || scan.is_empty() {
        return Err("library_root and scan_root required".into());
    }
    ensure_library_layout(lib)?;
    let mut settings = settings::AppSettings {
        skills_library_root: lib.to_string(),
        library_root_configured: true,
        project_scan_roots: vec![scan.to_string()],
        project_scan_max_depth: max_depth,
        ..Default::default()
    };
    ensure_active_container(&mut settings)?;

    let t0 = Instant::now();
    let load = load_catalog(lib);
    let warnings = if load.healthy {
        validate_entry_paths(lib, &load.catalog.entries)
    } else {
        vec![]
    };
    let _snap = build_snapshot_subset(&settings, &load, warnings);
    let snapshot_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let t1 = Instant::now();
    let preview = scan_ingest::scan_and_ingest_preview(&settings)?;
    let scan_preview_ms = t1.elapsed().as_secs_f64() * 1000.0;

    Ok(PerfBenchResult {
        ok: preview.ok,
        library_root: lib.to_string(),
        scan_root: scan.to_string(),
        project_scan_max_depth: max_depth,
        snapshot_ms,
        catalog_entry_count: load.catalog.entries.len(),
        scan_preview_ms,
        scan_item_count: preview.items.len(),
        pending_new_project_count: preview.pending_new_project_count,
        message: preview.message,
    })
}

fn snapshot_now() -> Result<AppSnapshotSubset, String> {
    let settings = load_settings()?;
    let Some(root) = effective_library_root(&settings) else {
        let empty = catalog::CatalogLoadResult {
            catalog: catalog::empty_catalog(),
            healthy: true,
            error: None,
        };
        return Ok(build_snapshot_subset(&settings, &empty, vec![]));
    };
    let load = load_catalog(&root);
    let warnings = if load.healthy {
        validate_entry_paths(&root, &load.catalog.entries)
    } else {
        vec![]
    };
    Ok(build_snapshot_subset(&settings, &load, warnings))
}

#[tauri::command]
fn ping() -> String {
    "pong from CCM-Tauri2".into()
}

#[tauri::command]
fn ensure_default_library() -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    if !settings.library_root_configured || settings.skills_library_root.trim().is_empty() {
        settings.skills_library_root = DEFAULT_LIBRARY_ROOT.to_string();
        settings.library_root_configured = true;
    }
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    let root = settings.skills_library_root.clone();
    ensure_library_layout(&root)?;
    // Plan/03: also ensure network library root exists (isolated)
    let _ = network_library::ensure_default_network_library(&mut settings);
    snapshot_now()
}

#[tauri::command]
fn get_snapshot() -> Result<AppSnapshotSubset, String> {
    snapshot_now()
}

#[tauri::command]
fn choose_library_root(selected_path: String) -> Result<AppSnapshotSubset, String> {
    let root = project_discovery::to_display_path(selected_path.trim());
    if root.is_empty() {
        return Err("已取消".into());
    }
    let mut settings = load_settings()?;
    settings.skills_library_root = root.clone();
    settings.library_root_configured = true;
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    ensure_library_layout(&root)?;
    snapshot_now()
}

#[tauri::command]
fn ensure_default_network_library() -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::ensure_default_network_library(&mut settings)
}

#[tauri::command]
fn choose_network_library_root(selected_path: String) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::choose_network_library_root(&mut settings, &selected_path)
}

#[tauri::command]
fn list_network_baseline_sources() -> Result<Vec<network_library::NetworkBaselineSourceDto>, String> {
    Ok(network_library::list_baseline_sources())
}

#[tauri::command]
fn fetch_network_source(
    url_or_baseline_id: String,
    label: Option<String>,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    network_library::fetch_network_source(
        &settings,
        &url_or_baseline_id,
        label.as_deref(),
    )
}

#[tauri::command]
fn check_network_updates() -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    network_library::check_network_updates(&settings)
}

#[tauri::command]
fn apply_network_cache_update(
    source_ids: Option<Vec<String>>,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    let ids = source_ids.unwrap_or_default();
    network_library::apply_network_cache_update(&settings, &ids)
}

#[tauri::command]
fn promote_network_to_library(
    entry_ids: Vec<String>,
    resolutions: Option<Vec<ConflictResolution>>,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    let res = resolutions.unwrap_or_default();
    network_library::promote_network_to_library(&settings, &entry_ids, &res)
}

#[tauri::command]
fn update_app_settings(
    backup_root: Option<String>,
    project_scan_roots: Option<Vec<String>>,
    project_scan_max_depth: Option<i32>,
    auto_scan_projects_on_startup: Option<bool>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    if let Some(b) = backup_root {
        settings.backup_root = project_discovery::to_display_path(b.trim());
    }
    if let Some(roots) = project_scan_roots {
        let mut cleaned = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for r in roots {
            let d = project_discovery::to_display_path(r.trim());
            if d.is_empty() {
                continue;
            }
            let key = project_discovery::normalize_path(&d);
            if seen.insert(key) {
                cleaned.push(d);
            }
        }
        settings.project_scan_roots = cleaned;
    }
    if let Some(depth) = project_scan_max_depth {
        settings.project_scan_max_depth = depth.clamp(0, 20);
    }
    if let Some(auto) = auto_scan_projects_on_startup {
        settings.auto_scan_projects_on_startup = auto;
    }
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn reset_catalog() -> Result<AppSnapshotSubset, String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let _ = catalog_backup::push_catalog_backup(lib)?;
    catalog::write_empty_catalog(lib)?;
    with_session(|s| s.selected_entry_ids.clear());
    snapshot_now()
}

#[tauri::command]
fn list_catalog_backups() -> Result<Vec<catalog_backup::CatalogBackupInfo>, String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Ok(vec![]);
    }
    catalog_backup::list_catalog_backups(lib)
}

#[tauri::command]
fn restore_catalog_backup(id: String) -> Result<AppSnapshotSubset, String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    catalog_backup::restore_catalog_backup(lib, &id)?;
    with_session(|s| s.selected_entry_ids.clear());
    snapshot_now()
}

#[tauri::command]
fn set_nav(kind: String, project_id: Option<String>, tool: Option<String>) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    settings.nav_kind = kind.clone();
    settings.show_global_only = kind == "global";
    settings.selected_project_id = if kind == "project" {
        project_id.filter(|s| !s.is_empty())
    } else {
        None
    };
    if let Some(t) = tool {
        if let Some(nid) = workspace::normalize_workspace_id(&t) {
            settings.selected_global_tool = nid.into();
        }
    }
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    with_session(|s| s.selected_entry_ids.clear());
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_workspace_visibility(ids: Vec<String>) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let mut cleaned = Vec::new();
    for id in ids {
        if let Some(nid) = workspace::normalize_workspace_id(&id) {
            let enabled = settings
                .workspaces
                .iter()
                .find(|w| w.id == nid)
                .map(|w| w.enabled)
                .unwrap_or(false);
            if enabled && !cleaned.iter().any(|x: &String| x == nid) {
                cleaned.push(nid.into());
            }
        }
    }
    if cleaned.is_empty() {
        cleaned.push(settings.default_workspace_id.clone());
    }
    settings.visible_workspace_ids = cleaned;
    // Keep focus if still visible; else default or first visible.
    let focus = settings.selected_global_tool.clone();
    if !settings
        .visible_workspace_ids
        .iter()
        .any(|v| v.eq_ignore_ascii_case(&focus))
    {
        let next = if settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(&settings.default_workspace_id))
        {
            settings.default_workspace_id.clone()
        } else {
            settings.visible_workspace_ids[0].clone()
        };
        settings.selected_global_tool = next;
    }
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_default_workspace(id: String) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let Some(nid) = workspace::normalize_workspace_id(&id) else {
        return Err("未知工作区".into());
    };
    let enabled = settings
        .workspaces
        .iter()
        .find(|w| w.id == nid)
        .map(|w| w.enabled)
        .unwrap_or(false);
    if !enabled {
        return Err("不能将未启用的工作区设为默认".into());
    }
    settings.default_workspace_id = nid.into();
    if !settings
        .visible_workspace_ids
        .iter()
        .any(|v| v.eq_ignore_ascii_case(nid))
    {
        settings.visible_workspace_ids.push(nid.into());
    }
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn update_workspace_config(
    id: String,
    enabled: Option<bool>,
    display_name: Option<String>,
    container_root: Option<String>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let Some(nid) = workspace::normalize_workspace_id(&id) else {
        return Err("未知工作区".into());
    };
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    let Some(w) = settings
        .workspaces
        .iter_mut()
        .find(|w| w.id.eq_ignore_ascii_case(nid))
    else {
        return Err("工作区不存在".into());
    };
    if let Some(en) = enabled {
        w.enabled = en;
    }
    if let Some(name) = display_name {
        let t = name.trim();
        if !t.is_empty() {
            w.display_name = t.to_string();
        }
    }
    if let Some(root) = container_root {
        let t = root.trim();
        if t.is_empty() {
            w.container_root = crate::active_container::user_global_tool_root(nid);
        } else {
            w.container_root = project_discovery::to_display_path(t);
        }
    }
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_filters(args: Value) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let obj = args.as_object();
    if let Some(o) = obj {
        if let Some(v) = o.get("filterShowSkills").and_then(|x| x.as_bool()) {
            settings.filter_show_skills = v;
        }
        if let Some(v) = o.get("FilterShowSkills").and_then(|x| x.as_bool()) {
            settings.filter_show_skills = v;
        }
        if let Some(v) = o.get("filterShowRules").and_then(|x| x.as_bool()) {
            settings.filter_show_rules = v;
        }
        if let Some(v) = o.get("FilterShowRules").and_then(|x| x.as_bool()) {
            settings.filter_show_rules = v;
        }
        if let Some(v) = o.get("filterShowAgents").and_then(|x| x.as_bool()) {
            settings.filter_show_agents = v;
        }
        if let Some(v) = o.get("FilterShowAgents").and_then(|x| x.as_bool()) {
            settings.filter_show_agents = v;
        }
        if let Some(v) = o.get("filterShowCommands").and_then(|x| x.as_bool()) {
            settings.filter_show_commands = v;
        }
        if let Some(v) = o.get("FilterShowCommands").and_then(|x| x.as_bool()) {
            settings.filter_show_commands = v;
        }
        if let Some(v) = o.get("filterShowHooks").and_then(|x| x.as_bool()) {
            settings.filter_show_hooks = v;
        }
        if let Some(v) = o.get("FilterShowHooks").and_then(|x| x.as_bool()) {
            settings.filter_show_hooks = v;
        }
        settings.library_filter_initialized = true;
    }
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_selection(
    entry_ids: Vec<String>,
    detail_path_side: Option<String>,
) -> Result<AppSnapshotSubset, String> {
    with_session(|s| {
        s.selected_entry_ids = entry_ids;
        if let Some(side) = detail_path_side {
            if side == "container" || side == "library" {
                s.detail_path_side = side;
            }
        }
    });
    snapshot_now()
}

#[tauri::command]
fn set_detail_mode(mode: String) -> Result<AppSnapshotSubset, String> {
    with_session(|s| {
        s.detail_pane_mode = mode;
    });
    snapshot_now()
}

#[tauri::command]
fn set_cluster_mode(index: i32) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    settings.cluster_mode_index = index.clamp(0, 2);
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_purpose_domain_filter(index: i32) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    settings.purpose_domain_filter_index = index.max(0);
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn set_ui_layout(args: Value) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    if let Some(o) = args.as_object() {
        if let Some(v) = o.get("navWidth").and_then(|x| x.as_f64()) {
            settings.ui_nav_width = (v.round() as i32).clamp(160, 480);
        }
        if let Some(v) = o.get("listWidth").and_then(|x| x.as_f64()) {
            settings.ui_list_width = (v.round() as i32).clamp(280, 800);
        }
        if let Some(v) = o.get("navVisible").and_then(|x| x.as_bool()) {
            settings.ui_nav_visible = v;
        }
        if let Some(v) = o.get("detailVisible").and_then(|x| x.as_bool()) {
            settings.ui_detail_visible = v;
        }
    }
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn deploy(entry_ids: Vec<String>) -> Result<DeployResult, String> {
    if entry_ids
        .iter()
        .any(|id| network_library::is_network_entry_id(id))
    {
        return Err("网络库条目不可直接部署到容器；请先「存入永久库」".into());
    }
    let mut settings = load_settings()?;
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    deploy_entries(&settings, &entry_ids)
}

#[tauri::command]
fn withdraw_batch(
    entry_ids: Vec<String>,
    resolutions: Option<Vec<ConflictResolution>>,
) -> Result<WithdrawBatchResult, String> {
    if entry_ids
        .iter()
        .any(|id| network_library::is_network_entry_id(id))
    {
        return Err("网络库条目不可撤回".into());
    }
    let settings = load_settings()?;
    withdraw_entries(&settings, &entry_ids, resolutions.as_deref().unwrap_or(&[]))
}

#[tauri::command]
fn withdraw(entry_id: String) -> Result<WithdrawResult, String> {
    if network_library::is_network_entry_id(&entry_id) {
        return Err("网络库条目不可撤回/部署".into());
    }
    let settings = load_settings()?;
    withdraw_entry(&settings, &entry_id)
}

#[tauri::command]
fn unmanage(entry_ids: Vec<String>) -> Result<ManageResult, String> {
    let settings = load_settings()?;
    unmanage_entries(&settings, &entry_ids)
}

#[tauri::command]
fn purge_missing_entries(entry_ids: Vec<String>) -> Result<ManageResult, String> {
    let settings = load_settings()?;
    purge_missing(&settings, &entry_ids)
}

#[tauri::command]
fn scan_and_ingest_preview() -> Result<ScanPreviewResult, String> {
    let settings = load_settings()?;
    scan_ingest::scan_and_ingest_preview(&settings)
}

#[tauri::command]
fn confirm_scan_build(
    selected_keys: Option<Vec<String>>,
    resolutions: Option<Vec<ScanResolution>>,
) -> Result<ScanConfirmResult, String> {
    let settings = load_settings()?;
    scan_ingest::confirm_scan_build(
        &settings,
        selected_keys.as_deref().unwrap_or(&[]),
        resolutions.as_deref().unwrap_or(&[]),
    )
}

#[tauri::command]
fn scan_projects_preview() -> Result<ScanProjectsPreviewResult, String> {
    let settings = load_settings()?;
    scan_ingest::scan_projects_preview(&settings)
}

#[tauri::command]
fn confirm_scan_projects(
    selected_root_paths: Option<Vec<String>>,
) -> Result<ScanProjectsConfirmResult, String> {
    let settings = load_settings()?;
    scan_ingest::confirm_scan_projects(
        &settings,
        selected_root_paths.as_deref().unwrap_or(&[]),
    )
}

#[tauri::command]
fn create_project_container(
    name: Option<String>,
    root_path: String,
    category: Option<String>,
) -> Result<ProjectOpResult, String> {
    let mut settings = load_settings()?;
    projects::create_project_container(&mut settings, name, root_path, category)
}

#[tauri::command]
fn edit_project(
    id: String,
    name: String,
    root_path: String,
    category: Option<String>,
) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::edit_project(&settings, id, name, root_path, category)
}

#[tauri::command]
fn toggle_pin_project(id: String) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::toggle_pin_project(&settings, id)
}

#[tauri::command]
fn reorder_project(id: String, direction: String) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::reorder_project_cmd(&settings, id, direction)
}

#[tauri::command]
fn inspect_project_for_delete(id: String) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::inspect_project_for_delete(&settings, id)
}

#[tauri::command]
fn remove_project(
    id: String,
    force_delete_markers: Option<bool>,
    purge_empty_markers: Option<bool>,
) -> Result<ProjectOpResult, String> {
    let mut settings = load_settings()?;
    projects::remove_project_cmd(
        &mut settings,
        id,
        force_delete_markers.unwrap_or(false),
        purge_empty_markers.unwrap_or(false),
    )
}

#[tauri::command]
fn open_project_cursor(id: String) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::open_project_cursor(&settings, id)
}

#[tauri::command]
fn open_project_root(id: String) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::open_project_root(&settings, id)
}

#[tauri::command]
fn edit_tags(scope: String, purposes: Vec<String>) -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::edit_tags(&settings, scope, purposes)
}

#[tauri::command]
fn set_entry_level(
    level: String,
    entry_ids: Option<Vec<String>>,
) -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::set_entry_level(&settings, level, entry_ids)
}

#[tauri::command]
fn set_scope_global() -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::set_scope_global(&settings)
}

#[tauri::command]
fn set_scope_project(project_id: Option<String>) -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::set_scope_project(&settings, project_id)
}

#[tauri::command]
fn preview_suggested_purposes() -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::preview_suggested_purposes(&settings)
}

#[tauri::command]
fn apply_suggested_purposes(items: Vec<ApplyPurposeItem>) -> Result<TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::apply_suggested_purposes(&settings, items)
}

#[tauri::command]
fn refresh() -> Result<RefreshResult, String> {
    let settings = load_settings()?;
    refresh::refresh_with_conflict_check(&settings)
}

#[tauri::command]
fn apply_refresh_conflicts(
    resolutions: Option<Vec<RefreshResolution>>,
) -> Result<RefreshResult, String> {
    let settings = load_settings()?;
    refresh::apply_refresh_conflicts(&settings, resolutions.as_deref().unwrap_or(&[]))
}

#[tauri::command]
fn preview_move_into_backup() -> Result<MovePreviewResult, String> {
    let settings = load_settings()?;
    backup::preview_move_into_backup(&settings)
}

#[tauri::command]
fn move_into_backup_library(
    entry_ids: Option<Vec<String>>,
    resolutions: Option<Vec<MoveResolution>>,
) -> Result<MoveBackupResult, String> {
    let settings = load_settings()?;
    backup::move_into_backup_library(
        &settings,
        entry_ids.as_deref(),
        resolutions.as_deref().unwrap_or(&[]),
    )
}

#[tauri::command]
fn get_dual_copy_texts(entry_id: String) -> Result<DualCopyTextsResult, String> {
    let settings = load_settings()?;
    dual_copy::get_dual_copy_texts(&settings, entry_id)
}

#[tauri::command]
fn read_library_text(entry_id: String) -> Result<ReadLibraryTextResult, String> {
    let settings = load_settings()?;
    read_library_text_impl(&settings, &entry_id)
}

#[tauri::command]
fn save_library_file(entry_id: String, content: String) -> Result<SaveLibraryFileResult, String> {
    if network_library::is_network_entry_id(&entry_id) {
        return Err("网络库为只读橱窗，禁止编辑保存".into());
    }
    let settings = load_settings()?;
    save_library_file_impl(&settings, &entry_id, &content)
}

#[tauri::command]
fn save_detail_markdown(
    entry_id: String,
    content: String,
    side: Option<String>,
) -> Result<SaveLibraryFileResult, String> {
    if network_library::is_network_entry_id(&entry_id) {
        return Err("网络库为只读橱窗，禁止编辑保存；请先存入永久库".into());
    }
    let settings = load_settings()?;
    let side = side.unwrap_or_else(|| "library".into());
    save_detail_markdown_impl(&settings, &entry_id, &content, &side)
}

#[tauri::command]
fn resolve_drag_file_paths(
    entry_ids: Vec<String>,
    path_side: Option<String>,
) -> Result<ResolveDragPathsResult, String> {
    let settings = load_settings()?;
    Ok(drag_paths::resolve_drag_file_paths(
        &settings,
        &entry_ids,
        path_side.as_deref().unwrap_or("library"),
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .invoke_handler(tauri::generate_handler![
            ping,
            ensure_default_library,
            get_snapshot,
            choose_library_root,
            ensure_default_network_library,
            choose_network_library_root,
            list_network_baseline_sources,
            fetch_network_source,
            check_network_updates,
            apply_network_cache_update,
            promote_network_to_library,
            update_app_settings,
            reset_catalog,
            list_catalog_backups,
            restore_catalog_backup,
            set_nav,
            set_workspace_visibility,
            set_default_workspace,
            update_workspace_config,
            set_filters,
            set_selection,
            set_detail_mode,
            set_cluster_mode,
            set_purpose_domain_filter,
            set_ui_layout,
            deploy,
            withdraw,
            withdraw_batch,
            unmanage,
            purge_missing_entries,
            scan_and_ingest_preview,
            confirm_scan_build,
            scan_projects_preview,
            confirm_scan_projects,
            create_project_container,
            edit_project,
            toggle_pin_project,
            reorder_project,
            inspect_project_for_delete,
            remove_project,
            open_project_cursor,
            open_project_root,
            edit_tags,
            set_entry_level,
            set_scope_global,
            set_scope_project,
            preview_suggested_purposes,
            apply_suggested_purposes,
            refresh,
            apply_refresh_conflicts,
            preview_move_into_backup,
            move_into_backup_library,
            get_dual_copy_texts,
            resolve_drag_file_paths,
            read_library_text,
            save_library_file,
            save_detail_markdown,
            pick_folder,
            open_path,
            reveal_in_folder,
            open_entry_side,
            open_active_container_dir,
            open_global_container
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod p1_flow_tests {
    use super::*;
    use settings::AppSettings;
    use std::fs;
    use std::sync::Mutex;

    static APPDATA_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn ensure_then_snapshot_with_fake_entries() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let lib_root = lib.path().to_string_lossy().to_string();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            ..AppSettings::default()
        };
        ensure_active_container(&mut settings).unwrap();
        save_settings(&settings).unwrap();
        ensure_library_layout(&lib_root).unwrap();

        let snap_empty = get_snapshot().unwrap();
        assert!(snap_empty.is_library_configured);
        assert!(snap_empty.in_library_other_items.is_empty());
        assert!(!snap_empty.nav_nodes.is_empty());
        // Electron: canOpenPermanentLibrary 需单选且库文件存在
        assert_eq!(
            snap_empty
                .commands
                .get("canOpenPermanentLibrary")
                .and_then(|v| v.as_bool()),
            Some(false)
        );

        let fake = format!(
            r#"{{
  "version": 2,
  "projects": [],
  "entries": [
    {{
      "id": "fixture-a",
      "kind": "skill",
      "libraryPath": "skills/fixture-a/SKILL.md",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    }},
    {{
      "id": "fixture-b",
      "kind": "rule",
      "libraryPath": "rules/fixture-b.mdc",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    }}
  ]
}}"#
        );
        fs::write(lib.path().join("catalog.json"), fake).unwrap();
        fs::create_dir_all(lib.path().join("skills/fixture-a")).unwrap();
        fs::write(lib.path().join("skills/fixture-a/SKILL.md"), b"# a\n").unwrap();
        fs::create_dir_all(lib.path().join("rules")).unwrap();
        fs::write(lib.path().join("rules/fixture-b.mdc"), b"# b\n").unwrap();

        let snap = get_snapshot().unwrap();
        assert!(snap.catalog_healthy);
        assert_eq!(snap.in_library_other_items.len(), 2);
        assert_eq!(snap.in_library_other_items[0].entry_id, "fixture-a");
        assert_eq!(snap.in_library_other_items[0].kind_label, "技能");
        assert!(!snap.permanent_library_roots.is_empty());

        settings = load_settings().unwrap();
        assert_eq!(settings.skills_library_root, lib_root);

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn update_app_settings_persists_scan_fields() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let scan = tempfile::tempdir().unwrap();
        let lib_root = lib.path().to_string_lossy().to_string();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let mut settings = AppSettings {
            skills_library_root: lib_root,
            library_root_configured: true,
            ..AppSettings::default()
        };
        save_settings(&settings).unwrap();

        let scan_root = scan.path().to_string_lossy().to_string();
        let snap = update_app_settings(
            Some(r"E:\cursorBf-test".into()),
            Some(vec![
                scan_root.clone(),
                format!(r"\\?\{}", scan_root),
            ]),
            Some(7),
            Some(true),
        )
        .unwrap();

        assert_eq!(snap.project_scan_max_depth, 7);
        assert!(snap.auto_scan_projects_on_startup);
        assert_eq!(snap.project_scan_roots.len(), 1);
        assert!(!snap.project_scan_roots[0].starts_with(r"\\?\"));
        assert!(snap.disabled_storage_display.contains("cursorBf-test"));

        settings = load_settings().unwrap();
        assert_eq!(settings.project_scan_max_depth, 7);
        assert!(settings.auto_scan_projects_on_startup);
        assert_eq!(settings.project_scan_roots.len(), 1);
        assert_eq!(settings.backup_root, r"E:\cursorBf-test");

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn reset_catalog_backs_up_and_clears_entries() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let lib_root = lib.path().to_string_lossy().to_string();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            ..AppSettings::default()
        };
        save_settings(&settings).unwrap();
        ensure_library_layout(&lib_root).unwrap();
        fs::write(
            lib.path().join("catalog.json"),
            r#"{"version":2,"projects":[],"entries":[{"id":"x","kind":"skill","libraryPath":"skills/x/SKILL.md","isInLibrary":true,"deployedPath":"","isMissing":false}]}"#,
        )
        .unwrap();

        let snap = reset_catalog().unwrap();
        assert!(snap.in_library_other_items.is_empty());
        assert!(snap.catalog_healthy);

        let load = catalog::load_catalog(&lib_root);
        assert!(load.healthy);
        assert!(load.catalog.entries.is_empty());

        let bak_count = catalog_backup::list_catalog_backups(&lib_root)
            .unwrap()
            .len();
        assert!(bak_count >= 1, "expected ring backup");

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }
}
