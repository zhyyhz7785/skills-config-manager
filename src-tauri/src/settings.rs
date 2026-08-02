//! AppData settings for CCM-Tauri2 — Electron-compatible PascalCase JSON.
//! Unknown fields are preserved via `extra` so sidecar and Rust can share one file.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::workspace::{ensure_workspaces_migrated, WorkspaceConfig};

pub const APP_SETTINGS_DIR_NAME: &str = "CCM-Tauri2";
pub const DEFAULT_LIBRARY_ROOT: &str = r"C:\CursorSkills-Tauri2Spike";
pub const DEFAULT_SPIKE_CONTAINER_REL: &str = ".spike-container";
/// Electron `SettingsService.getBackupRoot` fallback when `BackupRoot` is empty.
pub const DEFAULT_BACKUP_ROOT: &str = r"E:\cursorBf";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AppSettings {
    #[serde(default)]
    pub skills_library_root: String,
    #[serde(default)]
    pub library_root_configured: bool,
    /// Network library root (Plan/03 quarantine cache; ≠ permanent library).
    #[serde(default)]
    pub network_library_root: String,
    #[serde(default)]
    pub network_library_configured: bool,
    #[serde(default)]
    pub network_official_pinned_ids: Vec<String>,
    #[serde(default)]
    pub network_popular_pinned_ids: Vec<String>,
    #[serde(default)]
    pub network_agent_repo_overrides: std::collections::HashMap<String, String>,
    /// 0 = disabled; minutes between checkNetworkUpdates only (never apply).
    #[serde(default)]
    pub network_update_check_interval_minutes: i32,
    /// Optional skills.sh Bearer token (empty = disabled). Never log.
    #[serde(default)]
    pub skills_sh_api_token: String,
    #[serde(default)]
    pub active_container_root: String,
    #[serde(default)]
    pub backup_root: String,
    #[serde(default)]
    pub purpose_taxonomy: Vec<String>,
    #[serde(default)]
    pub selected_project_id: Option<String>,
    #[serde(default)]
    pub show_global_only: bool,
    #[serde(default = "default_nav_kind")]
    pub nav_kind: String,
    #[serde(default = "default_tool")]
    pub selected_global_tool: String,
    /// Plan/04 default workspace id (cursor | claude | codex).
    #[serde(default)]
    pub default_workspace_id: String,
    /// Plan/04 visible workspace ids (multi-select for nav + list sections).
    #[serde(default)]
    pub visible_workspace_ids: Vec<String>,
    /// Plan/04 per-workspace config (enabled / display / container root).
    #[serde(default)]
    pub workspaces: Vec<WorkspaceConfig>,
    #[serde(default)]
    pub cluster_mode_index: i32,
    #[serde(default)]
    pub purpose_domain_filter_index: i32,
    #[serde(default)]
    pub selected_directory_mode_index: i32,
    #[serde(default)]
    pub custom_base_directory: String,
    #[serde(default)]
    pub project_scan_roots: Vec<String>,
    #[serde(default = "default_scan_depth")]
    pub project_scan_max_depth: i32,
    #[serde(default)]
    pub auto_scan_projects_on_startup: bool,
    #[serde(default)]
    pub library_filter_initialized: bool,
    #[serde(default = "default_true")]
    pub filter_show_skills: bool,
    #[serde(default = "default_true")]
    pub filter_show_rules: bool,
    #[serde(default = "default_true")]
    pub filter_show_agents: bool,
    #[serde(default = "default_true")]
    pub filter_show_commands: bool,
    #[serde(default = "default_true")]
    pub filter_show_hooks: bool,
    #[serde(default = "default_nav_width")]
    pub ui_nav_width: i32,
    #[serde(default = "default_list_width")]
    pub ui_list_width: i32,
    #[serde(default = "default_true")]
    pub ui_nav_visible: bool,
    #[serde(default = "default_true")]
    pub ui_detail_visible: bool,
    /// Preserve any keys Electron/sidecar wrote that we don't model yet.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn default_nav_kind() -> String {
    "global".into()
}
fn default_tool() -> String {
    "cursor".into()
}
fn default_scan_depth() -> i32 {
    5
}
fn default_true() -> bool {
    true
}
fn default_nav_width() -> i32 {
    220
}
fn default_list_width() -> i32 {
    480
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            skills_library_root: String::new(),
            library_root_configured: false,
            network_library_root: String::new(),
            network_library_configured: false,
            network_official_pinned_ids: vec![],
            network_popular_pinned_ids: vec![],
            network_agent_repo_overrides: std::collections::HashMap::new(),
            network_update_check_interval_minutes: 0,
            skills_sh_api_token: String::new(),
            active_container_root: String::new(),
            backup_root: String::new(),
            purpose_taxonomy: vec![],
            selected_project_id: None,
            show_global_only: false,
            nav_kind: default_nav_kind(),
            selected_global_tool: default_tool(),
            default_workspace_id: String::new(),
            visible_workspace_ids: vec![],
            workspaces: vec![],
            cluster_mode_index: 0,
            purpose_domain_filter_index: 0,
            selected_directory_mode_index: 0,
            custom_base_directory: String::new(),
            project_scan_roots: vec![],
            project_scan_max_depth: 5,
            auto_scan_projects_on_startup: false,
            library_filter_initialized: false,
            filter_show_skills: true,
            filter_show_rules: true,
            filter_show_agents: true,
            filter_show_commands: true,
            filter_show_hooks: true,
            ui_nav_width: 220,
            ui_list_width: 480,
            ui_nav_visible: true,
            ui_detail_visible: true,
            extra: Map::new(),
        }
    }
}

pub fn default_spike_container_root(library_root: &str) -> String {
    Path::new(library_root.trim())
        .join(DEFAULT_SPIKE_CONTAINER_REL)
        .to_string_lossy()
        .to_string()
}

pub fn settings_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
    Ok(PathBuf::from(appdata).join(APP_SETTINGS_DIR_NAME))
}

pub fn settings_file() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let mut s = load_settings_from(&settings_file()?)?;
    // In-memory only: avoid write-on-read races in tests / concurrent loads.
    // Persistence happens on the next save_settings (set_nav / settings UI / etc.).
    let _ = ensure_workspaces_migrated(&mut s);
    let _ = crate::network_catalog::ensure_network_pin_defaults(&mut s);
    Ok(s)
}

pub fn load_settings_from(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("read settings: {e}"))?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    serde_json::from_str(raw).map_err(|e| format!("parse settings: {e}"))
}

/// Merge-save: serialize typed fields then re-apply any `extra` keys not overwritten.
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let mut s = settings.clone();
    let _ = ensure_workspaces_migrated(&mut s);
    let dir = settings_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir settings: {e}"))?;
    save_settings_to(&dir.join("settings.json"), &s)
}

pub fn save_settings_to(path: &Path, settings: &AppSettings) -> Result<(), String> {
    let mut merged = if path.exists() {
        let existing = fs::read_to_string(path).unwrap_or_default();
        let existing = existing.strip_prefix('\u{feff}').unwrap_or(&existing);
        serde_json::from_str::<Value>(existing)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default()
    } else {
        Map::new()
    };

    let typed = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    if let Some(obj) = typed.as_object() {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir settings: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(&Value::Object(merged)).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| format!("write settings: {e}"))
}

pub fn effective_library_root(settings: &AppSettings) -> Option<String> {
    if settings.library_root_configured {
        let t = settings.skills_library_root.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

/// Resolve backup root for scan/config (Electron `getBackupRoot`).
pub fn resolve_backup_root(settings: &AppSettings) -> PathBuf {
    let t = settings.backup_root.trim();
    if t.is_empty() {
        PathBuf::from(DEFAULT_BACKUP_ROOT)
    } else {
        PathBuf::from(t)
    }
}

pub fn ensure_active_container(settings: &mut AppSettings) -> Result<(), String> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return Err("library root empty".into());
    }
    if settings.active_container_root.trim().is_empty() {
        settings.active_container_root = default_spike_container_root(lib);
    }
    fs::create_dir_all(&settings.active_container_root)
        .map_err(|e| format!("mkdir spike container: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_unknown_keys_on_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{
  "SkillsLibraryRoot": "C:\\Lib",
  "LibraryRootConfigured": true,
  "LastActionLog": [{"at":"t","method":"m","summary":"s"}],
  "CustomFutureField": 42
}"#,
        )
        .unwrap();

        let mut s = load_settings_from(&path).unwrap();
        assert_eq!(s.skills_library_root, r"C:\Lib");
        assert!(s.library_root_configured);
        s.ui_nav_width = 240;
        save_settings_to(&path, &s).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("CustomFutureField"));
        assert!(raw.contains("LastActionLog"));
        assert!(raw.contains("240"));
        let s2 = load_settings_from(&path).unwrap();
        assert_eq!(s2.ui_nav_width, 240);
        assert_eq!(s2.skills_library_root, r"C:\Lib");
    }

    #[test]
    fn resolve_backup_root_falls_back_to_default() {
        let empty = AppSettings::default();
        assert_eq!(
            resolve_backup_root(&empty),
            PathBuf::from(DEFAULT_BACKUP_ROOT)
        );
        let custom = AppSettings {
            backup_root: r"D:\myBackup".into(),
            ..Default::default()
        };
        assert_eq!(
            resolve_backup_root(&custom),
            PathBuf::from(r"D:\myBackup")
        );
    }
}
