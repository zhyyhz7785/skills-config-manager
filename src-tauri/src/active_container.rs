//! Active container root from nav (align Electron `getActiveContainerRoot`).

use std::path::{Path, PathBuf};

use crate::catalog::{list_projects, load_catalog};
use crate::project_discovery::normalize_path;
use crate::settings::AppSettings;

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Global tool config root under the user profile (Learning/11 + SM adapter paths).
pub fn user_global_tool_root(tool: &str) -> String {
    let Some(home) = dirs_home() else {
        return String::new();
    };
    let id = crate::workspace::normalize_workspace_id(tool).unwrap_or("cursor");
    let rel = match id {
        "claude" => PathBuf::from(".claude"),
        "codex" => PathBuf::from(".codex"),
        "gemini" => PathBuf::from(".gemini"),
        // SM / Learning11: global OpenCode under ~/.config/opencode (not ~/.opencode)
        "opencode" => PathBuf::from(".config").join("opencode"),
        // SM: ~/.codeium/windsurf
        "windsurf" => PathBuf::from(".codeium").join("windsurf"),
        "continue" => PathBuf::from(".continue"),
        "copilot" => PathBuf::from(".copilot"),
        "aider" => PathBuf::from(".aider"),
        "goose" => PathBuf::from(".config").join("goose"),
        "amp" => PathBuf::from(".amp"),
        "cline" => PathBuf::from(".cline"),
        "roo" => PathBuf::from(".roo"),
        "trae" => PathBuf::from(".trae"),
        "kilocode" => PathBuf::from(".kilocode"),
        "crush" => PathBuf::from(".crush"),
        "droid" => PathBuf::from(".droid"),
        "warp" => PathBuf::from(".warp"),
        "zed" => PathBuf::from(".config").join("zed"),
        "vscode" => PathBuf::from(".vscode-skills"),
        "antigravity" => PathBuf::from(".antigravity"),
        "openclaw" => PathBuf::from(".openclaw"),
        "qoder" => PathBuf::from(".qoder"),
        "pi" => PathBuf::from(".pi"),
        "augment" => PathBuf::from(".augment"),
        _ => PathBuf::from(".cursor"),
    };
    home.join(rel).to_string_lossy().to_string()
}

fn known_user_global_rel_paths() -> Vec<PathBuf> {
    vec![
        PathBuf::from(".cursor"),
        PathBuf::from(".claude"),
        PathBuf::from(".codex"),
        PathBuf::from(".agents"),
        PathBuf::from(".gemini"),
        PathBuf::from(".opencode"), // legacy CCM default (still accept)
        PathBuf::from(".config").join("opencode"),
        PathBuf::from(".windsurf"), // legacy
        PathBuf::from(".codeium").join("windsurf"),
        PathBuf::from(".continue"),
        PathBuf::from(".copilot"),
        PathBuf::from(".aider"),
        PathBuf::from(".config").join("goose"),
        PathBuf::from(".amp"),
        PathBuf::from(".cline"),
        PathBuf::from(".roo"),
        PathBuf::from(".trae"),
        PathBuf::from(".kilocode"),
        PathBuf::from(".crush"),
        PathBuf::from(".droid"),
        PathBuf::from(".warp"),
        PathBuf::from(".config").join("zed"),
        PathBuf::from(".vscode-skills"),
        PathBuf::from(".antigravity"),
        PathBuf::from(".openclaw"),
        PathBuf::from(".qoder"),
        PathBuf::from(".pi"),
        PathBuf::from(".augment"),
    ]
}

/// Whether `container_root` is a user-level tool config directory under the profile.
pub fn is_user_global_container_root(container_root: &str) -> bool {
    if container_root.trim().is_empty() {
        return false;
    }
    let Some(home) = dirs_home() else {
        return false;
    };
    let norm = normalize_path(container_root.trim());
    let home_n = normalize_path(&home.to_string_lossy());
    for rel in known_user_global_rel_paths() {
        let full = normalize_path(&home.join(rel).to_string_lossy());
        if norm == full {
            return true;
        }
    }
    // Direct child `.tool` under home (forward-compat)
    let parent = Path::new(container_root.trim())
        .parent()
        .map(|p| normalize_path(&p.to_string_lossy()))
        .unwrap_or_default();
    if parent != home_n {
        return false;
    }
    let base = Path::new(container_root.trim())
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    base.starts_with('.') && base.len() > 1
}

/// Directory name under a project root for a tool slot (Plan/04 Should).
/// Project OpenCode stays `.opencode` (Learning/11); global uses `.config/opencode`.
pub fn project_tool_dir_name(tool: &str) -> &'static str {
    let id = crate::workspace::normalize_workspace_id(tool).unwrap_or("cursor");
    match id {
        "claude" => ".claude",
        "codex" => ".codex",
        "gemini" => ".gemini",
        "opencode" => ".opencode",
        "windsurf" => ".windsurf",
        "continue" => ".continue",
        "copilot" => ".copilot",
        "aider" => ".aider",
        "goose" => ".goose",
        "amp" => ".amp",
        "cline" => ".cline",
        "roo" => ".roo",
        "trae" => ".trae",
        "kilocode" => ".kilocode",
        "crush" => ".crush",
        "droid" => ".droid",
        "warp" => ".warp",
        "zed" => ".zed",
        "vscode" => ".vscode",
        "antigravity" => ".antigravity",
        "openclaw" => ".openclaw",
        "qoder" => ".qoder",
        "pi" => ".pi",
        "augment" => ".augment",
        _ => ".cursor",
    }
}

/// Resolve project-side container root for a tool (override map or `{root}/.{tool}`).
pub fn resolve_project_tool_container(
    project_root: &str,
    tool: &str,
    overrides: &std::collections::BTreeMap<String, String>,
) -> String {
    let tool_n = crate::workspace::normalize_workspace_id(tool).unwrap_or("cursor");
    if let Some(o) = overrides.get(tool_n).or_else(|| overrides.get(tool)) {
        let t = o.trim();
        if !t.is_empty() {
            return crate::project_discovery::to_display_path(t);
        }
    }
    let root = project_root.trim();
    if root.is_empty() {
        return String::new();
    }
    crate::project_discovery::to_display_path(
        &Path::new(root)
            .join(project_tool_dir_name(tool_n))
            .to_string_lossy(),
    )
}

/// Tool id + container root for `project_id` using the same tool-slot rules as the focused project.
/// Does not require that project to be the current nav focus.
pub fn resolve_project_container_slot(
    settings: &AppSettings,
    project_id: &str,
) -> Option<(String, String)> {
    let pid = project_id.trim();
    if pid.is_empty() {
        return None;
    }
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return None;
    }
    let load = load_catalog(lib);
    for p in list_projects(&load.catalog) {
        if p.id != pid {
            continue;
        }
        let root = p.root_path.trim();
        if root.is_empty() {
            return None;
        }
        let visible = p.effective_visible_tools();
        let focus = crate::workspace::normalize_workspace_id(&settings.selected_global_tool)
            .unwrap_or("cursor");
        let tool = if visible.iter().any(|t| t == focus) {
            focus
        } else {
            visible.first().map(|s| s.as_str()).unwrap_or("cursor")
        };
        let container = resolve_project_tool_container(root, tool, &p.tool_container_roots);
        if container.trim().is_empty() {
            return None;
        }
        return Some((tool.to_string(), container));
    }
    None
}

/// Project container root for `project_id` using the same tool-slot rules as the focused project.
/// Does not require that project to be the current nav focus.
pub fn resolve_project_container_root(settings: &AppSettings, project_id: &str) -> String {
    resolve_project_container_slot(settings, project_id)
        .map(|(_, root)| root)
        .unwrap_or_default()
}

/// Electron `getActiveContainerRoot`: global → focus workspace; project → focus tool under project root.
pub fn resolve_active_container_root(settings: &AppSettings) -> String {
    let kind = settings.nav_kind.trim().to_lowercase();
    if kind == "library" {
        return String::new();
    }
    if kind.is_empty() || kind == "global" {
        return crate::workspace::resolve_workspace_container_root(
            settings,
            &settings.selected_global_tool,
        );
    }
    if kind == "project" {
        let Some(pid) = settings.selected_project_id.as_ref().map(|s| s.trim()) else {
            return String::new();
        };
        return resolve_project_container_root(settings, pid);
    }
    String::new()
}

/// Path belongs to the active container tree (Electron `isPathInActiveContainerTree`).
pub fn is_path_in_active_container_tree(
    file_path: &str,
    container_root: &str,
    user_global: bool,
) -> bool {
    if file_path.trim().is_empty() || container_root.trim().is_empty() {
        return false;
    }
    let file_n = normalize_path(file_path);
    let root_n = normalize_path(container_root);
    if file_n == root_n || file_n.starts_with(&(root_n.clone() + "\\")) {
        return true;
    }
    if user_global {
        return false;
    }
    // Project: also any nested `.cursor` under project root
    let project_root = {
        let base = Path::new(container_root.trim())
            .file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if matches!(
            base.as_str(),
            ".cursor"
                | ".claude"
                | ".codex"
                | ".agents"
                | ".gemini"
                | ".opencode"
                | ".windsurf"
                | ".continue"
        ) {
            Path::new(container_root.trim())
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default()
        } else {
            container_root.trim().to_string()
        }
    };
    if project_root.trim().is_empty() {
        return false;
    }
    let proj_n = normalize_path(&project_root);
    if !(file_n == proj_n || file_n.starts_with(&(proj_n + "\\"))) {
        return false;
    }
    let lower = file_path.replace('/', "\\").to_lowercase();
    lower.contains("\\.cursor\\") || lower.ends_with("\\.cursor") || lower.contains("/.cursor/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{ensure_library_layout, upsert_project, CatalogProject};
    use std::fs;

    #[test]
    fn resolve_global_uses_tool_home() {
        let s = AppSettings {
            nav_kind: "global".into(),
            selected_global_tool: "cursor".into(),
            ..Default::default()
        };
        let root = resolve_active_container_root(&s);
        assert!(
            root.to_lowercase().ends_with(".cursor"),
            "{root}"
        );
        assert!(is_user_global_container_root(&root));
    }

    #[test]
    fn resolve_project_uses_dot_cursor() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("MyProj");
        fs::create_dir_all(proj.join(".cursor")).unwrap();
        upsert_project(
            &lib,
            CatalogProject {
                id: "pid1".into(),
                name: "MyProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                ..Default::default()
            },
        )
        .unwrap();
        let s = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("pid1".into()),
            ..Default::default()
        };
        let root = resolve_active_container_root(&s);
        assert!(
            normalize_path(&root)
                == normalize_path(&proj.join(".cursor").to_string_lossy()),
            "{root}"
        );
    }

    /// Plan/04 Should：项目焦点 Claude → `{root}/.claude`。
    #[test]
    fn resolve_project_focus_claude_tool() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let proj = dir.path().join("MyProj");
        fs::create_dir_all(proj.join(".cursor")).unwrap();
        fs::create_dir_all(proj.join(".claude")).unwrap();
        upsert_project(
            &lib,
            CatalogProject {
                id: "pid1".into(),
                name: "MyProj".into(),
                root_path: proj.to_string_lossy().to_string(),
                category: "Cursor项目".into(),
                pinned: true,
                visible_tools: vec!["cursor".into(), "claude".into()],
                ..Default::default()
            },
        )
        .unwrap();
        let s = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            nav_kind: "project".into(),
            selected_project_id: Some("pid1".into()),
            selected_global_tool: "claude".into(),
            ..Default::default()
        };
        let root = resolve_active_container_root(&s);
        assert!(
            normalize_path(&root)
                == normalize_path(&proj.join(".claude").to_string_lossy()),
            "{root}"
        );
    }
}
