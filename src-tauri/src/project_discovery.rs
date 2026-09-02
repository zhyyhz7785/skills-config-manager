//! Full-disk / configured-root project discovery (align Electron ProjectDiscoveryService).

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

use crate::catalog::{list_projects, load_catalog, CatalogProject};
use crate::settings::AppSettings;

pub const CATEGORY_CURSOR: &str = "Cursor项目";
pub const CATEGORY_OTHER: &str = "其它项目";

const EXCLUDED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".git",
    "bin",
    "obj",
    ".vs",
    "skills-library",
    "$recycle.bin",
    "system volume information",
    "recovery",
    "windows",
    "program files",
    "program files (x86)",
    "programdata",
];

/// 构建产物目录（Rust `target`、前端 `dist`/`build`/`.next` 等）：体量大且几乎不含真实项目。
/// `build`/`out`/`dist` 是通用名，可能撞真实项目根，故剪枝前先探一次 `.cursor`
/// （见 `should_skip_directory`），目录自身是 Cursor 项目根时不剪。
pub(crate) const BUILD_OUTPUT_DIR_NAMES: &[&str] = &[
    "target",
    "dist",
    "dist-electron",
    "out",
    "build",
    "coverage",
    ".next",
    ".nuxt",
    ".output",
    ".turbo",
    ".cache",
    "__pycache__",
    ".venv",
    "venv",
];

const DENIED_FRAGMENTS: &[&str] = &[
    "\\.vscode\\extensions",
    "/.vscode/extensions",
    "\\.codex\\.tmp",
    "/.codex/.tmp",
    "\\.codex\\plugins",
    "/.codex/plugins",
];

const EDITOR_HINTS: &[&str] = &["code", "vscode", "cursor", "trae"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredProject {
    pub root_path: String,
    pub suggested_name: String,
    pub suggested_category: String,
    pub markers: String,
    pub already_registered: bool,
    pub has_content_changes: bool,
    pub pending_item_count: u32,
    pub is_selected: bool,
}

#[derive(Debug, Clone)]
pub struct PendingProjectItem {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub category: String,
    pub pinned: bool,
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

pub fn user_cursor_root() -> String {
    dirs_home()
        .map(|h| h.join(".cursor").to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Strip Windows `\\?\` / `\\.\` extended-length prefixes for compare + UI display.
pub fn strip_win_extended_prefix(p: &str) -> &str {
    let t = p.trim();
    t.strip_prefix(r"\\?\")
        .or_else(|| t.strip_prefix(r"\\.\")).unwrap_or(t)
}

/// Path string suitable for UI / catalog storage (no extended prefix).
pub fn to_display_path(p: &str) -> String {
    strip_win_extended_prefix(p).replace('/', "\\")
}

/// Lowercase, backslash, trim trailing separators (Electron pathRules.normalize-ish).
/// Also strips Windows `\\?\` / `\\.\` extended prefixes so canonicalize vs plain paths match.
pub fn normalize_path(p: &str) -> String {
    let mut s = strip_win_extended_prefix(p).replace('/', "\\");
    while s.ends_with('\\') {
        s.pop();
    }
    s.to_lowercase()
}

pub fn is_under_directory(path: &str, root: &str) -> bool {
    let p = normalize_path(path);
    let r = normalize_path(root);
    if r.is_empty() || p.is_empty() {
        return false;
    }
    p == r || p.starts_with(&(r.clone() + "\\"))
}

pub fn is_user_home_or_user_cursor(root: &str) -> bool {
    let Some(home) = dirs_home() else {
        return false;
    };
    let home_s = home.to_string_lossy();
    let n = normalize_path(root);
    if n == normalize_path(&home_s) {
        return true;
    }
    n == normalize_path(&user_cursor_root())
}

/// Path fragment exclusions (Electron `projectScanExclusions.shouldSkipPath`).
pub fn should_skip_path(file_path: &str) -> bool {
    let norm = normalize_path(file_path);
    if norm.is_empty() {
        return true;
    }
    for frag in DENIED_FRAGMENTS {
        let f = frag.replace('/', "\\").to_lowercase();
        if norm.contains(&f) {
            return true;
        }
    }
    if norm.contains("\\resources\\app") {
        return EDITOR_HINTS.iter().any(|h| norm.contains(h));
    }
    false
}

fn should_skip_directory(dir_path: &str, user_cursor_norm: &str, library_norm: &str) -> bool {
    let norm = normalize_path(dir_path);
    if norm.is_empty() {
        return true;
    }
    if !user_cursor_norm.is_empty()
        && (norm == *user_cursor_norm || is_under_directory(dir_path, user_cursor_norm))
    {
        return true;
    }
    if !library_norm.is_empty()
        && (norm == *library_norm || is_under_directory(dir_path, library_norm))
    {
        return true;
    }
    let name = Path::new(dir_path.trim_end_matches(['\\', '/']))
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !name.is_empty() && EXCLUDED_DIR_NAMES.iter().any(|e| *e == name) {
        return true;
    }
    if !name.is_empty() && BUILD_OUTPUT_DIR_NAMES.iter().any(|e| *e == name) {
        // 该排除同时挡「下钻」与「项目识别」；通用名目录自身若是 Cursor 项目根则不剪。
        if !Path::new(dir_path).join(".cursor").is_dir() {
            return true;
        }
    }
    should_skip_path(dir_path)
}

fn should_auto_register(markers: &[String]) -> bool {
    markers.iter().any(|m| m.eq_ignore_ascii_case("cursor"))
}

fn detect_markers(directory: &Path, user_cursor_norm: &str) -> Vec<String> {
    let mut markers = Vec::new();
    let dir_s = directory.to_string_lossy();
    if normalize_path(&dir_s) == user_cursor_norm {
        return markers;
    }
    if directory.join(".cursor").is_dir() {
        markers.push("cursor".into());
    }
    if directory.join(".claude").is_dir() {
        markers.push("claude".into());
    }
    if directory.join(".agents").is_dir() {
        markers.push("agents".into());
    }
    markers
}

fn classify_project(root_path: &Path) -> String {
    if is_user_home_or_user_cursor(&root_path.to_string_lossy()) {
        return CATEGORY_OTHER.into();
    }
    if root_path.join(".cursor").is_dir() {
        return CATEGORY_CURSOR.into();
    }
    CATEGORY_OTHER.into()
}

fn suggest_name(dir_path: &Path) -> String {
    let name = dir_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    if !name.trim().is_empty() {
        return name;
    }
    dir_path.to_string_lossy().to_string()
}

pub fn get_default_scan_roots() -> Vec<String> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        for letter in b'A'..=b'Z' {
            let drive = format!("{}:\\", letter as char);
            let p = Path::new(&drive);
            if p.exists() {
                roots.push(drive);
            }
        }
        return roots;
    }
    #[cfg(not(windows))]
    {
        vec!["/".into()]
    }
}

pub fn resolve_project_scan_roots(configured: &[String]) -> Vec<String> {
    let configured: Vec<String> = configured
        .iter()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty() && Path::new(r).exists())
        .collect();
    if !configured.is_empty() {
        return configured;
    }
    get_default_scan_roots()
}

pub fn stable_project_id_for_root(root_path: &str) -> String {
    let norm = normalize_path(root_path);
    let mut hasher = Sha256::new();
    hasher.update(norm.as_bytes());
    let dig = hasher.finalize();
    let hex: String = dig.iter().map(|b| format!("{:02x}", b)).collect();
    hex[..32].to_string()
}

fn project_root_depth(root_path: &str) -> usize {
    let n = root_path.trim().trim_end_matches(['\\', '/']);
    Path::new(n)
        .components()
        .filter(|c| !matches!(c, std::path::Component::Prefix(_) | std::path::Component::RootDir))
        .count()
}

/// Merge registered + discovered unregistered roots for container asset scan.
pub fn merge_projects_for_container_scan(
    registered: &[CatalogProject],
    discovered: &[DiscoveredProject],
) -> (Vec<CatalogProject>, Vec<PendingProjectItem>) {
    let mut by_norm: HashMap<String, CatalogProject> = HashMap::new();
    for p in registered {
        let key = normalize_path(&p.root_path);
        if key.is_empty() {
            continue;
        }
        by_norm.insert(key, p.clone());
    }

    let mut pending_new = Vec::new();
    for d in discovered {
        let key = normalize_path(&d.root_path);
        if key.is_empty() || by_norm.contains_key(&key) || d.already_registered {
            continue;
        }
        let name = if d.suggested_name.trim().is_empty() {
            suggest_name(Path::new(&d.root_path))
        } else {
            d.suggested_name.clone()
        };
        let category = if d.suggested_category.trim().is_empty() {
            CATEGORY_CURSOR.into()
        } else {
            d.suggested_category.clone()
        };
        let item = CatalogProject {
            id: stable_project_id_for_root(&d.root_path),
            name: name.clone(),
            root_path: Path::new(&d.root_path)
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| d.root_path.clone()),
            category: category.clone(),
            pinned: true,
            ..Default::default()
        };
        pending_new.push(PendingProjectItem {
            id: item.id.clone(),
            name,
            root_path: item.root_path.clone(),
            category,
            pinned: true,
        });
        by_norm.insert(key, item);
    }

    let mut merged: Vec<CatalogProject> = by_norm.into_values().collect();
    merged.sort_by(|a, b| {
        let depth = project_root_depth(&b.root_path).cmp(&project_root_depth(&a.root_path));
        depth.then_with(|| {
            a.root_path
                .to_lowercase()
                .cmp(&b.root_path.to_lowercase())
        })
    });
    (merged, pending_new)
}

pub fn scan_roots(
    roots: &[String],
    max_depth: i32,
    existing: &[CatalogProject],
    library_root: &str,
) -> Vec<DiscoveredProject> {
    let mut root_list: Vec<String> = roots
        .iter()
        .filter(|r| !r.trim().is_empty() && Path::new(r).exists())
        .map(|r| {
            Path::new(r)
                .canonicalize()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| r.clone())
        })
        .collect();
    let mut seen_roots = HashSet::new();
    root_list.retain(|r| seen_roots.insert(normalize_path(r)));
    if root_list.is_empty() {
        root_list = get_default_scan_roots();
    }

    let mut max_depth = max_depth;
    if max_depth < 0 {
        max_depth = 0;
    }
    if max_depth > 12 {
        max_depth = 12;
    }

    let mut existing_physical = HashSet::new();
    for p in existing {
        existing_physical.insert(normalize_path(&p.root_path));
    }

    let user_cursor = normalize_path(&user_cursor_root());
    let library_norm = normalize_path(library_root);
    let mut found: HashMap<String, DiscoveredProject> = HashMap::new();

    for root in &root_list {
        let mut queue: VecDeque<(PathBuf, i32)> = VecDeque::new();
        queue.push_back((PathBuf::from(root), 0));

        while let Some((current, depth)) = queue.pop_front() {
            let cur_s = current.to_string_lossy().to_string();
            if should_skip_directory(&cur_s, &user_cursor, &library_norm) {
                continue;
            }

            let markers = detect_markers(&current, &user_cursor);
            if !markers.is_empty()
                && should_auto_register(&markers)
                && !is_user_home_or_user_cursor(&cur_s)
            {
                let register_norm = normalize_path(&cur_s);
                if register_norm != user_cursor && !found.contains_key(&register_norm) {
                    let already = existing_physical.contains(&register_norm);
                    found.insert(
                        register_norm,
                        DiscoveredProject {
                            root_path: current
                                .canonicalize()
                                .map(|p| p.to_string_lossy().to_string())
                                .unwrap_or(cur_s.clone()),
                            suggested_name: suggest_name(&current),
                            suggested_category: classify_project(&current),
                            markers: markers.join(","),
                            already_registered: already,
                            has_content_changes: false,
                            pending_item_count: 0,
                            is_selected: !already,
                        },
                    );
                }
            }

            if depth >= max_depth {
                continue;
            }

            let Ok(rd) = fs::read_dir(&current) else {
                continue;
            };
            for ent in rd.flatten() {
                let Ok(ft) = ent.file_type() else {
                    continue;
                };
                if !ft.is_dir() {
                    continue;
                }
                let child = ent.path();
                let child_s = child.to_string_lossy().to_string();
                if should_skip_directory(&child_s, &user_cursor, &library_norm) {
                    continue;
                }
                let base = child
                    .file_name()
                    .map(|s| s.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if base == ".cursor" || base == ".claude" || base == ".agents" {
                    continue;
                }
                queue.push_back((child, depth + 1));
            }
        }
    }

    let mut out: Vec<_> = found.into_values().collect();
    out.sort_by(|a, b| {
        let can_a = !a.already_registered || a.has_content_changes;
        let can_b = !b.already_registered || b.has_content_changes;
        can_b
            .cmp(&can_a)
            .then_with(|| a.already_registered.cmp(&b.already_registered))
            .then_with(|| {
                a.root_path
                    .to_lowercase()
                    .cmp(&b.root_path.to_lowercase())
            })
    });
    out
}

fn project_root_from_cursor_path(file_path: &str) -> Option<String> {
    let resolved = PathBuf::from(file_path.trim().replace('/', "\\"));
    let mut parts: Vec<PathBuf> = Vec::new();
    for c in resolved.components() {
        let name = c.as_os_str().to_string_lossy();
        if name.eq_ignore_ascii_case(".cursor") {
            if parts.is_empty() {
                return None;
            }
            let mut out = PathBuf::new();
            for p in &parts {
                out.push(p);
            }
            return Some(out.to_string_lossy().to_string());
        }
        parts.push(PathBuf::from(c.as_os_str()));
    }
    None
}

pub fn discover_from_catalog_origin_paths(
    catalog_json_paths: &[PathBuf],
    existing: &[CatalogProject],
    library_root: &str,
) -> Vec<DiscoveredProject> {
    let mut existing_physical = HashSet::new();
    for p in existing {
        existing_physical.insert(normalize_path(&p.root_path));
    }
    let user_cursor = normalize_path(&user_cursor_root());
    let library_norm = normalize_path(library_root);
    let mut found: HashMap<String, DiscoveredProject> = HashMap::new();

    for catalog_path in catalog_json_paths {
        if !catalog_path.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(catalog_path) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let Some(entries) = v.get("entries").and_then(|e| e.as_array()) else {
            continue;
        };
        for entry in entries {
            let mut paths = Vec::new();
            if let Some(origins) = entry.get("origins").and_then(|o| o.as_array()) {
                for o in origins {
                    if let Some(p) = o.get("originalPath").and_then(|x| x.as_str()) {
                        paths.push(p.to_string());
                    }
                }
            }
            if let Some(history) = entry.get("history").and_then(|h| h.as_array()) {
                for h in history {
                    for key in ["fromPath", "toPath", "containerRoot"] {
                        if let Some(p) = h.get(key).and_then(|x| x.as_str()) {
                            paths.push(p.to_string());
                        }
                    }
                }
            }
            for p in paths {
                let Some(root) = project_root_from_cursor_path(&p) else {
                    continue;
                };
                if should_skip_directory(&root, &user_cursor, &library_norm) {
                    continue;
                }
                if is_user_home_or_user_cursor(&root) {
                    continue;
                }
                let root_path = PathBuf::from(&root);
                if !root_path.is_dir() || !root_path.join(".cursor").is_dir() {
                    continue;
                }
                let register_norm = normalize_path(&root);
                if register_norm.is_empty() || found.contains_key(&register_norm) {
                    continue;
                }
                let already = existing_physical.contains(&register_norm);
                let root_display = root_path
                    .canonicalize()
                    .map(|x| x.to_string_lossy().to_string())
                    .unwrap_or(root);
                found.insert(
                    register_norm,
                    DiscoveredProject {
                        root_path: root_display,
                        suggested_name: suggest_name(&root_path),
                        suggested_category: classify_project(&root_path),
                        markers: "cursor,origin-catalog".into(),
                        already_registered: already,
                        has_content_changes: false,
                        pending_item_count: 0,
                        is_selected: !already,
                    },
                );
            }
        }
    }
    found.into_values().collect()
}

pub fn list_catalog_json_for_origin_recovery(library_root: &str) -> Vec<PathBuf> {
    let lib = library_root.trim();
    if lib.is_empty() {
        return vec![];
    }
    ["catalog.json", "bf/catalog.json", "bf1/catalog.json", "bf2/catalog.json"]
        .iter()
        .map(|rel| Path::new(lib).join(rel))
        .filter(|p| p.is_file())
        .collect()
}

/// Walk + origin merge (Electron discoverProjectsMerged).
pub fn discover_projects_merged(
    settings: &AppSettings,
    registered: &[CatalogProject],
) -> (Vec<String>, Vec<DiscoveredProject>) {
    let roots = resolve_project_scan_roots(&settings.project_scan_roots);
    let lib = settings.skills_library_root.trim();
    let found_by_walk = scan_roots(
        &roots,
        settings.project_scan_max_depth,
        registered,
        lib,
    );
    let found_by_origin = discover_from_catalog_origin_paths(
        &list_catalog_json_for_origin_recovery(lib),
        registered,
        lib,
    );

    let mut merged: HashMap<String, DiscoveredProject> = HashMap::new();
    for d in found_by_walk.into_iter().chain(found_by_origin) {
        let key = normalize_path(&d.root_path);
        if let Some(prev) = merged.get_mut(&key) {
            if !prev.markers.contains("origin") && d.markers.contains("origin") {
                prev.markers = format!("{},{}", prev.markers, d.markers);
            }
        } else {
            merged.insert(key, d);
        }
    }
    let mut discovered: Vec<_> = merged.into_values().collect();
    discovered.sort_by(|a, b| {
        a.already_registered
            .cmp(&b.already_registered)
            .then_with(|| {
                a.root_path
                    .to_lowercase()
                    .cmp(&b.root_path.to_lowercase())
            })
    });
    (roots, discovered)
}

pub fn registered_projects_from_settings(settings: &AppSettings) -> Vec<CatalogProject> {
    let lib = settings.skills_library_root.trim();
    if lib.is_empty() {
        return vec![];
    }
    let load = load_catalog(lib);
    list_projects(&load.catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn to_display_path_strips_prefix() {
        assert_eq!(
            to_display_path(r"\\?\E:\BaiduSyncdisk\Code\foo\.cursor"),
            r"E:\BaiduSyncdisk\Code\foo\.cursor"
        );
    }

    #[test]
    fn normalize_path_strips_win_extended_prefix() {
        assert_eq!(
            normalize_path(r"\\?\C:\Users\alice\.cursor"),
            normalize_path(r"C:\Users\alice\.cursor")
        );
        assert_eq!(
            normalize_path(r"\\.\E:\temppath\skills"),
            r"e:\temppath\skills"
        );
    }

    #[test]
    fn discovers_cursor_project_under_configured_root() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("MyApp");
        fs::create_dir_all(proj.join(".cursor/skills")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg/.cursor")).unwrap();

        let found = scan_roots(
            &[dir.path().to_string_lossy().to_string()],
            5,
            &[],
            "",
        );
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(found[0].root_path.to_lowercase().contains("myapp"));
        assert!(!found[0].already_registered);
        assert!(found[0].is_selected);
    }

    #[test]
    fn skips_build_output_dirs_but_keeps_project_named_build() {
        let dir = tempfile::tempdir().unwrap();
        // 构建产物内的 .cursor 不应被发现
        fs::create_dir_all(dir.path().join("App/target/debug/pkg/.cursor")).unwrap();
        fs::create_dir_all(dir.path().join("App/dist/site/.cursor")).unwrap();
        fs::create_dir_all(dir.path().join("App/.next/cache/.cursor")).unwrap();
        // 目录名恰为 build 的真实项目根仍应被识别
        fs::create_dir_all(dir.path().join("build/.cursor/rules")).unwrap();

        let found = scan_roots(
            &[dir.path().to_string_lossy().to_string()],
            6,
            &[],
            "",
        );
        assert_eq!(found.len(), 1, "{found:?}");
        assert!(
            normalize_path(&found[0].root_path).ends_with("\\build"),
            "{found:?}"
        );
    }

    #[test]
    fn merge_adds_pending_new() {
        let discovered = vec![DiscoveredProject {
            root_path: r"D:\Projects\Foo".into(),
            suggested_name: "Foo".into(),
            suggested_category: CATEGORY_CURSOR.into(),
            markers: "cursor".into(),
            already_registered: false,
            has_content_changes: false,
            pending_item_count: 0,
            is_selected: true,
        }];
        let (merged, pending) = merge_projects_for_container_scan(&[], &discovered);
        assert_eq!(pending.len(), 1);
        assert_eq!(merged.len(), 1);
        assert_eq!(pending[0].id.len(), 32);
    }

    #[test]
    fn stable_id_is_deterministic() {
        let a = stable_project_id_for_root(r"E:\A\B");
        let b = stable_project_id_for_root(r"e:\a\b");
        assert_eq!(a, b);
    }
}
