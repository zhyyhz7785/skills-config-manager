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

/// Global tool config root under the user profile (Plan/05 W2-S3a 探测表).
pub fn user_global_tool_root(tool: &str) -> String {
    let Some(home) = dirs_home() else {
        return String::new();
    };
    let name = match tool.trim().to_lowercase().as_str() {
        "claude" => ".claude",
        "codex" => ".codex",
        "gemini" => ".gemini",
        "opencode" => ".opencode",
        "windsurf" => ".windsurf",
        "continue" | "continuedev" => ".continue",
        _ => ".cursor",
    };
    home.join(name).to_string_lossy().to_string()
}

/// Whether `container_root` is a user-level tool config directory under the profile.
pub fn is_user_global_container_root(container_root: &str) -> bool {
    if container_root.trim().is_empty() {
        return false;
    }
    let Some(home) = dirs_home() else {
        return false;
    };
    let parent = Path::new(container_root.trim())
        .parent()
        .map(|p| normalize_path(&p.to_string_lossy()))
        .unwrap_or_default();
    if parent != normalize_path(&home.to_string_lossy()) {
        return false;
    }
    let base = Path::new(container_root.trim())
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    matches!(
        base.as_str(),
        ".cursor"
            | ".claude"
            | ".codex"
            | ".agents"
            | ".gemini"
            | ".opencode"
            | ".windsurf"
            | ".continue"
    )
}

/// Electron `getActiveContainerRoot`: global → focus workspace container; project → `{root}/.cursor`.
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
        if pid.is_empty() {
            return String::new();
        }
        let lib = settings.skills_library_root.trim();
        if lib.is_empty() {
            return String::new();
        }
        let load = load_catalog(lib);
        for p in list_projects(&load.catalog) {
            if p.id == pid {
                let root = p.root_path.trim();
                if root.is_empty() {
                    return String::new();
                }
                return crate::project_discovery::to_display_path(
                    &Path::new(root).join(".cursor").to_string_lossy(),
                );
            }
        }
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
}
