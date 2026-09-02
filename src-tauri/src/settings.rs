//! AppData settings for CCM-Tauri2 — Electron-compatible PascalCase JSON.
//! Unknown fields are preserved via `extra` so sidecar and Rust can share one file.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

use crate::workspace::{ensure_workspaces_migrated, WorkspaceConfig};

pub const APP_SETTINGS_DIR_NAME: &str = "CCM-Tauri2";
pub const DEFAULT_LIBRARY_ROOT: &str = r"C:\CursorSkills";
pub const DEFAULT_SPIKE_CONTAINER_REL: &str = ".spike-container";
/// Electron `SettingsService.getBackupRoot` fallback when `BackupRoot` is empty.
pub const DEFAULT_BACKUP_ROOT: &str = r"E:\cursorBf";
/// 永久库根下的应用设置文件名（测试回厂：与 catalog.json 同目录）。
pub const LIBRARY_SETTINGS_FILE: &str = "ccm-settings.json";
/// AppData 内仅存永久库路径指针，解「先读设置才知道库在哪」。
pub const LIBRARY_POINTER_FILE: &str = "library-pointer.json";
/// 迁移前遗留的 AppData 全量设置。
pub const LEGACY_APPDATA_SETTINGS_FILE: &str = "settings.json";

/// 用户粘贴 Git URL 后持久进侧栏的源（与固化精选同池）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NetworkUserSource {
    pub id: String,
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct AppSettings {
    #[serde(default)]
    pub skills_library_root: String,
    #[serde(default)]
    pub library_root_configured: bool,
    /// Last non-ephemeral permanent library root (used when reclaiming Temp paths).
    #[serde(default)]
    pub last_stable_library_root: String,
    /// Network library root (Plan/03 quarantine cache; ≠ permanent library).
    #[serde(default)]
    pub network_library_root: String,
    #[serde(default)]
    pub network_library_configured: bool,
    #[serde(default)]
    pub network_official_pinned_ids: Vec<String>,
    #[serde(default)]
    pub network_popular_pinned_ids: Vec<String>,
    /// True once popular pin visibility was explicitly set (bulk hide / single pin / defaults applied).
    /// Distinguishes first-run default-all-open from user-intended empty list.
    #[serde(default)]
    pub network_popular_pins_initialized: bool,
    /// Full display order for official network nav (pinned segment still uses pinned ids first).
    #[serde(default)]
    pub network_official_order: Vec<String>,
    #[serde(default)]
    pub network_popular_order: Vec<String>,
    /// Popular nav sort: stars | updated | forks | custom (eye-open = pinned ids).
    #[serde(default = "default_network_popular_sort")]
    pub network_popular_sort: String,
    /// 社区候选池数量 N（默认 10，范围 0..=min(50, 社区精选数)）；与 `network_popular_pinned_ids`（开眼真相）正交。
    #[serde(default = "default_network_popular_visible_limit")]
    pub network_popular_visible_limit: u32,
    /// User-added popular sources (paste URL); merged into networkPopularNav.
    #[serde(default)]
    pub network_user_sources: Vec<NetworkUserSource>,
    /// User order for global workspace nav / settings tables (ids).
    #[serde(default)]
    pub workspace_nav_order: Vec<String>,
    /// 0 = disabled; minutes between checkNetworkUpdates only (never apply).
    #[serde(default)]
    pub network_update_check_interval_minutes: i32,
    /// Git / gh / curl HTTP(S) proxy for network fetch (e.g. http://127.0.0.1:7890).
    /// Empty = inherit process env, else Windows system proxy.
    #[serde(default)]
    pub network_git_http_proxy: String,
    /// 网络库同时 git 拉取路数（1..=8，默认 3）。拉取弹层可调，设置窗不出现。
    #[serde(default = "default_network_fetch_concurrency")]
    pub network_fetch_concurrency: u32,
    #[serde(default)]
    pub active_container_root: String,
    #[serde(default)]
    pub backup_root: String,
    #[serde(default)]
    pub selected_project_id: Option<String>,
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
    pub project_scan_roots: Vec<String>,
    #[serde(default = "default_scan_depth")]
    pub project_scan_max_depth: i32,
    #[serde(default)]
    pub auto_scan_projects_on_startup: bool,
    /// 扫描建库跳过的工作区 id（空＝扫全部已知容器根）。
    #[serde(default)]
    pub scan_skip_workspace_ids: Vec<String>,
    /// 扫描建库额外目录（对应原弹层「添加目录」）。
    #[serde(default)]
    pub scan_extra_roots: Vec<ScanExtraRoot>,
    #[serde(default = "default_true")]
    pub filter_show_skills: bool,
    #[serde(default = "default_true")]
    pub filter_show_rules: bool,
    #[serde(default)]
    pub filter_show_agents: bool,
    #[serde(default)]
    pub filter_show_commands: bool,
    #[serde(default)]
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

/// 扫描建库额外根：路径 + 记入 origins.tool 的工作区 id。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "PascalCase")]
pub struct ScanExtraRoot {
    #[serde(default, alias = "path")]
    pub path: String,
    #[serde(default, alias = "tool")]
    pub tool: String,
}

fn default_network_popular_sort() -> String {
    "stars".into()
}
/// 社区候选池 N 默认值；「全部开眼」在 N=0 时也用它恢复。
pub(crate) fn default_network_popular_visible_limit() -> u32 {
    10
}
pub(crate) const NETWORK_FETCH_CONCURRENCY_MIN: u32 = 1;
pub(crate) const NETWORK_FETCH_CONCURRENCY_MAX: u32 = 8;
pub(crate) fn default_network_fetch_concurrency() -> u32 {
    3
}
pub(crate) fn clamp_network_fetch_concurrency(n: u32) -> u32 {
    n.clamp(
        NETWORK_FETCH_CONCURRENCY_MIN,
        NETWORK_FETCH_CONCURRENCY_MAX,
    )
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
            last_stable_library_root: String::new(),
            network_library_root: String::new(),
            network_library_configured: false,
            network_official_pinned_ids: vec![],
            network_popular_pinned_ids: vec![],
            network_popular_pins_initialized: false,
            network_official_order: vec![],
            network_popular_order: vec![],
            network_popular_sort: default_network_popular_sort(),
            network_popular_visible_limit: default_network_popular_visible_limit(),
            network_user_sources: vec![],
            workspace_nav_order: vec![],
            network_update_check_interval_minutes: 0,
            network_git_http_proxy: String::new(),
            network_fetch_concurrency: default_network_fetch_concurrency(),
            active_container_root: String::new(),
            backup_root: String::new(),
            selected_project_id: None,
            nav_kind: default_nav_kind(),
            selected_global_tool: default_tool(),
            default_workspace_id: String::new(),
            visible_workspace_ids: vec![],
            workspaces: vec![],
            cluster_mode_index: 0,
            purpose_domain_filter_index: 0,
            project_scan_roots: vec![],
            project_scan_max_depth: 5,
            auto_scan_projects_on_startup: false,
            scan_skip_workspace_ids: vec![],
            scan_extra_roots: vec![],
            filter_show_skills: true,
            filter_show_rules: true,
            filter_show_agents: false,
            filter_show_commands: false,
            filter_show_hooks: false,
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

/// True when the path sits under the OS temp dir but no longer exists on disk —
/// debris left by tests that overrode USERPROFILE/HOME with a tempfile dir and
/// leaked the derived roots into persisted settings. Existing temp paths are
/// kept (tests legitimately point roots at live tempdirs).
pub(crate) fn is_stale_temp_path(path: &str) -> bool {
    let t = path.trim();
    if t.is_empty() || Path::new(t).exists() {
        return false;
    }
    let norm = |s: &str| s.replace('/', "\\").trim_end_matches('\\').to_lowercase();
    let tmp = norm(&std::env::temp_dir().to_string_lossy());
    !tmp.is_empty() && norm(t).starts_with(&format!("{tmp}\\"))
}

pub fn settings_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var("APPDATA").map_err(|_| "APPDATA not set".to_string())?;
    Ok(PathBuf::from(appdata).join(APP_SETTINGS_DIR_NAME))
}

/// AppData 指针文件路径。
pub fn library_pointer_file() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join(LIBRARY_POINTER_FILE))
}

/// 遗留 AppData `settings.json`（迁移源）。
pub fn legacy_appdata_settings_file() -> Result<PathBuf, String> {
    Ok(settings_dir()?.join(LEGACY_APPDATA_SETTINGS_FILE))
}

/// 库内 `ccm-settings.json` 绝对路径。
pub fn library_settings_path(library_root: &str) -> PathBuf {
    Path::new(library_root.trim()).join(LIBRARY_SETTINGS_FILE)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
struct LibraryPointer {
    #[serde(default)]
    pub skills_library_root: String,
}

pub fn read_library_pointer() -> Result<Option<String>, String> {
    let path = library_pointer_file()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read library-pointer: {e}"))?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let p: LibraryPointer =
        serde_json::from_str(raw).map_err(|e| format!("parse library-pointer: {e}"))?;
    let root = p.skills_library_root.trim().to_string();
    if root.is_empty() {
        Ok(None)
    } else {
        Ok(Some(root))
    }
}

pub fn write_library_pointer(library_root: &str) -> Result<(), String> {
    let root = library_root.trim();
    if root.is_empty() {
        return Err("library pointer empty".into());
    }
    let dir = settings_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir settings dir: {e}"))?;
    let p = LibraryPointer {
        skills_library_root: root.to_string(),
    };
    let raw = serde_json::to_string_pretty(&p).map_err(|e| e.to_string())?;
    fs::write(library_pointer_file()?, raw).map_err(|e| format!("write library-pointer: {e}"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let mut s = load_settings_resolved()?;
    // In-memory only: avoid write-on-read races in tests / concurrent loads.
    // Persistence happens on the next save_settings (set_nav / settings UI / etc.).
    let _ = ensure_workspaces_migrated(&mut s);
    let _ = crate::network_catalog::ensure_network_pin_defaults(&mut s);
    touch_last_stable_library_root(&mut s);
    Ok(s)
}

/// 解析加载：pointer → 库内 ccm-settings；否则迁移遗留 AppData settings.json。
fn load_settings_resolved() -> Result<AppSettings, String> {
    if let Some(root) = read_library_pointer()? {
        let lib_path = library_settings_path(&root);
        if lib_path.is_file() {
            let mut s = load_settings_from(&lib_path)?;
            if !s.library_root_configured || s.skills_library_root.trim().is_empty() {
                s.skills_library_root = root;
                s.library_root_configured = true;
            }
            return Ok(s);
        }
        // pointer 有、库内设置无：尝试遗留迁移进该库
        let legacy = legacy_appdata_settings_file()?;
        if legacy.is_file() {
            let mut s = load_settings_from(&legacy)?;
            if !s.library_root_configured || s.skills_library_root.trim().is_empty() {
                s.skills_library_root = root.clone();
                s.library_root_configured = true;
            } else if crate::project_discovery::normalize_path(&s.skills_library_root)
                != crate::project_discovery::normalize_path(&root)
            {
                // pointer 优先
                s.skills_library_root = root.clone();
                s.library_root_configured = true;
            }
            if let Some(parent) = lib_path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!("mkdir library for settings {}: {e}", parent.display())
                })?;
            }
            save_settings_to(&lib_path, &s)?;
            return Ok(s);
        }
        let mut s = AppSettings::default();
        s.skills_library_root = root;
        s.library_root_configured = true;
        return Ok(s);
    }

    // 无 pointer：遗留 AppData 全量 settings → 迁入其 SkillsLibraryRoot（或默认库）
    let legacy = legacy_appdata_settings_file()?;
    if legacy.is_file() {
        let mut s = load_settings_from(&legacy)?;
        let root = if s.library_root_configured && !s.skills_library_root.trim().is_empty() {
            s.skills_library_root.trim().to_string()
        } else {
            DEFAULT_LIBRARY_ROOT.to_string()
        };
        s.skills_library_root = root.clone();
        s.library_root_configured = true;
        let lib_path = library_settings_path(&root);
        if !lib_path.is_file() {
            fs::create_dir_all(Path::new(&root))
                .map_err(|e| format!("mkdir library {root}: {e}"))?;
            save_settings_to(&lib_path, &s)?;
        }
        write_library_pointer(&root)?;
        return Ok(s);
    }

    Ok(AppSettings::default())
}

/// True when `root` has a parseable healthy `catalog.json`.
pub fn library_root_looks_valid(root: &str) -> bool {
    let root = root.trim();
    if root.is_empty() {
        return false;
    }
    let load = crate::catalog::load_catalog(root);
    load.healthy
}

/// Remember the latest configured non-Temp permanent library for Temp reclaim.
pub fn touch_last_stable_library_root(settings: &mut AppSettings) {
    if !settings.library_root_configured {
        return;
    }
    let cur = settings.skills_library_root.trim();
    if cur.is_empty() || is_ephemeral_fs_path(cur) {
        return;
    }
    settings.last_stable_library_root = cur.to_string();
}

fn resolve_reclaim_destination(settings: &AppSettings) -> String {
    let stable = settings.last_stable_library_root.trim();
    if !stable.is_empty()
        && !is_ephemeral_fs_path(stable)
        && library_root_looks_valid(stable)
    {
        return stable.to_string();
    }
    DEFAULT_LIBRARY_ROOT.to_string()
}

pub fn load_settings_from(path: &Path) -> Result<AppSettings, String> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| format!("read settings: {e}"))?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let value: Value =
        serde_json::from_str(raw).map_err(|e| format!("parse settings: {e}"))?;
    // 缺 NetworkPopularVisibleLimit 且已初始化过 pins → 用 pinned 数量迁移（cap 50）；真正首次仍默认 10。
    let missing_visible_limit = value
        .as_object()
        .map(|o| !o.contains_key("NetworkPopularVisibleLimit"))
        .unwrap_or(true);
    let mut s: AppSettings =
        serde_json::from_value(value).map_err(|e| format!("parse settings: {e}"))?;
    if missing_visible_limit && s.network_popular_pins_initialized {
        let n = (s.network_popular_pinned_ids.len() as u32).min(50);
        s.network_popular_visible_limit = n;
    }
    s.network_fetch_concurrency = clamp_network_fetch_concurrency(s.network_fetch_concurrency);
    Ok(s)
}

/// Merge-save: serialize typed fields then re-apply any `extra` keys not overwritten.
/// 主体写入 `{永久库}\ccm-settings.json`，并更新 AppData `library-pointer.json`。
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let mut s = settings.clone();
    let _ = ensure_workspaces_migrated(&mut s);
    touch_last_stable_library_root(&mut s);
    let root = if s.library_root_configured && !s.skills_library_root.trim().is_empty() {
        s.skills_library_root.trim().to_string()
    } else {
        return Err("保存设置需要已配置永久库目录".into());
    };
    fs::create_dir_all(&root).map_err(|e| format!("mkdir library: {e}"))?;
    save_settings_to(&library_settings_path(&root), &s)?;
    write_library_pointer(&root)?;
    Ok(())
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

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir settings: {e}"))?;
    }
    let mut to_save = settings.clone();
    touch_last_stable_library_root(&mut to_save);
    let typed = serde_json::to_value(&to_save).map_err(|e| e.to_string())?;
    if let Some(obj) = typed.as_object() {
        for (k, v) in obj {
            merged.insert(k.clone(), v.clone());
        }
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

/// True when path looks like a tempfile / OS Temp ephemeral root (e.g. `%TEMP%\.tmpXXXX\lib`).
pub fn is_ephemeral_fs_path(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() {
        return false;
    }
    let lower = p.replace('/', "\\").to_lowercase();
    if lower.contains("\\temp\\.tmp") || lower.contains("\\tmp\\.tmp") {
        return true;
    }
    for key in ["TEMP", "TMP"] {
        if let Ok(t) = std::env::var(key) {
            let tn = t
                .replace('/', "\\")
                .trim_end_matches(['\\', '/'])
                .to_lowercase();
            if tn.is_empty() {
                continue;
            }
            if lower.starts_with(&tn) && lower[tn.len()..].contains("\\.tmp") {
                return true;
            }
        }
    }
    false
}

/// Best-effort copy of kind folders present in `from` but missing under `to` (skills/rules/…).
pub fn copy_missing_library_kind_dirs(from: &str, to: &str) -> Result<u32, String> {
    let from = Path::new(from.trim());
    let to = Path::new(to.trim());
    if !from.is_dir() || to.as_os_str().is_empty() {
        return Ok(0);
    }
    fs::create_dir_all(to).map_err(|e| format!("mkdir target library: {e}"))?;
    let mut copied = 0u32;
    for kind in ["skills", "rules", "agents", "commands", "hooks"] {
        let src_kind = from.join(kind);
        if !src_kind.is_dir() {
            continue;
        }
        let dst_kind = to.join(kind);
        fs::create_dir_all(&dst_kind).map_err(|e| format!("mkdir {kind}: {e}"))?;
        let entries = fs::read_dir(&src_kind).map_err(|e| format!("read {kind}: {e}"))?;
        for ent in entries.flatten() {
            let name = ent.file_name();
            let dst = dst_kind.join(&name);
            if dst.exists() {
                continue;
            }
            let src = ent.path();
            if src.is_dir() {
                copy_dir_recursive(&src, &dst)?;
                copied += 1;
            } else if src.is_file() {
                fs::copy(&src, &dst).map_err(|e| format!("copy file: {e}"))?;
                copied += 1;
            }
        }
    }
    Ok(copied)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("mkdir {:?}: {e}", dst))?;
    for ent in fs::read_dir(src).map_err(|e| format!("read {:?}: {e}", src))? {
        let ent = ent.map_err(|e| e.to_string())?;
        let to = dst.join(ent.file_name());
        let from = ent.path();
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy {:?}: {e}", from))?;
        }
    }
    Ok(())
}

/// If permanent library points at an ephemeral Temp path, reclaim default + copy missing assets.
/// Returns true when settings were changed.
pub fn reclaim_ephemeral_permanent_library(settings: &mut AppSettings) -> bool {
    if !settings.library_root_configured {
        return false;
    }
    let old = settings.skills_library_root.trim().to_string();
    if old.is_empty() || !is_ephemeral_fs_path(&old) {
        return false;
    }
    let dest = resolve_reclaim_destination(settings);
    if crate::project_discovery::normalize_path(&old)
        == crate::project_discovery::normalize_path(&dest)
    {
        return false;
    }
    let _ = copy_missing_library_kind_dirs(&old, &dest);
    // 台账：Temp 上登记过的 entries/projects 并入目标库（不覆盖已有 id/根路径）
    let _ = crate::catalog::merge_missing_catalog_records(&old, &dest);
    settings.skills_library_root = dest.clone();
    settings.library_root_configured = true;
    settings.last_stable_library_root = dest;
    true
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
    if settings.active_container_root.trim().is_empty()
        || is_stale_temp_path(&settings.active_container_root)
    {
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
    fn migrate_visible_limit_from_pinned_len_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(
            &path,
            r#"{
  "NetworkPopularPinsInitialized": true,
  "NetworkPopularPinnedIds": ["a", "b", "c"]
}"#,
        )
        .unwrap();
        let s = load_settings_from(&path).unwrap();
        assert_eq!(s.network_popular_visible_limit, 3);
    }

    #[test]
    fn fetch_concurrency_defaults_and_clamps() {
        assert_eq!(default_network_fetch_concurrency(), 3);
        assert_eq!(clamp_network_fetch_concurrency(0), 1);
        assert_eq!(clamp_network_fetch_concurrency(1), 1);
        assert_eq!(clamp_network_fetch_concurrency(3), 3);
        assert_eq!(clamp_network_fetch_concurrency(8), 8);
        assert_eq!(clamp_network_fetch_concurrency(99), 8);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"SkillsLibraryRoot":"C:\\Lib"}"#).unwrap();
        let s = load_settings_from(&path).unwrap();
        assert_eq!(s.network_fetch_concurrency, 3);
        fs::write(&path, r#"{"NetworkFetchConcurrency":0}"#).unwrap();
        let s0 = load_settings_from(&path).unwrap();
        assert_eq!(s0.network_fetch_concurrency, 1);
        fs::write(&path, r#"{"NetworkFetchConcurrency":99}"#).unwrap();
        let s99 = load_settings_from(&path).unwrap();
        assert_eq!(s99.network_fetch_concurrency, 8);
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

    #[test]
    fn reclaim_prefers_last_stable_over_default() {
        let stable = r"E:\cursor\CursorSkills";
        if !library_root_looks_valid(stable) {
            return; // skip on machines without user library
        }
        let mut settings = AppSettings {
            skills_library_root: r"C:\Users\alice\AppData\Local\Temp\.tmpDavIyw\lib".into(),
            library_root_configured: true,
            last_stable_library_root: stable.into(),
            ..Default::default()
        };
        assert!(reclaim_ephemeral_permanent_library(&mut settings));
        assert_eq!(settings.skills_library_root, stable);
    }

    #[test]
    fn touch_last_stable_skips_ephemeral() {
        let mut settings = AppSettings {
            skills_library_root: r"C:\Users\alice\AppData\Local\Temp\.tmpX\lib".into(),
            library_root_configured: true,
            ..Default::default()
        };
        touch_last_stable_library_root(&mut settings);
        assert!(settings.last_stable_library_root.is_empty());
        settings.skills_library_root = r"E:\cursor\CursorSkills".into();
        touch_last_stable_library_root(&mut settings);
        assert_eq!(settings.last_stable_library_root, r"E:\cursor\CursorSkills");
    }

    #[test]
    fn ephemeral_temp_library_path_detected() {
        assert!(is_ephemeral_fs_path(
            r"C:\Users\alice\AppData\Local\Temp\.tmpDavIyw\lib"
        ));
        assert!(!is_ephemeral_fs_path(r"C:\CursorSkills"));
        assert!(!is_ephemeral_fs_path(r"C:\CursorSkills-Tauri2Spike"));
        assert!(!is_ephemeral_fs_path(r"E:\temppath"));
    }

    #[test]
    fn save_and_load_uses_library_ccm_settings_and_pointer() {
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("Roaming");
        fs::create_dir_all(&appdata).unwrap();
        let lib = dir.path().join("CursorSkills");
        fs::create_dir_all(&lib).unwrap();
        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }
        let lib_s = lib.to_string_lossy().to_string();
        let s = AppSettings {
            skills_library_root: lib_s.clone(),
            library_root_configured: true,
            ui_nav_width: 321,
            ..Default::default()
        };
        save_settings(&s).unwrap();
        assert!(library_settings_path(&lib_s).is_file());
        assert!(library_pointer_file().unwrap().is_file());
        let loaded = load_settings_resolved().unwrap();
        assert_eq!(loaded.ui_nav_width, 321);
        assert_eq!(
            crate::project_discovery::normalize_path(&loaded.skills_library_root),
            crate::project_discovery::normalize_path(&lib_s)
        );
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn migrates_legacy_appdata_settings_into_library() {
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("Roaming");
        let ccm = appdata.join(APP_SETTINGS_DIR_NAME);
        fs::create_dir_all(&ccm).unwrap();
        let lib = dir.path().join("Lib");
        fs::create_dir_all(&lib).unwrap();
        let lib_s = lib.to_string_lossy().to_string();
        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }
        fs::write(
            ccm.join(LEGACY_APPDATA_SETTINGS_FILE),
            format!(
                r#"{{
  "SkillsLibraryRoot": "{}",
  "LibraryRootConfigured": true,
  "UiNavWidth": 277
}}"#,
                lib_s.replace('\\', "\\\\")
            ),
        )
        .unwrap();
        let loaded = load_settings_resolved().unwrap();
        assert_eq!(loaded.ui_nav_width, 277);
        assert!(library_settings_path(&lib_s).is_file());
        assert!(library_pointer_file().unwrap().is_file());
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn copy_missing_library_kind_dirs_skips_existing() {
        let dir = tempfile::tempdir().unwrap();
        let from = dir.path().join("from");
        let to = dir.path().join("to");
        fs::create_dir_all(from.join("skills").join("only-from")).unwrap();
        fs::write(from.join("skills").join("only-from").join("SKILL.md"), b"# a\n").unwrap();
        fs::create_dir_all(to.join("skills").join("already")).unwrap();
        fs::write(to.join("skills").join("already").join("SKILL.md"), b"# b\n").unwrap();
        fs::create_dir_all(from.join("skills").join("already")).unwrap();
        fs::write(from.join("skills").join("already").join("SKILL.md"), b"# overwrite?\n").unwrap();

        let n = copy_missing_library_kind_dirs(
            &from.to_string_lossy(),
            &to.to_string_lossy(),
        )
        .unwrap();
        assert!(n >= 1);
        assert!(to.join("skills").join("only-from").join("SKILL.md").is_file());
        let body = fs::read_to_string(to.join("skills").join("already").join("SKILL.md")).unwrap();
        assert_eq!(body, "# b\n", "existing dirs must not be overwritten");
    }
}
