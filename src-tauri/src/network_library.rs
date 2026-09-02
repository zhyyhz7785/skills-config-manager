//! Network library (Plan/03 Must): read-only quarantine cache → promote to permanent library.
//! Independent root + `network-index.json`; never writes permanent `catalog.json` except via promote.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use crate::catalog::{
    ensure_library_layout, get_entry_tags, load_catalog, set_entry_tags, upsert_entry,
    CatalogEntry, CatalogOrigin,
};
use crate::content_sync::{
    resolve_comparable_content_path, resolve_library_main_dest, sync_main_file,
    verify_content_hash_match,
};
use crate::hash::{content_equivalent, hash_path_auto};
use crate::network_catalog::{
    build_network_nav_ex, heat_for_source_id, load_heat_cache, normalize_git_url_key,
    resolve_agent_repo, HeatCache, NetworkNavNodeDto, POPULAR_SOURCES,
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
use crate::snapshot::{
    build_snapshot_subset, build_snapshot_subset_ex, AppSnapshotSubset, LibraryListItemDto,
};
use crate::withdraw::{path_conflict_dto, ConflictResolution, PathConflictDto};

pub const NETWORK_INDEX_FILE: &str = "network-index.json";
pub const NETWORK_CACHE_DIR: &str = "cache";
pub const NETWORK_ID_PREFIX: &str = "net:";

/// 本地 git 缓存健康度：半成品 `.git`（仅有 lock / 无 index）须自愈重克隆。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CachedRepoState {
    Absent,
    Healthy,
    Broken,
}

/// Windows 上 git pack 常为只读，`remove_dir_all` 会静默失败；先清只读再删。
pub fn force_remove_dir_all(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    clear_readonly_recursive(path);
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(e1) => {
            clear_readonly_recursive(path);
            fs::remove_dir_all(path).map_err(|e2| {
                format!("强制删除目录失败（先 {e1}，重试 {e2}）：{}", path.display())
            })
        }
    }
}

fn clear_readonly_recursive(path: &Path) {
    let Ok(meta) = fs::metadata(path) else {
        return;
    };
    let mut perms = meta.permissions();
    if perms.readonly() {
        perms.set_readonly(false);
        let _ = fs::set_permissions(path, perms);
    }
    if !meta.is_dir() {
        return;
    }
    let Ok(rd) = fs::read_dir(path) else {
        return;
    };
    for ent in rd.flatten() {
        clear_readonly_recursive(&ent.path());
    }
}

/// 判定缓存仓是否健康：`.git` 存在但无 index / 有残留 `*.lock` / HEAD 不可解析 → Broken。
pub fn cached_repo_state(dest: &Path) -> CachedRepoState {
    let git = dest.join(".git");
    if !git.is_dir() {
        return CachedRepoState::Absent;
    }
    // 从未 checkout：无 index
    if !git.join("index").is_file() {
        return CachedRepoState::Broken;
    }
    // 中断的浅克隆会留下 lock
    if git_has_stale_lock(&git) {
        return CachedRepoState::Broken;
    }
    // 快照热路径不 spawn git：只读 HEAD 文件。rev-parse 在 clone/fetch 路径再用。
    let head = git.join("HEAD");
    match fs::read_to_string(&head) {
        Ok(s) if !s.trim().is_empty() => CachedRepoState::Healthy,
        _ => CachedRepoState::Broken,
    }
}

/// 判定 git 错误是否为瞬时网络故障（TLS 握手、解析、超时、连接重置等）。
/// 起什么作用：Healthy 缓存 fetch 失败时保留本地仓，避免把网络抖动放大成删缓存。
fn is_transient_network_error(msg: &str) -> bool {
    let m = msg.to_ascii_lowercase();
    const NEEDLES: &[&str] = &[
        "unable to access",
        "handshake",
        "could not resolve",
        "timed out",
        "timeout",
        "connection refused",
        "connection reset",
        "failed to connect",
        "ssl routines",
        "openssl",
        "gnutls",
        "network is unreachable",
        "no route to host",
        "early eof",
        "recv failure",
        "proxy connect",
        "sslv3",
        "tls",
    ];
    NEEDLES.iter().any(|n| m.contains(n))
}

fn git_has_stale_lock(git_dir: &Path) -> bool {
    let Ok(rd) = fs::read_dir(git_dir) else {
        return false;
    };
    for ent in rd.flatten() {
        let name = ent.file_name();
        let s = name.to_string_lossy();
        if s.ends_with(".lock") {
            return true;
        }
    }
    false
}

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
    pub warnings: Option<Vec<String>>,
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

/// Legacy default folder name under `%USERPROFILE%`（ensure 时迁到 `{永久库}\net`）。
const LEGACY_NETWORK_LIBRARY_DIR: &str = "CCM-NetworkLibrary";

/// 网络容器默认根：`{永久库}\net`；永久库未设时用 `DEFAULT_LIBRARY_ROOT\net`。
pub fn default_network_library_root_for(library_root: &str) -> String {
    let base = library_root.trim();
    let base = if base.is_empty() {
        crate::settings::DEFAULT_LIBRARY_ROOT
    } else {
        base
    };
    Path::new(base)
        .join("net")
        .to_string_lossy()
        .to_string()
}

pub fn default_network_library_root(settings: &AppSettings) -> String {
    default_network_library_root_for(&settings.skills_library_root)
}

fn is_legacy_ccm_network_library(path: &str) -> bool {
    let name = Path::new(path.trim())
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    name.eq_ignore_ascii_case(LEGACY_NETWORK_LIBRARY_DIR)
}

/// 强制把网络根耦合为 `{永久库}\net`（改永久库时调用）。
pub fn sync_coupled_network_root(settings: &mut AppSettings) -> Result<(), String> {
    let dest = default_network_library_root(settings);
    if dest.trim().is_empty() {
        return Err("耦合网络库根为空".into());
    }
    if settings.library_root_configured
        && !settings.skills_library_root.trim().is_empty()
        && normalize_path(&dest) == normalize_path(&settings.skills_library_root)
    {
        return Err("网络库根不得与永久库根相同".into());
    }
    settings.network_library_root = dest.clone();
    settings.network_library_configured = true;
    ensure_network_layout(&dest)?;
    Ok(())
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

fn network_index_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_network_index_file(network_root: &str) -> Result<NetworkIndex, String> {
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

fn save_network_index_unlocked(network_root: &str, index: &NetworkIndex) -> Result<(), String> {
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

pub fn load_network_index(network_root: &str) -> Result<NetworkIndex, String> {
    let mut index = read_network_index_file(network_root)?;
    let mut changed = migrate_network_index_source_ids(network_root, &mut index)?;
    // 只剔 sources[]；已转入本地的条目保留，由 snapshot 路径带 keep 集再清
    let dropped = drain_retired_popular_sources(&mut index);
    if !dropped.is_empty() {
        changed = true;
        remove_retired_source_caches(network_root, &dropped);
    }
    if changed {
        save_network_index(network_root, &index)?;
    }
    Ok(index)
}

/// 从 `sources[]` 剔除退役官方源，返回 `(id, cache_rel)` 供清盘。
pub fn drain_retired_popular_sources(index: &mut NetworkIndex) -> Vec<(String, String)> {
    let mut dropped = Vec::new();
    index.sources.retain(|s| {
        if crate::network_catalog::is_retired_popular_id(&s.id) {
            dropped.push((s.id.clone(), s.cache_rel.clone()));
            false
        } else {
            true
        }
    });
    dropped
}

fn remove_retired_source_caches(network_root: &str, dropped: &[(String, String)]) {
    for (id, rel) in dropped {
        let mut rels: Vec<String> = Vec::new();
        let r = rel.trim().replace('\\', "/");
        if !r.is_empty() {
            rels.push(r);
        }
        let fallback = format!("{NETWORK_CACHE_DIR}/{id}");
        if !rels
            .iter()
            .any(|x| x.eq_ignore_ascii_case(&fallback))
        {
            rels.push(fallback);
        }
        for c in rels {
            if let Ok(p) = resolve_network_safe_path(network_root, &c) {
                let _ = force_remove_dir_all(&p);
            }
        }
    }
}

/// 剔除退役源条目；`keep_entry_ids` 内的条目（已转入本地）保留。
pub fn prune_retired_popular_entries(
    index: &mut NetworkIndex,
    keep_entry_ids: &HashSet<String>,
) -> bool {
    let before = index.entries.len();
    index.entries.retain(|e| {
        if !crate::network_catalog::is_retired_popular_id(&e.source_id) {
            return true;
        }
        keep_entry_ids
            .iter()
            .any(|k| k.eq_ignore_ascii_case(&e.id))
    });
    index.entries.len() != before
}

pub fn save_network_index(network_root: &str, index: &NetworkIndex) -> Result<(), String> {
    let _guard = network_index_write_lock()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    save_network_index_unlocked(network_root, index)
}

/// 持进程级写锁：load（含迁移）→ 闭包 → save。
pub fn with_network_index_mut<R, F>(network_root: &str, f: F) -> Result<R, String>
where
    F: FnOnce(&mut NetworkIndex) -> Result<R, String>,
{
    let _guard = network_index_write_lock()
        .lock()
        .unwrap_or_else(|p| p.into_inner());
    let mut index = read_network_index_file(network_root)?;
    let _changed = migrate_network_index_source_ids(network_root, &mut index)?;
    let out = f(&mut index)?;
    save_network_index_unlocked(network_root, &index)?;
    Ok(out)
}

pub fn resolve_network_safe_path(
    network_root: &str,
    rel: &str,
) -> Result<PathBuf, String> {
    resolve_library_safe_path(network_root, rel).map_err(|e| e.to_string())
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

/// Nav-only mutations (pin / eye / sort / reorder): omit network list only; still load real catalog
/// so workspace nav / projects / container lists stay accurate if frontend merge is skipped.
fn snap_nav_only(settings: &AppSettings) -> AppSnapshotSubset {
    let load = load_catalog(settings.skills_library_root.trim());
    let warnings = if load.healthy {
        crate::catalog::validate_entry_paths(
            settings.skills_library_root.trim(),
            &load.catalog.entries,
        )
    } else {
        vec![]
    };
    build_snapshot_subset_ex(settings, &load, warnings, true)
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
    crate::network_proxy::apply_network_proxy_env_from_settings(&mut cmd);
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
                "。浏览器能访问不等于 git 能访问。请在设置填写「Git / gh HTTP 代理」（常见 Clash：http://127.0.0.1:7890），或确认系统代理已开；也可改用本机可达的 Git URL。",
            );
        }
        return Err(msg);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_head(repo: &Path) -> Result<String, String> {
    run_git(&["rev-parse", "HEAD"], Some(repo))
}

/// 从 `git ls-remote` 输出取出第一列提交号（SHA）。
fn parse_ls_remote_head(out: &str) -> Option<String> {
    let sha = out.split_whitespace().next()?.trim();
    if sha.is_empty() {
        None
    } else {
        Some(sha.to_string())
    }
}

fn git_remote_head(url: &str) -> Result<String, String> {
    let out = run_git(&["ls-remote", url, "HEAD"], None)?;
    parse_ls_remote_head(&out).ok_or_else(|| "无法解析远端 HEAD".into())
}

/// 浅克隆结果：指纹＝当前 HEAD 提交号；skipped＝未下载 pack。
#[derive(Debug, Clone, PartialEq, Eq)]
struct ShallowCloneOutcome {
    fingerprint: String,
    skipped: bool,
}

/// 健康缓存：先比对本地 HEAD 与远端 HEAD（`ls-remote`，不拉 pack）。
/// `Ok(Some(sha))`＝已是同一提交，跳过下载；`Ok(None)`＝需要 fetch/clone；
/// `Err`＝瞬时网络故障，保留本地缓存。
fn try_skip_up_to_date(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<Option<String>, String> {
    let local = match run_long(&["rev-parse", "HEAD"], Some(dest)) {
        Ok(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Ok(None);
            }
            t.to_string()
        }
        Err(_) => return Ok(None),
    };
    match run_long(&["ls-remote", url, "HEAD"], None) {
        Ok(out) => match parse_ls_remote_head(&out) {
            Some(remote) if remote.eq_ignore_ascii_case(&local) => Ok(Some(local)),
            _ => Ok(None),
        },
        Err(e) if is_transient_network_error(&e) => Err(format!(
            "网络故障（已保留本地缓存，条目仍可用）：{e}。请检查代理或稍后重试"
        )),
        Err(_) => Ok(None),
    }
}

/// 长时 git（ls-remote / clone / fetch）执行器：后台任务可注入可取消/带进度的实现。
pub type LongGitRunner<'a> =
    dyn FnMut(&[&str], Option<&Path>) -> Result<String, String> + 'a;

fn parse_git_version(stdout: &str) -> Option<(u32, u32)> {
    let rest = stdout.trim().strip_prefix("git version ")?;
    let mut parts = rest.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    Some((major, minor))
}

/// sparse-checkout --no-cone 需 Git ≥ 2.25；`--filter=blob:none` 需 ≥ 2.19。
fn git_supports_partial_clone() -> bool {
    static CACHED: OnceLock<bool> = OnceLock::new();
    *CACHED.get_or_init(|| match run_git(&["version"], None) {
        Ok(s) => parse_git_version(&s)
            .map(|(maj, min)| maj > 2 || (maj == 2 && min >= 25))
            .unwrap_or(false),
        Err(_) => false,
    })
}

fn collect_sparse_expand_paths(dest: &Path) -> Vec<String> {
    // 整仓即单技能：根含 SKILL.md 时检出全部附属文件，供转入本地离线使用。
    if dest.join("SKILL.md").is_file() {
        return vec!["/**".to_string()];
    }
    let mut out = Vec::new();
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        let rd = match fs::read_dir(dir) {
            Ok(r) => r,
            Err(_) => return,
        };
        for ent in rd.flatten() {
            let p = ent.path();
            let name = ent.file_name().to_string_lossy().to_string();
            if should_skip_discover_name(&name) {
                continue;
            }
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if is_dir {
                if p.join("SKILL.md").is_file() {
                    if let Ok(rel) = p.strip_prefix(root) {
                        let s = rel.to_string_lossy().replace('\\', "/");
                        if !s.is_empty() {
                            out.push(s.clone());
                            out.push(format!("{s}/**"));
                        }
                    }
                    continue;
                }
                walk(root, &p, out);
            }
        }
    }
    walk(dest, dest, &mut out);
    out
}

fn expand_sparse_for_discovered(
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<(), String> {
    let paths = collect_sparse_expand_paths(dest);
    if paths.is_empty() {
        return Ok(());
    }
    for chunk in paths.chunks(40) {
        let mut args: Vec<&str> = vec!["sparse-checkout", "add", "--no-cone"];
        args.extend(chunk.iter().map(|s| s.as_str()));
        run_long(&args, Some(dest))?;
    }
    run_long(&["-c", "core.longpaths=true", "checkout", "--progress"], Some(dest))?;
    Ok(())
}

fn clone_partial(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<String, String> {
    let dest_s = dest.to_string_lossy().to_string();
    run_long(
        &[
            "-c",
            "core.longpaths=true",
            "clone",
            "--progress",
            "--filter=blob:none",
            "--depth",
            "1",
            "--no-checkout",
            url,
            &dest_s,
        ],
        None,
    )?;
    run_long(&["sparse-checkout", "init", "--no-cone"], Some(dest))?;
    run_long(
        &[
            "sparse-checkout",
            "set",
            "--no-cone",
            "**/SKILL.md",
            "**/*.mdc",
        ],
        Some(dest),
    )?;
    run_long(&["-c", "core.longpaths=true", "checkout", "--progress"], Some(dest))?;
    expand_sparse_for_discovered(dest, run_long)?;
    let head = run_long(&["rev-parse", "HEAD"], Some(dest))?;
    if head.trim().is_empty() {
        return Err("部分克隆后无法解析 HEAD".into());
    }
    Ok(head.trim().to_string())
}

fn clone_full_shallow(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<String, String> {
    let dest_s = dest.to_string_lossy().to_string();
    run_long(
        &[
            "-c",
            "core.longpaths=true",
            "clone",
            "--progress",
            "--depth",
            "1",
            url,
            &dest_s,
        ],
        None,
    )?;
    let head = run_long(&["rev-parse", "HEAD"], Some(dest))?;
    if head.trim().is_empty() {
        return git_head(dest);
    }
    Ok(head.trim().to_string())
}

fn shallow_clone_or_update_with(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<ShallowCloneOutcome, String> {
    match cached_repo_state(dest) {
        CachedRepoState::Healthy => {
            match try_skip_up_to_date(url, dest, run_long) {
                Ok(Some(sha)) => {
                    return Ok(ShallowCloneOutcome {
                        fingerprint: sha,
                        skipped: true,
                    });
                }
                Ok(None) => {}
                Err(e) => return Err(e),
            }
            match run_long(
                &["fetch", "--progress", "--depth", "1", "origin"],
                Some(dest),
            ) {
                Ok(_) => {
                    let _ = run_git(&["rev-parse", "--abbrev-ref", "HEAD"], Some(dest));
                    run_git(&["reset", "--hard", "FETCH_HEAD"], Some(dest)).map_err(|e| {
                        format!("更新缓存后 reset --hard FETCH_HEAD 失败（工作树可能过期）: {e}")
                    })?;
                    let _ = expand_sparse_for_discovered(dest, run_long);
                    return Ok(ShallowCloneOutcome {
                        fingerprint: git_head(dest)?,
                        skipped: false,
                    });
                }
                Err(e) => {
                    if is_transient_network_error(&e) {
                        return Err(format!(
                            "网络故障（已保留本地缓存，条目仍可用）：{e}。请检查代理或稍后重试"
                        ));
                    }
                    // 非网络类（仓损坏）：强删后全新克隆一次（单次自愈）
                    let _ = force_remove_dir_all(dest);
                    return clone_fresh(url, dest, run_long)
                        .map(|fingerprint| ShallowCloneOutcome {
                            fingerprint,
                            skipped: false,
                        })
                        .map_err(|e2| {
                            format!(
                                "已尝试重建缓存仍失败（先 fetch：{e}；再 clone：{e2}）。请检查代理/网络"
                            )
                        });
                }
            }
        }
        CachedRepoState::Broken => {
            force_remove_dir_all(dest)?;
        }
        CachedRepoState::Absent => {
            if dest.exists() {
                force_remove_dir_all(dest)?;
            }
        }
    }
    clone_fresh(url, dest, run_long).map(|fingerprint| ShallowCloneOutcome {
        fingerprint,
        skipped: false,
    })
}

fn clone_fresh(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
) -> Result<String, String> {
    let force_full = std::env::var("CCM_FORCE_FULL_SHALLOW")
        .ok()
        .map(|v| v == "1")
        .unwrap_or(false);
    clone_fresh_ex(
        url,
        dest,
        run_long,
        git_supports_partial_clone() && !force_full,
    )
}

fn clone_fresh_ex(
    url: &str,
    dest: &Path,
    run_long: &mut LongGitRunner<'_>,
    prefer_partial: bool,
) -> Result<String, String> {
    if dest.exists() {
        force_remove_dir_all(dest)?;
    }
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir cache parent: {e}"))?;
    }
    if prefer_partial {
        match clone_partial(url, dest, run_long) {
            Ok(head) => return Ok(head),
            Err(partial_err) => {
                let _ = force_remove_dir_all(dest);
                if let Some(parent) = dest.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                match clone_full_shallow(url, dest, run_long) {
                    Ok(head) => return Ok(head),
                    Err(full_err) => {
                        let _ = force_remove_dir_all(dest);
                        return Err(format!(
                            "部分克隆失败（{partial_err}）；全量浅克隆亦失败（{full_err}）"
                        ));
                    }
                }
            }
        }
    }
    match clone_full_shallow(url, dest, run_long) {
        Ok(head) => Ok(head),
        Err(e) => {
            let _ = force_remove_dir_all(dest);
            Err(e)
        }
    }
}

fn shallow_clone_or_update(url: &str, dest: &Path) -> Result<String, String> {
    Ok(shallow_clone_or_update_with(url, dest, &mut |args, cwd| run_git(args, cwd))?.fingerprint)
}

/// 若 URL/id 命中基线或精选表，返回表内 `(id, label, url)`。
fn catalog_source_for_raw(raw: &str) -> Option<(String, String, String)> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some((id, lab, u)) = BASELINE_SOURCES
        .iter()
        .find(|(id, _, _)| id.eq_ignore_ascii_case(raw))
    {
        return Some(((*id).to_string(), (*lab).to_string(), (*u).to_string()));
    }
    if let Some(p) = POPULAR_SOURCES
        .iter()
        .find(|p| p.id.eq_ignore_ascii_case(raw))
    {
        return Some((p.id.to_string(), p.label.to_string(), p.url.to_string()));
    }
    let key = normalize_git_url_key(raw);
    if key.is_empty() {
        return None;
    }
    if let Some((id, lab, u)) = BASELINE_SOURCES
        .iter()
        .find(|(_, _, u)| normalize_git_url_key(u) == key)
    {
        return Some(((*id).to_string(), (*lab).to_string(), (*u).to_string()));
    }
    if let Some(p) = POPULAR_SOURCES
        .iter()
        .find(|p| normalize_git_url_key(p.url) == key)
    {
        return Some((p.id.to_string(), p.label.to_string(), p.url.to_string()));
    }
    None
}

/// 触及升格：旧 URL slug `source_id` → 精选/基线表内 id，并尽量 rename `cache/{旧}`。
/// 返回是否改动了 index（调用方负责写回）。rename 失败则 skip 该条，不改 index 字段。
pub fn migrate_network_index_source_ids(
    network_root: &str,
    index: &mut NetworkIndex,
) -> Result<bool, String> {
    let root = Path::new(network_root.trim());
    let mut remaps: Vec<(String, String, String, String)> = Vec::new();
    for src in &index.sources {
        let Some((canon_id, canon_label, canon_url)) = catalog_source_for_raw(&src.url) else {
            continue;
        };
        if src.id.eq_ignore_ascii_case(&canon_id) {
            continue;
        }
        remaps.push((src.id.clone(), canon_id, canon_label, canon_url));
    }
    if remaps.is_empty() {
        return Ok(false);
    }

    let mut changed = false;
    for (old_id, new_id, new_label, new_url) in remaps {
        if index
            .sources
            .iter()
            .any(|s| s.id.eq_ignore_ascii_case(&new_id) && !s.id.eq_ignore_ascii_case(&old_id))
        {
            eprintln!(
                "network-index migrate skip {old_id} -> {new_id}: target id already exists"
            );
            continue;
        }

        let old_cache = root.join(NETWORK_CACHE_DIR).join(&old_id);
        let new_cache = root.join(NETWORK_CACHE_DIR).join(&new_id);
        let accept = if old_cache.exists() {
            if new_cache.exists() {
                if !new_cache.is_dir() {
                    eprintln!(
                        "network-index migrate skip {old_id} -> {new_id}: cache/{new_id} exists but is not a directory"
                    );
                    false
                } else {
                    eprintln!(
                        "network-index migrate warn: keep existing cache/{new_id}, skip rename from {old_id}"
                    );
                    true
                }
            } else if let Err(e) = fs::rename(&old_cache, &new_cache) {
                eprintln!("network-index migrate rename cache/{old_id}: {e}");
                false
            } else {
                true
            }
        } else {
            // 旧缓存不存在：仍可接受，仅改 index 指向 new
            true
        };
        if !accept {
            continue;
        }

        if let Some(src) = index
            .sources
            .iter_mut()
            .find(|s| s.id.eq_ignore_ascii_case(&old_id))
        {
            src.id = new_id.clone();
            src.label = new_label;
            src.url = new_url.clone();
            src.cache_rel = format!("{NETWORK_CACHE_DIR}/{new_id}");
        }

        let old_prefix = format!("{NETWORK_CACHE_DIR}/{old_id}");
        let new_prefix = format!("{NETWORK_CACHE_DIR}/{new_id}");
        let old_entry_prefix = format!("{NETWORK_ID_PREFIX}{old_id}:");
        let new_entry_prefix = format!("{NETWORK_ID_PREFIX}{new_id}:");
        for e in index
            .entries
            .iter_mut()
            .filter(|e| e.source_id.eq_ignore_ascii_case(&old_id))
        {
            e.source_id = new_id.clone();
            e.source_url = new_url.clone();
            if e.cached_rel_path.starts_with(&old_prefix) {
                e.cached_rel_path =
                    format!("{new_prefix}{}", &e.cached_rel_path[old_prefix.len()..]);
            }
            if e.id.starts_with(&old_entry_prefix) {
                e.id = format!("{new_entry_prefix}{}", &e.id[old_entry_prefix.len()..]);
            }
        }
        changed = true;
    }
    Ok(changed)
}

/// 解析拉取目标（URL / 基线 id / 精选 id / 本地 git），供同步拉取与后台 job 共用。
pub fn resolve_network_fetch_target(
    settings: &AppSettings,
    url_or_baseline_id: &str,
    label: Option<&str>,
) -> Result<ResolvedNetworkFetchTarget, String> {
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

    let (source_id, source_label, url) = if let Some(known) = catalog_source_for_raw(raw) {
        known
    } else if is_remote || is_local_git {
        // 未知仓：用 URL slug 作为 source_id
        let id = slug_from_url(raw);
        let lab = label
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| id.clone());
        (id, lab, raw.to_string())
    } else {
        return Err(
            "无法识别源：请粘贴 Git URL / 本地 Git 路径，或选择基线/精选 id（如 anthropics-skills / vercel-agent-skills）"
                .into(),
        );
    };

    let cache_rel = format!("{NETWORK_CACHE_DIR}/{source_id}");
    let dest = resolve_network_safe_path(&net_root, &cache_rel)?;
    Ok(ResolvedNetworkFetchTarget {
        network_root: net_root,
        source_id,
        source_label,
        url,
        cache_rel,
        dest,
    })
}

#[derive(Debug, Clone)]
pub struct ResolvedNetworkFetchTarget {
    pub network_root: String,
    pub source_id: String,
    pub source_label: String,
    pub url: String,
    pub cache_rel: String,
    pub dest: PathBuf,
}

/// 浅克隆/更新后写入 network-index（clone 步骤可替换为带进度实现）。
pub fn fetch_network_source_with_clone(
    settings: &mut AppSettings,
    url_or_baseline_id: &str,
    label: Option<&str>,
    run_long: &mut LongGitRunner<'_>,
) -> Result<NetworkOpResult, String> {
    let target = resolve_network_fetch_target(settings, url_or_baseline_id, label)?;
    let outcome = shallow_clone_or_update_with(&target.url, &target.dest, run_long)?;
    let fingerprint = outcome.fingerprint;
    let skipped = outcome.skipped;

    let n = with_network_index_mut(&target.network_root, |index| {
        let source = NetworkSourceRecord {
            id: target.source_id.clone(),
            label: target.source_label.clone(),
            url: target.url.clone(),
            cache_rel: target.cache_rel.clone(),
            fingerprint: fingerprint.clone(),
            last_fetched_at: chrono_like_now(),
        };
        if let Some(existing) = index
            .sources
            .iter_mut()
            .find(|s| s.id.eq_ignore_ascii_case(&target.source_id))
        {
            *existing = source.clone();
        } else {
            index.sources.push(source.clone());
        }
        let entries = discover_entries_in_cache(&target.network_root, &source, &fingerprint)?;
        let n = entries.len();
        merge_source_entries(index, &target.source_id, entries);
        Ok(n)
    })?;

    // 回读校验：发现数须与索引中该源条目一致（全源：官方/社区/用户粘贴）
    let verified = load_network_index(&target.network_root)?;
    let verified_n = verified
        .entries
        .iter()
        .filter(|e| e.source_id.eq_ignore_ascii_case(&target.source_id))
        .count();
    if verified_n != n {
        return Err(format!(
            "索引回读校验失败：「{}」发现 {n} 条，回读 {verified_n} 条",
            target.source_id
        ));
    }

    // 非精选 Git URL → 持久进侧栏用户源并开眼
    let raw = url_or_baseline_id.trim();
    let is_baseline_id = BASELINE_SOURCES.iter().any(|(id, _, _)| *id == raw);
    let mut persist_note = String::new();
    if !is_baseline_id
        && crate::network_catalog::persist_user_source_after_fetch(
            settings,
            &target.source_id,
            &target.source_label,
            &target.url,
        )
    {
        if let Err(e) = crate::settings::save_settings(settings) {
            persist_note = format!("（用户源写入设置失败：{e}）");
        }
    }

    let commit = &fingerprint[..fingerprint.len().min(8)];
    let verb = if skipped {
        "已是最新，已跳过下载"
    } else {
        "已缓存"
    };
    let ctype = crate::network_catalog::content_type_for(&target.source_id);
    let (ok, message) = if n == 0 {
        match ctype {
            "courses" | "cookbooks" => (
                true,
                format!(
                    "{verb}「{}」：文档仓，预期无 Skill 条目；缓存已落盘，可右键打开本地目录（commit {commit}）{persist_note}",
                    target.source_id
                ),
            ),
            "skills" => (
                false,
                format!(
                    "警告：{verb}「{}」但发现 0 个条目（精选 Skill 源应含 SKILL.md；请检查代理/缓存树是否拉错）（commit {commit}）{persist_note}",
                    target.source_id
                ),
            ),
            _ => (
                true,
                format!(
                    "{verb}「{}」：未发现可入库的 SKILL.md 或 .mdc（commit {commit}）{persist_note}",
                    target.source_id
                ),
            ),
        }
    } else {
        (
            true,
            format!(
                "{verb}「{}」：发现 {n} 个条目（commit {commit}）{persist_note}",
                target.source_id
            ),
        )
    };
    Ok(NetworkOpResult {
        ok,
        message,
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        warnings: None,
    })
}

fn extract_summary_from_skill_md(text: &str) -> String {
    /// 截断到 120 字，去掉首尾引号/空白。
    fn clip(s: &str) -> String {
        s.trim()
            .trim_matches('"')
            .trim_matches('\'')
            .chars()
            .take(120)
            .collect()
    }
    let lines: Vec<&str> = text.lines().collect();
    // 优先 YAML frontmatter 的 description:（技能卡短描述）；避免误吃正文里其它语言标题
    if lines
        .first()
        .map(|l| l.trim() == "---")
        .unwrap_or(false)
    {
        for line in lines.iter().skip(1).take(80) {
            let t = line.trim();
            if t == "---" {
                break;
            }
            if let Some(rest) = t
                .strip_prefix("description:")
                .or_else(|| t.strip_prefix("Description:"))
            {
                let v = clip(rest);
                if !v.is_empty() {
                    return v;
                }
            }
        }
        // frontmatter 无 description → 用 frontmatter 结束后的首个标题
        let mut saw_close = false;
        for line in lines.iter().skip(1) {
            let t = line.trim();
            if !saw_close {
                if t == "---" {
                    saw_close = true;
                }
                continue;
            }
            if t.starts_with('#') {
                let v = clip(t.trim_start_matches('#'));
                if !v.is_empty() {
                    return v;
                }
            }
            if !t.is_empty() {
                break;
            }
        }
        return String::new();
    }
    for line in lines.iter().take(40) {
        let t = line.trim();
        if t.starts_with('#') {
            return clip(t.trim_start_matches('#'));
        }
        if let Some(rest) = t.strip_prefix("description:") {
            return clip(rest);
        }
    }
    String::new()
}

/// 源显示名：`owner/repo` 取仓名，否则用 label / id。
fn source_repo_display_name(source: &NetworkSourceRecord) -> String {
    let label = source.label.trim();
    if let Some((_, repo)) = label.rsplit_once('/') {
        let r = repo.trim();
        if !r.is_empty() {
            return r.to_string();
        }
    }
    if !label.is_empty() {
        return label.to_string();
    }
    source.id.clone()
}

fn discover_entries_in_cache(
    network_root: &str,
    source: &NetworkSourceRecord,
    fingerprint: &str,
) -> Result<Vec<NetworkEntry>, String> {
    let cache_abs = resolve_network_safe_path(network_root, &source.cache_rel)?;
    let mut out = Vec::new();
    let skill_md = cache_abs.join("SKILL.md");
    if skill_md.is_file() {
        // 整仓=单技能：根目录 SKILL.md。哈希只算清单文件，避免把 .git 算进 content_hash。
        let net_rel = source.cache_rel.replace('\\', "/");
        let (hash, _) = hash_path_auto(&skill_md).unwrap_or_default();
        let summary = fs::read_to_string(&skill_md)
            .map(|t| extract_summary_from_skill_md(&t))
            .unwrap_or_default();
        let name = source_repo_display_name(source);
        let path_id = sanitize_id(&source.id);
        let id = format!("{NETWORK_ID_PREFIX}{}:{path_id}", source.id);
        out.push(NetworkEntry {
            id,
            kind: "skill".into(),
            name,
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
        return Ok(finalize_discovered_entries(out, &source.cache_rel));
    }
    walk_discover(&cache_abs, &cache_abs, source, fingerprint, &mut out)?;
    Ok(finalize_discovered_entries(out, &source.cache_rel))
}

/// 相对网络库根的路径 → 去掉 `cache/{source}/` 前缀后的仓内相对路径（正斜杠）。
fn under_cache_rel(cached_rel_path: &str, cache_rel: &str) -> String {
    let full = cached_rel_path.replace('\\', "/");
    let prefix = cache_rel.replace('\\', "/").trim_end_matches('/').to_string();
    let rest = full
        .strip_prefix(&prefix)
        .map(|s| s.trim_start_matches('/'))
        .unwrap_or(full.as_str());
    rest.to_string()
}

/// 撞名时的短路径提示（父路径末两段）。
fn short_path_hint(under_cache: &str) -> String {
    let parent = under_cache
        .replace('\\', "/")
        .rsplit_once('/')
        .map(|(a, _)| a.to_string())
        .unwrap_or_default();
    let parts: Vec<&str> = parent.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return String::new();
    }
    if parts.len() <= 2 {
        parts.join("/")
    } else {
        parts[parts.len() - 2..].join("/")
    }
}

fn path_basename(under_or_rel: &str) -> String {
    under_or_rel
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or("item")
        .to_string()
}

fn display_basename_for_entry(entry: &NetworkEntry, cache_rel: &str) -> String {
    let under = under_cache_rel(&entry.cached_rel_path, cache_rel);
    let base = path_basename(&under);
    if base.is_empty() {
        return if entry.name.is_empty() {
            "item".into()
        } else {
            entry.name.clone()
        };
    }
    if entry.kind == "rule" {
        Path::new(&base)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(base)
    } else {
        base
    }
}

/// 同 source 内 basename 撞名时，显示名改为 `{basename} · {短路径}`。
fn disambiguate_entry_display_names(entries: &mut [NetworkEntry], cache_rel: &str) {
    let mut basename_counts: HashMap<String, usize> = HashMap::new();
    for e in entries.iter() {
        let base = display_basename_for_entry(e, cache_rel);
        *basename_counts.entry(base).or_insert(0) += 1;
    }
    for e in entries.iter_mut() {
        let under = under_cache_rel(&e.cached_rel_path, cache_rel);
        let base = display_basename_for_entry(e, cache_rel);
        if basename_counts.get(&base).copied().unwrap_or(0) > 1 {
            let hint = short_path_hint(&under);
            e.name = if hint.is_empty() {
                base
            } else {
                format!("{base} · {hint}")
            };
        } else {
            e.name = base;
        }
    }
}

/// 同仓同 content_hash 只留一条；优先 `.github/skills/` → 非 plugins 的 `/skills/` → 更短路径 → 字典序。
fn dedupe_entries_by_content_hash(entries: Vec<NetworkEntry>) -> Vec<NetworkEntry> {
    fn prefer_key(rel: &str) -> (i32, usize, String) {
        let p = rel.replace('\\', "/").to_ascii_lowercase();
        let rank = if p.contains("/.github/skills/") {
            0
        } else if p.contains("/skills/") && !p.contains("plugins") {
            1
        } else if p.contains("/skills/") {
            2
        } else {
            3
        };
        (rank, p.len(), p)
    }

    let mut best: HashMap<String, NetworkEntry> = HashMap::new();
    for e in entries {
        let key = if e.content_hash.trim().is_empty() {
            format!("id:{}", e.id)
        } else {
            format!("h:{}", e.content_hash)
        };
        match best.get(&key) {
            None => {
                best.insert(key, e);
            }
            Some(old) => {
                if prefer_key(&e.cached_rel_path) < prefer_key(&old.cached_rel_path) {
                    best.insert(key, e);
                }
            }
        }
    }
    let mut out: Vec<NetworkEntry> = best.into_values().collect();
    out.sort_by(|a, b| {
        a.cached_rel_path
            .to_lowercase()
            .cmp(&b.cached_rel_path.to_lowercase())
    });
    out
}

fn finalize_discovered_entries(
    entries: Vec<NetworkEntry>,
    cache_rel: &str,
) -> Vec<NetworkEntry> {
    let mut entries = dedupe_entries_by_content_hash(entries);
    disambiguate_entry_display_names(&mut entries, cache_rel);
    entries
}

/// 网络发现跳过名：黑名单（非「一切点目录」）。
/// 起什么作用：仍避开 `.git` / 依赖与缓存噪音，但允许下钻 `.github` / `.curated` / `.claude` 等官方仓技能路径。
pub fn should_skip_discover_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | ".svn"
            | ".hg"
            | ".venv"
            | "venv"
            | "__pycache__"
            | ".idea"
            | ".vs"
            | ".tox"
            | ".mypy_cache"
            | ".pytest_cache"
            | ".DS_Store"
    )
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
        if should_skip_discover_name(&name) {
            continue;
        }
        let ft = ent.file_type().map_err(|e| e.to_string())?;
        if ft.is_dir() {
            let skill_md = p.join("SKILL.md");
            if skill_md.is_file() {
                let net_rel = path_rel_to_network(cache_abs, &p, &source.cache_rel)?;
                let under = under_cache_rel(&net_rel, &source.cache_rel);
                let (hash, _) = hash_path_auto(&p).unwrap_or_default();
                let summary = fs::read_to_string(&skill_md)
                    .map(|t| extract_summary_from_skill_md(&t))
                    .unwrap_or_default();
                let path_id = sanitize_id(&under);
                let basename = path_basename(&under);
                let id = format!("{NETWORK_ID_PREFIX}{}:{path_id}", source.id);
                out.push(NetworkEntry {
                    id,
                    kind: "skill".into(),
                    name: basename,
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
                let under = under_cache_rel(&net_rel, &source.cache_rel);
                let (hash, _) = hash_path_auto(&p).unwrap_or_default();
                let path_id = sanitize_id(&under);
                let basename = path_basename(&under);
                // 文件：显示名用 stem（去掉 .mdc）
                let stem = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(basename);
                let id = format!("{NETWORK_ID_PREFIX}{}:{path_id}", source.id);
                out.push(NetworkEntry {
                    id,
                    kind: "rule".into(),
                    name: sanitize_id(&stem),
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
    let mut dirty = false;
    let coupled = default_network_library_root(settings);
    let cur = settings.network_library_root.trim().to_string();
    let should_couple = !settings.network_library_configured
        || cur.is_empty()
        || crate::settings::is_ephemeral_fs_path(&cur)
        || is_legacy_ccm_network_library(&cur)
        || (settings.library_root_configured
            && !settings.skills_library_root.trim().is_empty()
            && normalize_path(&cur) == normalize_path(&settings.skills_library_root));
    if should_couple && normalize_path(&cur) != normalize_path(&coupled) {
        settings.network_library_root = coupled;
        settings.network_library_configured = true;
        dirty = true;
    }
    // Drop user sources that pointed at ephemeral Temp clones (test fixture leak).
    let removed_ids: Vec<String> = settings
        .network_user_sources
        .iter()
        .filter(|s| crate::settings::is_ephemeral_fs_path(&s.url))
        .map(|s| s.id.clone())
        .collect();
    if !removed_ids.is_empty() {
        settings
            .network_user_sources
            .retain(|s| !removed_ids.iter().any(|id| id == &s.id));
        settings
            .network_popular_order
            .retain(|id| !removed_ids.iter().any(|rid| rid == id));
        settings
            .network_popular_pinned_ids
            .retain(|id| !removed_ids.iter().any(|rid| rid == id));
        dirty = true;
    }
    ensure_network_layout(&settings.network_library_root.clone())?;
    if dirty {
        crate::settings::save_settings(settings)?;
    }
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
    settings: &mut AppSettings,
    url_or_baseline_id: &str,
    label: Option<&str>,
) -> Result<NetworkOpResult, String> {
    fetch_network_source_with_clone(settings, url_or_baseline_id, label, &mut |args, cwd| {
        run_git(args, cwd)
    })
}

/// 将侧栏 kind+id 解析为 `(url_or_baseline_id, label)`，供后台拉取使用。
pub fn resolve_nav_fetch_args(
    settings: &AppSettings,
    kind: &str,
    id: &str,
) -> Result<(String, Option<String>), String> {
    let id = id.trim();
    if kind.eq_ignore_ascii_case("popular") || kind.eq_ignore_ascii_case("user") {
        if let Some(p) = POPULAR_SOURCES
            .iter()
            .find(|p| p.id.eq_ignore_ascii_case(id))
        {
            return Ok((p.url.to_string(), Some(p.label.to_string())));
        }
        if let Some(u) = settings
            .network_user_sources
            .iter()
            .find(|u| u.id.eq_ignore_ascii_case(id))
        {
            return Ok((u.url.clone(), Some(u.label.clone())));
        }
        return Err(format!("未知热门源：{id}"));
    }
    if kind.eq_ignore_ascii_case("official") {
        let (url, baseline) = resolve_agent_repo(settings, id);
        if let Some(b) = baseline {
            return Ok((b, None));
        }
        if url.trim().is_empty() {
            return Err("该官方工作区无默认仓；请先设置仓库 URL 或改用粘贴 Git URL".into());
        }
        return Ok((url, None));
    }
    Err("kind 须为 official、popular 或 user".into())
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
    let (available, reapply_hints) = with_network_index_mut(&net_root, |index| {
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
        let reapply_hints = collect_reapply_hints(settings, index);
        Ok((available, reapply_hints))
    })?;
    // 用已有 heat-cache 对齐精选 Top50 + 开眼 N（新鲜星数走「刷新热度」）
    let mut settings = settings.clone();
    let heat = crate::network_catalog::load_heat_cache(&net_root);
    crate::network_catalog::realign_popular_after_heat(&mut settings, Some(&heat));
    crate::settings::save_settings(&settings)?;
    Ok(NetworkOpResult {
        ok: true,
        message: if available == 0 {
            "检查完成：无可用更新".into()
        } else {
            format!("检查完成：{available} 个源有更新（需确认后覆盖缓存）")
        },
        snapshot: snap(&settings),
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
        warnings: None,
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
            warnings: None,
        });
    }
    let mut updated = 0u32;
    let mut bak_notes = Vec::new();
    let mut updated_ids: Vec<String> = Vec::new();
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
        updated_ids.push(sid);
        updated += 1;
    }
    save_network_index(&net_root, &index)?;
    if settings.library_root_configured {
        let lib = settings.skills_library_root.trim();
        for sid in &updated_ids {
            crate::oplog::append(
                lib,
                crate::oplog::OpEvent {
                    op: "cacheUpdate".into(),
                    source_id: sid.clone(),
                    note: "更新网络缓存（未改永久库）".into(),
                    ..Default::default()
                },
            );
        }
    }
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
        warnings: None,
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

/// 晋升落盘：skill 目标为目录单元时，单文件源写入 `{dest}/SKILL.md`；rule 目标为嵌套文件路径。
fn copy_promote_payload(src: &Path, dest: &Path, kind: &str) -> Result<(), String> {
    if kind.eq_ignore_ascii_case("skill") && src.is_file() {
        let skill_md = if dest.extension().is_some() {
            dest.to_path_buf()
        } else {
            dest.join("SKILL.md")
        };
        return copy_tree(src, &skill_md);
    }
    if kind.eq_ignore_ascii_case("rule") && src.is_dir() {
        let dest_stem = dest
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let mut candidates: Vec<PathBuf> = Vec::new();
        let rd = fs::read_dir(src).map_err(|e| {
            format!("读规则源目录 {}: {e}", src.display())
        })?;
        for ent in rd {
            let ent = ent.map_err(|e| format!("读规则源项: {e}"))?;
            let p = ent.path();
            if !p.is_file() {
                continue;
            }
            let name = p
                .file_name()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            if name.ends_with(".mdc") || name.ends_with(".md") {
                candidates.push(p);
            }
        }
        if candidates.is_empty() {
            return Err(format!("规则源目录无 .mdc/.md：{}", src.display()));
        }
        let exact = candidates.iter().find(|p| {
            p.file_stem()
                .map(|s| s.to_string_lossy().to_lowercase())
                .unwrap_or_default()
                == dest_stem
        });
        let file = if let Some(p) = exact {
            p.clone()
        } else if candidates.len() == 1 {
            candidates.into_iter().next().unwrap()
        } else {
            return Err(format!(
                "规则源目录有多个 .mdc/.md 且无与目标同名（{}）：{}",
                dest_stem,
                src.display()
            ));
        };
        return copy_tree(&file, dest);
    }
    copy_tree(src, dest)
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

/// 转入本地时写入台账的层级：仅当意向已是 L0/L1/L2 才写入；空则保持未分类。
fn effective_intended_level(raw: &str) -> Option<&str> {
    match raw.trim() {
        "L0" | "L1" | "L2" => Some(raw.trim()),
        _ => None,
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
    let raw = net_entry.intended_level.trim();
    let level = effective_intended_level(raw);
    let mut tags = get_entry_tags(&entry);
    tags.level = level.map(|s| s.to_string());
    set_entry_tags(&mut entry, tags);
    upsert_entry(lib, entry.clone())?;
    let text = fs::read_to_string(src_cmp).unwrap_or_default();
    seed_baseline_on_promote(lib, &entry.id, &text, &net_entry.content_hash)?;
    crate::oplog::append(
        lib,
        crate::oplog::OpEvent {
            op: "promote".into(),
            entry_id: entry.id.clone(),
            network_entry_id: net_entry.id.clone(),
            source_id: net_entry.source_id.clone(),
            level: level.unwrap_or("未分类").to_string(),
            note: format!("转入本地：{}", net_entry.name),
            ..Default::default()
        },
    );
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
                warnings: None,
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

        let kind = net_entry.kind.clone();
        let stem = sanitize_id(&net_entry.name);
        let level = effective_intended_level(&net_entry.intended_level);
        let promote_id = crate::level_id::desired_id(
            &kind,
            &stem,
            level,
            crate::level_id::IdOrigin::Network,
        );
        // 本仓布局：rule=文件夹壳；skill=目录单元（见 L1-ccm-library-layout）
        let lib_rel = if kind.eq_ignore_ascii_case("rule") {
            crate::rule_layout::nested_rule_rel(&promote_id, ".mdc")
        } else {
            crate::skill_layout::skill_dir_rel(&promote_id)
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
            if content_equivalent(&src_hash, &lib_hash, &src_cmp, &lib_cmp) {
                // same content (incl. EOL-only) — skip
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
                let new_id = crate::level_id::desired_id(
                    &kind,
                    &format!("{stem}__network"),
                    level,
                    crate::level_id::IdOrigin::Network,
                );
                let new_rel = if kind.eq_ignore_ascii_case("rule") {
                    crate::rule_layout::nested_rule_rel(&new_id, ".mdc")
                } else {
                    crate::skill_layout::skill_dir_rel(&new_id)
                };
                let new_dest =
                    resolve_library_safe_path(lib, &new_rel).map_err(|e| e.to_string())?;
                copy_promote_payload(&src_abs, &new_dest, &kind)?;
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
        copy_promote_payload(&src_abs, &dest_abs, &kind)?;
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
        warnings: None,
    })
}

#[cfg(test)]
pub fn network_list_items(settings: &AppSettings) -> Result<Vec<LibraryListItemDto>, String> {
    match load_network_snapshot_context(settings) {
        None => Ok(vec![]),
        Some(ctx) => network_list_items_with_context(settings, &ctx),
    }
}

pub struct NetworkSnapshotContext {
    pub index: Result<NetworkIndex, String>,
    pub heat: HeatCache,
    /// networkEntryId → (本地条目 id, 是否有非空定制 diff)；用于列表「本地」列与右键菜单。
    pub promoted: HashMap<String, (String, bool)>,
}

/// 用本地台账 provenance 建 networkEntryId → (本地条目 id, 有定制 diff) 的映射。
pub fn promoted_network_map(settings: &AppSettings) -> HashMap<String, (String, bool)> {
    let lib = settings.skills_library_root.trim();
    if !settings.library_root_configured || lib.is_empty() {
        return HashMap::new();
    }
    let load = crate::catalog::load_catalog(lib);
    if !load.healthy {
        return HashMap::new();
    }
    let mut map = HashMap::new();
    for e in &load.catalog.entries {
        let Some(prov) = crate::network_customization::get_provenance(e) else {
            continue;
        };
        if prov.network_entry_id.trim().is_empty() {
            continue;
        }
        let has_custom = crate::network_customization::load_customization(lib, &e.id)
            .map(|rec| !rec.unified_diff.trim().is_empty())
            .unwrap_or(false);
        map.insert(prov.network_entry_id.clone(), (e.id.clone(), has_custom));
    }
    map
}

pub fn load_network_snapshot_context(settings: &AppSettings) -> Option<NetworkSnapshotContext> {
    let root = effective_network_root(settings)?;
    let mut index = load_network_index(&root).map_err(|e| format!("读取网络索引失败: {e}"));
    let heat = load_heat_cache(&root);
    let promoted = promoted_network_map(settings);
    if let Ok(ref mut idx) = index {
        let keep: HashSet<String> = promoted.keys().cloned().collect();
        if prune_retired_popular_entries(idx, &keep) {
            let _ = save_network_index(&root, idx);
        }
    }
    Some(NetworkSnapshotContext {
        index,
        heat,
        promoted,
    })
}

pub fn network_list_items_with_context(
    settings: &AppSettings,
    ctx: &NetworkSnapshotContext,
) -> Result<Vec<LibraryListItemDto>, String> {
    let index = ctx.index.as_ref().map_err(|e| e.clone())?;
    let heat = &ctx.heat;
    let order = load_network_list_order(settings);
    // 网络货架不跟随本地类型复选框过滤：网络条目绝大多数为 skill，
    // 本地过滤器（如只勾「规则」）会把整个网络列表清空，误导为「源无内容」。
    let mut items: Vec<LibraryListItemDto> = index
        .entries
        .iter()
        .map(|e| {
            let badge = match e.update_status.as_str() {
                "updateAvailable" => " · 有更新",
                "error" => " · 检查失败",
                _ => "",
            };
            let heat_label = heat_for_source_id(&e.source_id, Some(heat));
            let promoted_info = ctx.promoted.get(&e.id);
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
                summary: if e.summary.trim().is_empty() {
                    None
                } else {
                    Some(e.summary.clone())
                },
                promoted_entry_id: promoted_info.map(|(id, _)| id.clone()),
                has_customization: promoted_info.map(|(_, h)| *h),
                origin_tools: vec![],
            }
        })
        .collect();
    if !order.is_empty() {
        items.sort_by(|a, b| {
            let ra = order
                .iter()
                .position(|x| x.eq_ignore_ascii_case(&a.entry_id))
                .unwrap_or(usize::MAX);
            let rb = order
                .iter()
                .position(|x| x.eq_ignore_ascii_case(&b.entry_id))
                .unwrap_or(usize::MAX);
            ra.cmp(&rb)
                .then_with(|| a.entry_id.to_lowercase().cmp(&b.entry_id.to_lowercase()))
        });
    }
    Ok(items)
}

/// 技能目录原样打开；规则文件打开其父目录（文件夹壳）。
fn network_entry_open_target(abs: &Path) -> Result<PathBuf, String> {
    if !abs.exists() {
        return Err("本地缓存路径不存在；请先拉取该源".into());
    }
    if abs.is_dir() {
        Ok(abs.to_path_buf())
    } else {
        Ok(abs
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| abs.to_path_buf()))
    }
}

/// 打开网络条目本地缓存目录（资源管理器）。
pub fn open_network_entry_dir(settings: &AppSettings, entry_id: &str) -> Result<(), String> {
    let root = effective_network_root(settings).ok_or_else(|| "网络库未配置".to_string())?;
    let id = entry_id.trim();
    if id.is_empty() {
        return Err("entryId 为空".into());
    }
    let index = load_network_index(&root)?;
    let entry = index
        .entries
        .iter()
        .find(|e| e.id.eq_ignore_ascii_case(id))
        .ok_or_else(|| format!("未找到网络条目：{id}"))?;
    let abs = resolve_network_safe_path(&root, &entry.cached_rel_path)?;
    let dir = network_entry_open_target(&abs)?;
    crate::shell_ops::open_path(dir.to_string_lossy().to_string())
}

/// 打开源缓存根目录 `cache/{source_id}`。
pub fn open_network_source_cache_dir(settings: &AppSettings, source_id: &str) -> Result<(), String> {
    let root = effective_network_root(settings).ok_or_else(|| "网络库未配置".to_string())?;
    let sid = source_id.trim();
    if sid.is_empty() {
        return Err("sourceId 为空".into());
    }
    let cache_rel = format!("{NETWORK_CACHE_DIR}/{sid}");
    let abs = resolve_network_safe_path(&root, &cache_rel)?;
    if !abs.is_dir() {
        // 兼容旧索引用 URL slug 作 cache 目录名
        let index = load_network_index(&root)
            .map_err(|e| format!("读取网络索引失败（打开源缓存）: {e}"))?;
        if let Some(src) = index
            .sources
            .iter()
            .find(|s| s.id.eq_ignore_ascii_case(sid))
        {
            let alt = resolve_network_safe_path(&root, &src.cache_rel)?;
            if alt.is_dir() {
                return crate::shell_ops::open_path(alt.to_string_lossy().to_string());
            }
        }
        return Err("源缓存目录不存在；请先拉取该源".into());
    }
    crate::shell_ops::open_path(abs.to_string_lossy().to_string())
}

/// 移除用户粘贴源：settings + 索引 entries/sources + 缓存目录。
pub fn remove_network_user_source(
    settings: &mut AppSettings,
    source_id: &str,
) -> Result<NetworkOpResult, String> {
    let sid = source_id.trim();
    if sid.is_empty() {
        return Err("sourceId 为空".into());
    }
    if crate::network_catalog::is_curated_popular_id(sid) {
        return Err("精选源不能移除；请用「隐藏」".into());
    }
    if !settings
        .network_user_sources
        .iter()
        .any(|u| u.id.eq_ignore_ascii_case(sid))
    {
        return Err(format!("不是用户源或不存在：{sid}"));
    }

    let root_opt = effective_network_root(settings);
    let (old_index, cache_rels) = if let Some(ref root) = root_opt {
        let index = load_network_index(root)?;
        let cache_rels: Vec<String> = index
            .sources
            .iter()
            .filter(|s| s.id.eq_ignore_ascii_case(sid))
            .map(|s| s.cache_rel.clone())
            .collect();
        let mut new_index = index.clone();
        new_index
            .entries
            .retain(|e| !e.source_id.eq_ignore_ascii_case(sid));
        new_index
            .sources
            .retain(|s| !s.id.eq_ignore_ascii_case(sid));
        save_network_index(root, &new_index)?;
        (Some(index), cache_rels)
    } else {
        (None, Vec::new())
    };

    let prev_user = settings.network_user_sources.clone();
    let prev_pins = settings.network_popular_pinned_ids.clone();
    let prev_order = settings.network_popular_order.clone();
    settings
        .network_user_sources
        .retain(|u| !u.id.eq_ignore_ascii_case(sid));
    settings
        .network_popular_pinned_ids
        .retain(|id| !id.eq_ignore_ascii_case(sid));
    settings
        .network_popular_order
        .retain(|id| !id.eq_ignore_ascii_case(sid));

    if let Err(e) = crate::settings::save_settings(settings) {
        settings.network_user_sources = prev_user;
        settings.network_popular_pinned_ids = prev_pins;
        settings.network_popular_order = prev_order;
        if let (Some(root), Some(old)) = (root_opt.as_ref(), old_index.as_ref()) {
            let _ = save_network_index(root, old);
        }
        return Err(e);
    }

    let mut warnings = Vec::new();
    if let Some(ref root) = root_opt {
        for rel in &cache_rels {
            match resolve_network_safe_path(root, rel) {
                Ok(p) if p.is_dir() => {
                    if let Err(err) = fs::remove_dir_all(&p) {
                        warnings.push(format!("清除缓存 {rel} 失败: {err}"));
                    }
                }
                Ok(_) => {}
                Err(err) => warnings.push(format!("解析缓存路径 {rel} 失败: {err}")),
            }
        }
        let fallback = Path::new(root).join(NETWORK_CACHE_DIR).join(sid);
        if fallback.is_dir() {
            if let Err(err) = fs::remove_dir_all(&fallback) {
                warnings.push(format!(
                    "清除缓存 {}/{sid} 失败: {err}",
                    NETWORK_CACHE_DIR
                ));
            }
        }
    }

    let message = if warnings.is_empty() {
        format!("已移除用户源「{sid}」")
    } else {
        format!(
            "已移除用户源「{sid}」（{}）",
            warnings.join("；")
        )
    };
    Ok(NetworkOpResult {
        ok: true,
        message,
        snapshot: snap(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        warnings: if warnings.is_empty() {
            None
        } else {
            Some(warnings)
        },
    })
}

#[cfg(test)]
pub fn network_nav_for_snapshot(
    settings: &AppSettings,
) -> (Vec<NetworkNavNodeDto>, Vec<NetworkNavNodeDto>) {
    let ctx = load_network_snapshot_context(settings);
    network_nav_with_context(settings, ctx.as_ref())
}

pub fn network_nav_with_context(
    settings: &AppSettings,
    ctx: Option<&NetworkSnapshotContext>,
) -> (Vec<NetworkNavNodeDto>, Vec<NetworkNavNodeDto>) {
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut cached_source_ids: HashSet<String> = HashSet::new();
    let mut stale_source_ids: HashSet<String> = HashSet::new();
    let heat = ctx.map(|c| &c.heat);
    let net_root = effective_network_root(settings);
    if let Some(ctx) = ctx {
        if let Ok(index) = ctx.index.as_ref() {
            for s in &index.sources {
                let id = s.id.trim();
                if id.is_empty() {
                    continue;
                }
                let disk_ok = net_root
                    .as_ref()
                    .map(|root| {
                        let dest = Path::new(root).join(&s.cache_rel);
                        dest.is_dir() && cached_repo_state(&dest) == CachedRepoState::Healthy
                    })
                    .unwrap_or(false);
                if disk_ok {
                    cached_source_ids.insert(id.to_string());
                } else {
                    stale_source_ids.insert(id.to_string());
                }
            }
            for e in &index.entries {
                if cached_source_ids
                    .iter()
                    .any(|k| k.eq_ignore_ascii_case(&e.source_id))
                {
                    *counts.entry(e.source_id.clone()).or_default() += 1;
                }
            }
        }
    }
    build_network_nav_ex(
        settings,
        &counts,
        &cached_source_ids,
        &stale_source_ids,
        heat,
    )
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
    let popular = section.eq_ignore_ascii_case("popular");
    let list = if section.eq_ignore_ascii_case("official") {
        &mut settings.network_official_pinned_ids
    } else if popular {
        &mut settings.network_popular_pinned_ids
    } else {
        return Err("section 须为 official 或 popular".into());
    };
    list.retain(|x| !x.eq_ignore_ascii_case(id));
    if pinned {
        list.push(id.to_string());
    }
    if popular {
        if pinned {
            crate::network_catalog::ensure_community_candidate(settings, id);
        }
        crate::network_catalog::mark_network_popular_pins_initialized(settings);
    }
    crate::settings::save_settings(settings)?;
    Ok(snap_nav_only(settings))
}

/// Bulk eye-open / eye-off for popular nav (`pinned` = shown).
/// `scope`: `"community"`（默认）作用于社区分组内全部行＝精选社区候选＋用户源；
/// `"official"` 只动官网样例 pin。
/// community show=true：把社区候选与用户源全部 pin（官网 pin 保留）；
/// community show=false：清空社区候选与用户源 pin（官网 pin 保留）——
/// 分组头「全部闭眼」必须能关掉该分组里所有开眼行（含用户源）。
pub fn set_network_popular_visibility_all(
    settings: &mut AppSettings,
    show: bool,
    scope: Option<&str>,
) -> Result<AppSnapshotSubset, String> {
    use crate::network_catalog::{
        clamp_settings_visible_limit, community_candidate_ids, is_community_popular_id,
        is_official_popular_sample, mark_network_popular_pins_initialized,
        official_web_source_ids,
    };
    let scope = scope
        .unwrap_or("community")
        .trim()
        .to_ascii_lowercase();
    if scope == "official" {
        if show {
            for id in official_web_source_ids() {
                if !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(id))
                {
                    settings.network_popular_pinned_ids.push(id.to_string());
                }
            }
        } else {
            settings
                .network_popular_pinned_ids
                .retain(|id| !is_official_popular_sample(id));
        }
    } else {
        // community（默认）：社区分组渲染 精选候选 + 用户源，批量眼须覆盖两者
        let user_ids: Vec<String> = settings
            .network_user_sources
            .iter()
            .map(|u| u.id.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if show {
            // N=0（曾全部闭眼 / 遗留状态）→ 恢复默认 N；否则尊重用户设定的 N
            if settings.network_popular_visible_limit == 0 {
                settings.network_popular_visible_limit =
                    crate::settings::default_network_popular_visible_limit();
            }
            clamp_settings_visible_limit(settings);
            let candidates = community_candidate_ids(settings);
            for id in candidates.into_iter().chain(user_ids.into_iter()) {
                if !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(&id))
                {
                    settings.network_popular_pinned_ids.push(id);
                }
            }
        } else {
            // 只清社区/用户源 pin，保留 N：头部显示 0/N 而非 0/0，
            // 后续单行开眼仍在池内立即生效（不再卡死）。
            settings.network_popular_pinned_ids.retain(|id| {
                !is_community_popular_id(id)
                    && !user_ids.iter().any(|u| u.eq_ignore_ascii_case(id))
            });
        }
    }
    mark_network_popular_pins_initialized(settings);
    crate::settings::save_settings(settings)?;
    Ok(snap_nav_only(settings))
}

/// 设置社区候选池数量 N；只改 limit + clamp，不重写全部 pins。
/// 首次且 pins 空时，默认开眼社区候选前 N。
pub fn set_network_popular_visible_limit(
    settings: &mut AppSettings,
    limit: u32,
) -> Result<AppSnapshotSubset, String> {
    use crate::network_catalog::{
        apply_popular_sort_mode, clamp_settings_visible_limit, community_candidate_ids,
        load_heat_cache, mark_network_popular_pins_initialized, normalize_popular_sort,
    };
    settings.network_popular_visible_limit = limit;
    let heat = effective_network_root(settings)
        .filter(|r| !r.trim().is_empty())
        .map(|root| load_heat_cache(&root));
    let mode = normalize_popular_sort(&settings.network_popular_sort);
    if mode != "custom" {
        apply_popular_sort_mode(settings, heat.as_ref());
    }
    clamp_settings_visible_limit(settings);
    if !settings.network_popular_pins_initialized && settings.network_popular_pinned_ids.is_empty()
    {
        settings.network_popular_pinned_ids = community_candidate_ids(settings);
    }
    mark_network_popular_pins_initialized(settings);
    crate::settings::save_settings(settings)?;
    Ok(snap_nav_only(settings))
}

/// 社区（及热门全序）按 GitHub 指标重排；`custom` 只记模式、不改现有序。
pub fn set_network_popular_sort(
    settings: &mut AppSettings,
    mode: &str,
) -> Result<AppSnapshotSubset, String> {
    use crate::network_catalog::{
        apply_popular_sort_mode, clamp_settings_visible_limit, load_heat_cache,
        normalize_popular_sort,
    };
    settings.network_popular_sort = normalize_popular_sort(mode).to_string();
    let heat = effective_network_root(settings)
        .filter(|r| !r.trim().is_empty())
        .map(|root| load_heat_cache(&root));
    apply_popular_sort_mode(settings, heat.as_ref());
    clamp_settings_visible_limit(settings);
    crate::settings::save_settings(settings)?;
    Ok(snap_nav_only(settings))
}

/// Reorder network sidebar within official/popular; optional pin section change.
pub fn reorder_network_nav(
    settings: &mut AppSettings,
    section: &str,
    id: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
    target_pinned: Option<bool>,
) -> Result<AppSnapshotSubset, String> {
    let id = id.trim();
    if id.is_empty() {
        return Err("空 id".into());
    }
    let official = section.eq_ignore_ascii_case("official");
    let popular = section.eq_ignore_ascii_case("popular");
    if !official && !popular {
        return Err("section 须为 official 或 popular".into());
    }
    let catalog_ids: Vec<String> = if official {
        crate::network_catalog::OFFICIAL_AGENTS
            .iter()
            .map(|a| a.agent_key.to_string())
            .collect()
    } else {
        crate::network_catalog::popular_pool_ids(settings)
    };
    let mut popular_pin_touched = false;
    {
        let pinned_list = if official {
            &mut settings.network_official_pinned_ids
        } else {
            &mut settings.network_popular_pinned_ids
        };
        let order_list = if official {
            &mut settings.network_official_order
        } else {
            &mut settings.network_popular_order
        };
        if order_list.is_empty() {
            *order_list = catalog_ids.clone();
        } else {
            crate::list_order::sync_order_with_known(order_list, &catalog_ids);
        }
        let currently_pinned = pinned_list.iter().any(|x| x.eq_ignore_ascii_case(id));
        let want_pinned = target_pinned.unwrap_or(currently_pinned);
        if want_pinned != currently_pinned {
            pinned_list.retain(|x| !x.eq_ignore_ascii_case(id));
            if want_pinned {
                pinned_list.push(id.to_string());
            }
            popular_pin_touched = popular;
        }
        if want_pinned {
            crate::list_order::reorder_ids(pinned_list, id, direction, to_index)?;
        } else {
            // unpinned segment: order among non-pinned
            let mut unpinned: Vec<String> = order_list
                .iter()
                .filter(|x| !pinned_list.iter().any(|p| p.eq_ignore_ascii_case(x)))
                .cloned()
                .collect();
            if !unpinned.iter().any(|x| x.eq_ignore_ascii_case(id)) {
                unpinned.push(id.to_string());
            }
            crate::list_order::reorder_ids(&mut unpinned, id, direction, to_index)?;
            // rebuild full order = pinned + unpinned
            let mut next = pinned_list.clone();
            for u in unpinned {
                if !next.iter().any(|x| x.eq_ignore_ascii_case(&u)) {
                    next.push(u);
                }
            }
            for c in &catalog_ids {
                if !next.iter().any(|x| x.eq_ignore_ascii_case(c)) {
                    next.push(c.clone());
                }
            }
            *order_list = next;
        }
    }
    if popular && target_pinned == Some(true) {
        crate::network_catalog::ensure_community_candidate(settings, id);
    }
    if popular_pin_touched {
        crate::network_catalog::mark_network_popular_pins_initialized(settings);
    }
    // Manual drag → custom sort for popular shelf.
    if popular {
        settings.network_popular_sort = "custom".into();
    }
    crate::settings::save_settings(settings)?;
    Ok(snap_nav_only(settings))
}

fn network_list_order_path(settings: &AppSettings) -> Result<std::path::PathBuf, String> {
    let root = settings.network_library_root.trim();
    if root.is_empty() {
        return Err("请先配置网络库目录".into());
    }
    Ok(std::path::PathBuf::from(root).join("list-order.json"))
}

pub fn load_network_list_order(settings: &AppSettings) -> Vec<String> {
    let Ok(path) = network_list_order_path(settings) else {
        return vec![];
    };
    if !path.is_file() {
        return vec![];
    }
    let Ok(text) = std::fs::read_to_string(&path) else {
        return vec![];
    };
    serde_json::from_str::<Vec<String>>(&text).unwrap_or_default()
}

pub fn reorder_network_list_item(
    settings: &AppSettings,
    entry_id: &str,
    direction: Option<&str>,
    to_index: Option<usize>,
    visible_ids: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    let path = network_list_order_path(settings)?;
    let mut order = load_network_list_order(settings);
    if let Some(vis) = visible_ids {
        if !vis.is_empty() {
            crate::list_order::sync_order_with_known(&mut order, &vis);
            // Reorder only within visible subset, then merge back.
            let mut subset: Vec<String> = vis
                .iter()
                .filter(|id| order.iter().any(|x| x.eq_ignore_ascii_case(id)))
                .cloned()
                .collect();
            for id in &vis {
                if !subset.iter().any(|x| x.eq_ignore_ascii_case(id)) {
                    subset.push(id.clone());
                }
            }
            crate::list_order::reorder_ids(&mut subset, entry_id.trim(), direction, to_index)?;
            // stitch: keep non-visible positions, replace visible block order
            let mut out = Vec::new();
            let mut si = 0;
            let vis_set: Vec<String> = vis.clone();
            for id in &order {
                if vis_set.iter().any(|v| v.eq_ignore_ascii_case(id)) {
                    if si < subset.len() {
                        out.push(subset[si].clone());
                        si += 1;
                    }
                } else {
                    out.push(id.clone());
                }
            }
            while si < subset.len() {
                out.push(subset[si].clone());
                si += 1;
            }
            order = out;
        } else {
            crate::list_order::reorder_ids(&mut order, entry_id.trim(), direction, to_index)?;
        }
    } else {
        if !order.iter().any(|x| x.eq_ignore_ascii_case(entry_id.trim())) {
            order.push(entry_id.trim().to_string());
        }
        crate::list_order::reorder_ids(&mut order, entry_id.trim(), direction, to_index)?;
    }
    let text = serde_json::to_string_pretty(&order).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, text).map_err(|e| format!("写 list-order：{e}"))?;
    Ok(order)
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
    let mut touched: Vec<(String, String)> = Vec::new();
    for raw in entry_ids {
        let id = raw.trim();
        if let Some(e) = index.entries.iter_mut().find(|e| e.id == id) {
            e.intended_level = level.to_string();
            touched.push((e.id.clone(), e.source_id.clone()));
            n += 1;
        }
    }
    save_network_index(&net_root, &index)?;
    if settings.library_root_configured {
        let lib = settings.skills_library_root.trim();
        for (nid, sid) in &touched {
            crate::oplog::append(
                lib,
                crate::oplog::OpEvent {
                    op: "setIntendedLevel".into(),
                    network_entry_id: nid.clone(),
                    source_id: sid.clone(),
                    level: level.to_string(),
                    ..Default::default()
                },
            );
        }
    }
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
        warnings: None,
    })
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
            warnings: None,
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
        crate::oplog::append(
            lib,
            crate::oplog::OpEvent {
                op: "reapply".into(),
                entry_id: entry_id.to_string(),
                network_entry_id: network_entry_id.to_string(),
                source_id: net.source_id.clone(),
                note: "上游更新：用上游覆盖（丢弃定制）".into(),
                ..Default::default()
            },
        );
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
            warnings: None,
        });
    }
    if mode == "reapply" {
        let (merged, applied) =
            reapply_customization_on_text(lib, entry_id, &upstream, &upstream_hash)?;
        write_merged_to_library_entry(lib, &entry, &merged)?;
        update_entry_provenance_hash(lib, entry_id, &upstream_hash, &net.fingerprint)?;
        crate::oplog::append(
            lib,
            crate::oplog::OpEvent {
                op: "reapply".into(),
                entry_id: entry_id.to_string(),
                network_entry_id: network_entry_id.to_string(),
                source_id: net.source_id.clone(),
                note: if applied {
                    "上游更新：已重放定制 diff".into()
                } else {
                    "上游更新：无定制 diff，直接跟随上游".into()
                },
                ..Default::default()
            },
        );
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
            warnings: None,
        });
    }
    Err("mode 须为 reapply / overwrite / skip".into())
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
    let promoted = promoted_network_map(settings);
    let local_line = match promoted.get(&e.id) {
        Some((local_id, true)) => format!("本地: 已转入为 {local_id}（有定制 diff）"),
        Some((local_id, false)) => format!("本地: 已转入为 {local_id}"),
        None => "本地: 未转入（只读预览；编辑请先转入本地）".to_string(),
    };
    let level_line = if e.intended_level.trim().is_empty() {
        "意向层级: —（仅在转入本地时写入条目级别）".to_string()
    } else {
        format!(
            "意向层级: {}（仅在转入本地时写入条目级别）",
            e.intended_level.trim()
        )
    };
    let summary = format!(
        "{}\n种类: {}\n来源: {}\n状态: {}\n缓存: {}\n{}\n{}\n（只读 · 网络库）",
        e.name, e.kind, e.source_url, e.update_status, e.cached_rel_path, local_line, level_line
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
    use std::sync::Mutex;

    static APPDATA_LOCK: Mutex<()> = Mutex::new(());

    fn with_temp_appdata<R>(f: impl FnOnce() -> R) -> R {
        let _guard = APPDATA_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let appdata = tempfile::tempdir().unwrap();
        unsafe {
            std::env::set_var("APPDATA", appdata.path());
        }
        let out = f();
        unsafe {
            std::env::remove_var("APPDATA");
        }
        out
    }

    #[test]
    fn network_entry_open_target_dir_and_file() {
        let dir = tempfile::tempdir().unwrap();
        let skill = dir.path().join("brand-guidelines");
        fs::create_dir_all(&skill).unwrap();
        fs::write(skill.join("SKILL.md"), "# x\n").unwrap();
        assert_eq!(network_entry_open_target(&skill).unwrap(), skill);

        let mdc = dir.path().join("foo.mdc");
        fs::write(&mdc, "x").unwrap();
        assert_eq!(
            network_entry_open_target(&mdc).unwrap(),
            dir.path()
        );

        let missing = dir.path().join("no-such");
        assert!(network_entry_open_target(&missing)
            .unwrap_err()
            .contains("不存在"));
    }

    #[test]
    fn effective_intended_level_empty_is_uncategorized() {
        assert_eq!(effective_intended_level(""), None);
        assert_eq!(effective_intended_level("  "), None);
        assert_eq!(effective_intended_level("L0"), Some("L0"));
        assert_eq!(effective_intended_level("L1"), Some("L1"));
        assert_eq!(effective_intended_level("L2"), Some("L2"));
        assert_eq!(effective_intended_level("lx"), None);
    }

    #[test]
    fn extract_summary_prefers_frontmatter_description() {
        let md = "---\nname: demo\ndescription: \"Short card blurb\"\n---\n# 本文标题应被忽略\n\nbody\n";
        assert_eq!(
            extract_summary_from_skill_md(md),
            "Short card blurb"
        );
        let no_fm = "# Only heading\n\npara\n";
        assert_eq!(extract_summary_from_skill_md(no_fm), "Only heading");
    }

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
    fn default_network_root_is_library_net_subdir() {
        let lib = r"C:\CursorSkills";
        let net = default_network_library_root_for(lib);
        assert_eq!(normalize_path(&net), normalize_path(r"C:\CursorSkills\net"));
        let settings = AppSettings {
            skills_library_root: lib.into(),
            library_root_configured: true,
            ..Default::default()
        };
        assert_eq!(
            normalize_path(&default_network_library_root(&settings)),
            normalize_path(r"C:\CursorSkills\net")
        );
    }

    #[test]
    fn baseline_urls_match_popular_catalog() {
        for (id, _, url) in BASELINE_SOURCES {
            let p = POPULAR_SOURCES
                .iter()
                .find(|p| p.id == *id)
                .unwrap_or_else(|| panic!("baseline {id} missing from POPULAR_SOURCES"));
            assert_eq!(p.url, *url, "{id}");
            assert!(p.is_official_sample, "{id}");
        }
    }

    #[test]
    fn sync_coupled_follows_library_root() {
        let dir = tempfile::tempdir().unwrap();
        let lib = dir.path().join("perm").to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: r"C:\elsewhere\custom-net".into(),
            network_library_configured: true,
            ..Default::default()
        };
        sync_coupled_network_root(&mut settings).unwrap();
        let expect = Path::new(&lib).join("net").to_string_lossy().to_string();
        assert_eq!(
            normalize_path(&settings.network_library_root),
            normalize_path(&expect)
        );
        assert!(Path::new(&settings.network_library_root)
            .join(NETWORK_INDEX_FILE)
            .is_file());
    }

    #[test]
    fn ensure_migrates_legacy_ccm_network_library() {
        with_temp_appdata(|| {
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("perm").to_string_lossy().to_string();
            ensure_library_layout(&lib).unwrap();
            let legacy = dir
                .path()
                .join("CCM-NetworkLibrary")
                .to_string_lossy()
                .to_string();
            fs::create_dir_all(&legacy).unwrap();
            let mut settings = AppSettings {
                skills_library_root: lib.clone(),
                library_root_configured: true,
                network_library_root: legacy,
                network_library_configured: true,
                ..Default::default()
            };
            ensure_default_network_library(&mut settings).unwrap();
            let expect = Path::new(&lib).join("net").to_string_lossy().to_string();
            assert_eq!(
                normalize_path(&settings.network_library_root),
                normalize_path(&expect)
            );
        });
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
        assert_eq!(entry.library_path.replace('\\', "/"), "skills/my-skill");
        assert!(entry.origins.iter().any(|o| o.tool == "network"));
    }

    #[test]
    fn promote_with_intended_level_uses_s_prefix() {
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
            intended_level: "L1".into(),
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
        assert!(
            load.catalog.entries.iter().any(|e| e.id == "S1-my-skill"),
            "ids={:?}",
            load.catalog.entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>()
        );
        assert!(
            Path::new(&lib)
                .join("skills/S1-my-skill/SKILL.md")
                .is_file()
        );
    }

    #[test]
    fn promote_copies_rule_into_nested_shell() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let rule_file = Path::new(&net).join("cache/demo/my-rule.mdc");
        fs::create_dir_all(rule_file.parent().unwrap()).unwrap();
        fs::write(&rule_file, "# Nested rule\n").unwrap();

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
            id: format!("{NETWORK_ID_PREFIX}demo:my-rule"),
            kind: "rule".into(),
            name: "my-rule".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/my-rule.mdc".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "Nested rule".into(),
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
            &[format!("{NETWORK_ID_PREFIX}demo:my-rule")],
            &[],
            false,
        )
        .unwrap();
        assert!(res.ok, "{}", res.message);
        assert_eq!(res.promoted, Some(1));
        assert!(Path::new(&lib).join("rules/my-rule/my-rule.mdc").is_file());
        assert!(!Path::new(&lib).join("rules/my-rule.mdc").exists());
        let load = load_catalog(&lib);
        let entry = load
            .catalog
            .entries
            .iter()
            .find(|e| e.id == "my-rule")
            .unwrap();
        assert_eq!(
            entry.library_path.replace('\\', "/"),
            "rules/my-rule/my-rule.mdc"
        );
    }

    #[test]
    fn promote_rule_dir_prefers_matching_stem() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let rule_dir = Path::new(&net).join("cache/demo/pack");
        fs::create_dir_all(&rule_dir).unwrap();
        fs::write(rule_dir.join("other.mdc"), "# other\n").unwrap();
        fs::write(rule_dir.join("my-rule.mdc"), "# match\n").unwrap();

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
            id: format!("{NETWORK_ID_PREFIX}demo:my-rule"),
            kind: "rule".into(),
            name: "my-rule".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/pack".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "dir pack".into(),
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
            &[format!("{NETWORK_ID_PREFIX}demo:my-rule")],
            &[],
            false,
        )
        .unwrap();
        assert!(res.ok, "{}", res.message);
        let body = fs::read_to_string(Path::new(&lib).join("rules/my-rule/my-rule.mdc")).unwrap();
        assert!(body.contains("match"), "should prefer stem-matched file, got {body}");
    }

    #[test]
    fn promote_rule_dir_ambiguous_without_stem_match_errors() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let rule_dir = Path::new(&net).join("cache/demo/pack");
        fs::create_dir_all(&rule_dir).unwrap();
        fs::write(rule_dir.join("a.mdc"), "# a\n").unwrap();
        fs::write(rule_dir.join("b.mdc"), "# b\n").unwrap();

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
            id: format!("{NETWORK_ID_PREFIX}demo:my-rule"),
            kind: "rule".into(),
            name: "my-rule".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/pack".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "ambiguous".into(),
            license: String::new(),
            ..Default::default()
        });
        save_network_index(&net, &index).unwrap();

        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net,
            network_library_configured: true,
            ..Default::default()
        };
        let err = promote_network_to_library(
            &settings,
            &[format!("{NETWORK_ID_PREFIX}demo:my-rule")],
            &[],
            false,
        )
        .expect_err("ambiguous rule dir should fail hard");
        assert!(
            err.contains("多个") || err.contains("无与目标同名"),
            "unexpected message: {err}"
        );
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

    /// 晋升映射：promote 后列表行带 promotedEntryId；库内改动后 hasCustomization=true。
    #[test]
    fn promoted_map_marks_list_rows_and_customization() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();

        let cached = Path::new(&net).join("cache/demo/map-skill");
        fs::create_dir_all(&cached).unwrap();
        fs::write(cached.join("SKILL.md"), "# Map skill\n\noriginal\n").unwrap();

        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: "demo".into(),
            label: "Demo".into(),
            url: "https://example.com/demo.git".into(),
            cache_rel: "cache/demo".into(),
            fingerprint: "abc".into(),
            last_fetched_at: String::new(),
        });
        let net_id = format!("{NETWORK_ID_PREFIX}demo:map-skill");
        index.entries.push(NetworkEntry {
            id: net_id.clone(),
            kind: "skill".into(),
            name: "map-skill".into(),
            source_id: "demo".into(),
            source_url: "https://example.com/demo.git".into(),
            remote_id: "r1".into(),
            cached_rel_path: "cache/demo/map-skill".into(),
            fingerprint: "abc".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: "示例描述".into(),
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

        // 未晋升：无映射，列表行不带 promotedEntryId，summary 透传
        let ctx0 = load_network_snapshot_context(&settings).expect("ctx");
        assert!(ctx0.promoted.is_empty());
        let items0 = network_list_items_with_context(&settings, &ctx0).unwrap();
        let row0 = items0.iter().find(|x| x.entry_id == net_id).expect("row");
        assert!(row0.promoted_entry_id.is_none());
        assert_eq!(row0.summary.as_deref(), Some("示例描述"));

        // 晋升后：映射建立，hasCustomization=false
        let res = promote_network_to_library(&settings, &[net_id.clone()], &[], false).unwrap();
        assert!(res.ok, "{}", res.message);
        let map = promoted_network_map(&settings);
        let (local_id, has_custom) = map.get(&net_id).expect("promoted mapping").clone();
        assert!(!local_id.is_empty());
        assert!(!has_custom);
        let ctx1 = load_network_snapshot_context(&settings).expect("ctx");
        let items1 = network_list_items_with_context(&settings, &ctx1).unwrap();
        let row1 = items1.iter().find(|x| x.entry_id == net_id).expect("row");
        assert_eq!(row1.promoted_entry_id.as_deref(), Some(local_id.as_str()));
        assert_eq!(row1.has_customization, Some(false));

        // 库内保存改动 → 记录 diff → hasCustomization=true
        let msg = crate::network_customization::record_after_library_save(
            &lib,
            &local_id,
            "# Map skill\n\noriginal\nmy customization\n",
        )
        .unwrap();
        assert!(msg.is_some());
        let map2 = promoted_network_map(&settings);
        assert!(map2.get(&net_id).expect("mapping").1);

        // oplog 已记 promote 与 recordDiff 两类事件
        let events = crate::oplog::read_for_entry(&lib, &local_id, &net_id, "");
        assert!(events.iter().any(|e| e.op == "promote"));
        assert!(events.iter().any(|e| e.op == "recordDiff"));
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

        let mut settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            ..Default::default()
        };
        let res = fetch_network_source(
            &mut settings,
            bare.to_str().unwrap(),
            Some("local-seed"),
        )
        .unwrap();
        assert!(res.ok, "{}", res.message);
        // 本地 Git 路径应持久为用户源
        assert!(
            settings
                .network_user_sources
                .iter()
                .any(|u| !u.url.is_empty()),
            "expected user source persisted"
        );
        let items = network_list_items(&settings).expect("list items");
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
        with_temp_appdata(|| {
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
        });
    }

    #[test]
    fn resolve_popular_url_and_id_use_catalog_source_id() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();
        let settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net,
            network_library_configured: true,
            ..Default::default()
        };

        let by_url = resolve_network_fetch_target(
            &settings,
            "https://github.com/vercel-labs/agent-skills",
            None,
        )
        .unwrap();
        assert_eq!(by_url.source_id, "vercel-agent-skills");
        assert!(by_url.url.contains("vercel-labs/agent-skills"));

        let by_id = resolve_network_fetch_target(&settings, "vercel-agent-skills", None).unwrap();
        assert_eq!(by_id.source_id, "vercel-agent-skills");
        assert_eq!(by_id.url, by_url.url);

        // 未知仓仍走 slug
        let unknown = resolve_network_fetch_target(
            &settings,
            "https://github.com/acme/unknown-skills",
            Some("Acme"),
        )
        .unwrap();
        assert_eq!(unknown.source_id, "acme-unknown-skills");
        assert_eq!(unknown.source_label, "Acme");
    }

    #[test]
    fn migrate_and_load_upgrade_slug_source_id() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let old_id = "vercel-labs-agent-skills";
        let old_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(old_id);
        fs::create_dir_all(&old_cache).unwrap();
        fs::write(old_cache.join("marker.txt"), "x").unwrap();

        let mut index = NetworkIndex {
            version: 1,
            sources: vec![NetworkSourceRecord {
                id: old_id.into(),
                label: "old slug".into(),
                url: "https://github.com/vercel-labs/agent-skills".into(),
                cache_rel: format!("{NETWORK_CACHE_DIR}/{old_id}"),
                fingerprint: "abc".into(),
                last_fetched_at: String::new(),
            }],
            entries: vec![NetworkEntry {
                id: format!("{NETWORK_ID_PREFIX}{old_id}:demo"),
                kind: "skill".into(),
                name: "demo".into(),
                source_id: old_id.into(),
                source_url: "https://github.com/vercel-labs/agent-skills".into(),
                remote_id: String::new(),
                cached_rel_path: format!("{NETWORK_CACHE_DIR}/{old_id}/demo"),
                fingerprint: "abc".into(),
                content_hash: String::new(),
                update_status: "current".into(),
                summary: String::new(),
                license: String::new(),
                intended_level: String::new(),
                security_level: String::new(),
            }],
        };
        save_network_index(&net, &index).unwrap();

        let loaded = load_network_index(&net).unwrap();
        assert_eq!(loaded.sources.len(), 1);
        assert_eq!(loaded.sources[0].id, "vercel-agent-skills");
        assert_eq!(
            loaded.sources[0].cache_rel,
            format!("{NETWORK_CACHE_DIR}/vercel-agent-skills")
        );
        assert_eq!(loaded.entries[0].source_id, "vercel-agent-skills");
        assert_eq!(
            loaded.entries[0].id,
            format!("{NETWORK_ID_PREFIX}vercel-agent-skills:demo")
        );
        assert_eq!(
            loaded.entries[0].cached_rel_path,
            format!("{NETWORK_CACHE_DIR}/vercel-agent-skills/demo")
        );
        assert!(Path::new(&net)
            .join(NETWORK_CACHE_DIR)
            .join("vercel-agent-skills")
            .join("marker.txt")
            .is_file());

        // 直接 migrate 幂等
        index = loaded;
        assert!(!migrate_network_index_source_ids(&net, &mut index).unwrap());
    }

    #[test]
    fn load_network_index_deletes_retired_source_cache() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let retired_id = "anthropics-courses";
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(retired_id);
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("SKILL.md"), "x").unwrap();
        let keep_id = "anthropics-skills";
        let keep_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(keep_id);
        fs::create_dir_all(&keep_cache).unwrap();
        fs::write(keep_cache.join("marker.txt"), "keep").unwrap();

        let index = NetworkIndex {
            version: 1,
            sources: vec![
                NetworkSourceRecord {
                    id: retired_id.into(),
                    label: "retired".into(),
                    url: "https://github.com/anthropics/courses".into(),
                    cache_rel: format!("{NETWORK_CACHE_DIR}/{retired_id}"),
                    fingerprint: String::new(),
                    last_fetched_at: String::new(),
                },
                NetworkSourceRecord {
                    id: keep_id.into(),
                    label: "keep".into(),
                    url: "https://github.com/anthropics/skills".into(),
                    cache_rel: format!("{NETWORK_CACHE_DIR}/{keep_id}"),
                    fingerprint: String::new(),
                    last_fetched_at: String::new(),
                },
            ],
            entries: vec![],
        };
        save_network_index(&net, &index).unwrap();

        let loaded = load_network_index(&net).unwrap();
        assert!(!loaded.sources.iter().any(|s| s.id == retired_id));
        assert!(loaded.sources.iter().any(|s| s.id == keep_id));
        assert!(!cache.exists(), "retired cache dir must be removed");
        assert!(keep_cache.join("marker.txt").is_file());
    }

    #[test]
    fn should_skip_discover_name_denylist_allows_agent_dot_dirs() {
        assert!(should_skip_discover_name(".git"));
        assert!(should_skip_discover_name("node_modules"));
        assert!(should_skip_discover_name(".venv"));
        assert!(should_skip_discover_name("venv"));
        assert!(should_skip_discover_name("__pycache__"));
        assert!(should_skip_discover_name(".idea"));
        assert!(!should_skip_discover_name(".github"));
        assert!(!should_skip_discover_name(".curated"));
        assert!(!should_skip_discover_name(".claude"));
        assert!(!should_skip_discover_name(".cursor"));
        assert!(!should_skip_discover_name(".codex"));
        assert!(!should_skip_discover_name("skills"));
    }

    #[test]
    fn discover_finds_skills_under_github_curated_and_claude() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join("demo");

        let github_skill = cache.join(".github").join("skills").join("foo");
        fs::create_dir_all(&github_skill).unwrap();
        fs::write(github_skill.join("SKILL.md"), "# Foo\n").unwrap();

        let curated_skill = cache.join("skills").join(".curated").join("bar");
        fs::create_dir_all(&curated_skill).unwrap();
        fs::write(curated_skill.join("SKILL.md"), "# Bar\n").unwrap();

        let claude_skill = cache.join(".claude").join("skills").join("baz");
        fs::create_dir_all(&claude_skill).unwrap();
        fs::write(claude_skill.join("SKILL.md"), "# Baz\n").unwrap();

        let git_hidden = cache.join(".git").join("objects").join("hidden");
        fs::create_dir_all(&git_hidden).unwrap();
        fs::write(git_hidden.join("SKILL.md"), "# HiddenGit\n").unwrap();

        let nm_hidden = cache.join("node_modules").join("pkg");
        fs::create_dir_all(&nm_hidden).unwrap();
        fs::write(nm_hidden.join("SKILL.md"), "# HiddenNm\n").unwrap();

        let source = NetworkSourceRecord {
            id: "demo".into(),
            label: "demo".into(),
            url: "https://example.com/demo".into(),
            cache_rel: format!("{NETWORK_CACHE_DIR}/demo"),
            fingerprint: "abc123".into(),
            last_fetched_at: String::new(),
        };
        let entries = discover_entries_in_cache(&net, &source, "abc123").unwrap();
        let names: HashSet<String> = entries.iter().map(|e| e.name.clone()).collect();
        assert_eq!(
            names.len(),
            3,
            "expected foo/bar/baz, got {names:?}"
        );
        assert!(names.contains("foo"));
        assert!(names.contains("bar"));
        assert!(names.contains("baz"));
        assert!(!names.contains("hidden"));
        assert!(!names.contains("pkg"));
        // id 含路径，不再是裸 basename
        assert!(entries.iter().any(|e| e.id.contains("github-skills-foo")));
    }

    #[test]
    fn discover_root_skill_md_is_single_entry() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join("blader-humanizer");
        fs::create_dir_all(&cache).unwrap();
        fs::write(
            cache.join("SKILL.md"),
            "---\nname: humanize\ndescription: Make text less AI.\n---\n# Humanize\n",
        )
        .unwrap();
        fs::write(cache.join("README.md"), "# readme\n").unwrap();
        let nested = cache.join("skills").join("other");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SKILL.md"), "# nested should be ignored\n").unwrap();

        let source = NetworkSourceRecord {
            id: "blader-humanizer".into(),
            label: "blader/humanizer".into(),
            url: "https://github.com/blader/humanizer".into(),
            cache_rel: format!("{NETWORK_CACHE_DIR}/blader-humanizer"),
            fingerprint: "abc123".into(),
            last_fetched_at: String::new(),
        };
        let entries = discover_entries_in_cache(&net, &source, "abc123").unwrap();
        assert_eq!(entries.len(), 1, "root SKILL.md is one skill, got {entries:?}");
        assert_eq!(entries[0].kind, "skill");
        assert_eq!(entries[0].name, "humanizer");
        assert!(entries[0].summary.to_lowercase().contains("less ai") || entries[0].summary.contains("Humanize"));
        assert!(entries[0].id.contains("blader-humanizer"));
    }

    #[test]
    fn collect_sparse_expand_paths_root_skill_checks_out_all() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("repo");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("SKILL.md"), "# root\n").unwrap();
        let paths = collect_sparse_expand_paths(&dest);
        assert_eq!(paths, vec!["/**".to_string()]);
    }

    #[test]
    fn discover_dedupes_same_content_keeps_github_skills_copy() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join("demo");
        let body = "# Entra\n\nshared body\n";
        let a = cache
            .join(".github")
            .join("plugins")
            .join("azure-skills")
            .join("skills")
            .join("entra-agent-id");
        let b = cache.join(".github").join("skills").join("entra-agent-id");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("SKILL.md"), body).unwrap();
        fs::write(b.join("SKILL.md"), body).unwrap();

        let source = NetworkSourceRecord {
            id: "demo".into(),
            label: "demo".into(),
            url: "https://example.com/demo".into(),
            cache_rel: format!("{NETWORK_CACHE_DIR}/demo"),
            fingerprint: "fp".into(),
            last_fetched_at: String::new(),
        };
        let entries = discover_entries_in_cache(&net, &source, "fp").unwrap();
        assert_eq!(entries.len(), 1, "same content should collapse: {entries:?}");
        assert_eq!(entries[0].name, "entra-agent-id");
        assert!(
            entries[0]
                .cached_rel_path
                .replace('\\', "/")
                .contains("/.github/skills/entra-agent-id"),
            "prefer .github/skills copy, got {}",
            entries[0].cached_rel_path
        );
        assert_ne!(
            entries[0].id,
            format!("{NETWORK_ID_PREFIX}demo:entra-agent-id"),
            "id must include path, not bare basename"
        );
    }

    #[test]
    fn discover_keeps_same_basename_when_content_differs() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join("demo");
        let a = cache
            .join(".github")
            .join("plugins")
            .join("azure-skills")
            .join("skills")
            .join("entra-agent-id");
        let b = cache.join(".github").join("skills").join("entra-agent-id");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(a.join("SKILL.md"), "# Plugin copy\n").unwrap();
        fs::write(b.join("SKILL.md"), "# Canonical copy\n").unwrap();

        let source = NetworkSourceRecord {
            id: "demo".into(),
            label: "demo".into(),
            url: "https://example.com/demo".into(),
            cache_rel: format!("{NETWORK_CACHE_DIR}/demo"),
            fingerprint: "fp".into(),
            last_fetched_at: String::new(),
        };
        let entries = discover_entries_in_cache(&net, &source, "fp").unwrap();
        assert_eq!(entries.len(), 2, "different content kept: {entries:?}");
        let mut ids: Vec<_> = entries.iter().map(|e| e.id.clone()).collect();
        ids.sort();
        assert_ne!(ids[0], ids[1]);
        for e in &entries {
            assert!(
                e.name.contains(" · "),
                "colliding basename should show path hint, got {}",
                e.name
            );
            assert!(e.name.starts_with("entra-agent-id"));
        }
    }

    #[test]
    fn network_snapshot_context_thin_wrappers() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let settings = AppSettings {
            network_library_root: net,
            network_library_configured: true,
            ..Default::default()
        };
        assert!(network_list_items(&settings).unwrap().is_empty());
        let (_o, _p) = network_nav_for_snapshot(&settings);
        let ctx = load_network_snapshot_context(&settings).expect("ctx");
        assert!(ctx.index.is_ok());
    }

    #[test]
    fn migrate_rename_failure_leaves_index_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let old_id = "vercel-labs-agent-skills";
        let new_id = "vercel-agent-skills";
        let old_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(old_id);
        fs::create_dir_all(&old_cache).unwrap();
        let marker = old_cache.join("marker.txt");
        fs::write(&marker, "x").unwrap();

        let mut index = NetworkIndex {
            version: 1,
            sources: vec![NetworkSourceRecord {
                id: old_id.into(),
                label: "old slug".into(),
                url: "https://github.com/vercel-labs/agent-skills".into(),
                cache_rel: format!("{NETWORK_CACHE_DIR}/{old_id}"),
                fingerprint: "abc".into(),
                last_fetched_at: String::new(),
            }],
            entries: vec![NetworkEntry {
                id: format!("{NETWORK_ID_PREFIX}{old_id}:demo"),
                kind: "skill".into(),
                name: "demo".into(),
                source_id: old_id.into(),
                source_url: "https://github.com/vercel-labs/agent-skills".into(),
                remote_id: String::new(),
                cached_rel_path: format!("{NETWORK_CACHE_DIR}/{old_id}/demo"),
                fingerprint: "abc".into(),
                content_hash: String::new(),
                update_status: "current".into(),
                summary: String::new(),
                license: String::new(),
                intended_level: String::new(),
                security_level: String::new(),
            }],
        };

        // 制造 rename 失败：独占打开缓存内文件（Windows）或去掉 cache 写权限（Unix）
        #[cfg(windows)]
        let _lock = {
            use std::fs::OpenOptions;
            use std::os::windows::fs::OpenOptionsExt;
            OpenOptions::new()
                .read(true)
                .write(true)
                .share_mode(0)
                .open(&marker)
                .expect("exclusive lock")
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let cache_dir = Path::new(&net).join(NETWORK_CACHE_DIR);
            let mut perms = fs::metadata(&cache_dir).unwrap().permissions();
            perms.set_mode(0o555);
            fs::set_permissions(&cache_dir, perms).unwrap();
        }

        let changed = migrate_network_index_source_ids(&net, &mut index).unwrap();
        assert!(!changed, "rename failure must not flip index");
        assert_eq!(index.sources[0].id, old_id);
        assert_eq!(index.entries[0].source_id, old_id);
        assert!(!Path::new(&net).join(NETWORK_CACHE_DIR).join(new_id).exists());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let cache_dir = Path::new(&net).join(NETWORK_CACHE_DIR);
            let mut perms = fs::metadata(&cache_dir).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&cache_dir, perms).unwrap();
        }
    }

    #[test]
    fn load_propagates_migrate_save_failure() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let old_id = "vercel-labs-agent-skills";
        let old_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(old_id);
        fs::create_dir_all(&old_cache).unwrap();
        fs::write(old_cache.join("marker.txt"), "x").unwrap();

        let index = NetworkIndex {
            version: 1,
            sources: vec![NetworkSourceRecord {
                id: old_id.into(),
                label: "old slug".into(),
                url: "https://github.com/vercel-labs/agent-skills".into(),
                cache_rel: format!("{NETWORK_CACHE_DIR}/{old_id}"),
                fingerprint: "abc".into(),
                last_fetched_at: String::new(),
            }],
            entries: vec![],
        };
        save_network_index(&net, &index).unwrap();

        // 阻塞 save：预建与 pid 同名的 tmp 目录，使 write tmp 失败
        let tmp = Path::new(&net).join(format!("network-index.{}.tmp", std::process::id()));
        fs::create_dir_all(&tmp).unwrap();

        let err = load_network_index(&net).unwrap_err();
        assert!(
            err.contains("tmp") || err.contains("write") || err.contains("network-index"),
            "expected save error, got {err}"
        );
        // 磁盘上 index 仍为旧 id（未成功写回）
        let raw = fs::read_to_string(Path::new(&net).join(NETWORK_INDEX_FILE)).unwrap();
        assert!(raw.contains(old_id), "index on disk must stay old on save fail");
    }

    #[test]
    fn remove_user_source_updates_index_before_settings() {
        let dir = tempfile::tempdir().unwrap();
        let appdata = dir.path().join("appdata");
        fs::create_dir_all(&appdata).unwrap();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_library_layout(&lib).unwrap();
        ensure_network_layout(&net).unwrap();

        let sid = "user-acme-skills";
        let cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(sid);
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("x.txt"), "1").unwrap();

        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: sid.into(),
            label: "Acme".into(),
            url: "https://github.com/acme/skills".into(),
            cache_rel: format!("{NETWORK_CACHE_DIR}/{sid}"),
            fingerprint: "fp".into(),
            last_fetched_at: String::new(),
        });
        index.entries.push(NetworkEntry {
            id: format!("{NETWORK_ID_PREFIX}{sid}:demo"),
            kind: "skill".into(),
            name: "demo".into(),
            source_id: sid.into(),
            source_url: "https://github.com/acme/skills".into(),
            remote_id: String::new(),
            cached_rel_path: format!("{NETWORK_CACHE_DIR}/{sid}/demo"),
            fingerprint: "fp".into(),
            content_hash: String::new(),
            update_status: "current".into(),
            summary: String::new(),
            license: String::new(),
            intended_level: String::new(),
            security_level: String::new(),
        });
        save_network_index(&net, &index).unwrap();

        unsafe {
            std::env::set_var("APPDATA", &appdata);
        }
        let mut settings = AppSettings {
            skills_library_root: lib.clone(),
            library_root_configured: true,
            network_library_root: net.clone(),
            network_library_configured: true,
            network_user_sources: vec![crate::settings::NetworkUserSource {
                id: sid.into(),
                label: "Acme".into(),
                url: "https://github.com/acme/skills".into(),
            }],
            network_popular_pinned_ids: vec![sid.into()],
            ..Default::default()
        };
        crate::settings::save_settings(&settings).unwrap();

        let res = remove_network_user_source(&mut settings, sid).unwrap();
        assert!(res.ok, "{}", res.message);
        assert!(settings.network_user_sources.is_empty());
        let loaded = load_network_index(&net).unwrap();
        assert!(loaded.sources.is_empty());
        assert!(loaded.entries.is_empty());
        assert!(!cache.exists(), "cache dir should be cleared");
        unsafe {
            std::env::remove_var("APPDATA");
        }
    }

    #[test]
    fn migrate_accepts_when_new_cache_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let old_id = "vercel-labs-agent-skills";
        let new_id = "vercel-agent-skills";
        let old_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(old_id);
        let new_cache = Path::new(&net).join(NETWORK_CACHE_DIR).join(new_id);
        fs::create_dir_all(&old_cache).unwrap();
        fs::create_dir_all(&new_cache).unwrap();
        fs::write(new_cache.join("keep.txt"), "keep").unwrap();

        let mut index = NetworkIndex {
            version: 1,
            sources: vec![NetworkSourceRecord {
                id: old_id.into(),
                label: "old".into(),
                url: "https://github.com/vercel-labs/agent-skills".into(),
                cache_rel: format!("{NETWORK_CACHE_DIR}/{old_id}"),
                fingerprint: "abc".into(),
                last_fetched_at: String::new(),
            }],
            entries: vec![],
        };
        assert!(migrate_network_index_source_ids(&net, &mut index).unwrap());
        assert_eq!(index.sources[0].id, new_id);
        assert_eq!(
            index.sources[0].cache_rel,
            format!("{NETWORK_CACHE_DIR}/{new_id}")
        );
        assert!(new_cache.join("keep.txt").is_file());
    }

    #[test]
    fn visibility_all_official_scope_keeps_community_pins() {
        with_temp_appdata(|| {
            use crate::network_catalog::{
                ensure_network_pin_defaults, is_community_popular_id, is_official_popular_sample,
                official_web_source_ids,
            };
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("lib").to_string_lossy().to_string();
            ensure_library_layout(&lib).unwrap();
            let net = Path::new(&lib).join("net").to_string_lossy().to_string();
            ensure_network_layout(&net).unwrap();
            let mut settings = AppSettings {
                skills_library_root: lib,
                library_root_configured: true,
                network_library_root: net,
                network_library_configured: true,
                ..Default::default()
            };
            let _ = ensure_network_pin_defaults(&mut settings);
            // 确保官网与至少一个社区 pin 都在
            for id in official_web_source_ids() {
                if !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(id))
                {
                    settings.network_popular_pinned_ids.push(id.to_string());
                }
            }
            let community_before: Vec<String> = settings
                .network_popular_pinned_ids
                .iter()
                .filter(|id| is_community_popular_id(id))
                .cloned()
                .collect();
            assert!(
                !community_before.is_empty(),
                "setup needs at least one community pin"
            );
            let limit_before = settings.network_popular_visible_limit;

            set_network_popular_visibility_all(&mut settings, false, Some("official")).unwrap();
            assert!(
                !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|id| is_official_popular_sample(id)),
                "official pins cleared"
            );
            let community_after: Vec<String> = settings
                .network_popular_pinned_ids
                .iter()
                .filter(|id| is_community_popular_id(id))
                .cloned()
                .collect();
            assert_eq!(community_after, community_before, "community pins untouched");
            assert_eq!(
                settings.network_popular_visible_limit, limit_before,
                "official scope must not touch visible limit"
            );

            set_network_popular_visibility_all(&mut settings, true, Some("official")).unwrap();
            for id in official_web_source_ids() {
                assert!(
                    settings
                        .network_popular_pinned_ids
                        .iter()
                        .any(|x| x.eq_ignore_ascii_case(id)),
                    "official id {id} must be pinned after show"
                );
            }
            // 幂等：再开一次仍全 pin
            let pins_mid = settings.network_popular_pinned_ids.clone();
            set_network_popular_visibility_all(&mut settings, true, Some("official")).unwrap();
            assert_eq!(settings.network_popular_pinned_ids, pins_mid);
        });
    }

    #[test]
    fn set_network_popular_sort_forks_keeps_official_first() {
        with_temp_appdata(|| {
            use crate::network_catalog::{
                ensure_network_pin_defaults, is_community_popular_id, is_official_popular_sample,
                save_heat_cache, HeatCache,
            };
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("lib").to_string_lossy().to_string();
            ensure_library_layout(&lib).unwrap();
            let net = Path::new(&lib).join("net").to_string_lossy().to_string();
            ensure_network_layout(&net).unwrap();
            let mut settings = AppSettings {
                skills_library_root: lib,
                library_root_configured: true,
                network_library_root: net.clone(),
                network_library_configured: true,
                ..Default::default()
            };
            let _ = ensure_network_pin_defaults(&mut settings);
            let mut heat = HeatCache::default();
            heat.forks.insert("anthropics-skills".into(), 10);
            heat.forks.insert("obra-superpowers".into(), 999);
            save_heat_cache(&net, &heat).unwrap();

            set_network_popular_sort(&mut settings, "forks").unwrap();
            assert_eq!(settings.network_popular_sort, "forks");
            assert!(
                settings
                    .network_popular_order
                    .first()
                    .is_some_and(|id| is_official_popular_sample(id)),
                "official segment stays first after metric sort"
            );
            let community: Vec<&str> = settings
                .network_popular_order
                .iter()
                .filter(|id| is_community_popular_id(id))
                .map(|s| s.as_str())
                .collect();
            assert_eq!(
                community.first().copied(),
                Some("obra-superpowers"),
                "highest forks among community should lead the community segment"
            );
        });
    }

    /// 社区分组「全部闭眼」须连用户源一起关（用户源显示在社区分组内）；
    /// 「全部开眼」也把用户源 pin 回来；官网 pin 两个方向都保留。
    #[test]
    fn visibility_all_community_scope_includes_user_sources() {
        with_temp_appdata(|| {
            use crate::network_catalog::{
                ensure_network_pin_defaults, is_official_popular_sample, official_web_source_ids,
            };
            use crate::settings::NetworkUserSource;
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("lib").to_string_lossy().to_string();
            ensure_library_layout(&lib).unwrap();
            let net = Path::new(&lib).join("net").to_string_lossy().to_string();
            ensure_network_layout(&net).unwrap();
            let mut settings = AppSettings {
                skills_library_root: lib,
                library_root_configured: true,
                network_library_root: net,
                network_library_configured: true,
                ..Default::default()
            };
            let _ = ensure_network_pin_defaults(&mut settings);
            for id in official_web_source_ids() {
                if !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(id))
                {
                    settings.network_popular_pinned_ids.push(id.to_string());
                }
            }
            // 用户源（skills.sh / 粘贴 URL）：入侧栏即开眼
            settings.network_user_sources.push(NetworkUserSource {
                id: "obra-superpowers".into(),
                label: "obra/superpowers".into(),
                url: "https://github.com/obra/superpowers".into(),
            });
            settings
                .network_popular_pinned_ids
                .push("obra-superpowers".into());
            let official_before: Vec<String> = settings
                .network_popular_pinned_ids
                .iter()
                .filter(|id| is_official_popular_sample(id))
                .cloned()
                .collect();
            assert!(!official_before.is_empty());

            // 全部闭眼：用户源 pin 一并清除，官网保留
            set_network_popular_visibility_all(&mut settings, false, Some("community")).unwrap();
            assert!(
                !settings
                    .network_popular_pinned_ids
                    .iter()
                    .any(|id| id.eq_ignore_ascii_case("obra-superpowers")),
                "user source pin must be cleared by community bulk hide"
            );
            let official_after: Vec<String> = settings
                .network_popular_pinned_ids
                .iter()
                .filter(|id| is_official_popular_sample(id))
                .cloned()
                .collect();
            assert_eq!(official_after, official_before, "official pins untouched");

        // 全部开眼：用户源 pin 回来
        set_network_popular_visibility_all(&mut settings, true, Some("community")).unwrap();
        assert!(
            settings
                .network_popular_pinned_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case("obra-superpowers")),
            "user source pin must return on community bulk show"
        );
        });
    }

    /// N=0（社区全部闭眼后）单行开眼：候选池须扩到覆盖该行，否则开眼永远不生效。
    #[test]
    fn pin_community_outside_pool_expands_candidate_limit() {
        with_temp_appdata(|| {
            use crate::network_catalog::{community_candidate_ids, ensure_network_pin_defaults};
            let dir = tempfile::tempdir().unwrap();
            let lib = dir.path().join("lib").to_string_lossy().to_string();
            ensure_library_layout(&lib).unwrap();
            let net = Path::new(&lib).join("net").to_string_lossy().to_string();
            ensure_network_layout(&net).unwrap();
            let mut settings = AppSettings {
                skills_library_root: lib,
                library_root_configured: true,
                network_library_root: net,
                network_library_configured: true,
                ..Default::default()
            };
            let _ = ensure_network_pin_defaults(&mut settings);
            // 「社区全部闭眼」只清 pin，不再清零 N（保留默认 10，头部 0/10 而非 0/0）
            let limit_before = settings.network_popular_visible_limit;
            assert!(limit_before > 0, "default limit should be positive");
            set_network_popular_visibility_all(&mut settings, false, Some("community")).unwrap();
            assert_eq!(
                settings.network_popular_visible_limit, limit_before,
                "community bulk hide must keep N"
            );
            // 模拟遗留卡死状态（旧版本闭眼清零后持久化）
            settings.network_popular_visible_limit = 0;

            // 取社区 order 中第 3 个精选源（位置 2），开眼后 N 须 ≥ 3 且它在候选池内
            let third = settings
                .network_popular_order
                .iter()
                .filter(|id| crate::network_catalog::is_community_popular_id(id))
                .nth(2)
                .cloned()
                .expect("community order has at least 3 entries");
            set_network_pin(&mut settings, "popular", &third, true).unwrap();
            assert!(
                settings.network_popular_visible_limit >= 3,
                "limit must expand to cover the pinned row, got {}",
                settings.network_popular_visible_limit
            );
            assert!(
                community_candidate_ids(&settings)
                    .iter()
                    .any(|c| c.eq_ignore_ascii_case(&third)),
                "pinned row must be inside candidate pool"
            );

            // N=0 遗留态下「全部开眼」→ 恢复默认 10 并 pin 候选
            settings.network_popular_visible_limit = 0;
            set_network_popular_visibility_all(&mut settings, true, Some("community")).unwrap();
            assert_eq!(
                settings.network_popular_visible_limit,
                crate::settings::default_network_popular_visible_limit(),
                "bulk show from N=0 must restore default N"
            );
            assert!(
                !community_candidate_ids(&settings).is_empty(),
                "candidates must be non-empty after bulk show"
            );
        });
    }

    #[test]
    fn force_remove_dir_all_removes_readonly_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("ro-cache");
        fs::create_dir_all(root.join("objects")).unwrap();
        let pack = root.join("objects").join("tmp_pack");
        fs::write(&pack, b"pack").unwrap();
        let mut perms = fs::metadata(&pack).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&pack, perms).unwrap();
        force_remove_dir_all(&root).expect("force remove readonly tree");
        assert!(!root.exists());
    }

    #[test]
    fn broken_cache_with_stale_lock_triggers_reclone() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("broken-cache");
        fs::create_dir_all(dest.join(".git")).unwrap();
        fs::write(dest.join(".git").join("shallow.lock"), b"lock").unwrap();
        // 无 index → Broken
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Broken);

        let mut saw_clone = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.iter().any(|a| *a == "clone") {
                saw_clone = true;
                let dest_s = args.last().copied().unwrap_or("");
                let d = Path::new(dest_s);
                let _ = force_remove_dir_all(d);
                fs::create_dir_all(d.join(".git")).unwrap();
                fs::write(d.join(".git").join("index"), b"idx").unwrap();
                return Ok("abc123".into());
            }
            if args.first() == Some(&"fetch") {
                panic!("Broken cache must not fetch; should reclone");
            }
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123".into());
            }
            Ok(String::new())
        };
        // git_head 对假仓会失败；只需验证走了 clone 而非 fetch
        let _ = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner);
        assert!(saw_clone, "Broken cache must trigger fresh clone");
    }

    #[test]
    fn cached_repo_state_healthy_requires_index_and_no_lock() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("repo");
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Absent);
        fs::create_dir_all(dest.join(".git")).unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Broken);
        fs::write(dest.join(".git").join("index"), b"idx").unwrap();
        fs::write(dest.join(".git").join("shallow.lock"), b"x").unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Broken);
        fs::remove_file(dest.join(".git").join("shallow.lock")).unwrap();
        fs::write(dest.join(".git").join("HEAD"), b"ref: refs/heads/main\n").unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);
    }

    #[test]
    fn is_transient_network_error_matches_ssl_and_timeout() {
        assert!(is_transient_network_error(
            "fatal: unable to access 'https://github.com/geekan/MetaGPT/': OpenSSL/3.1.2: error:0A000410:SSL routines::sslv3 alert handshake failure"
        ));
        assert!(is_transient_network_error("Could not resolve host: github.com"));
        assert!(is_transient_network_error("Failed to connect to github.com port 443: Connection refused"));
        assert!(!is_transient_network_error("Filename too long"));
        assert!(!is_transient_network_error("repository not found"));
    }

    #[test]
    fn healthy_cache_fetch_ssl_error_keeps_cache() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("healthy-cache");
        fs::create_dir_all(dest.join(".git")).unwrap();
        fs::write(dest.join(".git").join("index"), b"idx").unwrap();
        fs::write(dest.join(".git").join("HEAD"), b"ref: refs/heads/main\n").unwrap();
        fs::write(dest.join("SKILL.md"), "# keep\n").unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);

        let mut saw_clone = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.first() == Some(&"fetch") {
                return Err(
                    "fatal: unable to access 'https://example.com/repo.git/': OpenSSL/3.1.2: error:0A000410:SSL routines::sslv3 alert handshake failure"
                        .into(),
                );
            }
            if args.iter().any(|a| *a == "clone") {
                saw_clone = true;
            }
            Ok(String::new())
        };
        let err = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner)
            .unwrap_err();
        assert!(
            err.contains("已保留本地缓存"),
            "expected keep-cache message, got {err}"
        );
        assert!(!saw_clone, "network error must not reclone");
        assert!(dest.join("SKILL.md").is_file(), "cache tree must remain");
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);
    }

    #[test]
    fn healthy_cache_fetch_corrupt_still_reclones() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("corrupt-cache");
        fs::create_dir_all(dest.join(".git")).unwrap();
        fs::write(dest.join(".git").join("index"), b"idx").unwrap();
        fs::write(dest.join(".git").join("HEAD"), b"ref: refs/heads/main\n").unwrap();
        fs::write(dest.join("marker.txt"), b"old").unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);

        let mut saw_clone = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.first() == Some(&"fetch") {
                return Err("fatal: index file corrupt".into());
            }
            if args.iter().any(|a| *a == "clone") {
                saw_clone = true;
                let dest_s = args.last().copied().unwrap_or("");
                let d = Path::new(dest_s);
                let _ = force_remove_dir_all(d);
                fs::create_dir_all(d.join(".git")).unwrap();
                fs::write(d.join(".git").join("index"), b"idx").unwrap();
                fs::write(d.join(".git").join("HEAD"), b"ref: refs/heads/main\n").unwrap();
                return Ok(String::new());
            }
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123".into());
            }
            Ok(String::new())
        };
        let _ = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner);
        assert!(saw_clone, "non-network fetch error must reclone");
        assert!(!dest.join("marker.txt").is_file(), "old tree must be replaced");
    }

    #[test]
    fn parse_ls_remote_head_reads_tab_and_space() {
        assert_eq!(
            parse_ls_remote_head("abc123def\tHEAD\n"),
            Some("abc123def".into())
        );
        assert_eq!(
            parse_ls_remote_head("abc123def HEAD"),
            Some("abc123def".into())
        );
        assert_eq!(parse_ls_remote_head(""), None);
        assert_eq!(parse_ls_remote_head("   \n"), None);
    }

    fn healthy_cache_fixture(dir: &tempfile::TempDir, name: &str) -> std::path::PathBuf {
        let dest = dir.path().join(name);
        fs::create_dir_all(dest.join(".git")).unwrap();
        fs::write(dest.join(".git").join("index"), b"idx").unwrap();
        fs::write(dest.join(".git").join("HEAD"), b"ref: refs/heads/main\n").unwrap();
        fs::write(dest.join("SKILL.md"), "# keep\n").unwrap();
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);
        dest
    }

    #[test]
    fn healthy_cache_same_head_skips_fetch() {
        let dir = tempfile::tempdir().unwrap();
        let dest = healthy_cache_fixture(&dir, "same-head");
        let mut saw_fetch = false;
        let mut saw_clone = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123def".into());
            }
            if args.first() == Some(&"ls-remote") {
                return Ok("ABC123DEF\tHEAD".into());
            }
            if args.first() == Some(&"fetch") {
                saw_fetch = true;
                panic!("same HEAD must not fetch");
            }
            if args.iter().any(|a| *a == "clone") {
                saw_clone = true;
                panic!("same HEAD must not clone");
            }
            Ok(String::new())
        };
        let out = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner)
            .expect("skip should succeed");
        assert_eq!(out.fingerprint, "abc123def");
        assert!(out.skipped, "must mark skipped");
        assert!(!saw_fetch);
        assert!(!saw_clone);
        assert!(dest.join("SKILL.md").is_file());
    }

    #[test]
    fn healthy_cache_different_head_fetches() {
        let dir = tempfile::tempdir().unwrap();
        let dest = healthy_cache_fixture(&dir, "diff-head");
        let mut saw_fetch = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123def".into());
            }
            if args.first() == Some(&"ls-remote") {
                return Ok("def456aaa\tHEAD".into());
            }
            if args.first() == Some(&"fetch") {
                saw_fetch = true;
                return Ok(String::new());
            }
            Ok(String::new())
        };
        let _ = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner);
        assert!(saw_fetch, "different remote HEAD must fetch");
    }

    #[test]
    fn healthy_cache_ls_remote_ssl_keeps_cache() {
        let dir = tempfile::tempdir().unwrap();
        let dest = healthy_cache_fixture(&dir, "ls-remote-ssl");
        let mut saw_fetch = false;
        let mut saw_clone = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123def".into());
            }
            if args.first() == Some(&"ls-remote") {
                return Err(
                    "fatal: unable to access 'https://example.com/repo.git/': OpenSSL/3.1.2: error:0A000410:SSL routines::sslv3 alert handshake failure"
                        .into(),
                );
            }
            if args.first() == Some(&"fetch") {
                saw_fetch = true;
            }
            if args.iter().any(|a| *a == "clone") {
                saw_clone = true;
            }
            Ok(String::new())
        };
        let err = shallow_clone_or_update_with("https://example.com/repo.git", &dest, &mut runner)
            .unwrap_err();
        assert!(
            err.contains("已保留本地缓存"),
            "expected keep-cache message, got {err}"
        );
        assert!(!saw_fetch, "ls-remote SSL must not fetch");
        assert!(!saw_clone, "ls-remote SSL must not clone");
        assert!(dest.join("SKILL.md").is_file());
        assert_eq!(cached_repo_state(&dest), CachedRepoState::Healthy);
    }

    #[test]
    fn parse_git_version_reads_windows_and_plain() {
        assert_eq!(
            parse_git_version("git version 2.47.1.windows.1"),
            Some((2, 47))
        );
        assert_eq!(parse_git_version("git version 2.24.0"), Some((2, 24)));
        assert_eq!(parse_git_version("not git"), None);
    }

    #[test]
    fn clone_fresh_partial_records_filter_and_sparse_commands() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("repo");
        let mut cmds: Vec<String> = Vec::new();
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            cmds.push(args.join(" "));
            if args.iter().any(|a| *a == "clone") {
                let dest_s = args.last().copied().unwrap_or("");
                let d = Path::new(dest_s);
                fs::create_dir_all(d.join(".git")).unwrap();
                fs::write(d.join(".git").join("index"), b"idx").unwrap();
                let skill = d.join("pack").join("demo");
                fs::create_dir_all(&skill).unwrap();
                fs::write(skill.join("SKILL.md"), "# demo\n").unwrap();
                return Ok(String::new());
            }
            if args.first() == Some(&"rev-parse") {
                return Ok("abc123def".into());
            }
            Ok(String::new())
        };
        let head = clone_fresh_ex(
            "https://example.com/repo.git",
            &dest,
            &mut runner,
            true,
        )
        .unwrap();
        assert_eq!(head, "abc123def");
        let joined = cmds.join(" | ");
        assert!(
            joined.contains("filter=blob:none"),
            "expected partial clone flags, got {joined}"
        );
        assert!(
            joined.contains("core.longpaths=true"),
            "expected longpaths, got {joined}"
        );
        assert!(
            joined.contains("sparse-checkout init"),
            "expected sparse init, got {joined}"
        );
        assert!(
            joined.contains("**/SKILL.md"),
            "expected SKILL.md sparse pattern, got {joined}"
        );
        assert!(
            joined.contains("pack/demo"),
            "expected skill dir expand, got {joined}"
        );
    }

    #[test]
    fn clone_fresh_partial_failure_falls_back_to_full_shallow() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("repo");
        let mut saw_full = false;
        let mut runner = |args: &[&str], _cwd: Option<&Path>| -> Result<String, String> {
            if args.iter().any(|a| *a == "clone") && args.iter().any(|a| *a == "--filter=blob:none")
            {
                return Err("filter not supported".into());
            }
            if args.iter().any(|a| *a == "clone") {
                saw_full = true;
                let dest_s = args.last().copied().unwrap_or("");
                let d = Path::new(dest_s);
                fs::create_dir_all(d.join(".git")).unwrap();
                fs::write(d.join(".git").join("index"), b"idx").unwrap();
                return Ok(String::new());
            }
            if args.first() == Some(&"rev-parse") {
                return Ok("deadbeef".into());
            }
            Ok(String::new())
        };
        let head = clone_fresh_ex(
            "https://example.com/repo.git",
            &dest,
            &mut runner,
            true,
        )
        .unwrap();
        assert_eq!(head, "deadbeef");
        assert!(saw_full, "expected fallback full shallow clone");
    }

    #[test]
    fn nav_marks_needs_refetch_when_cache_dir_missing() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().join("net").to_string_lossy().to_string();
        let lib = dir.path().join("lib").to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        ensure_library_layout(&lib).unwrap();
        let mut index = NetworkIndex::default();
        index.sources.push(NetworkSourceRecord {
            id: "obra-superpowers".into(),
            label: "obra/superpowers".into(),
            url: "https://github.com/obra/superpowers".into(),
            cache_rel: "cache/obra-superpowers".into(),
            fingerprint: "abc".into(),
            last_fetched_at: String::new(),
        });
        save_network_index(&net, &index).unwrap();
        let mut settings = AppSettings {
            skills_library_root: lib,
            library_root_configured: true,
            network_library_root: net,
            network_library_configured: true,
            ..Default::default()
        };
        let _ = crate::network_catalog::ensure_network_pin_defaults(&mut settings);
        if !settings
            .network_popular_order
            .iter()
            .any(|id| id.eq_ignore_ascii_case("obra-superpowers"))
        {
            settings.network_popular_order.push("obra-superpowers".into());
        }
        if !settings
            .network_popular_pinned_ids
            .iter()
            .any(|id| id.eq_ignore_ascii_case("obra-superpowers"))
        {
            settings
                .network_popular_pinned_ids
                .push("obra-superpowers".into());
        }
        let (_, popular) = network_nav_for_snapshot(&settings);
        let node = popular
            .iter()
            .find(|n| n.id == "obra-superpowers")
            .expect("obra in nav");
        assert!(!node.has_cached_source);
        assert!(node.needs_refetch);
        assert_eq!(node.cached_count, 0);
    }
}
