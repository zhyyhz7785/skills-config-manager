//! Network library (Plan/03 Must): read-only quarantine cache → promote to permanent library.
//! Independent root + `network-index.json`; never writes permanent `catalog.json` except via promote.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::catalog::{
    ensure_library_layout, get_entry_tags, load_catalog, set_entry_tags, upsert_entry, CatalogEntry,
    CatalogOrigin,
};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::hash_path_auto;
use crate::network_catalog::{
    build_network_nav, heat_for_source_id, load_heat_cache, resolve_agent_repo, NetworkNavNodeDto,
    POPULAR_SOURCES,
};
use crate::network_customization::{
    get_provenance, load_customization, reapply_customization_on_text, seed_baseline_on_promote,
    set_provenance, update_entry_provenance_hash, write_merged_to_library_entry, NetworkProvenance,
    ReapplyHintDto,
};
use crate::network_security::{evaluate_path, SecurityReport};
use crate::path_guard::resolve_library_safe_path;
use crate::project_discovery::{normalize_path, to_display_path};
use crate::settings::AppSettings;
use crate::snapshot::{build_snapshot_subset, AppSnapshotSubset, LibraryListItemDto};
use crate::withdraw::{path_conflict_dto, ConflictResolution, PathConflictDto};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsShItemDto {
    pub name: String,
    pub url: String,
    pub repo: String,
}

pub const NETWORK_INDEX_FILE: &str = "network-index.json";
pub const NETWORK_CACHE_DIR: &str = "cache";
pub const NETWORK_ID_PREFIX: &str = "net:";

pub const BASELINE_SOURCES: &[(&str, &str, &str)] = &[
    (
        "anthropics-skills",
        "Anthropic Skills（官方样例）",
        "https://github.com/anthropics/skills",
    ),
    (
        "vercel-agent-skills",
        "Vercel Agent Skills",
        "https://github.com/vercel-labs/agent-skills",
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkIndex {
    #[serde(default = "default_index_version")]
    pub version: i32,
    #[serde(default)]
    pub sources: Vec<NetworkSourceRecord>,
    #[serde(default)]
    pub entries: Vec<NetworkEntry>,
}

impl Default for NetworkIndex {
    fn default() -> Self {
        Self {
            version: default_index_version(),
            sources: vec![],
            entries: vec![],
        }
    }
}

fn default_index_version() -> i32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSourceRecord {
    pub id: String,
    pub label: String,
    pub url: String,
    /// Relative path under network root: `cache/{id}`
    pub cache_rel: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub last_fetched_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEntry {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub source_id: String,
    pub source_url: String,
    pub remote_id: String,
    /// Relative to network root
    pub cached_rel_path: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub content_hash: String,
    #[serde(default)]
    pub update_status: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub intended_level: String,
    #[serde(default)]
    pub security_level: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkBaselineSourceDto {
    pub id: String,
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkOpResult {
    pub ok: bool,
    pub message: String,
    pub snapshot: AppSnapshotSubset,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflicts: Option<Vec<PathConflictDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub promoted: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_available: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<SecurityReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reapply_hints: Option<Vec<ReapplyHintDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_items: Option<Vec<SkillsShItemDto>>,
}

/// Public wrappers for sibling modules (network_p2).
pub fn require_network_root_pub(settings: &AppSettings) -> Result<String, String> {
    require_network_root(settings)
}
pub fn snap_pub(settings: &AppSettings) -> AppSnapshotSubset {
    snap(settings)
}

pub fn is_network_entry_id(id: &str) -> bool {
    id.trim().starts_with(NETWORK_ID_PREFIX)
}

pub fn default_network_library_root() -> String {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    Path::new(&home)
        .join("CCM-NetworkLibrary")
        .to_string_lossy()
        .to_string()
}

pub fn effective_network_root(settings: &AppSettings) -> Option<String> {
    if settings.network_library_configured {
        let t = settings.network_library_root.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    None
}

pub fn ensure_network_layout(network_root: &str) -> Result<(), String> {
    let root = Path::new(network_root.trim());
    if root.as_os_str().is_empty() {
        return Err("network library root empty".into());
    }
    fs::create_dir_all(root).map_err(|e| format!("mkdir network root: {e}"))?;
    fs::create_dir_all(root.join(NETWORK_CACHE_DIR))
        .map_err(|e| format!("mkdir network cache: {e}"))?;
    let idx = root.join(NETWORK_INDEX_FILE);
    if !idx.exists() {
        save_network_index(network_root, &NetworkIndex::default())?;
    }
    Ok(())
}

pub fn load_network_index(network_root: &str) -> Result<NetworkIndex, String> {
    let path = Path::new(network_root.trim()).join(NETWORK_INDEX_FILE);
    if !path.exists() {
        return Ok(NetworkIndex::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read network-index: {e}"))?;
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    let mut index: NetworkIndex =
        serde_json::from_str(raw).map_err(|e| format!("parse network-index: {e}"))?;
    if index.version < 1 {
        index.version = 1;
    }
    Ok(index)
}

pub fn save_network_index(network_root: &str, index: &NetworkIndex) -> Result<(), String> {
    let root = Path::new(network_root.trim());
    fs::create_dir_all(root).map_err(|e| format!("mkdir network: {e}"))?;
    let path = root.join(NETWORK_INDEX_FILE);
    let tmp = root.join(format!("network-index.{}.tmp", std::process::id()));
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(&tmp, raw).map_err(|e| format!("write network-index tmp: {e}"))?;
    // validate
    let check = fs::read_to_string(&tmp).map_err(|e| e.to_string())?;
    let _: NetworkIndex =
        serde_json::from_str(&check).map_err(|e| format!("network-index invalid after write: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("rename network-index: {e}"))?;
    Ok(())
}

pub fn resolve_network_safe_path(
    network_root: &str,
    rel: &str,
) -> Result<PathBuf, String> {
    resolve_library_safe_path(network_root, rel).map_err(|e| e.to_string())
}

pub fn list_baseline_sources() -> Vec<NetworkBaselineSourceDto> {
    BASELINE_SOURCES
        .iter()
        .map(|(id, label, url)| NetworkBaselineSourceDto {
            id: (*id).into(),
            label: (*label).into(),
            url: (*url).into(),
        })
        .collect()
}

fn snap(settings: &AppSettings) -> AppSnapshotSubset {
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        crate::catalog::validate_entry_paths(
            settings.skills_library_root.trim(),
            &load.catalog.entries,
        )
    } else {
        vec![]
    };
    build_snapshot_subset(settings, &load, warnings)
}

fn require_network_root(settings: &AppSettings) -> Result<String, String> {
    let root = effective_network_root(settings).ok_or_else(|| "网络库未配置".to_string())?;
    if normalize_path(&root) == normalize_path(settings.skills_library_root.trim())
        && settings.library_root_configured
        && !settings.skills_library_root.trim().is_empty()
    {
        return Err("网络库根不得与永久库根相同".into());
    }
    ensure_network_layout(&root)?;
    Ok(root)
}

fn slug_from_url(url: &str) -> String {
    let u = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let last = u.rsplit('/').next().unwrap_or("repo");
    let prev = u.rsplit('/').nth(1).unwrap_or("src");
    sanitize_id(&format!("{prev}-{last}"))
}

fn sanitize_id(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c.to_ascii_lowercase());
        } else if c == ' ' || c == '/' || c == '\\' {
            out.push('-');
        }
    }
    while out.contains("--") {
        out = out.replace("--", "-");
    }
    let t = out.trim_matches('-').to_string();
    if t.is_empty() {
        "item".into()
    } else {
        t.chars().take(80).collect()
    }
}

fn run_git(args: &[&str], cwd: Option<&Path>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("未找到 git 或无法启动：{e}。请安装 Git 并加入 PATH。"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let detail = if !stderr.trim().is_empty() {
            stderr.trim()
        } else {
            stdout.trim()
        };
        let mut msg = format!(
            "git {} 失败：{}",
            args.first().unwrap_or(&""),
            detail
        );
        let low = detail.to_ascii_lowercase();
        if low.contains("couldn't connect")
            || low.contains("failed to connect")
            || low.contains("timed out")
            || low.contains("connection refused")
            || low.contains("could not resolve host")
        {
            msg.push_str(
                "。请检查本机能否访问该 Git 主机（代理/防火墙），或改用本机可达的 Git URL。",
            );
        }
        return Err(msg);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_head(repo: &Path) -> Result<String, String> {
    run_git(&["rev-parse", "HEAD"], Some(repo))
}

fn git_remote_head(url: &str) -> Result<String, String> {
    let out = run_git(&["ls-remote", url, "HEAD"], None)?;
    let sha = out
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if sha.is_empty() {
        return Err("无法解析远端 HEAD".into());
    }
    Ok(sha)
}

fn shallow_clone_or_update(url: &str, dest: &Path) -> Result<String, String> {
    if dest.join(".git").is_dir() {
        run_git(&["fetch", "--depth", "1", "origin"], Some(dest))?;
        let _ = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(dest));
        let _ = run_git(&["reset", "--hard", "FETCH_HEAD"], Some(dest));
        return git_head(dest);
    }
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| format!("清理旧缓存失败: {e}"))?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir cache parent: {e}"))?;
    }
    let dest_s = dest.to_string_lossy().to_string();
    match run_git(&["clone", "--depth", "1", url, &dest_s], None) {
        Ok(_) => {}
        Err(e) => {
            // 失败时去掉半成品目录，避免下次误当有效缓存
            if dest.exists() {
                let _ = fs::remove_dir_all(dest);
            }
            return Err(e);
        }
    }
    git_head(dest)
}

fn extract_summary_from_skill_md(text: &str) -> String {
    for line in text.lines().take(40) {
        let t = line.trim();
        if t.starts_with('#') {
            return t.trim_start_matches('#').trim().chars().take(120).collect();
        }
        if t.starts_with("description:") {
            return t
                .trim_start_matches("description:")
                .trim()
                .trim_matches('"')
                .chars()
                .take(120)
                .collect();
        }
    }
    String::new()
}

fn discover_entries_in_cache(
    network_root: &str,
    source: &NetworkSourceRecord,
    fingerprint: &str,
) -> Result<Vec<NetworkEntry>, String> {
    let cache_abs = resolve_network_safe_path(network_root, &source.cache_rel)?;
    let mut out = Vec::new();
    walk_discover(&cache_abs, &cache_abs, source, fingerprint, &mut out)?;
    Ok(out)
}

fn walk_discover(
    cache_abs: &Path,
    dir: &Path,
    source: &NetworkSourceRecord,
    fingerprint: &str,
    out: &mut Vec<NetworkEntry>,
) -> Result<(), String> {
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return Ok(()),
    };
    for ent in rd.flatten() {
        let p = ent.path();
        let name = ent.file_name().to_string_lossy().to_string();
        if name == ".git" || name == "node_modules" || name.starts_with('.') {
            continue;
        }
        let ft = ent.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            let skill_md = p.join("SKILL.md");
            if skill_md.is_file() {
                let net_rel = path_rel_to_network(cache_abs, &p, &source.cache_rel)?;
                let (hash, _) = hash_path_auto(&p).unwrap_or_default();
                let summary = fs::read_to_string(&skill_md)
                    .map(|t| extract_summary_from_skill_md(&t))
                    .unwrap_or_default();
                let item_id = sanitize_id(
                    p.file_name()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "skill".into())
                        .as_str(),
                );
                let id = format!("{NETWORK_ID_PREFIX}{}:{item_id}", source.id);
                out.push(NetworkEntry {
                    id,
                    kind: "skill".into(),
                    name: item_id,
                    source_id: source.id.clone(),
                    source_url: source.url.clone(),
                    remote_id: format!("{}:{}", source.url, net_rel),
                    cached_rel_path: net_rel,
                    fingerprint: fingerprint.to_string(),
                    content_hash: hash,
                    update_status: "current".into(),
                    summary,
                    license: String::new(),
                    intended_level: String::new(),
                    security_level: String::new(),
                });
                continue; // don't descend into skill package
            }
            walk_discover(cache_abs, &p, source, fingerprint, out)?;
        } else if ft.is_file() {
            let lower = name.to_lowercase();
            if lower.ends_with(".mdc") {
                let net_rel = path_rel_to_network(cache_abs, &p, &source.cache_rel)?;
                let (hash, _) = hash_path_auto(&p).unwrap_or_default();
                let stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "rule".into());
                let item_id = sanitize_id(&stem);
                let id = format!("{NETWORK_ID_PREFIX}{}:{item_id}", source.id);
                out.push(NetworkEntry {
                    id,
                    kind: "rule".into(),
                    name: item_id,
                    source_id: source.id.clone(),
                    source_url: source.url.clone(),
                    remote_id: format!("{}:{}", source.url, net_rel),
                    cached_rel_path: net_rel,
                    fingerprint: fingerprint.to_string(),
                    content_hash: hash,
                    update_status: "current".into(),
                    summary: String::new(),
                    license: String::new(),
                    intended_level: String::new(),
                    security_level: String::new(),
                });
            }
        }
    }
    Ok(())
}

fn path_rel_to_network(
    cache_abs: &Path,
    item: &Path,
    cache_rel: &str,
) -> Result<String, String> {
    let under = item
        .strip_prefix(cache_abs)
        .map_err(|_| format!("path escape: {}", item.display()))?;
    let joined = Path::new(cache_rel).join(under);
    Ok(joined.to_string_lossy().replace('\\', "/"))
}

/// Rebuild index entries for one source; preserve intendedLevel / security when same id.
fn merge_source_entries(
    index: &mut NetworkIndex,
    source_id: &str,
    new_entries: Vec<NetworkEntry>,
) {
    let prev: HashMap<String, NetworkEntry> = index
        .entries
        .iter()
        .filter(|e| e.source_id == source_id)
        .map(|e| (e.id.clone(), e.clone()))
        .collect();
    index.entries.retain(|e| e.source_id != source_id);
    for mut e in new_entries {
        if let Some(old) = prev.get(&e.id) {
            if !old.intended_level.is_empty() {
                e.intended_level = old.intended_level.clone();
            }
            e.security_level = old.security_level.clone();
        }
        index.entries.push(e);
    }
}

pub fn ensure_default_network_library(settings: &mut AppSettings) -> Result<AppSnapshotSubset, String> {
    if !settings.network_library_configured || settings.network_library_root.trim().is_empty() {
        settings.network_library_root = default_network_library_root();
        settings.network_library_configured = true;
    }
    // Reject same as permanent
    if settings.library_root_configured
        && !settings.skills_library_root.trim().is_empty()
        && normalize_path(&settings.network_library_root)
            == normalize_path(&settings.skills_library_root)
    {
        settings.network_library_root = default_network_library_root();
    }
    ensure_network_layout(&settings.network_library_root.clone())?;
    crate::settings::save_settings(settings)?;
    Ok(snap(settings))
}

pub fn choose_network_library_root(
    settings: &mut AppSettings,
    selected_path: &str,
) -> Result<AppSnapshotSubset, String> {
    let root = to_display_path(selected_path.trim());
    if root.is_empty() {
        return Err("已取消".into());
    }
    if settings.library_root_configured
        && !settings.skills_library_root.trim().is_empty()
        && normalize_path(&root) == normalize_path(&settings.skills_library_root)
    {
        return Err("网络库根不得与永久库根相同".into());
    }
    settings.network_library_root = root.clone();
    settings.network_library_configured = true;
    ensure_network_layout(&root)?;
    crate::settings::save_settings(settings)?;
    Ok(snap(settings))
}

pub fn fetch_network_source(
    settings: &AppSettings,
    url_or_baseline_id: &str,
    label: Option<&str>,
) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root(settings)?;
    let raw = url_or_baseline_id.trim();
    if raw.is_empty() {
        return Err("请提供 Git URL 或基线 id".into());
    }

    let lower = raw.to_ascii_lowercase();
    let is_remote = lower.starts_with("http://")
        || lower.starts_with("https://")
        || raw.starts_with("git@")
        || lower.starts_with("git://")
        || lower.starts_with("file://");
    let is_local_git = !is_remote
        && Path::new(raw).exists()
        && (Path::new(raw).is_dir() || lower.ends_with(".git"));

    let (source_id, source_label, url) = if let Some((id, lab, u)) =
        BASELINE_SOURCES.iter().find(|(id, _, _)| *id == raw)
    {
        ((*id).to_string(), (*lab).to_string(), (*u).to_string())
    } else if is_remote || is_local_git {
        let id = slug_from_url(raw);
        let lab = label
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        (id, lab, raw.to_string())
    } else if let Some((id, lab, u)) = BASELINE_SOURCES
        .iter()
        .find(|(_, _, u)| u.eq_ignore_ascii_case(raw))
    {
        ((*id).to_string(), (*lab).to_string(), (*u).to_string())
    } else {
        return Err(
            "无法识别源：请粘贴 Git URL / 本地 Git 路径，或选择基线 id（anthropics-skills / vercel-agent-skills）"
                .into(),
        );
    };

    let cache_rel = format!("{NETWORK_CACHE_DIR}/{source_id}");
    let dest = resolve_network_safe_path(&net_root, &cache_rel)?;
    let fingerprint = shallow_clone_or_update(&url, &dest)?;

    let mut index = load_network_index(&net_root)?;
    let source = NetworkSourceRecord {
        id: source_id.clone(),
        label: source_label,
        url: url.clone(),
        cache_rel: cache_rel.clone(),
        fingerprint: fingerprint.clone(),
        last_fetched_at: chrono_like_now(),
    };
    if let Some(existing) = index.sources.iter_mut().find(|s| s.id == source_id) {
        *existing = source.clone();
    } else {
        index.sources.push(source.clone());
    }
    let entries = discover_entries_in_cache(&net_root, &source, &fingerprint)?;
    let n = entries.len();
    merge_source_entries(&mut index, &source_id, entries);
    save_network_index(&net_root, &index)?;

    Ok(NetworkOpResult {
        ok: true,
        message: format!("已缓存「{source_id}」：发现 {n} 个条目（commit {}）", &fingerprint[..fingerprint.len().min(8)]),
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

pub fn check_network_updates(settings: &AppSettings) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root(settings)?;
    let mut index = load_network_index(&net_root)?;
    let mut available = 0u32;
    for src in index.sources.iter_mut() {
        match git_remote_head(&src.url) {
            Ok(remote) => {
                if !remote.eq_ignore_ascii_case(&src.fingerprint) {
                    for e in index.entries.iter_mut().filter(|e| e.source_id == src.id) {
                        e.update_status = "updateAvailable".into();
                    }
                    available += 1;
                } else {
                    for e in index.entries.iter_mut().filter(|e| e.source_id == src.id) {
                        if e.update_status == "updateAvailable" {
                            e.update_status = "current".into();
                        }
                    }
                }
            }
            Err(err) => {
                for e in index.entries.iter_mut().filter(|e| e.source_id == src.id) {
                    e.update_status = "error".into();
                    e.summary = if e.summary.is_empty() {
                        err.clone()
                    } else {
                        e.summary.clone()
                    };
                }
            }
        }
    }
    save_network_index(&net_root, &index)?;
    let reapply_hints = collect_reapply_hints(settings, &index);
    Ok(NetworkOpResult {
        ok: true,
        message: if available == 0 {
            "检查完成：无可用更新".into()
        } else {
            format!("检查完成：{available} 个源有更新（需确认后覆盖缓存）")
        },
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: Some(available),
        security: None,
        reapply_hints: if reapply_hints.is_empty() {
            None
        } else {
            Some(reapply_hints)
        },
        blocked: None,
        search_items: None,
    })
}

fn collect_reapply_hints(settings: &AppSettings, index: &NetworkIndex) -> Vec<ReapplyHintDto> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return vec![];
    }
    let load = load_catalog(lib);
    if !load.healthy {
        return vec![];
    }
    let mut out = Vec::new();
    for entry in &load.catalog.entries {
        let Some(prov) = get_provenance(entry) else {
            continue;
        };
        let Some(net) = index.entries.iter().find(|e| {
            (!prov.network_entry_id.is_empty() && e.id == prov.network_entry_id)
                || (e.source_id == prov.source_id
                    && e.name.eq_ignore_ascii_case(&prov.skill_name))
        }) else {
            continue;
        };
        if net.update_status != "updateAvailable" {
            continue;
        }
        let has_custom = load_customization(lib, &entry.id)
            .map(|c| !c.unified_diff.trim().is_empty())
            .unwrap_or(false);
        if !has_custom {
            continue;
        }
        out.push(ReapplyHintDto {
            entry_id: entry.id.clone(),
            skill_name: prov.skill_name.clone(),
            source_url: prov.source_url.clone(),
            network_entry_id: net.id.clone(),
            has_customization: true,
            message: format!(
                "「{}」上游有更新且本地有定制 diff，可选择重放定制 / 覆盖 / 跳过",
                entry.id
            ),
        });
    }
    out
}

pub fn apply_network_cache_update(
    settings: &AppSettings,
    source_ids: &[String],
) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root(settings)?;
    let mut index = load_network_index(&net_root)?;
    let targets: Vec<String> = if source_ids.is_empty() {
        index
            .sources
            .iter()
            .filter(|s| {
                index
                    .entries
                    .iter()
                    .any(|e| e.source_id == s.id && e.update_status == "updateAvailable")
            })
            .map(|s| s.id.clone())
            .collect()
    } else {
        source_ids.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
    };
    if targets.is_empty() {
        return Ok(NetworkOpResult {
            ok: true,
            message: "没有需要更新的源".into(),
            snapshot: snap(settings),
            conflicts: None,
            promoted: None,
            update_available: Some(0),
            security: None,
            reapply_hints: None,
            blocked: None,
            search_items: None,
        });
    }
    let mut updated = 0u32;
    let mut bak_notes = Vec::new();
    for sid in targets {
        let Some(src) = index.sources.iter().find(|s| s.id == sid).cloned() else {
            continue;
        };
        match backup_cache_dir_before_update(&net_root, &sid) {
            Ok(Some(rel)) => bak_notes.push(rel),
            Ok(None) => {}
            Err(e) => {
                return Err(format!("源 {sid} 更新中止：{e}"));
            }
        }
        let dest = resolve_network_safe_path(&net_root, &src.cache_rel)?;
        let fingerprint = shallow_clone_or_update(&src.url, &dest)?;
        if let Some(s) = index.sources.iter_mut().find(|s| s.id == sid) {
            s.fingerprint = fingerprint.clone();
            s.last_fetched_at = chrono_like_now();
        }
        let src_now = index
            .sources
            .iter()
            .find(|s| s.id == sid)
            .cloned()
            .unwrap_or(src);
        let entries = discover_entries_in_cache(&net_root, &src_now, &fingerprint)?;
        merge_source_entries(&mut index, &sid, entries);
        updated += 1;
    }
    save_network_index(&net_root, &index)?;
    let bak_msg = if bak_notes.is_empty() {
        String::new()
    } else {
        format!("；已备份 {} 个旧缓存", bak_notes.len())
    };
    Ok(NetworkOpResult {
        ok: true,
        message: format!("已更新 {updated} 个源的网络缓存（未改永久库）{bak_msg}"),
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: Some(0),
        security: None,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

/// Rename existing cache dir to `cache/{id}.bak-{ts}` before overwrite (P2).
pub fn backup_cache_dir_before_update(
    network_root: &str,
    source_id: &str,
) -> Result<Option<String>, String> {
    let cache_rel = format!("{NETWORK_CACHE_DIR}/{source_id}");
    let dest = resolve_network_safe_path(network_root, &cache_rel)?;
    if !dest.exists() {
        return Ok(None);
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let bak_rel = format!("{NETWORK_CACHE_DIR}/{source_id}.bak-{ts}");
    let bak = resolve_network_safe_path(network_root, &bak_rel)?;
    if bak.exists() {
        if bak.is_dir() {
            fs::remove_dir_all(&bak).map_err(|e| format!("清理旧 bak: {e}"))?;
        } else {
            fs::remove_file(&bak).map_err(|e| format!("清理旧 bak: {e}"))?;
        }
    }
    fs::rename(&dest, &bak).map_err(|e| format!("备份网络缓存失败（{source_id}）: {e}"))?;
    Ok(Some(bak_rel))
}

fn copy_tree(src: &Path, dst: &Path) -> Result<(), String> {
    if src.is_file() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
        }
        fs::copy(src, dst).map_err(|e| format!("copy file: {e}"))?;
        return Ok(());
    }
    fs::create_dir_all(dst).map_err(|e| format!("mkdir dest: {e}"))?;
    for ent in fs::read_dir(src).map_err(|e| format!("readdir: {e}"))? {
        let ent = ent.map_err(|e| e.to_string())?;
        let name = ent.file_name();
        if name == ".git" {
            continue;
        }
        let from = ent.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("copy: {e}"))?;
        }
    }
    Ok(())
}

fn make_provenance(net_entry: &NetworkEntry) -> NetworkProvenance {
    NetworkProvenance {
        source_url: net_entry.source_url.clone(),
        source_id: net_entry.source_id.clone(),
        remote_ref: net_entry.fingerprint.clone(),
        baseline_content_hash: net_entry.content_hash.clone(),
        skill_name: net_entry.name.clone(),
        promoted_at: chrono_like_now(),
        network_entry_id: net_entry.id.clone(),
    }
}

fn finalize_promoted_entry(
    lib: &str,
    mut entry: CatalogEntry,
    net_entry: &NetworkEntry,
    src_cmp: &Path,
) -> Result<(), String> {
    let prov = make_provenance(net_entry);
    set_provenance(&mut entry, &prov);
    let level = net_entry.intended_level.trim();
    if level == "L0" || level == "L1" || level == "L2" {
        let mut tags = get_entry_tags(&entry);
        tags.level = Some(level.to_string());
        set_entry_tags(&mut entry, tags);
    }
    upsert_entry(lib, entry.clone())?;
    let text = fs::read_to_string(src_cmp).unwrap_or_default();
    seed_baseline_on_promote(lib, &entry.id, &text, &net_entry.content_hash)?;
    Ok(())
}

pub fn promote_network_to_library(
    settings: &AppSettings,
    entry_ids: &[String],
    resolutions: &[ConflictResolution],
    force_security_override: bool,
) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root(settings)?;
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库".into());
    }
    ensure_library_layout(lib)?;
    let mut index = load_network_index(&net_root)?;
    let res_map: HashMap<String, String> = resolutions
        .iter()
        .map(|r| (r.key.clone(), r.choice.to_lowercase()))
        .collect();

    let mut worst_security: Option<SecurityReport> = None;
    for raw_id in entry_ids {
        let id = raw_id.trim();
        if !is_network_entry_id(id) {
            continue;
        }
        let Some(net_entry) = index.entries.iter().find(|e| e.id == id) else {
            continue;
        };
        let Ok(src_abs) = resolve_network_safe_path(&net_root, &net_entry.cached_rel_path) else {
            continue;
        };
        let report = evaluate_path(&net_root, &src_abs);
        if let Some(e) = index.entries.iter_mut().find(|e| e.id == id) {
            e.security_level = report.level.clone();
        }
        let take = match (&worst_security, report.level.as_str()) {
            (None, _) => true,
            (Some(w), "block") if w.level != "block" => true,
            (Some(w), "warn") if w.level == "pass" => true,
            _ => false,
        };
        if take {
            worst_security = Some(report);
        }
    }
    let _ = save_network_index(&net_root, &index);
    if let Some(ref sec) = worst_security {
        if sec.level == "block" && !force_security_override {
            return Ok(NetworkOpResult {
                ok: false,
                message: format!(
                    "安全评测为 block，已阻止转入本地（{} 条发现）。确认风险后可强制转入。",
                    sec.findings.len()
                ),
                snapshot: snap(settings),
                conflicts: None,
                promoted: Some(0),
                update_available: None,
                security: Some(sec.clone()),
                reapply_hints: None,
                blocked: Some(true),
                search_items: None,
            });
        }
    }

    let mut promoted = 0u32;
    let mut conflicts = Vec::new();

    for raw_id in entry_ids {
        let id = raw_id.trim();
        if !is_network_entry_id(id) {
            continue;
        }
        let Some(net_entry) = index.entries.iter().find(|e| e.id == id).cloned() else {
            continue;
        };
        let src_abs = resolve_network_safe_path(&net_root, &net_entry.cached_rel_path)?;
        if !src_abs.exists() {
            return Err(format!("网络缓存缺失：{}", net_entry.cached_rel_path));
        }

        let promote_id = sanitize_id(&net_entry.name);
        let kind = net_entry.kind.clone();
        let lib_rel = if kind.eq_ignore_ascii_case("rule") {
            format!("rules/{promote_id}.mdc")
        } else if kind.eq_ignore_ascii_case("skill") {
            if src_abs.is_dir() {
                format!("skills/{promote_id}")
            } else {
                format!("skills/{promote_id}/SKILL.md")
            }
        } else {
            format!("skills/{promote_id}")
        };

        let dest_abs = resolve_library_safe_path(lib, &lib_rel).map_err(|e| e.to_string())?;
        let load = load_catalog(lib);
        let existing = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == promote_id || e.library_path.replace('\\', "/") == lib_rel)
            .cloned();

        let src_cmp = resolve_comparable_content_path(&src_abs.to_string_lossy(), &kind);
        let (src_hash, _) = hash_path_auto(&src_cmp).unwrap_or_default();

        if let Some(ref ex) = existing {
            let lib_full =
                resolve_library_safe_path(lib, &ex.library_path).map_err(|e| e.to_string())?;
            let lib_cmp = resolve_comparable_content_path(&lib_full.to_string_lossy(), &ex.kind);
            let (lib_hash, _) = hash_path_auto(&lib_cmp).unwrap_or_default();
            if !src_hash.is_empty()
                && !lib_hash.is_empty()
                && src_hash.eq_ignore_ascii_case(&lib_hash)
            {
                // same content — skip
                continue;
            }
            let key = format!("promote:{id}");
            let choice = res_map.get(&key).cloned().or_else(|| {
                res_map
                    .get(&id.to_string())
                    .cloned()
            });
            if choice.is_none() {
                let mut dto = path_conflict_dto(
                    key,
                    "promoteFromNetwork",
                    promote_id.clone(),
                    kind.clone(),
                    src_abs.to_string_lossy().to_string(),
                    lib_full.to_string_lossy().to_string(),
                    ex.id.clone(),
                    src_hash.clone(),
                    lib_hash,
                );
                dto.source_preview = format!(
                    "【来自网络库】{}\n{}",
                    net_entry.source_url, dto.source_preview
                );
                conflicts.push(dto);
                continue;
            }
            let choice = choice.unwrap();
            if choice == "skip" {
                continue;
            }
            if choice == "merge" {
                // keep permanent — do nothing
                continue;
            }
            if choice == "saveas" {
                let new_id = format!("{promote_id}__network");
                let new_rel = if kind.eq_ignore_ascii_case("rule") {
                    format!("rules/{new_id}.mdc")
                } else {
                    format!("skills/{new_id}")
                };
                let new_dest =
                    resolve_library_safe_path(lib, &new_rel).map_err(|e| e.to_string())?;
                copy_tree(&src_abs, &new_dest)?;
                finalize_promoted_entry(
                    lib,
                    CatalogEntry {
                        id: new_id,
                        kind: kind.clone(),
                        library_path: new_rel,
                        is_in_library: true,
                        deployed_path: String::new(),
                        is_missing: false,
                        remark_zh: format!("来自网络库 {}", net_entry.source_url),
                        description: net_entry.summary.clone(),
                        trigger: String::new(),
                        origins: vec![CatalogOrigin {
                            original_path: net_entry.source_url.clone(),
                            tool: "network".into(),
                            scope: "network".into(),
                        }],
                        extra: Default::default(),
                    },
                    &net_entry,
                    &src_cmp,
                )?;
                promoted += 1;
                continue;
            }
            if choice == "overwrite" {
                // network wins → overwrite permanent main file / tree
                if kind.eq_ignore_ascii_case("skill") && src_abs.is_dir() {
                    if lib_full.exists() {
                        if lib_full.is_dir() {
                            // sync main file into existing skill dir
                            let lib_dest =
                                resolve_library_main_dest(&lib_full, lib_cmp.clone(), &kind)?;
                            sync_main_file(&src_cmp, &lib_dest)?;
                            verify_content_hash_match(&src_cmp, &lib_dest)?;
                        } else {
                            copy_tree(&src_abs, &lib_full)?;
                        }
                    } else {
                        copy_tree(&src_abs, &dest_abs)?;
                    }
                } else {
                    let lib_dest = resolve_library_main_dest(&lib_full, lib_cmp, &kind)?;
                    sync_main_file(&src_cmp, &lib_dest)?;
                    verify_content_hash_match(&src_cmp, &lib_dest)?;
                }
                let mut updated = ex.clone();
                updated.is_in_library = true;
                updated.is_missing = false;
                updated.origins.push(CatalogOrigin {
                    original_path: net_entry.source_url.clone(),
                    tool: "network".into(),
                    scope: "network".into(),
                });
                finalize_promoted_entry(lib, updated, &net_entry, &src_cmp)?;
                promoted += 1;
                continue;
            }
        }

        // no existing — copy fresh
        if dest_abs.exists() {
            // rare path collision without catalog entry
            if dest_abs.is_dir() {
                fs::remove_dir_all(&dest_abs).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(&dest_abs).map_err(|e| e.to_string())?;
            }
        }
        copy_tree(&src_abs, &dest_abs)?;
        finalize_promoted_entry(
            lib,
            CatalogEntry {
                id: promote_id,
                kind: kind.clone(),
                library_path: lib_rel,
                is_in_library: true,
                deployed_path: String::new(),
                is_missing: false,
                remark_zh: format!("来自网络库 {}", net_entry.source_url),
                description: net_entry.summary.clone(),
                trigger: String::new(),
                origins: vec![CatalogOrigin {
                    original_path: net_entry.source_url.clone(),
                    tool: "network".into(),
                    scope: "network".into(),
                }],
                extra: Default::default(),
            },
            &net_entry,
            &src_cmp,
        )?;
        promoted += 1;
    }

    let msg = if !conflicts.is_empty() {
        format!(
            "存入永久库需决议：{} 处同名冲突（来自网络库）",
            conflicts.len()
        )
    } else {
        format!("已存入永久库 {promoted} 项")
    };

    Ok(NetworkOpResult {
        ok: conflicts.is_empty(),
        message: msg,
        snapshot: snap(settings),
        conflicts: if conflicts.is_empty() {
            None
        } else {
            Some(conflicts)
        },
        promoted: Some(promoted),
        update_available: None,
        security: worst_security,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

pub fn network_list_items(settings: &AppSettings) -> Vec<LibraryListItemDto> {
    let Some(root) = effective_network_root(settings) else {
        return vec![];
    };
    let Ok(index) = load_network_index(&root) else {
        return vec![];
    };
    let heat = load_heat_cache(&root);
    index
        .entries
        .iter()
        .filter(|e| kind_allowed(settings, &e.kind))
        .map(|e| {
            let badge = match e.update_status.as_str() {
                "updateAvailable" => " · 有更新",
                "error" => " · 检查失败",
                _ => "",
            };
            let heat_label = heat_for_source_id(&e.source_id, Some(&heat));
            let level = e.intended_level.trim();
            let sec = e.security_level.trim();
            let subtitle = format!(
                "{}{}{}{}{}",
                e.source_url,
                if e.summary.is_empty() {
                    String::new()
                } else {
                    format!(" · {}", e.summary)
                },
                if level.is_empty() {
                    String::new()
                } else {
                    format!(" · {level}")
                },
                if sec.is_empty() {
                    String::new()
                } else {
                    format!(" · 安全:{sec}")
                },
                badge
            );
            LibraryListItemDto {
                entry_id: e.id.clone(),
                display_name: e.name.clone(),
                group_name: "网络库".into(),
                library_path_rel: Some(e.cached_rel_path.clone()),
                kind_label: crate::catalog::kind_label(&e.kind),
                subtitle,
                is_in_container_list: false,
                is_in_active_use: false,
                search_text: Some(format!(
                    "{} {} {} {} {} {}",
                    e.id, e.name, e.source_url, e.summary, e.source_id, heat_label
                )),
                level_key: if level.is_empty() {
                    None
                } else {
                    Some(level.to_string())
                },
                scope_key: None,
                source_id: Some(e.source_id.clone()),
                source_url: Some(e.source_url.clone()),
                heat_label: Some(heat_label),
                intended_level: if level.is_empty() {
                    None
                } else {
                    Some(level.to_string())
                },
                security_level: if sec.is_empty() {
                    None
                } else {
                    Some(sec.to_string())
                },
                update_available: Some(e.update_status == "updateAvailable"),
            }
        })
        .collect()
}

pub fn network_nav_for_snapshot(
    settings: &AppSettings,
) -> (Vec<NetworkNavNodeDto>, Vec<NetworkNavNodeDto>) {
    let mut counts: HashMap<String, u32> = HashMap::new();
    let heat = effective_network_root(settings).map(|r| load_heat_cache(&r));
    if let Some(root) = effective_network_root(settings) {
        if let Ok(index) = load_network_index(&root) {
            for e in &index.entries {
                *counts.entry(e.source_id.clone()).or_default() += 1;
            }
        }
    }
    build_network_nav(settings, &counts, heat.as_ref())
}

pub fn set_network_pin(
    settings: &mut AppSettings,
    section: &str,
    id: &str,
    pinned: bool,
) -> Result<AppSnapshotSubset, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("空 id".into());
    }
    let list = if section.eq_ignore_ascii_case("official") {
        &mut settings.network_official_pinned_ids
    } else if section.eq_ignore_ascii_case("popular") {
        &mut settings.network_popular_pinned_ids
    } else {
        return Err("section 须为 official 或 popular".into());
    };
    list.retain(|x| !x.eq_ignore_ascii_case(id));
    if pinned {
        list.push(id.to_string());
    }
    crate::settings::save_settings(settings)?;
    Ok(snap(settings))
}

pub fn set_network_agent_repo_override(
    settings: &mut AppSettings,
    agent_key: &str,
    url: &str,
) -> Result<AppSnapshotSubset, String> {
    let key = agent_key.trim();
    if key.is_empty() {
        return Err("空 agentKey".into());
    }
    let url = url.trim();
    if url.is_empty() {
        settings.network_agent_repo_overrides.remove(key);
    } else {
        settings
            .network_agent_repo_overrides
            .insert(key.to_string(), url.to_string());
    }
    crate::settings::save_settings(settings)?;
    Ok(snap(settings))
}

pub fn set_network_intended_level(
    settings: &AppSettings,
    entry_ids: &[String],
    level: &str,
) -> Result<NetworkOpResult, String> {
    let level = level.trim();
    if !(level.is_empty() || level == "L0" || level == "L1" || level == "L2") {
        return Err("level 须为 L0/L1/L2 或空".into());
    }
    let net_root = require_network_root(settings)?;
    let mut index = load_network_index(&net_root)?;
    let mut n = 0u32;
    for raw in entry_ids {
        let id = raw.trim();
        if let Some(e) = index.entries.iter_mut().find(|e| e.id == id) {
            e.intended_level = level.to_string();
            n += 1;
        }
    }
    save_network_index(&net_root, &index)?;
    Ok(NetworkOpResult {
        ok: true,
        message: format!("已写入意向层级 {n} 项"),
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

pub fn evaluate_network_security(
    settings: &AppSettings,
    entry_ids: &[String],
) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root(settings)?;
    let mut index = load_network_index(&net_root)?;
    let mut worst: Option<SecurityReport> = None;
    for raw in entry_ids {
        let id = raw.trim();
        let Some(e) = index.entries.iter().find(|e| e.id == id).cloned() else {
            continue;
        };
        let Ok(src) = resolve_network_safe_path(&net_root, &e.cached_rel_path) else {
            continue;
        };
        let report = evaluate_path(&net_root, &src);
        if let Some(ent) = index.entries.iter_mut().find(|x| x.id == id) {
            ent.security_level = report.level.clone();
        }
        let take = match (&worst, report.level.as_str()) {
            (None, _) => true,
            (Some(w), "block") if w.level != "block" => true,
            (Some(w), "warn") if w.level == "pass" => true,
            _ => false,
        };
        if take {
            worst = Some(report);
        }
    }
    save_network_index(&net_root, &index)?;
    Ok(NetworkOpResult {
        ok: true,
        message: worst
            .as_ref()
            .map(|r| format!("安全评测：{}", r.level))
            .unwrap_or_else(|| "无可评测条目".into()),
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: worst,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

pub fn fetch_network_nav_source(
    settings: &AppSettings,
    kind: &str,
    id: &str,
) -> Result<NetworkOpResult, String> {
    let id = id.trim();
    if kind.eq_ignore_ascii_case("popular") {
        let p = POPULAR_SOURCES
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(id))
            .ok_or_else(|| format!("未知热门源：{id}"))?;
        return fetch_network_source(settings, p.url, Some(p.label));
    }
    if kind.eq_ignore_ascii_case("official") {
        let (url, baseline) = resolve_agent_repo(settings, id);
        if let Some(b) = baseline {
            return fetch_network_source(settings, &b, None);
        }
        if url.trim().is_empty() {
            return Err("该官方工作区无默认仓；请先设置仓库 URL 或改用粘贴 Git URL".into());
        }
        return fetch_network_source(settings, &url, None);
    }
    Err("kind 须为 official 或 popular".into())
}

pub fn reapply_network_customization(
    settings: &AppSettings,
    entry_id: &str,
    network_entry_id: &str,
    mode: &str,
) -> Result<NetworkOpResult, String> {
    let mode = mode.trim().to_lowercase();
    if mode == "skip" {
        return Ok(NetworkOpResult {
            ok: true,
            message: "已跳过定制重放".into(),
            snapshot: snap(settings),
            conflicts: None,
            promoted: None,
            update_available: None,
            security: None,
            reapply_hints: None,
            blocked: None,
            search_items: None,
        });
    }
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return Err("请先配置永久库".into());
    }
    let net_root = require_network_root(settings)?;
    let index = load_network_index(&net_root)?;
    let net = index
        .entries
        .iter()
        .find(|e| e.id == network_entry_id)
        .ok_or_else(|| format!("网络条目不存在：{network_entry_id}"))?
        .clone();
    let load = load_catalog(lib);
    let entry = load
        .catalog
        .entries
        .iter()
        .find(|e| e.id == entry_id)
        .cloned()
        .ok_or_else(|| format!("永久库条目不存在：{entry_id}"))?;
    let src_abs = resolve_network_safe_path(&net_root, &net.cached_rel_path)?;
    let cmp = resolve_comparable_content_path(&src_abs.to_string_lossy(), &net.kind);
    let upstream = fs::read_to_string(&cmp).unwrap_or_default();
    let upstream_hash = if net.content_hash.is_empty() {
        crate::hash::hash_path_auto(&cmp)
            .map(|(h, _)| h)
            .unwrap_or_default()
    } else {
        net.content_hash.clone()
    };
    if mode == "overwrite" {
        write_merged_to_library_entry(lib, &entry, &upstream)?;
        update_entry_provenance_hash(lib, entry_id, &upstream_hash, &net.fingerprint)?;
        return Ok(NetworkOpResult {
            ok: true,
            message: format!("已用上游覆盖永久库：{entry_id}"),
            snapshot: snap(settings),
            conflicts: None,
            promoted: None,
            update_available: None,
            security: None,
            reapply_hints: None,
            blocked: None,
            search_items: None,
        });
    }
    if mode == "reapply" {
        let (merged, _applied) =
            reapply_customization_on_text(lib, entry_id, &upstream, &upstream_hash)?;
        write_merged_to_library_entry(lib, &entry, &merged)?;
        update_entry_provenance_hash(lib, entry_id, &upstream_hash, &net.fingerprint)?;
        return Ok(NetworkOpResult {
            ok: true,
            message: format!("已重放定制到永久库：{entry_id}"),
            snapshot: snap(settings),
            conflicts: None,
            promoted: None,
            update_available: None,
            security: None,
            reapply_hints: None,
            blocked: None,
            search_items: None,
        });
    }
    Err("mode 须为 reapply / overwrite / skip".into())
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

pub fn load_network_detail(
    settings: &AppSettings,
    entry_id: &str,
) -> Option<(String, String, String)> {
    // returns (summary, markdown, file_path)
    if !is_network_entry_id(entry_id) {
        return None;
    }
    let root = effective_network_root(settings)?;
    let index = load_network_index(&root).ok()?;
    let e = index.entries.iter().find(|x| x.id == entry_id)?;
    let abs = resolve_network_safe_path(&root, &e.cached_rel_path).ok()?;
    let cmp = resolve_comparable_content_path(&abs.to_string_lossy(), &e.kind);
    let text = fs::read_to_string(&cmp).unwrap_or_default();
    let summary = format!(
        "{}\n种类: {}\n来源: {}\n状态: {}\n缓存: {}\n（只读 · 网络库）",
        e.name, e.kind, e.source_url, e.update_status, e.cached_rel_path
    );
    Some((
        summary,
        text,
        cmp.to_string_lossy().to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::AppSettings;

    #[test]
    fn network_root_differs_from_library() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();
        assert!(Path::new(&net).join(NETWORK_INDEX_FILE).is_file());
        assert_ne!(normalize_path(&net), normalize_path(&lib));
    }

    #[test]
    fn reject_same_root_on_choose() {
        let dir = tempfile::tempdir().unwrap();
        let same = dir.path().to_string_lossy().to_string();
        let mut settings = AppSettings {
            skills_library_root: same.clone(),
            library_root_configured: true,
            ..Default::default()
        };
        let err = choose_network_library_root(&mut settings, &same).unwrap_err();
        assert!(err.contains("不得"));
    }

    #[test]
    fn promote_copies_skill_into_library() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let skill_dir = Path::new(&net).join("cache/demo/my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Hello\n\nbody").unwrap();

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
            id: format!("{NETWORK_ID_PREFIX}demo:my-skill"),
            kind: "skill".into(),
            name: "my-skill".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/my-skill".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "Hello".into(),
            license: String::new(),
            ..Default::default()
        });
        save_network_index(&net, &index).unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };
        let res = promote_network_to_library(
            &settings,
            &[format!("{NETWORK_ID_PREFIX}demo:my-skill")],
            &[],
            false,
        )
        .unwrap();
        assert!(res.ok, "{}", res.message);
        assert_eq!(res.promoted, Some(1));
        let load = load_catalog(&lib);
        assert!(load.catalog.entries.iter().any(|e| e.id == "my-skill"));
        assert!(
            Path::new(&lib)
                .join("skills/my-skill/SKILL.md")
                .is_file()
                || Path::new(&lib).join("skills/my-skill").join("SKILL.md").is_file()
        );
        let entry = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == "my-skill")
            .unwrap();
        assert!(entry.origins.iter().any(|o| o.tool == "network"));
    }

    #[test]
    fn is_network_id() {
        assert!(is_network_entry_id("net:foo:bar"));
        assert!(!is_network_entry_id("foo"));
    }

    #[test]
    fn index_default_version_is_one() {
        assert_eq!(NetworkIndex::default().version, 1);
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let loaded = load_network_index(&net).unwrap();
        assert_eq!(loaded.version, 1);
    }

    /// Docs/04 验收步骤 5–7（域路径）：晋升、冲突文案、只读守卫语义。
    #[test]
    fn acceptance_promote_conflict_and_readonly_guards() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let skill_dir = Path::new(&net).join("cache/demo/shared-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# Network version\n\nfrom net").unwrap();

        // 永久库先放同名不同内容
        let lib_skill = Path::new(&lib).join("skills/shared-skill");
        fs::create_dir_all(&lib_skill).unwrap();
        fs::write(lib_skill.join("SKILL.md"), "# Library version\n\nfrom lib").unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "shared-skill".into(),
                kind: "skill".into(),
                library_path: "skills/shared-skill".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();

        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: "demo".into(),
            label: "Demo".into(),
            url: "https://example.com/demo.git".into(),
            cache_rel: "cache/demo".into(),
            fingerprint: "abc".into(),
            last_fetched_at: String::new(),
        });
        let net_id = format!("{NETWORK_ID_PREFIX}demo:shared-skill");
        index.entries.push(NetworkEntry {
            id: net_id.clone(),
            kind: "skill".into(),
            name: "shared-skill".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/shared-skill".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: String::new(),
            license: String::new(),
            ..Default::default()
        });
        save_network_index(&net, &index).unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };

        // 步骤 6：同名不同哈希 → 冲突，文案含网络库
        let res = promote_network_to_library(&settings, &[net_id.clone()], &[], false).unwrap();
        assert!(!res.ok);
        let conflicts = res.conflicts.expect("conflicts");
        assert!(!conflicts.is_empty());
        assert!(
            conflicts[0].source_preview.contains("来自网络库")
                || conflicts[0].operation == "promoteFromNetwork"
        );
        assert_eq!(conflicts[0].operation, "promoteFromNetwork");

        // 采用网络库
        let res2 = promote_network_to_library(
            &settings,
            &[net_id.clone()],
            &[ConflictResolution {
                key: conflicts[0].key.clone(),
                choice: "overwrite".into(),
            }],
            false,
        )
        .unwrap();
        assert!(res2.ok, "{}", res2.message);
        let text = fs::read_to_string(lib_skill.join("SKILL.md")).unwrap();
        assert!(text.contains("from net"));

        // 步骤 7：网络 id 守卫（与 lib.rs 命令一致）
        assert!(is_network_entry_id(&net_id));
    }

    /// 五项验收「拉取」域路径：本地 bare 仓浅克隆 → 发现 net: 条目（不依赖外网）。
    #[test]
    fn acceptance_fetch_local_git_discovers_entries() {
        use std::process::Command;

        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        let work = dir.path().join("seed");
        let bare = dir.path().join("bare.git");
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let skill = work.join("demo-skill");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: demo-skill\n---\n# Demo\n",
        )
        .unwrap();

        let run = |cwd: &Path, args: &[&str]| {
            let out = Command::new("git")
                .args(args)
                .current_dir(cwd)
                .env("GIT_AUTHOR_NAME", "ccm")
                .env("GIT_AUTHOR_EMAIL", "ccm@local")
                .env("GIT_COMMITTER_NAME", "ccm")
                .env("GIT_COMMITTER_EMAIL", "ccm@local")
                .output()
                .expect("git");
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };
        run(dir.path(), &["init", work.to_str().unwrap()]);
        run(&work, &["add", "."]);
        run(&work, &["commit", "-m", "seed"]);
        run(
            dir.path(),
            &[
                "clone",
                "--bare",
                work.to_str().unwrap(),
                bare.to_str().unwrap(),
            ],
        );

        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };
        let res = fetch_network_source(
            &settings,
            bare.to_str().unwrap(),
            Some("local-seed"),
        )
        .unwrap();
        assert!(res.ok, "{}", res.message);
        let items = network_list_items(&settings);
        assert!(
            items.iter().any(|i| i.entry_id.starts_with(NETWORK_ID_PREFIX)),
            "expected net: entries, got {:?}",
            items.iter().map(|i| &i.entry_id).collect::<Vec<_>>()
        );
        let id = items[0].entry_id.clone();
        let detail = load_network_detail(&settings, &id);
        assert!(detail.is_some(), "readonly detail");
        assert!(detail.unwrap().0.contains("只读"));
    }

    #[test]
    fn acceptance_check_update_does_not_touch_catalog() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();
        upsert_entry(
            &lib,
            CatalogEntry {
                id: "keep-me".into(),
                kind: "skill".into(),
                library_path: "skills/keep-me".into(),
                is_in_library: true,
                ..Default::default()
            },
        )
        .unwrap();
        let before = fs::read_to_string(Path::new(&lib).join("catalog.json")).unwrap();

        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: "local".into(),
            label: "Local".into(),
            url: "https://example.invalid/no-such-repo.git".into(),
            cache_rel: "cache/local".into(),
            fingerprint: "deadbeef".into(),
            last_fetched_at: String::new(),
        });
        save_network_index(&net, &index).unwrap();

        let settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };
        let _ = check_network_updates(&settings).unwrap();
        let after = fs::read_to_string(Path::new(&lib).join("catalog.json")).unwrap();
        assert_eq!(before, after, "检查更新不得改永久库 catalog.json");
    }
}
