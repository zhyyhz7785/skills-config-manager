//! AppSnapshot builder — enough for full App.tsx list/nav/commands (M3 domain 2).

use serde::Serialize;
use serde_json::json;
use std::path::Path;

use crate::catalog::{get_entry_tags, kind_label, CatalogEntry, CatalogLoadResult};
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDto {
    pub id: String,
    pub enabled: bool,
    pub display_name: String,
    pub container_root: String,
    pub is_default: bool,
    pub is_visible: bool,
    pub is_focused: bool,
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
    pub purpose_taxonomy: Vec<String>,
    pub cluster_mode_index: i32,
    pub cluster_mode_options: Vec<String>,
    pub directory_mode_options: Vec<String>,
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
    pub is_network_library_configured: bool,
    pub network_library_root_display: String,
    pub network_official_nav: Vec<crate::network_catalog::NetworkNavNodeDto>,
    pub network_popular_nav: Vec<crate::network_catalog::NetworkNavNodeDto>,
    /// 0 = off; minutes between check-only updates.
    pub network_update_check_interval_minutes: i32,
    /// True when SkillsShApiToken is non-empty (token itself never exposed).
    pub skills_sh_configured: bool,
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
    /// 程序设置目录（settings.json 所在）。
    pub app_settings_dir_display: String,
    pub selected_directory_mode_index: i32,
    pub is_custom_directory_mode: bool,
    pub custom_base_directory: String,
    pub selected_directory_display: String,
    pub config_items: Vec<serde_json::Value>,
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
    // 勿仅凭台账 deployed_path 写「已部署」——该路径未必在当前活动容器中。
    let place = if in_container {
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
    let level = tags.level.as_deref().unwrap_or("").trim();
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
        level_key: tags.level.clone(),
        scope_key: Some(tags.scope),
        source_id: None,
        source_url: None,
        heat_label: None,
        intended_level: None,
        security_level: None,
        update_available: None,
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
    use crate::workspace::{ensure_workspaces_migrated, list_visible_workspaces};

    let mut ws_settings = settings.clone();
    let _ = ensure_workspaces_migrated(&mut ws_settings);

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
    let global_children: Vec<serde_json::Value> = list_visible_workspaces(&ws_settings)
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
    vec![
        json!({
            "name": "全局工作区",
            "kind": "category",
            "isExpanded": true,
            "children": global_children
        }),
        json!({
            "name": "项目",
            "kind": "category",
            "isExpanded": true,
            "children": [
                {
                    "name": "置顶容器",
                    "kind": "category",
                    "isExpanded": true,
                    "children": pinned
                },
                {
                    "name": "容器",
                    "kind": "category",
                    "isExpanded": false,
                    "children": unpinned
                }
            ]
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
    let none_have_copy = any
        && has_container
        && selected.iter().all(|e| {
            find_live_path_in_active_container(e, lib, container_root, user_global).is_none()
        });
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

    json!({
        "canDeploy": configured && has_container && all_have_library && none_have_copy,
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

pub fn build_snapshot_subset(
    settings: &AppSettings,
    load: &CatalogLoadResult,
    path_guard_warnings: Vec<String>,
) -> AppSnapshotSubset {
    use crate::active_container::resolve_active_container_root;
    use crate::catalog::list_projects;
    use crate::list_cluster::{
        build_cluster_tree, filter_deployed_in_container, filter_history_for_container,
        filter_permanent_library, find_live_path_in_active_container,
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
            let mut sec_history = vec![];
            if !root.trim().is_empty() {
                let deployed =
                    filter_deployed_in_container(&load.catalog.entries, root, ug);
                for e in deployed {
                    if kind_allowed(settings, &e.kind) {
                        let live = find_live_path_in_active_container(e, lib, root, ug);
                        let live_rel =
                            live.as_deref().map(|p| rel_under_container(p, root));
                        sec_container.push(entry_to_list_item(e, true, live_rel.as_deref()));
                    }
                }
                let history = filter_history_for_container(&load.catalog.entries, lib, root);
                for e in history {
                    if kind_allowed(settings, &e.kind) {
                        sec_history.push(entry_to_list_item(e, false, None));
                    }
                }
            }
            let n_sec_c = sec_container.len();
            let n_sec_h = sec_history.len();
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
                in_container_header: if user_global {
                    format!("容器中 · {ws_name}")
                } else {
                    "容器中".into()
                },
                in_container_summary: n_sec_c.to_string(),
                history_items: sec_history,
                history_header: if user_global {
                    format!("曾用于 · {ws_name}")
                } else {
                    "曾用于本容器".into()
                },
                history_summary: n_sec_h.to_string(),
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
            build_cluster_tree(&permanent_refs, settings.cluster_mode_index, &projects);
    }

    let n_lib = in_library_other.len();
    let n_c: usize = visible_container_sections
        .iter()
        .map(|s| s.in_container_items.len())
        .sum();
    let n_own: usize = visible_container_sections
        .iter()
        .map(|s| s.history_items.len())
        .sum();
    let status_text = if !configured {
        "尚未配置永久库目录。".into()
    } else if !load.healthy {
        format!(
            "台账加载失败，已禁止当空账使用：{}",
            load.error.as_deref().unwrap_or("unknown")
        )
    } else {
        format!("永久库已配置；容器中 {n_c}，曾用于 {n_own}，永久库 {n_lib}。")
    };

    let mut detail_markdown_file_path = String::new();
    let mut detail_source_path_display = String::new();
    let mut detail_summary_text = String::new();
    let mut detail_markdown_text = String::new();
    let mut detail_side_out = detail_side.clone();

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
                    find_live_path_in_active_container(e, lib, &container_root, user_global)
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

    let network_items = crate::network_library::network_list_items(settings);
    let net_configured = crate::network_library::effective_network_root(settings).is_some();
    let network_root_display = crate::network_library::effective_network_root(settings)
        .map(|p| to_display_path(&p))
        .unwrap_or_else(|| "（未配置）".into());
    let (network_official_nav, network_popular_nav) =
        crate::network_library::network_nav_for_snapshot(settings);

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

    let workspace_dtos: Vec<WorkspaceDto> = settings
        .workspaces
        .iter()
        .map(|w| WorkspaceDto {
            id: w.id.clone(),
            enabled: w.enabled,
            display_name: w.display_name.clone(),
            container_root: w.container_root.clone(),
            is_default: w.id.eq_ignore_ascii_case(&settings.default_workspace_id),
            is_visible: settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case(&w.id)),
            is_focused: w.id.eq_ignore_ascii_case(&focus_id),
        })
        .collect();

    let focus_own_header = visible_container_sections
        .iter()
        .find(|s| s.is_focused)
        .map(|s| s.history_header.clone())
        .unwrap_or_else(|| "曾用于本容器".into());

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
        purpose_taxonomy: settings.purpose_taxonomy.clone(),
        cluster_mode_index: settings.cluster_mode_index,
        cluster_mode_options: vec![
            "按层级用途".into(),
            "按项目归属".into(),
            "扁平".into(),
        ],
        directory_mode_options: vec![],
        show_user_rules_settings_hint: show_user_rules,
        user_rules_settings_hint_text: if show_user_rules {
            "用户规则在 Cursor 设置中编辑；本工具管理 .cursor 下的 skills/rules 等资产。".into()
        } else {
            String::new()
        },
        in_container_summary: in_container.len().to_string(),
        in_library_summary: (in_library_own.len() + n_lib).to_string(),
        in_library_own_summary: in_library_own.len().to_string(),
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
        network_library_items: network_items.clone(),
        network_library_summary: network_items.len().to_string(),
        network_library_header: "网络库（开源橱窗）".into(),
        is_network_library_configured: net_configured,
        network_library_root_display: network_root_display,
        network_official_nav,
        network_popular_nav,
        network_update_check_interval_minutes: settings.network_update_check_interval_minutes,
        skills_sh_configured: !settings.skills_sh_api_token.trim().is_empty(),
        selected_entry_ids: session_ids.clone(),
        selection_summary,
        detail_pane_mode: if !detail_markdown_file_path.is_empty() && detail_mode == "summary" {
            "markdown".into()
        } else {
            detail_mode
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
        app_settings_dir_display: settings_dir()
            .map(|p| to_display_path(&p.to_string_lossy()))
            .unwrap_or_default(),
        selected_directory_mode_index: settings.selected_directory_mode_index,
        is_custom_directory_mode: false,
        custom_base_directory: settings.custom_base_directory.clone(),
        selected_directory_display: String::new(),
        config_items: vec![],
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
        // Default: only Cursor visible under 全局工作区.
        let projects = vec![serde_json::json!({
            "id": "p1",
            "name": "Demo",
            "rootPath": "E:/demo",
            "pinned": true
        })];
        let nav = build_nav(&settings, &projects);
        assert_eq!(nav.len(), 2);
        assert_eq!(nav[0]["kind"], "category");
        assert_eq!(nav[0]["name"], "全局工作区");
        let tools = nav[0]["children"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["kind"], "global");
        assert_eq!(tools[0]["tool"], "cursor");
        settings.visible_workspace_ids =
            vec!["cursor".into(), "claude".into(), "codex".into()];
        let nav_all = build_nav(&settings, &projects);
        let tools_all = nav_all[0]["children"].as_array().unwrap();
        assert_eq!(tools_all.len(), 3);
        assert_eq!(tools_all[0]["tool"], "cursor");
        assert_eq!(tools_all[1]["tool"], "claude");
        assert_eq!(tools_all[2]["tool"], "codex");
        assert_eq!(nav[1]["kind"], "category");
        assert_eq!(nav[1]["name"], "项目");
        let groups = nav[1]["children"].as_array().unwrap();
        assert_eq!(groups[0]["kind"], "category");
        assert_eq!(groups[0]["name"], "置顶容器");
        let pinned = groups[0]["children"].as_array().unwrap();
        assert_eq!(pinned[0]["kind"], "project");
        assert_eq!(pinned[0]["projectId"], "p1");
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

        let in_c = entry_to_list_item(&e, true, Some("skills/bench-skill/SKILL.md"));
        assert!(in_c.is_in_active_use);
        assert!(in_c.subtitle.contains("当前容器"));
    }
}
