//! AppSnapshot builder — enough for full App.tsx list/nav/commands (M3 domain 2).

use serde::Serialize;
use serde_json::json;
use std::path::Path;

use crate::catalog::{get_entry_tags, kind_label, CatalogEntry, CatalogLoadResult};
use crate::list_cluster::effective_level;
use crate::path_guard::resolve_library_safe_path;
use crate::session::with_session;
use crate::settings::AppSettings;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListItemDto {
    pub entry_id: String,
    pub display_name: String,
    pub group_name: String,
    pub library_path_rel: Option<String>,
    pub kind_label: String,
    pub subtitle: String,
    pub is_in_container_list: bool,
    pub is_in_active_use: bool,
    pub search_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope_key: Option<String>,
    /// Network quarantine row metadata (local library rows leave these unset).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heat_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub intended_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_level: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_available: Option<bool>,
    /// Network row: entry description (index summary), shown as its own column.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Network row: local catalog entry id when already promoted (via provenance).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promoted_entry_id: Option<String>,
    /// Network row: promoted entry has a non-empty customization diff.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_customization: Option<bool>,
    /// Workspace tool ids from catalog origins (for source icons in permanent library).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub origin_tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub enabled: bool,
    /// Work-area member (sidebar candidate); false = backup tool pool only.
    pub in_work_area: bool,
    pub display_name: String,
    pub container_root: String,
    pub is_default: bool,
    pub is_visible: bool,
    pub is_focused: bool,
    /// Derived: default workspace → copy; other work-area slots → symlink.
    pub deploy_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanExtraRootDto {
    pub path: String,
    pub tool: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContainerSectionDto {
    pub workspace_id: String,
    pub display_name: String,
    pub container_root_display: String,
    pub is_focused: bool,
    pub in_container_items: Vec<LibraryListItemDto>,
    pub in_container_header: String,
    pub in_container_summary: String,
    pub history_items: Vec<LibraryListItemDto>,
    pub history_header: String,
    pub history_summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshotSubset {
    pub is_library_configured: bool,
    pub library_root_display: String,
    pub disabled_storage_display: String,
    pub status_text: String,
    pub active_container_path_display: String,
    pub nav_nodes: Vec<serde_json::Value>,
    pub selected_nav_kind: String,
    pub selected_project_id: Option<String>,
    pub selected_global_tool: String,
    /// Plan/04 focus workspace display name (deploy target label).
    pub focus_workspace_display_name: String,
    pub default_workspace_id: String,
    pub visible_workspace_ids: Vec<String>,
    pub workspaces: Vec<WorkspaceDto>,
    /// Plan/04 multi container/history sections (global visible workspaces, or one project section).
    pub visible_container_sections: Vec<WorkspaceContainerSectionDto>,
    pub projects: Vec<serde_json::Value>,
    pub filter_show_skills: bool,
    pub filter_show_rules: bool,
    pub filter_show_agents: bool,
    pub filter_show_commands: bool,
    pub filter_show_hooks: bool,
    pub purpose_domain_filter_index: i32,
    pub cluster_mode_index: i32,
    pub cluster_mode_options: Vec<String>,
    pub show_user_rules_settings_hint: bool,
    pub user_rules_settings_hint_text: String,
    pub in_container_items: Vec<LibraryListItemDto>,
    pub in_library_items: Vec<LibraryListItemDto>,
    pub in_library_other_items: Vec<LibraryListItemDto>,
    pub missing_items: Vec<LibraryListItemDto>,
    pub permanent_library_roots: Vec<serde_json::Value>,
    /// Plan/03 network library (quarantine cache) list items.
    pub network_library_items: Vec<LibraryListItemDto>,
    pub network_library_summary: String,
    pub network_library_header: String,
    /// When true, `network_library_items` were skipped; frontend must keep previous list.
    pub omit_network_library_list: bool,
    /// 读取 network-index 失败时的错误文案；有则前端应警示而非当「无条目」。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub network_index_error: Option<String>,
    pub is_network_library_configured: bool,
    pub network_library_root_display: String,
    pub network_official_nav: Vec<crate::network_catalog::NetworkNavNodeDto>,
    pub network_popular_nav: Vec<crate::network_catalog::NetworkNavNodeDto>,
    /// stars | custom
    pub network_popular_sort: String,
    /// 社区候选池数量 N（与 pinned 开眼正交）
    pub network_popular_visible_limit: u32,
    /// 0 = off; minutes between check-only updates.
    pub network_update_check_interval_minutes: i32,
    /// Git / gh HTTP(S) proxy URL for network fetch (empty = env / system proxy).
    pub network_git_http_proxy: String,
    /// 网络库同时 git 拉取路数（1..=8，默认 3）。
    pub network_fetch_concurrency: u32,
    pub in_container_summary: String,
    pub in_library_summary: String,
    pub in_library_own_summary: String,
    pub in_library_other_summary: String,
    pub in_library_own_header: String,
    pub in_library_other_header: String,
    pub missing_summary: String,
    pub missing_section_visible: bool,
    pub selected_entry_ids: Vec<String>,
    pub selection_summary: String,
    pub detail_pane_mode: String,
    pub detail_summary_text: String,
    pub detail_markdown_text: String,
    pub detail_rendered_markdown: String,
    pub detail_source_path_display: String,
    pub detail_markdown_file_path: String,
    pub detail_path_side: String,
    pub is_scanning_projects: bool,
    pub cancel_or_restore_button_text: String,
    pub cancel_or_restore_button_tool_tip: String,
    pub auto_scan_projects_on_startup: bool,
    pub project_scan_roots: Vec<String>,
    pub project_scan_max_depth: i32,
    /// 本机存在的默认扫描盘符（UI 固定层，不可删）。
    pub default_project_scan_roots: Vec<String>,
    /// 扫描建库跳过的工作区 id（空＝全扫）。
    pub scan_skip_workspace_ids: Vec<String>,
    /// 扫描建库额外目录。
    pub scan_extra_roots: Vec<ScanExtraRootDto>,
    /// 程序设置目录（settings.json 所在）。
    pub app_settings_dir_display: String,
    pub commands: serde_json::Value,
    pub ui_nav_width: i32,
    pub ui_list_width: i32,
    pub ui_nav_visible: bool,
    pub ui_detail_visible: bool,
    pub should_prompt_startup_scan: bool,
    pub catalog_healthy: bool,
    pub catalog_load_error: Option<String>,
    pub path_guard_warnings: Vec<String>,
}

fn kind_allowed(settings: &AppSettings, kind: &str) -> bool {
    match kind {
        "skill" => settings.filter_show_skills,
        "rule" => settings.filter_show_rules,
        "agent" => settings.filter_show_agents,
        "command" => settings.filter_show_commands,
        "hook" => settings.filter_show_hooks,
        _ => true,
    }
}

fn origin_tools_from_entry(e: &CatalogEntry) -> Vec<String> {
    let mut out = Vec::new();
    for o in &e.origins {
        let t = o.tool.trim().to_ascii_lowercase();
        if t.is_empty() || t == "library" || t == "network" || t == "backup" {
            continue;
        }
        if !out.iter().any(|x| x == &t) {
            out.push(t);
        }
    }
    out
}

fn entry_to_list_item(
    e: &CatalogEntry,
    in_container: bool,
    live_path_display: Option<&str>,
) -> LibraryListItemDto {
    let display = if e.id.is_empty() {
        e.library_path.clone()
    } else {
        e.id.clone()
    };
    let deployed = e.deployed_path.trim();
    let tags = get_entry_tags(e);
    // 勿仅凭台账 deployed_path 写「已部署」——以当前活动容器是否有 live 副本为准。
    let has_live = live_path_display
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let place = if in_container || has_live {
        "当前容器"
    } else if deployed.is_empty() {
        "未部署"
    } else {
        "台账有部署路径"
    };
    let path_shown = live_path_display
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(e.library_path.as_str());
    let level_eff = effective_level(e);
    let level = level_eff.as_deref().unwrap_or("");
    let subtitle = if !e.remark_zh.trim().is_empty() {
        let remark = e.remark_zh.trim();
        if !level.is_empty() {
            format!("[{level}] {remark} · {place}")
        } else {
            format!("{remark} · {place}")
        }
    } else if !level.is_empty() {
        format!("[{level}] {path_shown} · {place}")
    } else {
        format!("{path_shown} · {place}")
    };
    LibraryListItemDto {
        entry_id: e.id.clone(),
        display_name: display,
        group_name: kind_label(&e.kind),
        library_path_rel: Some(e.library_path.clone()),
        kind_label: kind_label(&e.kind),
        subtitle,
        is_in_container_list: in_container,
        // 「容器中」绿标仅表示当前活动容器有 live 副本；勿因其它项目的 deployedPath 仍存在而误标。
        is_in_active_use: in_container
            || live_path_display.map(|s| !s.trim().is_empty()).unwrap_or(false),
        search_text: Some(format!(
            "{} {} {} {} {}",
            e.id, e.kind, e.library_path, deployed, e.remark_zh
        )),
        level_key: level_eff.or(tags.level.clone()),
        scope_key: Some(tags.scope),
        source_id: None,
        source_url: None,
        heat_label: None,
        intended_level: None,
        security_level: None,
        update_available: None,
        summary: None,
        promoted_entry_id: None,
        has_customization: None,
        origin_tools: origin_tools_from_entry(e),
    }
}

/// Relative path under container for subtitle (prefer rules/… segment).
fn rel_under_container(abs: &str, container_root: &str) -> String {
    let abs_n = crate::project_discovery::to_display_path(abs);
    let root_n = crate::project_discovery::to_display_path(container_root)
        .trim_end_matches(['/', '\\'])
        .to_string();
    let abs_l = abs_n.replace('/', "\\");
    let root_l = root_n.replace('/', "\\");
    if abs_l.to_lowercase().starts_with(&root_l.to_lowercase()) {
        let rest = abs_l[root_l.len()..].trim_start_matches(['/', '\\']);
        return rest.replace('\\', "/");
    }
    // Fall back: keep rules/… tail if present
    let parts: Vec<&str> = abs_n.split(['/', '\\']).filter(|p| !p.is_empty()).collect();
    if let Some(i) = parts.iter().rposition(|p| p.eq_ignore_ascii_case("rules")) {
        if i + 1 < parts.len() {
            return parts[i..].join("/");
        }
    }
    abs_n
}

fn build_nav(settings: &AppSettings, projects: &[serde_json::Value]) -> Vec<serde_json::Value> {
    use crate::catalog::{list_projects, LibraryCatalog};
    use crate::workspace::{list_backup_pool_workspaces, list_visible_workspaces};

    // 不在此二次 ensure_workspaces_migrated：调用方（snapshot_now）已迁移；
    // 再次 migrate 会把全部 in_work_area PRIMARY 灌进 VisibleWorkspaceIds，破坏「默认只显示焦点」合同。
    let ws_settings = settings;

    let catalog = LibraryCatalog {
        version: 2,
        projects: projects.to_vec(),
        entries: vec![],
    };
    let parsed = list_projects(&catalog);
    let mut pinned = vec![];
    let mut unpinned = vec![];
    if !parsed.is_empty() {
        for p in &parsed {
            let node = json!({
                "name": p.name,
                "kind": "project",
                "projectId": p.id,
                "isExpanded": false,
                "children": []
            });
            if p.pinned {
                pinned.push(node);
            } else {
                unpinned.push(node);
            }
        }
    } else {
        for p in projects {
            let id = p
                .get("id")
                .or_else(|| p.get("Id"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let name = p
                .get("name")
                .or_else(|| p.get("Name"))
                .and_then(|v| v.as_str())
                .unwrap_or(id);
            if id.is_empty() {
                continue;
            }
            let pinned_flag = p
                .get("pinned")
                .or_else(|| p.get("Pinned"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let node = json!({
                "name": name,
                "kind": "project",
                "projectId": id,
                "isExpanded": false,
                "children": []
            });
            if pinned_flag {
                pinned.push(node);
            } else {
                unpinned.push(node);
            }
        }
    }
    let mut global_children: Vec<serde_json::Value> = list_visible_workspaces(&ws_settings)
        .into_iter()
        .map(|w| {
            json!({
                "name": w.display_name,
                "kind": "global",
                "tool": w.id,
                "isExpanded": false,
                "children": []
            })
        })
        .collect();
    // 工具池仍挂在 nav 数据里；前端齿轮展开时只渲染其子叶，不渲染「备份区域」标题行。
    let backup_children: Vec<serde_json::Value> = list_backup_pool_workspaces(&ws_settings)
        .into_iter()
        .map(|w| {
            json!({
                "name": w.display_name,
                "kind": "global",
                "tool": w.id,
                "isExpanded": false,
                "children": []
            })
        })
        .collect();
    global_children.push(json!({
        "name": "备份区域",
        "kind": "category",
        "isExpanded": false,
        "children": backup_children
    }));
    // 「容器」主叶 = pinned（侧栏开眼）；「隐藏容器」池 = !pinned（齿轮展开，UI 不画池标题）。
    let mut container_children = pinned;
    container_children.push(json!({
        "name": "隐藏容器",
        "kind": "category",
        "isExpanded": false,
        "children": unpinned
    }));
    vec![
        json!({
            "name": "工作区",
            "kind": "category",
            "isExpanded": true,
            "children": global_children
        }),
        json!({
            "name": "容器",
            "kind": "category",
            "isExpanded": true,
            "children": container_children
        }),
    ]
}

fn build_commands(
    settings: &AppSettings,
    load: &CatalogLoadResult,
    configured: bool,
    selected_ids: &[String],
    detail_file: &str,
    container_root: &str,
    user_global: bool,
) -> serde_json::Value {
    use crate::list_cluster::{find_live_path_in_active_container, library_content_exists};

    let lib = settings.skills_library_root.trim();
    let selected: Vec<&CatalogEntry> = if load.healthy {
        selected_ids
            .iter()
            .filter_map(|id| load.catalog.entries.iter().find(|e| e.id == *id))
            .collect()
    } else {
        vec![]
    };
    let any = !selected.is_empty();
    let any_missing = selected.iter().any(|e| e.is_missing);
    let project_selected =
        settings.nav_kind == "project" && settings.selected_project_id.as_ref().map(|s| !s.is_empty()).unwrap_or(false);
    let has_container = !container_root.trim().is_empty();

    let all_have_library = any && selected.iter().all(|e| library_content_exists(lib, e));
    let all_have_copy = any
        && has_container
        && selected.iter().all(|e| {
            find_live_path_in_active_container(e, lib, container_root, user_global).is_some()
        });

    let can_save = configured
        && selected.len() == 1
        && !detail_file.is_empty()
        && Path::new(detail_file).is_file()
        && !detail_file.to_lowercase().ends_with(".skill");

    let can_open_lib = configured
        && selected.len() == 1
        && selected
            .first()
            .map(|e| library_content_exists(lib, e))
            .unwrap_or(false);

    // 部署 = 永久库→容器推送：已有副本时仍可再次部署（覆盖）；撤回仍要求有副本。
    json!({
        "canDeploy": configured && has_container && all_have_library,
        "canWithdraw": configured && all_have_copy,
        "canUnmanage": configured && any && !any_missing,
        "canEditTags": configured && selected.len() == 1,
        "canPurgeMissing": configured && any_missing,
        "canScanProjects": configured,
        "canCancelOrRestore": false,
        "canOpenOriginalDirectory": selected.len() == 1,
        "canOpenCurrentDirectory": selected.len() == 1,
        "canOpenLibraryEntry": can_open_lib,
        "canOpenPermanentLibrary": can_open_lib,
        "canSetScope": configured && any,
        "canAddProject": true,
        "canEditProject": project_selected,
        "canRemoveProject": project_selected,
        "canTogglePinProject": project_selected,
        "canSaveDetailMarkdown": can_save
    })
}

/// Sentinel in `network_library_summary` when list payload was omitted (nav-only mutations).
pub const OMIT_NETWORK_LIST_SUMMARY: &str = "__omit_network_list__";

pub fn build_snapshot_subset(
    settings: &AppSettings,
    load: &CatalogLoadResult,
    path_guard_warnings: Vec<String>,
) -> AppSnapshotSubset {
    build_snapshot_subset_ex(settings, load, path_guard_warnings, false)
}

/// `omit_network_list`: skip rebuilding ~thousands of network list DTOs (pin/sort/reorder nav).
pub fn build_snapshot_subset_ex(
    settings: &AppSettings,
    load: &CatalogLoadResult,
    path_guard_warnings: Vec<String>,
    omit_network_list: bool,
) -> AppSnapshotSubset {
    use crate::active_container::resolve_active_container_root;
    use crate::catalog::list_projects;
    use crate::list_cluster::{
        build_cluster_tree, filter_deployed_in_container, filter_permanent_library,
        find_live_path_in_active_container,
    };
    use crate::project_discovery::{get_default_scan_roots, to_display_path};
    use crate::settings::{resolve_backup_root, settings_dir};
    use crate::workspace::{
        display_name_for, ensure_workspaces_migrated, list_visible_workspaces,
        resolve_workspace_container_root,
    };

    let mut ws_settings = settings.clone();
    let _ = ensure_workspaces_migrated(&mut ws_settings);
    let settings = &ws_settings;

    let configured =
        settings.library_root_configured && !settings.skills_library_root.trim().is_empty();
    let library_root_display = if configured {
        to_display_path(&settings.skills_library_root)
    } else {
        "（未配置）".into()
    };
    let container_root = resolve_active_container_root(settings);
    let active_container_path_display = if container_root.trim().is_empty() {
        "（未配置）".into()
    } else {
        to_display_path(&container_root)
    };
    let user_global = settings.nav_kind.trim().eq_ignore_ascii_case("global")
        || settings.nav_kind.trim().is_empty();
    let lib = settings.skills_library_root.trim();
    let focus_id = settings.selected_global_tool.clone();
    let focus_display = display_name_for(settings, &focus_id);

    let (session_ids, detail_side, detail_mode) = with_session(|s| {
        (
            s.selected_entry_ids.clone(),
            s.detail_path_side.clone(),
            s.detail_pane_mode.clone(),
        )
    });

    let mut in_container = vec![];
    let mut in_library_own = vec![];
    let mut in_library_other = vec![];
    let mut missing = vec![];
    let mut permanent_library_roots = vec![];
    let mut visible_container_sections: Vec<WorkspaceContainerSectionDto> = vec![];

    if load.healthy {
        for e in &load.catalog.entries {
            if e.is_missing && kind_allowed(settings, &e.kind) {
                missing.push(entry_to_list_item(e, false, None));
            }
        }

        let mut section_specs: Vec<(String, String, String, bool)> = vec![];
        if user_global {
            for w in list_visible_workspaces(settings) {
                let root = resolve_workspace_container_root(settings, &w.id);
                let focused = w.id.eq_ignore_ascii_case(&focus_id);
                section_specs.push((
                    w.id.clone(),
                    w.display_name.clone(),
                    root,
                    focused,
                ));
            }
            if section_specs.is_empty() {
                section_specs.push((
                    focus_id.clone(),
                    focus_display.clone(),
                    container_root.clone(),
                    true,
                ));
            }
        } else if let Some(pid) = settings.selected_project_id.as_ref() {
            // Plan/04 Should：项目侧按可见工具多段容器
            let proj = list_projects(&load.catalog)
                .into_iter()
                .find(|p| p.id == *pid);
            if let Some(proj) = proj {
                let tools = proj.effective_visible_tools();
                let focus_tool = crate::workspace::normalize_workspace_id(&focus_id)
                    .unwrap_or("cursor");
                let focus_ok = tools.iter().any(|t| t == focus_tool);
                for tool in &tools {
                    let root = crate::active_container::resolve_project_tool_container(
                        &proj.root_path,
                        tool,
                        &proj.tool_container_roots,
                    );
                    let name = display_name_for(settings, tool);
                    let focused = if focus_ok {
                        tool == focus_tool
                    } else {
                        tool == tools.first().map(|s| s.as_str()).unwrap_or("cursor")
                    };
                    section_specs.push((tool.clone(), name, root, focused));
                }
            }
            if section_specs.is_empty() {
                section_specs.push((
                    "project".into(),
                    "项目".into(),
                    container_root.clone(),
                    true,
                ));
            }
        } else {
            section_specs.push((
                "project".into(),
                "项目".into(),
                container_root.clone(),
                true,
            ));
        }

        for (ws_id, ws_name, root, focused) in &section_specs {
            let ug = crate::active_container::is_user_global_container_root(root);
            let mut sec_container = vec![];
            // history_* 恒空（分区已下线，见 Docs/01-核心逻辑）。
            let sec_history: Vec<LibraryListItemDto> = vec![];
            if !root.trim().is_empty() {
                let deployed =
                    filter_deployed_in_container(&load.catalog.entries, lib, root, ug);
                for e in deployed {
                    if kind_allowed(settings, &e.kind) {
                        let live = find_live_path_in_active_container(e, lib, root, ug);
                        let live_rel =
                            live.as_deref().map(|p| rel_under_container(p, root));
                        sec_container.push(entry_to_list_item(e, true, live_rel.as_deref()));
                    }
                }
            }
            let n_sec_c = sec_container.len();
            if *focused {
                in_container = sec_container.clone();
                in_library_own = sec_history.clone();
            }
            let root_disp = if root.trim().is_empty() {
                "（未配置）".into()
            } else {
                to_display_path(root)
            };
            visible_container_sections.push(WorkspaceContainerSectionDto {
                workspace_id: ws_id.clone(),
                display_name: ws_name.clone(),
                container_root_display: root_disp,
                is_focused: *focused,
                in_container_items: sec_container,
                in_container_header: if user_global || section_specs.len() > 1 {
                    format!("容器中 · {ws_name}")
                } else {
                    "容器中".into()
                },
                in_container_summary: n_sec_c.to_string(),
                history_items: sec_history,
                history_header: String::new(),
                history_summary: "0".into(),
            });
        }

        let permanent = filter_permanent_library(&load.catalog.entries, lib);
        let permanent_refs: Vec<&CatalogEntry> = permanent
            .iter()
            .copied()
            .filter(|e| kind_allowed(settings, &e.kind))
            .collect();
        for e in &permanent_refs {
            let live = find_live_path_in_active_container(e, lib, &container_root, user_global);
            let live_rel = live
                .as_deref()
                .map(|p| rel_under_container(p, &container_root));
            let path_hint = if live.is_some() {
                live_rel.as_deref()
            } else {
                None
            };
            in_library_other.push(entry_to_list_item(e, false, path_hint));
        }
        let projects = list_projects(&load.catalog);
        permanent_library_roots =
            build_cluster_tree(&permanent_refs, 0, &projects);
    }

    let n_lib = in_library_other.len();
    let n_c: usize = visible_container_sections
        .iter()
        .map(|s| s.in_container_items.len())
        .sum();
    let status_text = if !configured {
        "尚未配置永久库目录。".into()
    } else if !load.healthy {
        format!(
            "台账加载失败，已禁止当空账使用：{}",
            load.error.as_deref().unwrap_or("unknown")
        )
    } else {
        format!("容器 {n_c}")
    };

    let detail = build_detail_parts(
        settings,
        load,
        &session_ids,
        &detail_side,
        &container_root,
        user_global,
    );
    let detail_markdown_file_path = detail.markdown_file_path;
    let detail_source_path_display = detail.source_path_display;
    let detail_summary_text = detail.summary_text;
    let detail_markdown_text = detail.markdown_text;
    let detail_side_out = detail.side_out;
    let network_selected = detail.network_selected;

    let selection_summary = match session_ids.len() {
        0 => String::new(),
        1 => session_ids[0].clone(),
        n => format!("已选 {n} 项"),
    };

    let nav_kind = if settings.nav_kind.trim().is_empty() {
        "global".into()
    } else {
        settings.nav_kind.clone()
    };

    let show_user_rules = user_global
        && settings
            .selected_global_tool
            .eq_ignore_ascii_case("cursor");

    let backup_disp = to_display_path(&resolve_backup_root(settings).to_string_lossy());

    let net_ctx = crate::network_library::load_network_snapshot_context(settings);
    let (network_items, network_library_summary, omit_network_library_list, network_index_error) =
        if omit_network_list {
            (
                Vec::new(),
                OMIT_NETWORK_LIST_SUMMARY.to_string(),
                true,
                None,
            )
        } else {
            match &net_ctx {
                None => (Vec::new(), "0".into(), false, None),
                Some(ctx) => match &ctx.index {
                    Err(e) => (Vec::new(), "0".into(), false, Some(e.clone())),
                    Ok(_) => match crate::network_library::network_list_items_with_context(
                        settings, ctx,
                    ) {
                        Ok(items) => {
                            let summary = items.len().to_string();
                            (items, summary, false, None)
                        }
                        Err(e) => (Vec::new(), "0".into(), false, Some(e)),
                    },
                },
            }
        };
    let net_configured = crate::network_library::effective_network_root(settings).is_some();
    let network_root_display = crate::network_library::effective_network_root(settings)
        .map(|p| to_display_path(&p))
        .unwrap_or_else(|| "（未配置）".into());
    let (network_official_nav, network_popular_nav) =
        crate::network_library::network_nav_with_context(settings, net_ctx.as_ref());

    let can_save_final = !network_selected
        && configured
        && session_ids.len() == 1
        && !detail_markdown_file_path.is_empty()
        && Path::new(&detail_markdown_file_path).is_file()
        && !detail_markdown_file_path.to_lowercase().ends_with(".skill");

    let mut commands = build_commands(
        settings,
        load,
        configured,
        &session_ids,
        &detail_markdown_file_path,
        &container_root,
        user_global,
    );
    if network_selected {
        if let Some(obj) = commands.as_object_mut() {
            obj.insert("canDeploy".into(), json!(false));
            obj.insert("canWithdraw".into(), json!(false));
            obj.insert("canUnmanage".into(), json!(false));
            obj.insert("canEditTags".into(), json!(false));
            obj.insert("canSaveDetailMarkdown".into(), json!(false));
            obj.insert("canSetScope".into(), json!(false));
            obj.insert("canOpenPermanentLibrary".into(), json!(false));
        }
    } else if let Some(obj) = commands.as_object_mut() {
        obj.insert("canSaveDetailMarkdown".into(), json!(can_save_final));
    }

    let mut workspace_dtos: Vec<WorkspaceDto> = settings
        .workspaces
        .iter()
        .map(|w| {
            let mode = crate::workspace::deploy_mode_for(settings, &w.id);
            let deploy_mode = match mode {
                crate::workspace::DeployMode::Copy => "copy",
                crate::workspace::DeployMode::Symlink => "symlink",
            }
            .to_string();
            WorkspaceDto {
                id: w.id.clone(),
                enabled: w.enabled,
                in_work_area: w.in_work_area,
                display_name: w.display_name.clone(),
                container_root: w.container_root.clone(),
                is_default: w.id.eq_ignore_ascii_case(&settings.default_workspace_id),
                is_visible: settings
                    .visible_workspace_ids
                    .iter()
                    .any(|v| v.eq_ignore_ascii_case(&w.id)),
                is_focused: w.id.eq_ignore_ascii_case(&focus_id),
                deploy_mode,
            }
        })
        .collect();
    // Settings / UI tables: user WorkspaceNavOrder, else catalog popularity.
    workspace_dtos.sort_by_key(|w| crate::workspace::workspace_nav_rank(settings, &w.id));

    let focus_own_header = String::new();

    AppSnapshotSubset {
        is_library_configured: configured,
        library_root_display,
        disabled_storage_display: backup_disp,
        status_text,
        active_container_path_display,
        nav_nodes: build_nav(settings, &load.catalog.projects),
        selected_nav_kind: nav_kind,
        selected_project_id: settings.selected_project_id.clone(),
        selected_global_tool: settings.selected_global_tool.clone(),
        focus_workspace_display_name: focus_display,
        default_workspace_id: settings.default_workspace_id.clone(),
        visible_workspace_ids: settings.visible_workspace_ids.clone(),
        workspaces: workspace_dtos,
        visible_container_sections,
        projects: load.catalog.projects.clone(),
        filter_show_skills: settings.filter_show_skills,
        filter_show_rules: settings.filter_show_rules,
        filter_show_agents: settings.filter_show_agents,
        filter_show_commands: settings.filter_show_commands,
        filter_show_hooks: settings.filter_show_hooks,
        purpose_domain_filter_index: settings.purpose_domain_filter_index,
        cluster_mode_index: settings.cluster_mode_index,
        cluster_mode_options: vec![
            "按层级用途".into(),
            "按项目归属".into(),
            "扁平".into(),
        ],
        show_user_rules_settings_hint: show_user_rules,
        // 对齐 Electron CCM：~\.cursor/rules ≠ Cursor Settings → Rules（跨项目 User Rules）
        user_rules_settings_hint_text: if show_user_rules {
            "用户级规则放入 ~/.cursor/rules 后，Cursor 不会当作全局 Rule 加载。跨项目请复制正文到 Cursor → Settings → Rules（Customize → Rules）。项目内生效请放入该项目的 .cursor/rules。".into()
        } else {
            String::new()
        },
        in_container_summary: in_container.len().to_string(),
        in_library_summary: n_lib.to_string(),
        in_library_own_summary: "0".into(),
        in_library_other_summary: n_lib.to_string(),
        in_library_own_header: focus_own_header,
        in_library_other_header: "永久库".into(),
        missing_summary: missing.len().to_string(),
        missing_section_visible: !missing.is_empty(),
        in_container_items: in_container,
        in_library_items: in_library_own,
        in_library_other_items: in_library_other,
        missing_items: missing.clone(),
        permanent_library_roots,
        network_library_items: network_items,
        network_library_summary,
        network_library_header: "网络库（开源橱窗）".into(),
        omit_network_library_list,
        network_index_error,
        is_network_library_configured: net_configured,
        network_library_root_display: network_root_display,
        network_official_nav,
        network_popular_nav,
        network_popular_sort: crate::network_catalog::normalize_popular_sort(
            &settings.network_popular_sort,
        )
        .to_string(),
        network_popular_visible_limit: settings.network_popular_visible_limit,
        network_update_check_interval_minutes: settings.network_update_check_interval_minutes,
        network_git_http_proxy: settings.network_git_http_proxy.clone(),
        network_fetch_concurrency: crate::settings::clamp_network_fetch_concurrency(
            settings.network_fetch_concurrency,
        ),
        selected_entry_ids: session_ids.clone(),
        selection_summary,
        detail_pane_mode: {
            // 有正文文件且仍为摘要：升 markdown（Crepe）。网络条目同样走只读页签，禁止保存由 canSaveDetailMarkdown=false 保证。
            if !detail_markdown_file_path.is_empty() && detail_mode == "summary" {
                "markdown".into()
            } else {
                detail_mode
            }
        },
        detail_summary_text,
        detail_markdown_text,
        detail_rendered_markdown: String::new(),
        detail_source_path_display,
        detail_markdown_file_path: detail_markdown_file_path.clone(),
        detail_path_side: detail_side_out,
        is_scanning_projects: false,
        cancel_or_restore_button_text: String::new(),
        cancel_or_restore_button_tool_tip: String::new(),
        auto_scan_projects_on_startup: settings.auto_scan_projects_on_startup,
        project_scan_roots: settings
            .project_scan_roots
            .iter()
            .map(|p| to_display_path(p))
            .collect(),
        project_scan_max_depth: settings.project_scan_max_depth,
        default_project_scan_roots: get_default_scan_roots()
            .into_iter()
            .map(|p| to_display_path(&p))
            .collect(),
        scan_skip_workspace_ids: settings.scan_skip_workspace_ids.clone(),
        scan_extra_roots: settings
            .scan_extra_roots
            .iter()
            .map(|r| ScanExtraRootDto {
                path: to_display_path(&r.path),
                tool: r.tool.clone(),
            })
            .collect(),
        app_settings_dir_display: {
            // 测试回厂：主体设置在永久库 `ccm-settings.json`；展示库根便于打开同目录文件
            if let Some(root) = crate::settings::effective_library_root(settings) {
                to_display_path(&root)
            } else {
                settings_dir()
                    .map(|p| to_display_path(&p.to_string_lossy()))
                    .unwrap_or_default()
            }
        },
        commands,
        ui_nav_width: settings.ui_nav_width,
        ui_list_width: settings.ui_list_width,
        ui_nav_visible: settings.ui_nav_visible,
        ui_detail_visible: settings.ui_detail_visible,
        should_prompt_startup_scan: false,
        catalog_healthy: load.healthy,
        catalog_load_error: load.error.clone(),
        path_guard_warnings,
    }
}

/// 选中相关的详情字段（build_snapshot_subset_ex 与 H6 轻路径共用，保证行为等价）。
struct DetailParts {
    markdown_file_path: String,
    source_path_display: String,
    summary_text: String,
    markdown_text: String,
    side_out: String,
    network_selected: bool,
}

fn build_detail_parts(
    settings: &AppSettings,
    load: &CatalogLoadResult,
    session_ids: &[String],
    detail_side: &str,
    container_root: &str,
    user_global: bool,
) -> DetailParts {
    use crate::list_cluster::find_live_path_in_active_container;

    let lib = settings.skills_library_root.trim();
    let mut detail_markdown_file_path = String::new();
    let mut detail_source_path_display = String::new();
    let mut detail_summary_text = String::new();
    let mut detail_markdown_text = String::new();
    let mut detail_side_out = detail_side.to_string();

    let network_selected = session_ids
        .iter()
        .any(|id| crate::network_library::is_network_entry_id(id));

    if session_ids.is_empty() {
        detail_summary_text = "选择左侧条目查看详情".into();
    } else if session_ids.len() > 1 {
        detail_summary_text = format!(
            "已选择 {} 项\n{}",
            session_ids.len(),
            session_ids
                .iter()
                .map(|id| format!("- {id}"))
                .collect::<Vec<_>>()
                .join("\n")
        );
    } else if network_selected {
        if let Some((summary, md, path)) =
            crate::network_library::load_network_detail(settings, &session_ids[0])
        {
            detail_summary_text = summary;
            detail_markdown_text = md;
            detail_source_path_display = path.clone();
            detail_markdown_file_path = path;
            detail_side_out = "library".into();
        } else {
            detail_summary_text = "网络库条目不可读或已失效".into();
        }
    } else if load.healthy {
        let id = &session_ids[0];
        if let Some(e) = load.catalog.entries.iter().find(|x| x.id == *id) {
            detail_summary_text = format!(
                "{}\n种类: {}\n库相对路径: {}\n部署: {}",
                e.id,
                e.kind,
                e.library_path,
                if e.deployed_path.is_empty() {
                    "—"
                } else {
                    e.deployed_path.as_str()
                }
            );
            let side_container = detail_side.eq_ignore_ascii_case("container");
            if side_container {
                if let Some(live) =
                    find_live_path_in_active_container(e, lib, container_root, user_global)
                {
                    let meta = resolve_content_file_from_root(&live, &e.kind);
                    detail_source_path_display = live;
                    if let Some(m) = meta {
                        detail_markdown_file_path = m.clone();
                        if let Ok(text) = std::fs::read_to_string(&m) {
                            detail_markdown_text = text;
                        }
                    }
                }
            } else if let Ok(abs) =
                resolve_library_safe_path(&settings.skills_library_root, &e.library_path)
            {
                let meta = if abs.is_file() {
                    Some(abs.to_string_lossy().to_string())
                } else {
                    resolve_content_file_from_root(&abs.to_string_lossy(), &e.kind)
                };
                if let Some(m) = meta {
                    detail_markdown_file_path = m.clone();
                    detail_source_path_display = m;
                    if let Ok(text) = std::fs::read_to_string(&detail_markdown_file_path) {
                        detail_markdown_text = text;
                    }
                }
            }
        }
    }

    DetailParts {
        markdown_file_path: detail_markdown_file_path,
        source_path_display: detail_source_path_display,
        summary_text: detail_summary_text,
        markdown_text: detail_markdown_text,
        side_out: detail_side_out,
        network_selected,
    }
}

/// H6 点选轻路径载荷：仅回传随选中变化的字段，前端与上一帧快照合并。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionDetailDto {
    pub selected_entry_ids: Vec<String>,
    pub selection_summary: String,
    pub detail_pane_mode: String,
    pub detail_summary_text: String,
    pub detail_markdown_text: String,
    pub detail_source_path_display: String,
    pub detail_markdown_file_path: String,
    pub detail_path_side: String,
    pub commands: serde_json::Value,
}

/// 与 build_snapshot_subset_ex 的选中相关输出逐字段等价（共用 build_detail_parts / build_commands）。
pub fn build_selection_detail(
    settings: &AppSettings,
    load: &CatalogLoadResult,
) -> SelectionDetailDto {
    use crate::active_container::resolve_active_container_root;
    use crate::workspace::ensure_workspaces_migrated;

    let mut ws_settings = settings.clone();
    let _ = ensure_workspaces_migrated(&mut ws_settings);
    let settings = &ws_settings;

    let configured =
        settings.library_root_configured && !settings.skills_library_root.trim().is_empty();
    let container_root = resolve_active_container_root(settings);
    let user_global = settings.nav_kind.trim().eq_ignore_ascii_case("global")
        || settings.nav_kind.trim().is_empty();

    let (session_ids, detail_side, detail_mode) = with_session(|s| {
        (
            s.selected_entry_ids.clone(),
            s.detail_path_side.clone(),
            s.detail_pane_mode.clone(),
        )
    });

    let detail = build_detail_parts(
        settings,
        load,
        &session_ids,
        &detail_side,
        &container_root,
        user_global,
    );

    let can_save_final = !detail.network_selected
        && configured
        && session_ids.len() == 1
        && !detail.markdown_file_path.is_empty()
        && Path::new(&detail.markdown_file_path).is_file()
        && !detail.markdown_file_path.to_lowercase().ends_with(".skill");

    let mut commands = build_commands(
        settings,
        load,
        configured,
        &session_ids,
        &detail.markdown_file_path,
        &container_root,
        user_global,
    );
    if detail.network_selected {
        if let Some(obj) = commands.as_object_mut() {
            obj.insert("canDeploy".into(), json!(false));
            obj.insert("canWithdraw".into(), json!(false));
            obj.insert("canUnmanage".into(), json!(false));
            obj.insert("canEditTags".into(), json!(false));
            obj.insert("canSaveDetailMarkdown".into(), json!(false));
            obj.insert("canSetScope".into(), json!(false));
            obj.insert("canOpenPermanentLibrary".into(), json!(false));
        }
    } else if let Some(obj) = commands.as_object_mut() {
        obj.insert("canSaveDetailMarkdown".into(), json!(can_save_final));
    }

    let selection_summary = match session_ids.len() {
        0 => String::new(),
        1 => session_ids[0].clone(),
        n => format!("已选 {n} 项"),
    };

    SelectionDetailDto {
        selection_summary,
        detail_pane_mode: if !detail.markdown_file_path.is_empty() && detail_mode == "summary" {
            "markdown".into()
        } else {
            detail_mode
        },
        detail_summary_text: detail.summary_text,
        detail_markdown_text: detail.markdown_text,
        detail_source_path_display: detail.source_path_display,
        detail_markdown_file_path: detail.markdown_file_path,
        detail_path_side: detail.side_out,
        commands,
        selected_entry_ids: session_ids,
    }
}

fn resolve_content_file_from_root(root: &str, kind: &str) -> Option<String> {
    let p = Path::new(root.trim());
    if !p.exists() {
        return None;
    }
    if p.is_file() {
        return Some(p.to_string_lossy().to_string());
    }
    if !p.is_dir() {
        return None;
    }
    if kind.eq_ignore_ascii_case("skill") {
        let skill = p.join("SKILL.md");
        if skill.is_file() {
            return Some(skill.to_string_lossy().to_string());
        }
    }
    if let Ok(rd) = std::fs::read_dir(p) {
        for ent in rd.flatten() {
            let name = ent.file_name().to_string_lossy().to_lowercase();
            if name.ends_with(".mdc") || name.ends_with(".md") {
                let fp = ent.path();
                if fp.is_file() {
                    return Some(fp.to_string_lossy().to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;

    #[test]
    fn build_nav_kinds_match_electron_navtree_contract() {
        let mut settings = AppSettings::default();
        let _ = crate::workspace::ensure_workspaces_migrated(&mut settings);
        // Default: only Cursor visible under 工作区.
        let projects = vec![serde_json::json!({
            "id": "p1",
            "name": "Demo",
            "rootPath": "E:/demo",
            "pinned": true
        })];
        let nav = build_nav(&settings, &projects);
        assert_eq!(nav.len(), 2);
        assert_eq!(nav[0]["kind"], "category");
        assert_eq!(nav[0]["name"], "工作区");
        let tools = nav[0]["children"].as_array().unwrap();
        // visible leaf(s) + 「备份区域」数据节点（UI 不画标题行，由齿轮展开子叶）
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[0]["kind"], "global");
        assert_eq!(tools[0]["tool"], "cursor");
        assert_eq!(tools[1]["kind"], "category");
        assert_eq!(tools[1]["name"], "备份区域");
        assert_eq!(tools[1]["isExpanded"], false);
        let pool = tools[1]["children"].as_array().unwrap();
        assert!(
            pool.iter().any(|c| c["tool"] == "gemini"),
            "unpromoted tools appear under 备份区域"
        );
        assert!(
            !pool.iter().any(|c| c["tool"] == "cursor"),
            "work-area tools must not appear in backup pool"
        );
        settings.visible_workspace_ids =
            vec!["cursor".into(), "claude".into(), "codex".into()];
        let nav_all = build_nav(&settings, &projects);
        let tools_all = nav_all[0]["children"].as_array().unwrap();
        assert_eq!(tools_all.len(), 4);
        assert_eq!(tools_all[0]["tool"], "cursor");
        assert_eq!(tools_all[1]["tool"], "claude");
        assert_eq!(tools_all[2]["tool"], "codex");
        assert_eq!(tools_all[3]["name"], "备份区域");
        assert_eq!(nav[1]["kind"], "category");
        assert_eq!(nav[1]["name"], "容器");
        let container_kids = nav[1]["children"].as_array().unwrap();
        // visible project leaf(s) + 「隐藏容器」池节点
        assert_eq!(container_kids.len(), 2);
        assert_eq!(container_kids[0]["kind"], "project");
        assert_eq!(container_kids[0]["projectId"], "p1");
        assert_eq!(container_kids[1]["kind"], "category");
        assert_eq!(container_kids[1]["name"], "隐藏容器");
        assert_eq!(container_kids[1]["isExpanded"], false);
    }

    #[test]
    fn in_use_badge_ignores_deployed_path_elsewhere() {
        use crate::catalog::CatalogEntry;
        let e = CatalogEntry {
            id: "bench-skill".into(),
            kind: "skill".into(),
            library_path: "skills/bench-skill/SKILL.md".into(),
            deployed_path: r"E:\OtherProj\.cursor\skills\bench-skill\SKILL.md".into(),
            is_in_library: true,
            ..Default::default()
        };
        // 无 live 相对路径 → 即使 deployedPath 非空也不标「容器中」
        let item = entry_to_list_item(&e, false, None);
        assert!(!item.is_in_active_use);
        assert!(item.subtitle.contains("台账有部署路径"));

        let live = entry_to_list_item(&e, false, Some("skills/bench-skill/SKILL.md"));
        assert!(live.is_in_active_use);
        assert!(
            live.subtitle.contains("当前容器"),
            "live 副本时应标当前容器: {}",
            live.subtitle
        );

        let in_c = entry_to_list_item(&e, true, Some("skills/bench-skill/SKILL.md"));
        assert!(in_c.is_in_active_use);
        assert!(in_c.subtitle.contains("当前容器"));
    }

    #[test]
    fn network_entry_opens_markdown_readonly() {
        use crate::catalog::{empty_catalog, CatalogLoadResult};
        use crate::network_library::{
            ensure_network_layout, save_network_index, NetworkEntry, NetworkIndex,
            NetworkSourceRecord, NETWORK_ID_PREFIX,
        };
        use crate::session::with_session;
        use std::fs;
        use std::sync::Mutex;

        static APPDATA_LOCK: Mutex<()> = Mutex::new(());
        let _guard = APPDATA_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let appdata = tempfile::tempdir().unwrap();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }

        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        let net = dir.path().join("net").to_string_lossy().to_string();
        fs::create_dir_all(&lib).unwrap();
        ensure_network_layout(&net).unwrap();

        let cached = std::path::Path::new(&net).join("cache/demo/ro-skill");
        fs::create_dir_all(&cached).unwrap();
        fs::write(cached.join("SKILL.md"), "# Net skill\n\nbody\n").unwrap();

        let net_id = format!("{NETWORK_ID_PREFIX}demo:ro-skill");
        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: "demo".into(),
            label: "Demo".into(),
            url: "https://example.com/demo.git".into(),
            cache_rel: "cache/demo".into(),
            fingerprint: "abc".into(),
            last_fetched_at: String::new(),
        });
        index.entries.push(NetworkEntry {
            id: net_id.clone(),
            kind: "skill".into(),
            name: "ro-skill".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/ro-skill".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "Net skill".into(),
            license: String::new(),
            ..Default::default()
        });
        save_network_index(&net, &index).unwrap();

        let prev = with_session(|s| {
            let prev = (
                s.selected_entry_ids.clone(),
                s.detail_pane_mode.clone(),
                s.detail_path_side.clone(),
            );
            s.selected_entry_ids = vec![net_id.clone()];
            s.detail_pane_mode = "summary".into();
            s.detail_path_side = "library".into();
            prev
        });

        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net,
            network_library_configured: true,
            ..AppSettings::default()
        };
        let load = CatalogLoadResult {
            catalog: empty_catalog(),
            healthy: true,
            error: None,
        };
        let snap = build_snapshot_subset(&settings, &load, vec![]);
        assert_eq!(snap.detail_pane_mode, "markdown");
        assert_eq!(
            snap.commands
                .get("canSaveDetailMarkdown")
                .and_then(|v| v.as_bool()),
            Some(false)
        );
        assert!(snap.detail_markdown_text.contains("Net skill"));
        assert!(!snap.detail_markdown_file_path.is_empty());

        with_session(|s| {
            s.selected_entry_ids = prev.0;
            s.detail_pane_mode = prev.1;
            s.detail_path_side = prev.2;
        });
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    /// 合成 n 条 skill 条目库（磁盘上真实建 SKILL.md，正文约 0.6KB）。
    fn synthetic_library(
        dir: &std::path::Path,
        n: usize,
    ) -> (AppSettings, crate::catalog::CatalogLoadResult) {
        use crate::catalog::{empty_catalog, CatalogEntry, CatalogLoadResult};
        use std::fs;

        let lib = dir.join("lib").to_string_lossy().to_string();
        let mut catalog = empty_catalog();
        for i in 0..n {
            let id = format!("bench-entry-{i:03}");
            let entry_dir = std::path::Path::new(&lib).join("skills").join(&id);
            fs::create_dir_all(&entry_dir).unwrap();
            let body = format!(
                "# {id}\n\n{}\n",
                "示例正文行，用于逼近真实条目体积。\n".repeat(20)
            );
            fs::write(entry_dir.join("SKILL.md"), body).unwrap();
            catalog.entries.push(CatalogEntry {
                id: id.clone(),
                kind: "skill".into(),
                library_path: format!("skills/{id}"),
                is_in_library: true,
                remark_zh: format!("合成条目 {i}"),
                ..Default::default()
            });
        }
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            ..AppSettings::default()
        };
        let load = CatalogLoadResult {
            catalog,
            healthy: true,
            error: None,
        };
        (settings, load)
    }

    /// H6 行为等价：轻路径载荷与全量快照的选中相关字段逐一相等（单选与多选）。
    #[test]
    fn selection_detail_matches_full_snapshot_fields() {
        use crate::session::with_session;

        let dir = tempfile::tempdir().unwrap();
        let (settings, load) = synthetic_library(dir.path(), 12);

        let prev = with_session(|s| {
            let prev = (
                s.selected_entry_ids.clone(),
                s.detail_pane_mode.clone(),
                s.detail_path_side.clone(),
            );
            s.selected_entry_ids = vec!["bench-entry-007".into()];
            s.detail_pane_mode = "summary".into();
            s.detail_path_side = "library".into();
            prev
        });

        for ids in [
            vec!["bench-entry-007".to_string()],
            vec![
                "bench-entry-003".to_string(),
                "bench-entry-004".to_string(),
                "bench-entry-005".to_string(),
            ],
            vec![],
        ] {
            with_session(|s| s.selected_entry_ids = ids.clone());
            let full = build_snapshot_subset_ex(&settings, &load, vec![], true);
            let light = build_selection_detail(&settings, &load);
            assert_eq!(light.selected_entry_ids, full.selected_entry_ids);
            assert_eq!(light.selection_summary, full.selection_summary);
            assert_eq!(light.detail_pane_mode, full.detail_pane_mode);
            assert_eq!(light.detail_summary_text, full.detail_summary_text);
            assert_eq!(light.detail_markdown_text, full.detail_markdown_text);
            assert_eq!(
                light.detail_source_path_display,
                full.detail_source_path_display
            );
            assert_eq!(
                light.detail_markdown_file_path,
                full.detail_markdown_file_path
            );
            assert_eq!(light.detail_path_side, full.detail_path_side);
            assert_eq!(light.commands, full.commands, "ids={ids:?}");
        }
        // 单选有正文文件时应有内容且可保存
        with_session(|s| s.selected_entry_ids = vec!["bench-entry-007".into()]);
        let light = build_selection_detail(&settings, &load);
        assert!(light.detail_markdown_text.contains("bench-entry-007"));
        assert_eq!(
            light
                .commands
                .get("canSaveDetailMarkdown")
                .and_then(|v| v.as_bool()),
            Some(true)
        );

        with_session(|s| {
            s.selected_entry_ids = prev.0;
            s.detail_pane_mode = prev.1;
            s.detail_path_side = prev.2;
        });
    }

    /// H6 计时（默认忽略）：合成 50 条目，对比 set_selection 旧路径
    /// （validate_entry_paths + build_snapshot_subset_ex(omit_network) + 序列化）与
    /// 新路径（build_selection_detail + 序列化）的耗时与 JSON 字节数。
    /// 运行：`cargo test --lib bench_selection_detail -- --ignored --nocapture --test-threads=1`
    #[test]
    #[ignore]
    fn bench_selection_detail_50_entries_timing() {
        use crate::catalog::validate_entry_paths;
        use crate::session::with_session;
        use std::time::Instant;

        let dir = tempfile::tempdir().unwrap();
        let (settings, load) = synthetic_library(dir.path(), 50);

        let prev = with_session(|s| {
            let prev = (
                s.selected_entry_ids.clone(),
                s.detail_pane_mode.clone(),
                s.detail_path_side.clone(),
            );
            s.selected_entry_ids = vec!["bench-entry-025".into()];
            s.detail_pane_mode = "summary".into();
            s.detail_path_side = "library".into();
            prev
        });

        let rounds = 30;
        let median = |mut v: Vec<f64>| -> f64 {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            v[v.len() / 2]
        };

        let mut old_ms = Vec::with_capacity(rounds);
        let mut old_bytes = 0usize;
        for _ in 0..rounds {
            let t = Instant::now();
            let warnings =
                validate_entry_paths(&settings.skills_library_root, &load.catalog.entries);
            let snap = build_snapshot_subset_ex(&settings, &load, warnings, true);
            let json = serde_json::to_vec(&snap).unwrap();
            old_ms.push(t.elapsed().as_secs_f64() * 1000.0);
            old_bytes = json.len();
        }

        let mut new_ms = Vec::with_capacity(rounds);
        let mut new_bytes = 0usize;
        for _ in 0..rounds {
            let t = Instant::now();
            let dto = build_selection_detail(&settings, &load);
            let json = serde_json::to_vec(&dto).unwrap();
            new_ms.push(t.elapsed().as_secs_f64() * 1000.0);
            new_bytes = json.len();
        }

        println!(
            "[bench-h6] entries=50 rounds={rounds} old(build+serialize) median={:.2}ms bytes={} | new median={:.2}ms bytes={}",
            median(old_ms),
            old_bytes,
            median(new_ms),
            new_bytes
        );

        with_session(|s| {
            s.selected_entry_ids = prev.0;
            s.detail_pane_mode = prev.1;
            s.detail_path_side = prev.2;
        });
    }
}
