//! Global workspace model: work area + backup pool + derived deploy mode (copy vs symlink).

use serde::{Deserialize, Serialize};

use crate::active_container::user_global_tool_root;
use crate::settings::AppSettings;

/// Work-area residents (always catalogued; default `InWorkArea=true`).
pub const PRIMARY_WORKSPACE_IDS: &[&str] = &["cursor", "claude", "codex"];

/// Frozen SM-style tool pool (backup area), **popularity order after PRIMARY**.
/// Paths resolved via `user_global_tool_root`. Order is inferred from 2026 AI coding
/// assistant market mindshare (IDE/CLI seats); Cursor leads via PRIMARY.
pub const BACKUP_WORKSPACE_CATALOG: &[BackupWorkspaceSpec] = &[
    BackupWorkspaceSpec {
        id: "copilot",
        display_name: "GitHub Copilot",
    },
    BackupWorkspaceSpec {
        id: "gemini",
        display_name: "Gemini CLI",
    },
    BackupWorkspaceSpec {
        id: "windsurf",
        display_name: "Windsurf",
    },
    BackupWorkspaceSpec {
        id: "continue",
        display_name: "Continue",
    },
    BackupWorkspaceSpec {
        id: "cline",
        display_name: "Cline",
    },
    BackupWorkspaceSpec {
        id: "aider",
        display_name: "Aider",
    },
    BackupWorkspaceSpec {
        id: "opencode",
        display_name: "OpenCode",
    },
    BackupWorkspaceSpec {
        id: "zed",
        display_name: "Zed",
    },
    BackupWorkspaceSpec {
        id: "vscode",
        display_name: "VS Code",
    },
    BackupWorkspaceSpec {
        id: "roo",
        display_name: "Roo",
    },
    BackupWorkspaceSpec {
        id: "trae",
        display_name: "Trae",
    },
    BackupWorkspaceSpec {
        id: "amp",
        display_name: "Amp",
    },
    BackupWorkspaceSpec {
        id: "goose",
        display_name: "Goose",
    },
    BackupWorkspaceSpec {
        id: "warp",
        display_name: "Warp",
    },
    BackupWorkspaceSpec {
        id: "antigravity",
        display_name: "Antigravity",
    },
    BackupWorkspaceSpec {
        id: "kilocode",
        display_name: "Kilo Code",
    },
    BackupWorkspaceSpec {
        id: "crush",
        display_name: "Crush",
    },
    BackupWorkspaceSpec {
        id: "droid",
        display_name: "Droid",
    },
    BackupWorkspaceSpec {
        id: "openclaw",
        display_name: "OpenClaw",
    },
    BackupWorkspaceSpec {
        id: "qoder",
        display_name: "Qoder",
    },
    BackupWorkspaceSpec {
        id: "pi",
        display_name: "Pi",
    },
    BackupWorkspaceSpec {
        id: "augment",
        display_name: "Augment",
    },
];

/// Legacy alias: primary ∪ former seven builtins (tests / callers).
#[allow(dead_code)]
pub const BUILTIN_WORKSPACE_IDS: &[&str] = &[
    "cursor", "claude", "codex", "gemini", "opencode", "windsurf", "continue",
];

#[derive(Debug, Clone, Copy)]
pub struct BackupWorkspaceSpec {
    pub id: &'static str,
    pub display_name: &'static str,
}

/// Derived layout mode for a work-area slot (not persisted per row).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeployMode {
    Copy,
    Symlink,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct WorkspaceConfig {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// True → member of work area (sidebar candidate); false → backup pool only.
    #[serde(default = "default_in_work_area")]
    pub in_work_area: bool,
    #[serde(default)]
    pub display_name: String,
    /// Empty → use default `~/.{tool}` for built-ins.
    #[serde(default)]
    pub container_root: String,
}

fn default_true() -> bool {
    true
}

fn default_in_work_area() -> bool {
    false
}

impl WorkspaceConfig {
    pub fn builtin(id: &str) -> Self {
        let nid = normalize_workspace_id(id).unwrap_or("cursor");
        let display_name = BACKUP_WORKSPACE_CATALOG
            .iter()
            .find(|s| s.id == nid)
            .map(|s| s.display_name.to_string())
            .unwrap_or_else(|| display_name_for_id(nid));
        let in_work_area = PRIMARY_WORKSPACE_IDS.iter().any(|p| *p == nid);
        Self {
            id: nid.into(),
            enabled: true,
            in_work_area,
            display_name,
            container_root: user_global_tool_root(nid),
        }
    }
}

pub fn display_name_for_id(id: &str) -> String {
    let nid = normalize_workspace_id(id).unwrap_or("cursor");
    match nid {
        "claude" => "Claude Code".into(),
        "codex" => "Codex".into(),
        "gemini" => "Gemini CLI".into(),
        "opencode" => "OpenCode".into(),
        "windsurf" => "Windsurf".into(),
        "continue" => "Continue".into(),
        "copilot" => "GitHub Copilot".into(),
        "aider" => "Aider".into(),
        "goose" => "Goose".into(),
        "amp" => "Amp".into(),
        "cline" => "Cline".into(),
        "roo" => "Roo".into(),
        "trae" => "Trae".into(),
        "kilocode" => "Kilo Code".into(),
        "crush" => "Crush".into(),
        "droid" => "Droid".into(),
        "warp" => "Warp".into(),
        "zed" => "Zed".into(),
        "vscode" => "VS Code".into(),
        "antigravity" => "Antigravity".into(),
        "openclaw" => "OpenClaw".into(),
        "qoder" => "Qoder".into(),
        "pi" => "Pi".into(),
        "augment" => "Augment".into(),
        _ => "Cursor".into(),
    }
}

pub fn all_known_ids() -> impl Iterator<Item = &'static str> {
    PRIMARY_WORKSPACE_IDS
        .iter()
        .copied()
        .chain(BACKUP_WORKSPACE_CATALOG.iter().map(|s| s.id))
}

/// All known + custom workspace slots → (tool id, display container root).
/// Used as default scan-build roots (path may not exist yet).
pub fn list_all_workspace_scan_roots(settings: &AppSettings) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in all_known_ids() {
        let path = resolve_workspace_container_root(settings, id);
        if path.trim().is_empty() {
            continue;
        }
        seen.insert(id.to_ascii_lowercase());
        out.push((id.to_string(), path));
    }
    for w in &settings.workspaces {
        let key = w.id.trim().to_ascii_lowercase();
        if key.is_empty() || seen.contains(&key) {
            continue;
        }
        let path = resolve_workspace_container_root(settings, &w.id);
        if path.trim().is_empty() {
            continue;
        }
        seen.insert(key);
        out.push((w.id.clone(), path));
    }
    out
}

/// After scan-build confirm: ensure Cursor + discovered tools are visible work-area members.
/// Only adds / promotes; never demotes other visible slots. Returns whether settings changed.
pub fn promote_workspaces_after_scan(settings: &mut AppSettings, discovered_tools: &[String]) -> bool {
    let _ = ensure_workspaces_migrated(settings);
    let mut want: Vec<String> = vec!["cursor".into()];
    for t in discovered_tools {
        let Some(nid) = normalize_workspace_id(t) else {
            continue;
        };
        if !want.iter().any(|x| x.eq_ignore_ascii_case(nid)) {
            want.push(nid.into());
        }
    }
    let mut changed = false;
    for tid in &want {
        let Some(nid) = normalize_workspace_id(tid) else {
            continue;
        };
        if let Some(w) = settings
            .workspaces
            .iter_mut()
            .find(|w| w.id.eq_ignore_ascii_case(nid))
        {
            if !w.enabled {
                w.enabled = true;
                changed = true;
            }
            if !w.in_work_area {
                w.in_work_area = true;
                changed = true;
            }
        } else {
            let mut w = WorkspaceConfig::builtin(nid);
            w.enabled = true;
            w.in_work_area = true;
            settings.workspaces.push(w);
            changed = true;
        }
        if !settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(nid))
        {
            settings.visible_workspace_ids.push(nid.into());
            changed = true;
        }
    }
    if changed {
        let _ = ensure_workspaces_migrated(settings);
    }
    changed
}

pub fn normalize_workspace_id(id: &str) -> Option<&'static str> {
    match id.trim().to_lowercase().as_str() {
        "cursor" => Some("cursor"),
        "claude" | "claude_code" | "claudecode" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" | "gemini_cli" | "geminicli" => Some("gemini"),
        "opencode" => Some("opencode"),
        "windsurf" => Some("windsurf"),
        "continue" | "continuedev" => Some("continue"),
        "copilot" | "github_copilot" | "githubcopilot" => Some("copilot"),
        "aider" => Some("aider"),
        "goose" => Some("goose"),
        "amp" => Some("amp"),
        "cline" => Some("cline"),
        "roo" | "roocode" => Some("roo"),
        "trae" => Some("trae"),
        "kilocode" | "kilo" => Some("kilocode"),
        "crush" => Some("crush"),
        "droid" => Some("droid"),
        "warp" => Some("warp"),
        "zed" => Some("zed"),
        "vscode" | "code" => Some("vscode"),
        "antigravity" => Some("antigravity"),
        "openclaw" => Some("openclaw"),
        "qoder" => Some("qoder"),
        "pi" => Some("pi"),
        "augment" => Some("augment"),
        _ => None,
    }
}

/// Whether this id is a primary work-area resident (catalog default; not a hard lock).
#[allow(dead_code)]
pub fn is_primary_workspace(id: &str) -> bool {
    normalize_workspace_id(id)
        .map(|n| PRIMARY_WORKSPACE_IDS.iter().any(|p| *p == n))
        .unwrap_or(false)
}

/// Deploy mode derived from default workspace id (copy only for the default slot).
pub fn deploy_mode_for(settings: &AppSettings, workspace_id: &str) -> DeployMode {
    let id = normalize_workspace_id(workspace_id).unwrap_or("cursor");
    let default_id =
        normalize_workspace_id(&settings.default_workspace_id).unwrap_or("cursor");
    if id.eq_ignore_ascii_case(default_id) {
        DeployMode::Copy
    } else {
        DeployMode::Symlink
    }
}

/// Fill missing workspace fields; migrate InWorkArea + backup catalog. Returns true if mutated.
pub fn ensure_workspaces_migrated(settings: &mut AppSettings) -> bool {
    let mut changed = false;
    let focus = normalize_workspace_id(&settings.selected_global_tool).unwrap_or("cursor");
    // Snapshot visibility before catalog fill (used for InWorkArea migration).
    let prior_visible: Vec<String> = settings.visible_workspace_ids.clone();

    if settings.workspaces.is_empty() {
        settings.workspaces = all_known_ids()
            .map(|id| WorkspaceConfig::builtin(id))
            .collect();
        changed = true;
    } else {
        for id in all_known_ids() {
            if !settings
                .workspaces
                .iter()
                .any(|w| w.id.eq_ignore_ascii_case(id))
            {
                settings.workspaces.push(WorkspaceConfig::builtin(id));
                changed = true;
            }
        }
        for w in &mut settings.workspaces {
            if let Some(nid) = normalize_workspace_id(&w.id) {
                if w.id != nid {
                    w.id = nid.into();
                    changed = true;
                }
            }
            if w.display_name.trim().is_empty() {
                w.display_name = display_name_for_id(&w.id);
                changed = true;
            } else if w.id.eq_ignore_ascii_case("claude") && w.display_name.trim() == "Claude" {
                // Rename legacy short label → Claude Code
                w.display_name = display_name_for_id("claude");
                changed = true;
            }
            if w.container_root.trim().is_empty() {
                w.container_root = user_global_tool_root(&w.id);
                changed = true;
            } else if should_upgrade_default_container_root(&w.id, &w.container_root) {
                w.container_root = user_global_tool_root(&w.id);
                changed = true;
            } else if crate::settings::is_stale_temp_path(&w.container_root) {
                // 测试残留的临时 home 派生根 → 回落到该工具默认安装目录
                let def = user_global_tool_root(&w.id);
                if !def.trim().is_empty() && def != w.container_root {
                    w.container_root = def;
                    changed = true;
                }
            }
        }
    }

    // Legacy only: still listed in VisibleWorkspaceIds but InWorkArea=false → promote.
    // Do not force PRIMARY back into the work area (user may close those eyes; keep ≥1 elsewhere).
    for w in &mut settings.workspaces {
        let Some(nid) = normalize_workspace_id(&w.id) else {
            continue;
        };
        let was_visible = prior_visible
            .iter()
            .any(|v| v.eq_ignore_ascii_case(nid));
        if was_visible && !w.in_work_area {
            w.in_work_area = true;
            changed = true;
        }
    }

    if settings.default_workspace_id.trim().is_empty()
        || normalize_workspace_id(&settings.default_workspace_id).is_none()
    {
        settings.default_workspace_id = focus.into();
        changed = true;
    } else {
        let d = normalize_workspace_id(&settings.default_workspace_id).unwrap();
        if settings.default_workspace_id != d {
            settings.default_workspace_id = d.into();
            changed = true;
        }
    }

    // Default must be in work area + enabled.
    {
        let def = settings.default_workspace_id.clone();
        let def_ok = settings
            .workspaces
            .iter()
            .find(|w| w.id.eq_ignore_ascii_case(&def))
            .map(|w| w.enabled && w.in_work_area)
            .unwrap_or(false);
        if !def_ok {
            let fallback = settings
                .workspaces
                .iter()
                .find(|w| w.enabled && w.in_work_area)
                .map(|w| w.id.clone())
                .unwrap_or_else(|| "cursor".into());
            if settings.default_workspace_id != fallback {
                settings.default_workspace_id = fallback;
                changed = true;
            }
        }
    }

    if settings.visible_workspace_ids.is_empty() {
        settings.visible_workspace_ids = vec![settings.default_workspace_id.clone()];
        changed = true;
    } else {
        let mut cleaned = Vec::new();
        for id in &settings.visible_workspace_ids {
            if let Some(nid) = normalize_workspace_id(id) {
                if !cleaned.iter().any(|x: &String| x == nid) {
                    cleaned.push(nid.into());
                }
            }
        }
        if cleaned.is_empty() {
            cleaned.push(settings.default_workspace_id.clone());
        }
        if cleaned != settings.visible_workspace_ids {
            settings.visible_workspace_ids = cleaned;
            changed = true;
        }
    }

    // Visibility only for in-work-area + enabled.
    let eligible: Vec<String> = settings
        .workspaces
        .iter()
        .filter(|w| w.enabled && w.in_work_area)
        .filter_map(|w| normalize_workspace_id(&w.id).map(|s| s.to_string()))
        .collect();
    let vis_before = settings.visible_workspace_ids.clone();
    settings
        .visible_workspace_ids
        .retain(|id| eligible.iter().any(|e| e.eq_ignore_ascii_case(id)));
    if settings.visible_workspace_ids.is_empty() {
        let fallback = if eligible
            .iter()
            .any(|e| e == &settings.default_workspace_id)
        {
            settings.default_workspace_id.clone()
        } else {
            eligible
                .first()
                .cloned()
                .unwrap_or_else(|| "cursor".into())
        };
        settings.visible_workspace_ids = vec![fallback];
    }
    // Repair limbo: InWorkArea+enabled but dropped from VisibleWorkspaceIds (eye/sync drift).
    // 首次迁移（此前无 VisibleWorkspaceIds）只保留 default 一项，勿把全部 PRIMARY 灌进可见列表。
    if !prior_visible.is_empty() {
        for id in &eligible {
            if !settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case(id))
            {
                settings.visible_workspace_ids.push(id.clone());
                changed = true;
            }
        }
    }
    if settings.visible_workspace_ids != vis_before {
        changed = true;
    }

    if settings.selected_global_tool != focus {
        // keep normalize
        let n = normalize_workspace_id(&settings.selected_global_tool).unwrap_or(focus);
        if settings.selected_global_tool != n {
            settings.selected_global_tool = n.into();
            changed = true;
        }
    }
    let focus_now = normalize_workspace_id(&settings.selected_global_tool).unwrap_or("cursor");
    let focus_ok = settings
        .workspaces
        .iter()
        .find(|w| w.id.eq_ignore_ascii_case(focus_now))
        .map(|w| w.enabled && w.in_work_area)
        .unwrap_or(false)
        && settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(focus_now));
    if !focus_ok {
        let next = settings
            .visible_workspace_ids
            .first()
            .cloned()
            .unwrap_or_else(|| settings.default_workspace_id.clone());
        if settings.selected_global_tool != next {
            settings.selected_global_tool = next;
            changed = true;
        }
    }

    changed
}

/// Upgrade only when root still matches the previous hard-coded default (not user custom).
fn should_upgrade_default_container_root(id: &str, current: &str) -> bool {
    let nid = match normalize_workspace_id(id) {
        Some(n) => n,
        None => return false,
    };
    let cur = current.trim().replace('/', "\\").to_lowercase();
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|h| h.to_string_lossy().replace('/', "\\").to_lowercase())
        .unwrap_or_default();
    if home.is_empty() {
        return false;
    }
    match nid {
        "opencode" => {
            // Old CCM default ~/.opencode → SM/Learning11 ~/.config/opencode
            let old = format!("{home}\\.opencode");
            cur == old
        }
        "windsurf" => {
            let old = format!("{home}\\.windsurf");
            cur == old
        }
        _ => false,
    }
}

pub fn workspace_by_id<'a>(settings: &'a AppSettings, id: &str) -> Option<&'a WorkspaceConfig> {
    let nid = normalize_workspace_id(id)?;
    settings
        .workspaces
        .iter()
        .find(|w| w.id.eq_ignore_ascii_case(nid))
}

pub fn resolve_workspace_container_root(settings: &AppSettings, workspace_id: &str) -> String {
    let id = normalize_workspace_id(workspace_id).unwrap_or("cursor");
    if let Some(w) = workspace_by_id(settings, id) {
        let t = w.container_root.trim();
        if !t.is_empty() {
            return crate::project_discovery::to_display_path(t);
        }
    }
    user_global_tool_root(id)
}

fn sort_workspaces_by_nav_order<'a>(
    settings: &AppSettings,
    mut out: Vec<&'a WorkspaceConfig>,
) -> Vec<&'a WorkspaceConfig> {
    out.sort_by(|a, b| {
        workspace_nav_rank(settings, &a.id).cmp(&workspace_nav_rank(settings, &b.id))
    });
    out
}

/// Rank for nav/settings: user `WorkspaceNavOrder` first, then catalog popularity.
pub fn workspace_nav_rank(settings: &AppSettings, id: &str) -> usize {
    let nid = normalize_workspace_id(id).unwrap_or("");
    if let Some(pos) = settings
        .workspace_nav_order
        .iter()
        .position(|x| x.eq_ignore_ascii_case(nid))
    {
        return pos;
    }
    10_000 + workspace_popularity_rank(id)
}

/// Nav / list: in-work-area ∩ enabled ∩ visible, user nav order then catalog.
pub fn list_visible_workspaces(settings: &AppSettings) -> Vec<&WorkspaceConfig> {
    let mut out = Vec::new();
    for id in all_known_ids() {
        if !settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(id))
        {
            continue;
        }
        if let Some(w) = workspace_by_id(settings, id) {
            if w.enabled && w.in_work_area {
                out.push(w);
            }
        }
    }
    for w in &settings.workspaces {
        if !w.enabled || !w.in_work_area {
            continue;
        }
        if all_known_ids().any(|id| w.id.eq_ignore_ascii_case(id)) {
            continue;
        }
        if settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(&w.id))
        {
            out.push(w);
        }
    }
    sort_workspaces_by_nav_order(settings, out)
}

/// Work-area rows for settings (in_work_area), stable catalog order.
#[allow(dead_code)]
pub fn list_work_area_workspaces(settings: &AppSettings) -> Vec<&WorkspaceConfig> {
    let mut out = Vec::new();
    for id in all_known_ids() {
        if let Some(w) = workspace_by_id(settings, id) {
            if w.in_work_area {
                out.push(w);
            }
        }
    }
    for w in &settings.workspaces {
        if !w.in_work_area {
            continue;
        }
        if all_known_ids().any(|id| w.id.eq_ignore_ascii_case(id)) {
            continue;
        }
        out.push(w);
    }
    out
}

/// Backup-pool rows (not in work area). Includes demoted PRIMARY (Claude/Codex/…).
pub fn list_backup_pool_workspaces(settings: &AppSettings) -> Vec<&WorkspaceConfig> {
    let mut out = Vec::new();
    for id in all_known_ids() {
        if let Some(w) = workspace_by_id(settings, id) {
            if !w.in_work_area {
                out.push(w);
            }
        }
    }
    for w in &settings.workspaces {
        if w.in_work_area {
            continue;
        }
        if all_known_ids().any(|id| w.id.eq_ignore_ascii_case(id)) {
            continue;
        }
        out.push(w);
    }
    sort_workspaces_by_nav_order(settings, out)
}

/// Popularity rank for settings / pool ordering (lower = hotter). Cursor = 0.
pub fn workspace_popularity_rank(id: &str) -> usize {
    let nid = normalize_workspace_id(id).unwrap_or("");
    all_known_ids()
        .position(|x| x == nid)
        .unwrap_or(usize::MAX)
}

/// Persist user workspace nav order (settings).
/// When `peer_ids` is set, `to_index` / direction are relative to that subset, then stitched back.
pub fn reorder_workspace_nav(
    settings: &mut AppSettings,
    id: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
    peer_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let Some(nid) = normalize_workspace_id(id) else {
        return Err("未知工作区".into());
    };
    let known: Vec<String> = settings.workspaces.iter().map(|w| w.id.clone()).collect();
    if settings.workspace_nav_order.is_empty() {
        settings.workspace_nav_order = all_known_ids().map(|s| s.to_string()).collect();
        crate::list_order::sync_order_with_known(&mut settings.workspace_nav_order, &known);
    } else {
        crate::list_order::sync_order_with_known(&mut settings.workspace_nav_order, &known);
    }
    if let Some(peers_raw) = peer_ids {
        let peers: Vec<String> = peers_raw
            .iter()
            .filter_map(|p| normalize_workspace_id(p).map(|s| s.to_string()))
            .collect();
        crate::list_order::reorder_ids_among_peers(
            &mut settings.workspace_nav_order,
            &peers,
            nid,
            direction,
            to_index,
        )?;
    } else {
        crate::list_order::reorder_ids(
            &mut settings.workspace_nav_order,
            nid,
            direction,
            to_index,
        )?;
    }
    Ok(())
}

pub fn display_name_for(settings: &AppSettings, workspace_id: &str) -> String {
    workspace_by_id(settings, workspace_id)
        .map(|w| {
            let t = w.display_name.trim();
            if t.is_empty() {
                display_name_for_id(&w.id)
            } else {
                t.to_string()
            }
        })
        .unwrap_or_else(|| display_name_for_id(workspace_id))
}

/// Bulk set `in_work_area` for the given workspace ids (eye open/close).
/// Closing refuses to hide the last in-work-area workspace; demoting the default
/// slot auto-moves default to another still-visible member.
pub fn set_many_in_work_area(
    settings: &mut AppSettings,
    ids: &[String],
    in_work_area: bool,
) -> Result<(), String> {
    let mut targets: Vec<&'static str> = Vec::new();
    for id in ids {
        let Some(nid) = normalize_workspace_id(id) else {
            continue;
        };
        if !targets.iter().any(|x| *x == nid) {
            targets.push(nid);
        }
    }
    if targets.is_empty() {
        return Err("未指定有效工作区".into());
    }

    if !in_work_area {
        let closing: Vec<&str> = targets
            .iter()
            .copied()
            .filter(|nid| {
                settings
                    .workspaces
                    .iter()
                    .find(|w| w.id.eq_ignore_ascii_case(nid))
                    .map(|w| w.in_work_area)
                    .unwrap_or(false)
            })
            .collect();
        if !closing.is_empty() {
            let remaining = settings
                .workspaces
                .iter()
                .filter(|w| {
                    w.enabled
                        && w.in_work_area
                        && !closing
                            .iter()
                            .any(|c| w.id.eq_ignore_ascii_case(c))
                })
                .count();
            if remaining == 0 {
                return Err("至少保留一个工作区显示，不能关闭最后一个".into());
            }
            if closing
                .iter()
                .any(|c| settings.default_workspace_id.eq_ignore_ascii_case(c))
            {
                if let Some(fallback) = settings.workspaces.iter().find(|w| {
                    w.enabled
                        && w.in_work_area
                        && !closing
                            .iter()
                            .any(|c| w.id.eq_ignore_ascii_case(c))
                }) {
                    settings.default_workspace_id = fallback.id.clone();
                }
            }
        }
    }

    for nid in &targets {
        let Some(w) = settings
            .workspaces
            .iter_mut()
            .find(|w| w.id.eq_ignore_ascii_case(nid))
        else {
            continue;
        };
        w.in_work_area = in_work_area;
        if in_work_area {
            w.enabled = true;
        }
    }

    for nid in &targets {
        if in_work_area {
            if !settings
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case(nid))
            {
                settings.visible_workspace_ids.push((*nid).into());
            }
        } else {
            settings
                .visible_workspace_ids
                .retain(|v| !v.eq_ignore_ascii_case(nid));
        }
    }

    // Keep focus if still in work area; else default or first visible.
    let focus = settings.selected_global_tool.clone();
    let focus_ok = settings.workspaces.iter().any(|w| {
        w.id.eq_ignore_ascii_case(&focus) && w.enabled && w.in_work_area
    });
    if !focus_ok {
        let next = if settings.workspaces.iter().any(|w| {
            w.id.eq_ignore_ascii_case(&settings.default_workspace_id)
                && w.enabled
                && w.in_work_area
        }) {
            settings.default_workspace_id.clone()
        } else {
            settings
                .workspaces
                .iter()
                .find(|w| w.enabled && w.in_work_area)
                .map(|w| w.id.clone())
                .unwrap_or_else(|| settings.default_workspace_id.clone())
        };
        settings.selected_global_tool = next;
    }

    let _ = ensure_workspaces_migrated(settings);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrate_from_selected_tool_only() {
        let mut s = AppSettings {
            selected_global_tool: "claude".into(),
            ..Default::default()
        };
        assert!(ensure_workspaces_migrated(&mut s));
        assert_eq!(s.default_workspace_id, "claude");
        assert_eq!(s.visible_workspace_ids, vec!["claude".to_string()]);
        assert!(s.workspaces.len() >= PRIMARY_WORKSPACE_IDS.len() + BACKUP_WORKSPACE_CATALOG.len());
        assert!(s.workspaces.iter().any(|w| w.id == "claude" && w.enabled && w.in_work_area));
        assert!(s.workspaces.iter().any(|w| w.id == "gemini" && !w.in_work_area));
        let root = resolve_workspace_container_root(&s, "claude");
        assert!(root.to_lowercase().ends_with(".claude"), "{root}");
    }

    #[test]
    fn default_settings_migrate_to_cursor_visible() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        assert_eq!(s.default_workspace_id, "cursor");
        assert_eq!(s.visible_workspace_ids, vec!["cursor".to_string()]);
        assert_eq!(list_visible_workspaces(&s).len(), 1);
        assert_eq!(list_visible_workspaces(&s)[0].id, "cursor");
        assert!(s.workspaces.iter().filter(|w| w.in_work_area).count() >= 3);
    }

    #[test]
    fn demoting_primary_persists_across_migrate() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.in_work_area = false;
        }
        s.visible_workspace_ids = vec!["cursor".into()];
        let _ = ensure_workspaces_migrated(&mut s);
        let claude = s.workspaces.iter().find(|w| w.id == "claude").unwrap();
        assert!(
            !claude.in_work_area,
            "closing eye on Claude must not be forced back by migrate"
        );
        let pool = list_backup_pool_workspaces(&s);
        assert!(
            pool.iter().any(|w| w.id == "claude"),
            "demoted Claude Code must remain in tool pool"
        );
        assert!(
            !pool.iter().any(|w| w.id == "codex"),
            "Codex still in work area → not in pool"
        );
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "codex") {
            w.in_work_area = false;
        }
        let pool2 = list_backup_pool_workspaces(&s);
        assert!(pool2.iter().any(|w| w.id == "codex"));
        let ids: Vec<&str> = pool2.iter().map(|w| w.id.as_str()).collect();
        let i_claude = ids.iter().position(|x| *x == "claude").unwrap();
        let i_copilot = ids.iter().position(|x| *x == "copilot").unwrap();
        assert!(i_claude < i_copilot, "Claude before Copilot in pool: {ids:?}");
    }

    #[test]
    fn dual_visible_workspaces_list_two_sections() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let vis = list_visible_workspaces(&s);
        assert_eq!(vis.len(), 2, "{:?}", vis.iter().map(|w| &w.id).collect::<Vec<_>>());
        assert_eq!(vis[0].id, "cursor");
        assert_eq!(vis[1].id, "claude");
    }

    #[test]
    fn repair_in_work_area_missing_from_visible_ids() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let codex = s.workspaces.iter_mut().find(|w| w.id == "codex").unwrap();
        codex.in_work_area = true;
        assert!(
            !s.visible_workspace_ids.iter().any(|v| v == "codex"),
            "setup: codex must start absent from visible list"
        );
        let _ = ensure_workspaces_migrated(&mut s);
        assert!(
            s.visible_workspace_ids.iter().any(|v| v == "codex"),
            "migrate must restore codex to visible when still in work area"
        );
        assert_eq!(list_visible_workspaces(&s).len(), 3);
    }

    #[test]
    fn reorder_workspace_nav_peer_subset_changes_visible_relative_order() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        // Interleave: pool id between two visible → naive full-list toIndex=1 would no-op visually.
        s.workspace_nav_order = vec![
            "cursor".into(),
            "copilot".into(),
            "claude".into(),
            "codex".into(),
        ];
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into(), "codex".into()];
        let peers = vec!["cursor".into(), "claude".into(), "codex".into()];
        reorder_workspace_nav(&mut s, "cursor", None, Some(1), Some(peers)).unwrap();
        let vis = list_visible_workspaces(&s);
        let ids: Vec<&str> = vis.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, vec!["claude", "cursor", "codex"], "{ids:?}");
        let i_claude = s
            .workspace_nav_order
            .iter()
            .position(|x| x == "claude")
            .unwrap();
        let i_copilot = s
            .workspace_nav_order
            .iter()
            .position(|x| x == "copilot")
            .unwrap();
        let i_cursor = s
            .workspace_nav_order
            .iter()
            .position(|x| x == "cursor")
            .unwrap();
        assert!(
            i_claude < i_copilot && i_copilot < i_cursor,
            "peer stitch keeps non-peer slot: {:?}",
            s.workspace_nav_order
        );
    }

    #[test]
    fn deploy_mode_default_copy_others_symlink() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        assert_eq!(deploy_mode_for(&s, "cursor"), DeployMode::Copy);
        assert_eq!(deploy_mode_for(&s, "claude"), DeployMode::Symlink);
        s.default_workspace_id = "claude".into();
        assert_eq!(deploy_mode_for(&s, "claude"), DeployMode::Copy);
        assert_eq!(deploy_mode_for(&s, "cursor"), DeployMode::Symlink);
    }

    #[test]
    fn promote_visible_backup_into_work_area() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        // Simulate legacy: gemini was visible before InWorkArea existed
        s.visible_workspace_ids = vec!["cursor".into(), "gemini".into()];
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "gemini") {
            w.in_work_area = false;
        }
        assert!(ensure_workspaces_migrated(&mut s));
        let g = s.workspaces.iter().find(|w| w.id == "gemini").unwrap();
        assert!(g.in_work_area, "visible backup id should promote into work area");
    }

    #[test]
    fn migrate_heals_stale_temp_container_root() {
        let home = tempfile::tempdir().unwrap();
        std::env::set_var("USERPROFILE", home.path());
        std::env::set_var("HOME", home.path());
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        // 模拟测试残留：容器根指向已删除的临时目录
        let stale = std::env::temp_dir()
            .join(".tmp-gone-ccm-test")
            .join(".cursor");
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "cursor") {
            w.container_root = stale.to_string_lossy().to_string();
        }
        assert!(ensure_workspaces_migrated(&mut s));
        let root = resolve_workspace_container_root(&s, "cursor");
        assert!(
            !root.contains(".tmp-gone-ccm-test"),
            "stale temp root must be healed: {root}"
        );
        assert!(root.to_lowercase().ends_with(".cursor"), "{root}");
        // 存在的自定义根（即使在 temp 下）不得被重置
        let custom = home.path().join("custom-root");
        std::fs::create_dir_all(&custom).unwrap();
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "cursor") {
            w.container_root = custom.to_string_lossy().to_string();
        }
        let _ = ensure_workspaces_migrated(&mut s);
        let root2 = resolve_workspace_container_root(&s, "cursor");
        assert!(root2.to_lowercase().contains("custom-root"), "{root2}");
    }

    #[test]
    fn container_root_survives_settings_file_roundtrip() {
        use crate::settings::{load_settings_from, save_settings_to};
        use std::fs;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let custom = dir.path().join("custom-claude-root");
        fs::create_dir_all(&custom).unwrap();

        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        let custom_disp = crate::project_discovery::to_display_path(&custom.to_string_lossy());
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "claude") {
            w.enabled = true;
            w.container_root = custom_disp.clone();
        }
        save_settings_to(&path, &s).unwrap();

        let mut loaded = load_settings_from(&path).unwrap();
        ensure_workspaces_migrated(&mut loaded);
        let root = resolve_workspace_container_root(&loaded, "claude");
        assert_eq!(
            root.to_lowercase(),
            custom_disp.to_lowercase(),
            "reload must keep custom Claude container root"
        );
    }

    #[test]
    fn default_workspace_persists_and_visibility_falls_back_focus() {
        use crate::settings::{load_settings_from, save_settings_to};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        for id in ["cursor", "claude"] {
            if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == id) {
                w.enabled = true;
                w.in_work_area = true;
            }
        }
        s.default_workspace_id = "claude".into();
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        s.selected_global_tool = "claude".into();
        save_settings_to(&path, &s).unwrap();

        let mut loaded = load_settings_from(&path).unwrap();
        ensure_workspaces_migrated(&mut loaded);
        assert_eq!(loaded.default_workspace_id, "claude");
        assert!(loaded
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case("claude")));

        loaded.visible_workspace_ids = vec!["cursor".into()];
        let focus = loaded.selected_global_tool.clone();
        if !loaded
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(&focus))
        {
            let next = if loaded
                .visible_workspace_ids
                .iter()
                .any(|v| v.eq_ignore_ascii_case(&loaded.default_workspace_id))
            {
                loaded.default_workspace_id.clone()
            } else {
                loaded.visible_workspace_ids[0].clone()
            };
            loaded.selected_global_tool = next;
        }
        assert_eq!(loaded.selected_global_tool, "cursor");
        assert_eq!(loaded.default_workspace_id, "claude");
    }

    #[test]
    fn set_many_refuses_closing_last() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        for w in s.workspaces.iter_mut() {
            w.in_work_area = w.id == "cursor";
            w.enabled = true;
        }
        s.visible_workspace_ids = vec!["cursor".into()];
        s.default_workspace_id = "cursor".into();
        let err = set_many_in_work_area(&mut s, &["cursor".into()], false).unwrap_err();
        assert!(err.contains("至少保留一个"), "{err}");
        assert!(s.workspaces.iter().any(|w| w.id == "cursor" && w.in_work_area));
    }

    #[test]
    fn set_many_closing_default_moves_default() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        for id in ["cursor", "claude"] {
            if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == id) {
                w.in_work_area = true;
                w.enabled = true;
            }
        }
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        s.default_workspace_id = "cursor".into();
        s.selected_global_tool = "cursor".into();
        set_many_in_work_area(&mut s, &["cursor".into()], false).unwrap();
        assert!(!s
            .workspaces
            .iter()
            .find(|w| w.id == "cursor")
            .unwrap()
            .in_work_area);
        assert_eq!(s.default_workspace_id, "claude");
        assert_eq!(s.selected_global_tool, "claude");
    }

    #[test]
    fn set_many_open_enables_and_pins_visible() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        if let Some(w) = s.workspaces.iter_mut().find(|w| w.id == "gemini") {
            w.in_work_area = false;
            w.enabled = false;
        }
        s.visible_workspace_ids = vec!["cursor".into()];
        set_many_in_work_area(&mut s, &["gemini".into()], true).unwrap();
        let g = s.workspaces.iter().find(|w| w.id == "gemini").unwrap();
        assert!(g.in_work_area && g.enabled);
        assert!(s
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case("gemini")));
    }
}
