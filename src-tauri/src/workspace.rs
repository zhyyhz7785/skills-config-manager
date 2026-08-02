//! Global workspace model (Plan/04 + Plan/05 W2-S3a): Agent/tool slots with 1:1 container roots.

use serde::{Deserialize, Serialize};

use crate::active_container::user_global_tool_root;
use crate::settings::AppSettings;

/// Built-in probe + deploy slots (5～8 常用工具；非市场矩阵).
pub const BUILTIN_WORKSPACE_IDS: &[&str] = &[
    "cursor", "claude", "codex", "gemini", "opencode", "windsurf", "continue",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct WorkspaceConfig {
    pub id: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub display_name: String,
    /// Empty → use default `~/.{tool}` for built-ins.
    #[serde(default)]
    pub container_root: String,
}

fn default_true() -> bool {
    true
}

impl WorkspaceConfig {
    pub fn builtin(id: &str) -> Self {
        let nid = normalize_workspace_id(id).unwrap_or("cursor");
        let display_name = match nid {
            "claude" => "Claude",
            "codex" => "Codex",
            "gemini" => "Gemini CLI",
            "opencode" => "OpenCode",
            "windsurf" => "Windsurf",
            "continue" => "Continue",
            _ => "Cursor",
        };
        Self {
            id: nid.into(),
            enabled: true,
            display_name: display_name.into(),
            container_root: user_global_tool_root(nid),
        }
    }
}

pub fn normalize_workspace_id(id: &str) -> Option<&'static str> {
    match id.trim().to_lowercase().as_str() {
        "cursor" => Some("cursor"),
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "gemini" => Some("gemini"),
        "opencode" => Some("opencode"),
        "windsurf" => Some("windsurf"),
        "continue" | "continuedev" => Some("continue"),
        _ => None,
    }
}

/// Fill missing workspace fields from legacy `SelectedGlobalTool`. Returns true if mutated.
pub fn ensure_workspaces_migrated(settings: &mut AppSettings) -> bool {
    let mut changed = false;
    let focus = normalize_workspace_id(&settings.selected_global_tool).unwrap_or("cursor");

    if settings.workspaces.is_empty() {
        settings.workspaces = BUILTIN_WORKSPACE_IDS
            .iter()
            .map(|id| WorkspaceConfig::builtin(id))
            .collect();
        changed = true;
    } else {
        for id in BUILTIN_WORKSPACE_IDS {
            if !settings.workspaces.iter().any(|w| w.id.eq_ignore_ascii_case(id)) {
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
                w.display_name = WorkspaceConfig::builtin(&w.id).display_name;
                changed = true;
            }
            if w.container_root.trim().is_empty() {
                w.container_root = user_global_tool_root(&w.id);
                changed = true;
            }
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

    if settings.visible_workspace_ids.is_empty() {
        settings.visible_workspace_ids = vec![focus.into()];
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

    // Drop visibility for disabled workspaces.
    let enabled: Vec<String> = settings
        .workspaces
        .iter()
        .filter(|w| w.enabled)
        .filter_map(|w| normalize_workspace_id(&w.id).map(|s| s.to_string()))
        .collect();
    let vis_before = settings.visible_workspace_ids.clone();
    settings
        .visible_workspace_ids
        .retain(|id| enabled.iter().any(|e| e.eq_ignore_ascii_case(id)));
    if settings.visible_workspace_ids.is_empty() {
        let fallback = if enabled.iter().any(|e| e == &settings.default_workspace_id) {
            settings.default_workspace_id.clone()
        } else {
            enabled.first().cloned().unwrap_or_else(|| "cursor".into())
        };
        settings.visible_workspace_ids = vec![fallback];
    }
    if settings.visible_workspace_ids != vis_before {
        changed = true;
    }

    if settings.selected_global_tool != focus {
        settings.selected_global_tool = focus.into();
        changed = true;
    }
    let focus_enabled = settings
        .workspaces
        .iter()
        .find(|w| w.id.eq_ignore_ascii_case(focus))
        .map(|w| w.enabled)
        .unwrap_or(false);
    if !focus_enabled {
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

    let default_id = settings.default_workspace_id.clone();
    let default_ok = settings
        .workspaces
        .iter()
        .find(|w| w.id.eq_ignore_ascii_case(&default_id))
        .map(|w| w.enabled)
        .unwrap_or(false);
    if !default_ok {
        if let Some(first) = enabled.first() {
            settings.default_workspace_id = first.clone();
            changed = true;
        }
    }

    changed
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

/// Nav / list: enabled ∩ visible, stable builtin order then extras.
pub fn list_visible_workspaces(settings: &AppSettings) -> Vec<&WorkspaceConfig> {
    let mut out = Vec::new();
    for id in BUILTIN_WORKSPACE_IDS {
        if !settings
            .visible_workspace_ids
            .iter()
            .any(|v| v.eq_ignore_ascii_case(id))
        {
            continue;
        }
        if let Some(w) = workspace_by_id(settings, id) {
            if w.enabled {
                out.push(w);
            }
        }
    }
    for w in &settings.workspaces {
        if !w.enabled {
            continue;
        }
        if BUILTIN_WORKSPACE_IDS
            .iter()
            .any(|id| w.id.eq_ignore_ascii_case(id))
        {
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
    out
}

pub fn display_name_for(settings: &AppSettings, workspace_id: &str) -> String {
    workspace_by_id(settings, workspace_id)
        .map(|w| {
            let t = w.display_name.trim();
            if t.is_empty() {
                WorkspaceConfig::builtin(&w.id).display_name
            } else {
                t.to_string()
            }
        })
        .unwrap_or_else(|| WorkspaceConfig::builtin(workspace_id).display_name)
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
        assert_eq!(s.workspaces.len(), BUILTIN_WORKSPACE_IDS.len());
        assert!(s.workspaces.iter().any(|w| w.id == "claude" && w.enabled));
        assert!(s.workspaces.iter().any(|w| w.id == "gemini"));
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
        assert!(s.workspaces.len() >= 7);
    }

    #[test]
    fn dual_visible_workspaces_list_two_sections() {
        let mut s = AppSettings::default();
        ensure_workspaces_migrated(&mut s);
        s.visible_workspace_ids = vec!["cursor".into(), "claude".into()];
        let vis = list_visible_workspaces(&s);
        assert_eq!(vis.len(), 2);
        assert_eq!(vis[0].id, "cursor");
        assert_eq!(vis[1].id, "claude");
    }
}
