mod active_container;
mod backup;
mod catalog;
mod catalog_backup;
mod clear_container;
pub mod cli_api;
mod conflict_preview;
mod content_sync;
mod rule_layout;
mod deploy;
mod dual_copy;
mod factory_reset;
mod hash;
mod library_io;
mod list_cluster;
mod list_order;
mod level_id;
mod manage;
mod network_catalog;
mod network_customization;
mod network_fetch_job;
mod network_library;
mod network_p2;
mod network_proxy;
mod network_security;
mod open_entries;
mod oplog;
mod path_guard;
mod project_discovery;
mod projects;
mod refresh;
mod scan_ingest;
mod session;
mod settings;
mod shell_ops;
mod skill_layout;
mod snapshot;
mod tags_purpose;
mod withdraw;
mod workspace;

use catalog::{ensure_library_layout, load_catalog, validate_entry_paths};
use deploy::{
    deploy_entries, deploy_entries_to_projects, deploy_entries_to_workspaces, DeployResult,
};
use library_io::{
    read_library_text as read_library_text_impl, save_detail_markdown as save_detail_markdown_impl,
    save_library_file as save_library_file_impl, ReadLibraryTextResult, SaveLibraryFileResult,
};
use manage::{purge_missing, ManageResult};
use open_entries::{open_active_container_dir, open_entry_side, open_global_container};
use serde_json::Value;
use session::with_session;
use settings::{
    effective_library_root, ensure_active_container, load_settings, save_settings,
    ScanExtraRoot, DEFAULT_LIBRARY_ROOT,
};
use shell_ops::{open_path, pick_file, pick_folder, reveal_in_folder, save_file};
use snapshot::{
    build_selection_detail, build_snapshot_subset, build_snapshot_subset_ex, AppSnapshotSubset,
    SelectionDetailDto,
};
use backup::{MoveBackupResult, MovePreviewResult, MoveResolution};
use dual_copy::DualCopyTextsResult;
use projects::ProjectOpResult;
use refresh::{RefreshResolution, RefreshResult};
use scan_ingest::{
    ScanConfirmResult, ScanPreviewResult, ScanResolution, ScanRootInput,
};
use tags_purpose::{ApplyPurposeItem, TagsOpResult};
use clear_container::{
    clear_project_skills as clear_project_skills_impl,
    preview_clear_project_skills as preview_clear_project_skills_impl, ClearPreviewResult,
    ClearSkillsResult,
};
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
    let preview = scan_ingest::scan_and_ingest_preview(&settings, None)?;
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

/// 体积过大、全量浅克隆易触发拉取超时的精选源（GitHub `size` 约 ≥100MB）。
/// 合集/框架仓退役后此处为空；探测脚本仍读取该表。
pub const LARGE_PROBE_SOURCE_IDS: &[&str] = &[];

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSourceRow {
    pub id: String,
    pub label: String,
    pub url: String,
    pub large: bool,
    pub skipped: bool,
    pub ok: bool,
    pub entry_count: usize,
    pub elapsed_ms: f64,
    pub error: String,
    pub message: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeSourcesReport {
    pub ok: bool,
    pub work_root: String,
    pub skip_large: bool,
    pub timeout_secs: u64,
    pub rows: Vec<ProbeSourceRow>,
}

fn is_large_probe_id(id: &str) -> bool {
    LARGE_PROBE_SOURCE_IDS
        .iter()
        .any(|k| k.eq_ignore_ascii_case(id.trim()))
}

/// Headless 拉取全部基线+精选源到临时网络根（不碰用户真实库）。
pub fn run_probe_sources(
    work_root: &str,
    only: Option<&str>,
    skip_large: bool,
    timeout_secs: u64,
) -> Result<ProbeSourcesReport, String> {
    use std::time::{Duration, Instant};
    let work = work_root.trim();
    if work.is_empty() {
        return Err("work_root required".into());
    }
    std::fs::create_dir_all(work).map_err(|e| format!("mkdir work_root: {e}"))?;
    let timeout = Duration::from_secs(timeout_secs.max(30));

    let mut catalog: Vec<(String, String, String)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for (id, label, url) in network_library::BASELINE_SOURCES {
        if seen.insert((*id).to_string()) {
            catalog.push(((*id).to_string(), (*label).to_string(), (*url).to_string()));
        }
    }
    for p in network_catalog::POPULAR_SOURCES {
        if seen.insert(p.id.to_string()) {
            catalog.push((p.id.to_string(), p.label.to_string(), p.url.to_string()));
        }
    }

    let only_id = only.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mut rows = Vec::new();
    for (id, label, url) in catalog {
        if let Some(ref want) = only_id {
            if !id.eq_ignore_ascii_case(want) {
                continue;
            }
        }
        let large = is_large_probe_id(&id);
        if skip_large && large {
            rows.push(ProbeSourceRow {
                id,
                label,
                url,
                large,
                skipped: true,
                ok: false,
                entry_count: 0,
                elapsed_ms: 0.0,
                error: String::new(),
                message: "skipped-large".into(),
            });
            continue;
        }

        let case_root = std::path::Path::new(work).join(&id);
        let lib = case_root.join("lib").to_string_lossy().to_string();
        let net = case_root.join("net").to_string_lossy().to_string();
        let _ = std::fs::remove_dir_all(&case_root);
        catalog::ensure_library_layout(&lib)?;
        network_library::ensure_network_layout(&net)?;
        let mut settings = settings::AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };

        eprintln!("probe {id} …");
        let t0 = Instant::now();
        let fetch_id = id.clone();
        let handle = std::thread::spawn(move || {
            network_library::fetch_network_source(&mut settings, &fetch_id, None)
        });
        let outcome = loop {
            if handle.is_finished() {
                break match handle.join() {
                    Ok(r) => r,
                    Err(_) => Err("probe worker panicked".into()),
                };
            }
            if t0.elapsed() >= timeout {
                break Err(format!(
                    "probe timeout after {timeout_secs}s（工作线程仍可能在跑 git）"
                ));
            }
            std::thread::sleep(Duration::from_millis(200));
        };
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let (ok, entry_count, error, message) = match outcome {
            Ok(res) => {
                let n = network_library::load_network_index(&net)
                    .map(|idx| {
                        idx.entries
                            .iter()
                            .filter(|e| e.source_id.eq_ignore_ascii_case(&id))
                            .count()
                    })
                    .unwrap_or(0);
                (res.ok, n, String::new(), res.message)
            }
            Err(e) => (false, 0, e, String::new()),
        };
        eprintln!(
            "probe {id}: ok={ok} entries={entry_count} {:.0}ms {}",
            elapsed_ms,
            if error.is_empty() {
                message.as_str()
            } else {
                error.as_str()
            }
        );
        rows.push(ProbeSourceRow {
            id,
            label,
            url,
            large,
            skipped: false,
            ok,
            entry_count,
            elapsed_ms,
            error,
            message,
        });
    }

    let ok = rows.iter().all(|r| r.skipped || r.ok);
    Ok(ProbeSourcesReport {
        ok,
        work_root: work.to_string(),
        skip_large,
        timeout_secs,
        rows,
    })
}

fn snapshot_now() -> Result<AppSnapshotSubset, String> {
    snapshot_now_ex(false)
}

fn snapshot_now_ex(omit_network_list: bool) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let mut changed = false;
    if workspace::ensure_workspaces_migrated(&mut settings) {
        changed = true;
    }
    if settings::reclaim_ephemeral_permanent_library(&mut settings) {
        changed = true;
    }
    if effective_library_root(&settings).is_some()
        && factory_reset::reconcile_missing_catalog(&mut settings)?
    {
        // reconcile 内部已 save
        changed = false;
    }
    // 未配置永久库时不落盘：save_settings 要求已配置库，否则首启 getSnapshot 会被工作区内存迁移打挂
    if changed && effective_library_root(&settings).is_some() {
        save_settings(&settings)?;
    }
    let Some(root) = effective_library_root(&settings) else {
        let empty = catalog::CatalogLoadResult {
            catalog: catalog::empty_catalog(),
            healthy: true,
            error: None,
        };
        return Ok(build_snapshot_subset_ex(
            &settings,
            &empty,
            vec![],
            omit_network_list,
        ));
    };
    let load = load_catalog(&root);
    let warnings = if load.healthy {
        validate_entry_paths(&root, &load.catalog.entries)
    } else {
        vec![]
    };
    Ok(build_snapshot_subset_ex(
        &settings,
        &load,
        warnings,
        omit_network_list,
    ))
}

/// Light snapshot after workspace-eye mutations: reuse in-memory settings and skip
/// rebuilding the network library list (frontend merges previous list).
fn snapshot_now_light(settings: &settings::AppSettings) -> Result<AppSnapshotSubset, String> {
    let Some(root) = effective_library_root(settings) else {
        let empty = catalog::CatalogLoadResult {
            catalog: catalog::empty_catalog(),
            healthy: true,
            error: None,
        };
        return Ok(build_snapshot_subset_ex(settings, &empty, vec![], true));
    };
    let load = load_catalog(&root);
    let warnings = if load.healthy {
        validate_entry_paths(&root, &load.catalog.entries)
    } else {
        vec![]
    };
    Ok(build_snapshot_subset_ex(settings, &load, warnings, true))
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
    } else {
        let _ = settings::reclaim_ephemeral_permanent_library(&mut settings);
    }
    // 手删 catalog 时先级联回厂（写空台账），再 ensure_library_layout
    let _ = factory_reset::reconcile_missing_catalog(&mut settings)?;
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    let root = settings.skills_library_root.clone();
    ensure_library_layout(&root)?;
    let _ = rule_layout::upgrade_flat_rules_in_library(&root);
    // Plan/03: also ensure network library root exists (isolated)
    let _ = network_library::ensure_default_network_library(&mut settings);
    snapshot_now()
}

#[tauri::command]
fn get_snapshot(omit_network_list: Option<bool>) -> Result<AppSnapshotSubset, String> {
    snapshot_now_ex(omit_network_list.unwrap_or(false))
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
    settings.last_stable_library_root = root.clone();
    network_library::sync_coupled_network_root(&mut settings)?;
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    ensure_library_layout(&root)?;
    let _ = rule_layout::upgrade_flat_rules_in_library(&root);
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
fn fetch_network_source(
    url_or_baseline_id: String,
    label: Option<String>,
) -> Result<network_library::NetworkOpResult, String> {
    let mut settings = load_settings()?;
    network_library::fetch_network_source(
        &mut settings,
        &url_or_baseline_id,
        label.as_deref(),
    )
}

#[tauri::command]
fn check_network_updates() -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    let _ = network_p2::refresh_network_heat(&settings);
    let settings = load_settings().unwrap_or(settings);
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
    force_security_override: Option<bool>,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    let res = resolutions.unwrap_or_default();
    network_library::promote_network_to_library(
        &settings,
        &entry_ids,
        &res,
        force_security_override.unwrap_or(false),
    )
}

#[tauri::command]
fn set_network_pin(
    section: String,
    id: String,
    pinned: bool,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::set_network_pin(&mut settings, &section, &id, pinned)
}

#[tauri::command]
fn set_network_popular_visible_limit(limit: u32) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::set_network_popular_visible_limit(&mut settings, limit)
}

#[tauri::command]
fn set_network_popular_sort(mode: String) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::set_network_popular_sort(&mut settings, &mode)
}

#[tauri::command]
fn set_network_popular_visibility_all(
    show: bool,
    scope: Option<String>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::set_network_popular_visibility_all(
        &mut settings,
        show,
        scope.as_deref(),
    )
}

#[tauri::command]
fn set_network_intended_level(
    entry_ids: Vec<String>,
    level: String,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    network_library::set_network_intended_level(&settings, &entry_ids, &level)
}

#[tauri::command]
fn start_network_fetch(
    app: tauri::AppHandle,
    kind: Option<String>,
    id: Option<String>,
    url_or_baseline_id: Option<String>,
    label: Option<String>,
) -> Result<network_fetch_job::StartNetworkFetchResult, String> {
    network_fetch_job::start_network_fetch(app, kind, id, url_or_baseline_id, label)
}

#[tauri::command]
fn cancel_network_fetch(job_id: String) -> Result<(), String> {
    network_fetch_job::cancel_network_fetch(&job_id)
}

#[tauri::command]
fn open_network_entry_dir(entry_id: String) -> Result<(), String> {
    let settings = load_settings()?;
    network_library::open_network_entry_dir(&settings, &entry_id)
}

#[tauri::command]
fn open_network_source_cache_dir(source_id: String) -> Result<(), String> {
    let settings = load_settings()?;
    network_library::open_network_source_cache_dir(&settings, &source_id)
}

#[tauri::command]
fn remove_network_user_source(
    source_id: String,
) -> Result<network_library::NetworkOpResult, String> {
    let mut settings = load_settings()?;
    network_library::remove_network_user_source(&mut settings, &source_id)
}

#[tauri::command]
fn reapply_network_customization(
    entry_id: String,
    network_entry_id: String,
    mode: String,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    network_library::reapply_network_customization(
        &settings,
        &entry_id,
        &network_entry_id,
        &mode,
    )
}

/// 「定制与操作记录」对话框载荷：当前定制 diff + 级别 + 操作事件。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryOperationLogDto {
    entry_id: String,
    network_entry_id: String,
    source_id: String,
    level: String,
    has_customization: bool,
    unified_diff: String,
    baseline_hash: String,
    custom_hash: String,
    updated_at: String,
    events: Vec<oplog::OpEvent>,
}

#[tauri::command]
fn get_entry_operation_log(entry_id: String) -> Result<EntryOperationLogDto, String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim().to_string();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库".into());
    }
    let raw = entry_id.trim().to_string();
    if raw.is_empty() {
        return Err("entryId 为空".into());
    }
    let load = catalog::load_catalog(&lib);
    // net: id → 经晋升映射找本地条目；本地 id → 经 provenance 反查网络条目
    let (local_id, network_id) = if network_library::is_network_entry_id(&raw) {
        let map = network_library::promoted_network_map(&settings);
        let local = map.get(&raw).map(|(id, _)| id.clone()).unwrap_or_default();
        (local, raw)
    } else {
        let net = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == raw)
            .and_then(network_customization::get_provenance)
            .map(|p| p.network_entry_id)
            .unwrap_or_default();
        (raw, net)
    };
    let local_entry = load.catalog.entries.iter().find(|e| e.id == local_id);
    let source_id = local_entry
        .and_then(network_customization::get_provenance)
        .map(|p| p.source_id)
        .unwrap_or_default();
    let level = local_entry
        .map(|e| catalog::get_entry_tags(e).level.unwrap_or_default())
        .unwrap_or_default();
    let rec = if local_id.is_empty() {
        None
    } else {
        network_customization::load_customization(&lib, &local_id)
    };
    let events = oplog::read_for_entry(&lib, &local_id, &network_id, &source_id);
    let (unified_diff, baseline_hash, custom_hash, updated_at) = rec
        .map(|r| (r.unified_diff, r.baseline_hash, r.custom_hash, r.updated_at))
        .unwrap_or_default();
    Ok(EntryOperationLogDto {
        entry_id: local_id,
        network_entry_id: network_id,
        source_id,
        level,
        has_customization: !unified_diff.trim().is_empty(),
        unified_diff,
        baseline_hash,
        custom_hash,
        updated_at,
        events,
    })
}

#[tauri::command]
fn cleanup_network_cache(
    unused_only: Option<bool>,
) -> Result<network_library::NetworkOpResult, String> {
    let settings = load_settings()?;
    network_p2::cleanup_network_cache(&settings, unused_only.unwrap_or(true))
}

#[tauri::command]
fn update_app_settings(
    backup_root: Option<String>,
    project_scan_roots: Option<Vec<String>>,
    project_scan_max_depth: Option<i32>,
    auto_scan_projects_on_startup: Option<bool>,
    network_update_check_interval_minutes: Option<i32>,
    network_git_http_proxy: Option<String>,
    network_fetch_concurrency: Option<u32>,
    scan_skip_workspace_ids: Option<Vec<String>>,
    scan_extra_roots: Option<Vec<ScanExtraRoot>>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    if let Some(b) = backup_root {
        settings.backup_root = project_discovery::to_display_path(b.trim());
    }
    if let Some(mins) = network_update_check_interval_minutes {
        settings.network_update_check_interval_minutes = mins.max(0);
    }
    if let Some(proxy) = network_git_http_proxy {
        settings.network_git_http_proxy = proxy.trim().to_string();
    }
    if let Some(n) = network_fetch_concurrency {
        settings.network_fetch_concurrency =
            settings::clamp_network_fetch_concurrency(n);
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
    if let Some(ids) = scan_skip_workspace_ids {
        let mut cleaned = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            let t = id.trim().to_ascii_lowercase();
            if t.is_empty() || !seen.insert(t.clone()) {
                continue;
            }
            cleaned.push(t);
        }
        settings.scan_skip_workspace_ids = cleaned;
    }
    if let Some(roots) = scan_extra_roots {
        let mut cleaned = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for r in roots {
            let d = project_discovery::to_display_path(r.path.trim());
            if d.is_empty() {
                continue;
            }
            let key = project_discovery::normalize_path(&d);
            if !seen.insert(key) {
                continue;
            }
            let tool = r.tool.trim();
            cleaned.push(ScanExtraRoot {
                path: d,
                tool: if tool.is_empty() {
                    "cursor".into()
                } else {
                    tool.to_string()
                },
            });
        }
        settings.scan_extra_roots = cleaned;
    }
    save_settings(&settings)?;
    snapshot_now()
}

#[tauri::command]
fn reset_catalog(delete_network_cache: Option<bool>) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let lib = settings.skills_library_root.trim().to_string();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    let _ = catalog_backup::push_catalog_backup(&lib)?;
    factory_reset::reset_library_to_clean_test_state(
        &mut settings,
        delete_network_cache.unwrap_or(true),
    )?;
    with_session(|s| s.selected_entry_ids.clear());
    // 直接出快照，避免 snapshot_now 把 Temp 测试库回收到真实 C:\CursorSkills
    let load = load_catalog(&lib);
    let warnings = if load.healthy {
        validate_entry_paths(&lib, &load.catalog.entries)
    } else {
        vec![]
    };
    Ok(build_snapshot_subset(&settings, &load, warnings))
}

#[tauri::command]
fn export_catalog(path: String) -> Result<(), String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    catalog_backup::export_catalog_to_path(lib, &path)
}

#[tauri::command]
fn import_catalog(path: String) -> Result<AppSnapshotSubset, String> {
    let settings = load_settings()?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库目录".into());
    }
    catalog_backup::import_catalog_from_path(lib, &path)?;
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
    // 侧栏点行热路径：省略网络列表重建（前端 mergeNavOnlySnapshot 回填）
    snapshot_now_light(&settings)
}

#[tauri::command]
fn set_default_workspace(id: String) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    let Some(nid) = workspace::normalize_workspace_id(&id) else {
        return Err("未知工作区".into());
    };
    let member = settings
        .workspaces
        .iter()
        .find(|w| w.id == nid)
        .map(|w| (w.enabled, w.in_work_area))
        .unwrap_or((false, false));
    if !member.0 || !member.1 {
        return Err("只能将工作区域中已启用的工作区设为默认".into());
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
    snapshot_now_light(&settings)
}

#[tauri::command]
fn update_workspace_config(
    id: String,
    enabled: Option<bool>,
    display_name: Option<String>,
    container_root: Option<String>,
    in_work_area: Option<bool>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let Some(nid) = workspace::normalize_workspace_id(&id) else {
        return Err("未知工作区".into());
    };
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    if let Some(false) = in_work_area {
        let currently_in = settings
            .workspaces
            .iter()
            .find(|w| w.id.eq_ignore_ascii_case(nid))
            .map(|w| w.in_work_area)
            .unwrap_or(false);
        if currently_in {
            let others = settings
                .workspaces
                .iter()
                .filter(|w| {
                    w.enabled && w.in_work_area && !w.id.eq_ignore_ascii_case(nid)
                })
                .count();
            if others == 0 {
                return Err("至少保留一个工作区显示，不能关闭最后一个".into());
            }
            // 关掉当前默认时，自动把默认挪到仍在工作区域的另一个槽
            if settings.default_workspace_id.eq_ignore_ascii_case(nid) {
                if let Some(fallback) = settings.workspaces.iter().find(|w| {
                    w.enabled && w.in_work_area && !w.id.eq_ignore_ascii_case(nid)
                }) {
                    settings.default_workspace_id = fallback.id.clone();
                }
            }
        }
    }
    {
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
        if let Some(in_wa) = in_work_area {
            w.in_work_area = in_wa;
        }
    }
    if let Some(in_wa) = in_work_area {
        if in_wa {
            if !settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case(nid))
            {
                settings.visible_workspace_ids.push(nid.into());
            }
        } else {
            settings
                .visible_workspace_ids
                .retain(|v| !v.eq_ignore_ascii_case(nid));
        }
    }
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    save_settings(&settings)?;
    snapshot_now_light(&settings)
}

/// Bulk eye open/close for workspaces: one save + one light snapshot.
#[tauri::command]
fn set_workspaces_in_work_area(
    ids: Vec<String>,
    in_work_area: bool,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let _ = workspace::ensure_workspaces_migrated(&mut settings);
    workspace::set_many_in_work_area(&mut settings, &ids, in_work_area)?;
    save_settings(&settings)?;
    snapshot_now_light(&settings)
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
    }
    save_settings(&settings)?;
    snapshot_now_light(&settings)
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
    // 打开文档路径：轻快照带 detail，省略数千条网络列表 DTO 的重建与序列化
    let settings = load_settings()?;
    snapshot_now_light(&settings)
}

/// H6 点选轻路径：写会话选中集，只回传选中相关的详情子集（不重建全量快照，
/// 前端与上一帧快照合并）。与 set_selection 一样仅改内存会话，不写 settings。
#[tauri::command]
fn set_selection_detail(
    entry_ids: Vec<String>,
    detail_path_side: Option<String>,
) -> Result<SelectionDetailDto, String> {
    with_session(|s| {
        s.selected_entry_ids = entry_ids;
        if let Some(side) = detail_path_side {
            if side == "container" || side == "library" {
                s.detail_path_side = side;
            }
        }
    });
    let settings = load_settings()?;
    let load = match effective_library_root(&settings) {
        Some(root) => load_catalog(&root),
        None => catalog::CatalogLoadResult {
            catalog: catalog::empty_catalog(),
            healthy: true,
            error: None,
        },
    };
    Ok(build_selection_detail(&settings, &load))
}

/// 勾选类轻操作：只写会话选中集，不构建快照（网络列表点行/全选提速）。
#[tauri::command]
fn set_selection_light(entry_ids: Vec<String>, detail_path_side: Option<String>) {
    with_session(|s| {
        s.selected_entry_ids = entry_ids;
        if let Some(side) = detail_path_side {
            if side == "container" || side == "library" {
                s.detail_path_side = side;
            }
        }
    });
}

#[tauri::command]
fn set_detail_mode(mode: String) -> Result<AppSnapshotSubset, String> {
    with_session(|s| {
        s.detail_pane_mode = mode;
    });
    let settings = load_settings()?;
    snapshot_now_light(&settings)
}

#[tauri::command]
fn set_cluster_mode(index: i32) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    settings.cluster_mode_index = index.clamp(0, 2);
    save_settings(&settings)?;
    snapshot_now_light(&settings)
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
    snapshot_now_light(&settings)
}

#[tauri::command]
fn deploy(
    entry_ids: Vec<String>,
    workspace_ids: Option<Vec<String>>,
    project_ids: Option<Vec<String>>,
) -> Result<DeployResult, String> {
    if entry_ids
        .iter()
        .any(|id| network_library::is_network_entry_id(id))
    {
        return Err("网络库条目不可直接部署到容器；请先「存入永久库」".into());
    }
    let projects = project_ids
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    if !projects.is_empty() {
        let settings = load_settings()?;
        return deploy_entries_to_projects(&settings, &entry_ids, &projects);
    }
    let mut settings = load_settings()?;
    ensure_active_container(&mut settings)?;
    save_settings(&settings)?;
    let targets = workspace_ids.unwrap_or_default();
    if targets.is_empty() {
        deploy_entries(&settings, &entry_ids)
    } else {
        deploy_entries_to_workspaces(&settings, &entry_ids, &targets)
    }
}

/// Plan/04 Should：更新项目侧可见工具与可选容器根覆盖。
#[tauri::command]
fn update_project_tools(
    id: String,
    visible_tools: Vec<String>,
    tool_container_roots: Option<std::collections::HashMap<String, String>>,
) -> Result<projects::ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::update_project_tools(&settings, id, visible_tools, tool_container_roots)
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
fn preview_clear_project_skills(project_ids: Vec<String>) -> Result<ClearPreviewResult, String> {
    let settings = load_settings()?;
    preview_clear_project_skills_impl(&settings, &project_ids)
}

#[tauri::command]
fn clear_project_skills(
    project_ids: Vec<String>,
    resolutions: Option<Vec<ConflictResolution>>,
) -> Result<ClearSkillsResult, String> {
    let settings = load_settings()?;
    clear_project_skills_impl(
        &settings,
        &project_ids,
        resolutions.as_deref().unwrap_or(&[]),
    )
}

#[tauri::command]
fn purge_missing_entries(entry_ids: Vec<String>) -> Result<ManageResult, String> {
    let settings = load_settings()?;
    purge_missing(&settings, &entry_ids)
}

#[tauri::command]
fn scan_and_ingest_preview(
    roots: Option<Vec<ScanRootInput>>,
) -> Result<ScanPreviewResult, String> {
    let settings = load_settings()?;
    scan_ingest::scan_and_ingest_preview(&settings, roots.as_deref())
}

#[tauri::command]
fn confirm_scan_build(
    selected_keys: Option<Vec<String>>,
    resolutions: Option<Vec<ScanResolution>>,
) -> Result<ScanConfirmResult, String> {
    let mut settings = load_settings()?;
    let before_vis = settings.visible_workspace_ids.clone();
    let before_ws = settings.workspaces.clone();
    let result = scan_ingest::confirm_scan_build(
        &mut settings,
        selected_keys.as_deref().unwrap_or(&[]),
        resolutions.as_deref().unwrap_or(&[]),
    )?;
    if settings.visible_workspace_ids != before_vis || settings.workspaces != before_ws {
        save_settings(&settings)?;
    }
    Ok(result)
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
fn reorder_project(
    id: String,
    direction: Option<String>,
    to_index: Option<usize>,
) -> Result<ProjectOpResult, String> {
    let settings = load_settings()?;
    projects::reorder_project_cmd(
        &settings,
        id,
        direction.unwrap_or_default(),
        to_index,
    )
}

#[tauri::command]
fn reorder_workspace(
    id: String,
    direction: Option<String>,
    to_index: Option<usize>,
    peer_ids: Option<Vec<String>>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    workspace::reorder_workspace_nav(
        &mut settings,
        &id,
        direction.as_deref(),
        to_index,
        peer_ids,
    )?;
    save_settings(&settings)?;
    snapshot_now_light(&settings)
}

#[tauri::command]
fn reorder_library_entry(
    entry_id: String,
    region_key: String,
    direction: Option<String>,
    to_index: Option<usize>,
) -> Result<tags_purpose::TagsOpResult, String> {
    let settings = load_settings()?;
    tags_purpose::reorder_library_entry(
        &settings,
        &entry_id,
        &region_key,
        direction.as_deref(),
        to_index,
    )
}

#[tauri::command]
fn reorder_network_nav(
    section: String,
    id: String,
    direction: Option<String>,
    to_index: Option<usize>,
    target_pinned: Option<bool>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    network_library::reorder_network_nav(
        &mut settings,
        &section,
        &id,
        direction.as_deref(),
        to_index,
        target_pinned,
    )
}

#[tauri::command]
fn reorder_network_list_item(
    entry_id: String,
    direction: Option<String>,
    to_index: Option<usize>,
    visible_ids: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let settings = load_settings()?;
    let order = network_library::reorder_network_list_item(
        &settings,
        &entry_id,
        direction.as_deref(),
        to_index,
        visible_ids,
    )?;
    Ok(serde_json::json!({ "ok": true, "order": order, "snapshot": snapshot_now()? }))
}

#[tauri::command]
fn reorder_project_scan_roots(
    path: String,
    direction: Option<String>,
    to_index: Option<usize>,
) -> Result<AppSnapshotSubset, String> {
    let mut settings = load_settings()?;
    let defaults = crate::project_discovery::get_default_scan_roots();
    let default_keys: Vec<String> = defaults
        .iter()
        .map(|p| p.replace('/', "\\").trim_end_matches('\\').to_lowercase())
        .collect();
    let mut custom: Vec<String> = settings
        .project_scan_roots
        .iter()
        .filter(|p| {
            let k = p.replace('/', "\\").trim_end_matches('\\').to_lowercase();
            !default_keys.iter().any(|d| d == &k)
        })
        .cloned()
        .collect();
    if custom.is_empty() {
        return Err("没有可重排的自定义扫描根".into());
    }
    crate::list_order::reorder_ids(&mut custom, &path, direction.as_deref(), to_index)?;
    let enabled_defaults: Vec<String> = settings
        .project_scan_roots
        .iter()
        .filter(|p| {
            let k = p.replace('/', "\\").trim_end_matches('\\').to_lowercase();
            default_keys.iter().any(|d| d == &k)
        })
        .cloned()
        .collect();
    settings.project_scan_roots = enabled_defaults.into_iter().chain(custom).collect();
    save_settings(&settings)?;
    snapshot_now()
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
fn open_project_cursor(id: String) -> Result<(), String> {
    let settings = load_settings()?;
    projects::open_project_cursor(&settings, id)
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ping,
            ensure_default_library,
            get_snapshot,
            choose_library_root,
            ensure_default_network_library,
            choose_network_library_root,
            fetch_network_source,
            check_network_updates,
            apply_network_cache_update,
            promote_network_to_library,
            set_network_pin,
            set_network_popular_visible_limit,
            set_network_popular_sort,
            set_network_popular_visibility_all,
            set_network_intended_level,
            start_network_fetch,
            cancel_network_fetch,
            open_network_entry_dir,
            open_network_source_cache_dir,
            remove_network_user_source,
            reapply_network_customization,
            get_entry_operation_log,
            cleanup_network_cache,
            update_app_settings,
            reset_catalog,
            export_catalog,
            import_catalog,
            list_catalog_backups,
            restore_catalog_backup,
            set_nav,
            set_default_workspace,
            update_workspace_config,
            set_workspaces_in_work_area,
            set_filters,
            set_selection,
            set_selection_detail,
            set_selection_light,
            set_detail_mode,
            set_cluster_mode,
            set_ui_layout,
            deploy,
            withdraw,
            withdraw_batch,
            preview_clear_project_skills,
            clear_project_skills,
            purge_missing_entries,
            scan_and_ingest_preview,
            confirm_scan_build,
            create_project_container,
            edit_project,
            update_project_tools,
            toggle_pin_project,
            reorder_project,
            reorder_workspace,
            reorder_library_entry,
            reorder_network_nav,
            reorder_network_list_item,
            reorder_project_scan_roots,
            inspect_project_for_delete,
            remove_project,
            open_project_cursor,
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
            read_library_text,
            save_library_file,
            save_detail_markdown,
            pick_folder,
            pick_file,
            save_file,
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
        // 库放 APPDATA 下，避免 Temp\.tmp 被 reclaim 切到真实 C:\CursorSkills
        let lib_root = {
            let base = std::env::temp_dir().join(format!(
                "ccm-p1-lib-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let root = base.join("test-library");
            std::fs::create_dir_all(&root).unwrap();
            root.to_string_lossy().to_string()
        };
        let lib = std::path::PathBuf::from(&lib_root);
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            last_stable_library_root: lib_root.clone(),
            ..AppSettings::default()
        };
        ensure_active_container(&mut settings).unwrap();
        save_settings(&settings).unwrap();
        ensure_library_layout(&lib_root).unwrap();

        let snap_empty = get_snapshot(None).unwrap();
        assert!(snap_empty.is_library_configured);
        let light = get_snapshot(Some(true)).unwrap();
        assert!(light.omit_network_library_list);
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
      "libraryPath": "skills/fixture-a",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    }},
    {{
      "id": "fixture-b",
      "kind": "rule",
      "libraryPath": "rules/fixture-b/fixture-b.mdc",
      "isInLibrary": true,
      "deployedPath": "",
      "isMissing": false
    }}
  ]
}}"#
        );
        fs::write(lib.join("catalog.json"), fake).unwrap();
        fs::create_dir_all(lib.join("skills/fixture-a")).unwrap();
        fs::write(lib.join("skills/fixture-a/SKILL.md"), b"# a\n").unwrap();
        fs::create_dir_all(lib.join("rules/fixture-b")).unwrap();
        fs::write(lib.join("rules/fixture-b/fixture-b.mdc"), b"# b\n").unwrap();

        let snap = get_snapshot(None).unwrap();
        assert!(snap.catalog_healthy);
        assert_eq!(snap.in_library_other_items.len(), 2);
        let skill = snap
            .in_library_other_items
            .iter()
            .find(|e| e.entry_id == "fixture-a")
            .expect("skill fixture-a");
        assert!(snap
            .in_library_other_items
            .iter()
            .any(|e| e.entry_id == "fixture-b"));
        assert_eq!(skill.kind_label, "技能");
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
        let lib_root = {
            let base = std::env::temp_dir().join(format!(
                "ccm-p1-lib-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let root = base.join("test-library");
            std::fs::create_dir_all(&root).unwrap();
            root.to_string_lossy().to_string()
        };
        let scan = tempfile::tempdir().unwrap();
        let extra = tempfile::tempdir().unwrap();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            last_stable_library_root: lib_root,
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
            None,
            None,
            None,
            Some(vec!["claude".into(), " Claude ".into()]),
            Some(vec![ScanExtraRoot {
                path: extra.path().to_string_lossy().to_string(),
                tool: String::new(),
            }]),
        )
        .unwrap();

        assert_eq!(snap.project_scan_max_depth, 7);
        assert!(snap.auto_scan_projects_on_startup);
        assert_eq!(snap.project_scan_roots.len(), 1);
        assert!(!snap.project_scan_roots[0].starts_with(r"\\?\"));
        assert!(snap.disabled_storage_display.contains("cursorBf-test"));
        assert_eq!(snap.scan_skip_workspace_ids, vec!["claude".to_string()]);
        assert_eq!(snap.scan_extra_roots.len(), 1);
        assert_eq!(snap.scan_extra_roots[0].tool, "cursor");

        settings = load_settings().unwrap();
        assert_eq!(settings.project_scan_max_depth, 7);
        assert!(settings.auto_scan_projects_on_startup);
        assert_eq!(settings.project_scan_roots.len(), 1);
        assert_eq!(settings.backup_root, r"E:\cursorBf-test");
        assert_eq!(settings.scan_skip_workspace_ids, vec!["claude".to_string()]);
        assert_eq!(settings.scan_extra_roots.len(), 1);
        assert_eq!(settings.scan_extra_roots[0].tool, "cursor");

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn reset_catalog_backs_up_and_clears_entries() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let lib_root = {
            let base = std::env::temp_dir().join(format!(
                "ccm-p1-lib-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let root = base.join("test-library");
            std::fs::create_dir_all(&root).unwrap();
            root.to_string_lossy().to_string()
        };
        let lib = std::path::PathBuf::from(&lib_root);
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            last_stable_library_root: lib_root.clone(),
            ..AppSettings::default()
        };
        save_settings(&settings).unwrap();
        ensure_library_layout(&lib_root).unwrap();
        fs::write(
            lib.join("catalog.json"),
            r#"{"version":2,"projects":[],"entries":[{"id":"x","kind":"skill","libraryPath":"skills/x/SKILL.md","isInLibrary":true,"deployedPath":"","isMissing":false}]}"#,
        )
        .unwrap();

        let snap = reset_catalog(None).unwrap();
        let load = catalog::load_catalog(&lib_root);
        assert!(load.healthy, "catalog should be healthy after reset");
        assert!(
            load.catalog.entries.is_empty(),
            "catalog entries should be empty, got {}",
            load.catalog.entries.len()
        );
        assert!(
            snap.in_library_other_items.is_empty(),
            "expected empty library list, got {} items: {:?}",
            snap.in_library_other_items.len(),
            snap.in_library_other_items
                .iter()
                .map(|i| i.entry_id.clone())
                .collect::<Vec<_>>()
        );
        assert!(snap.catalog_healthy);

        let bak_count = catalog_backup::list_catalog_backups(&lib_root)
            .unwrap()
            .len();
        assert!(bak_count >= 1, "expected ring backup");

        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    fn with_temp_library_settings() -> (tempfile::TempDir, String) {
        let appdata = tempfile::tempdir().unwrap();
        let lib_root = {
            let base = std::env::temp_dir().join(format!(
                "ccm-ws-eye-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            let root = base.join("test-library");
            std::fs::create_dir_all(&root).unwrap();
            root.to_string_lossy().to_string()
        };
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }
        let mut settings = AppSettings {
            skills_library_root: lib_root.clone(),
            library_root_configured: true,
            last_stable_library_root: lib_root.clone(),
            ..AppSettings::default()
        };
        let _ = workspace::ensure_workspaces_migrated(&mut settings);
        for id in ["cursor", "claude", "codex"] {
            if let Some(w) = settings.workspaces.iter_mut().find(|w| w.id == id) {
                w.in_work_area = true;
                w.enabled = true;
            }
        }
        settings.visible_workspace_ids =
            vec!["cursor".into(), "claude".into(), "codex".into()];
        settings.default_workspace_id = "cursor".into();
        ensure_active_container(&mut settings).unwrap();
        save_settings(&settings).unwrap();
        ensure_library_layout(&lib_root).unwrap();
        (appdata, lib_root)
    }

    #[test]
    fn update_workspace_config_returns_omit_network_list_sentinel() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let (_appdata, _lib) = with_temp_library_settings();
        let snap = update_workspace_config(
            "claude".into(),
            Some(true),
            None,
            None,
            Some(true),
        )
        .unwrap();
        assert!(snap.omit_network_library_list);
        assert_eq!(
            snap.network_library_summary,
            snapshot::OMIT_NETWORK_LIST_SUMMARY
        );
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn set_workspaces_in_work_area_bulk_and_sentinel() {
        let _guard = APPDATA_LOCK.lock().unwrap();
        let (_appdata, _lib) = with_temp_library_settings();
        let snap =
            set_workspaces_in_work_area(vec!["claude".into(), "codex".into()], false).unwrap();
        assert!(snap.omit_network_library_list);
        assert_eq!(
            snap.network_library_summary,
            snapshot::OMIT_NETWORK_LIST_SUMMARY
        );
        let settings = load_settings().unwrap();
        assert!(!settings
            .workspaces
            .iter()
            .find(|w| w.id == "claude")
            .unwrap()
            .in_work_area);
        assert!(!settings
            .workspaces
            .iter()
            .find(|w| w.id == "codex")
            .unwrap()
            .in_work_area);
        assert!(settings
            .workspaces
            .iter()
            .find(|w| w.id == "cursor")
            .unwrap()
            .in_work_area);
        let err = set_workspaces_in_work_area(vec!["cursor".into()], false).unwrap_err();
        assert!(err.contains("至少保留一个"), "{err}");
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }
}
