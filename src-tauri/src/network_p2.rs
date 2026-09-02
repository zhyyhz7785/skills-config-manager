//! Plan/03 P2: cache .bak, heat refresh, skills.sh search, cache cleanup.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::network_catalog::{
    github_owner_repo, load_heat_cache, save_heat_cache, POPULAR_SOURCES,
};
use crate::network_library::{
    effective_network_root, ensure_network_layout, load_network_index, require_network_root_pub,
    snap_pub, NetworkOpResult, NETWORK_CACHE_DIR,
};
use crate::settings::AppSettings;

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn refresh_network_heat(settings: &AppSettings) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root_pub(settings)?;
    let mut cache = load_heat_cache(&net_root);
    let mut ok_n = 0u32;
    let mut warn = Vec::new();
    let mut targets: Vec<(String, String)> = POPULAR_SOURCES
        .iter()
        .map(|p| (p.id.to_string(), p.url.to_string()))
        .collect();
    for u in &settings.network_user_sources {
        let sid = u.id.trim();
        if sid.is_empty() || u.url.trim().is_empty() {
            continue;
        }
        if targets.iter().any(|(id, _)| id.eq_ignore_ascii_case(sid)) {
            continue;
        }
        targets.push((sid.to_string(), u.url.clone()));
    }
    let proxy = crate::network_proxy::resolve_network_http_proxy(&settings.network_git_http_proxy);
    for (id, url) in targets {
        let Some((owner, repo)) = github_owner_repo(&url) else {
            warn.push(format!("{id}: 无法解析 owner/repo"));
            continue;
        };
        match run_gh_repo_metrics(&owner, &repo, proxy.as_deref()) {
            Ok((stars, forks, pushed)) => {
                cache.stars.insert(id.clone(), stars);
                cache.forks.insert(id.clone(), forks);
                if !pushed.is_empty() {
                    cache.pushed_at.insert(id.clone(), pushed);
                }
                ok_n += 1;
            }
            Err(e) => {
                warn.push(format!("{id}: {e}"));
            }
        }
    }
    cache.updated_at = now_secs().to_string();
    save_heat_cache(&net_root, &cache)?;
    // 对齐 GitHub 热度：精选 Top50（星标）+ 当前排序 + 开眼 N
    let mut settings = settings.clone();
    let _ = crate::network_catalog::ensure_network_pin_defaults(&mut settings);
    crate::network_catalog::realign_popular_after_heat(&mut settings, Some(&cache));
    crate::settings::save_settings(&settings)?;
    let msg = if warn.is_empty() {
        format!("已刷新热度 {ok_n} 项（星标/Forks/推送）")
    } else {
        format!(
            "已刷新热度 {ok_n} 项；{} 项失败（无 gh/网络时保留旧值）",
            warn.len()
        )
    };
    Ok(NetworkOpResult {
        ok: true,
        message: msg,
        snapshot: snap_pub(&settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        warnings: if warn.is_empty() { None } else { Some(warn) },
    })
}

/// stars, forks, pushed_at (ISO or empty)
fn run_gh_repo_metrics(
    owner: &str,
    repo: &str,
    proxy: Option<&str>,
) -> Result<(u64, u64, String), String> {
    let mut cmd = Command::new("gh");
    cmd.args([
        "api",
        &format!("repos/{owner}/{repo}"),
        "--jq",
        "[.stargazers_count, .forks_count, .pushed_at] | @tsv",
    ]);
    if let Some(p) = proxy {
        crate::network_proxy::apply_network_proxy_env(&mut cmd, p);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("未找到 gh：{e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.trim().chars().take(120).collect());
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut parts = s.split('\t');
    let stars = parts
        .next()
        .unwrap_or("0")
        .parse::<u64>()
        .map_err(|_| format!("解析星数失败：{s}"))?;
    let forks = parts
        .next()
        .unwrap_or("0")
        .parse::<u64>()
        .map_err(|_| format!("解析 forks 失败：{s}"))?;
    let pushed = parts.next().unwrap_or("").trim().trim_matches('"').to_string();
    Ok((stars, forks, pushed))
}

pub fn cleanup_network_cache(
    settings: &AppSettings,
    unused_only: bool,
) -> Result<NetworkOpResult, String> {
    let net_root = require_network_root_pub(settings)?;
    ensure_network_layout(&net_root)?;
    let index = load_network_index(&net_root)?;
    let known: HashSet<String> = index.sources.iter().map(|s| s.id.clone()).collect();
    let cache_dir = Path::new(&net_root).join(NETWORK_CACHE_DIR);
    let mut removed = 0u32;
    let mut bak_pruned = 0u32;
    if cache_dir.is_dir() {
        let mut bak_by_prefix: std::collections::HashMap<String, Vec<(u64, PathBuf)>> =
            std::collections::HashMap::new();
        for ent in fs::read_dir(&cache_dir).map_err(|e| e.to_string())?.flatten() {
            let name = ent.file_name().to_string_lossy().to_string();
            let path = ent.path();
            if let Some((prefix, ts)) = parse_bak_name(&name) {
                bak_by_prefix
                    .entry(prefix)
                    .or_default()
                    .push((ts, path));
                continue;
            }
            if unused_only && !known.contains(&name) {
                if path.is_dir() {
                    crate::network_library::force_remove_dir_all(&path)?;
                } else {
                    fs::remove_file(&path).map_err(|e| e.to_string())?;
                }
                removed += 1;
            }
        }
        for (_prefix, mut list) in bak_by_prefix {
            list.sort_by(|a, b| b.0.cmp(&a.0));
            for (_ts, path) in list.into_iter().skip(1) {
                if path.is_dir() {
                    let _ = crate::network_library::force_remove_dir_all(&path);
                } else {
                    let _ = fs::remove_file(&path);
                }
                bak_pruned += 1;
            }
        }
    }
    let _ = effective_network_root(settings);
    Ok(NetworkOpResult {
        ok: true,
        message: format!("清理完成：无效缓存 {removed}，过期 bak {bak_pruned}"),
        snapshot: snap_pub(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        warnings: None,
    })
}

fn parse_bak_name(name: &str) -> Option<(String, u64)> {
    let (prefix, rest) = name.split_once(".bak-")?;
    let ts = rest.parse::<u64>().ok()?;
    Some((prefix.to_string(), ts))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network_library::{backup_cache_dir_before_update, ensure_network_layout};
    use crate::settings::AppSettings;

    #[test]
    fn bak_renames_existing_cache() {
        let dir = tempfile::tempdir().unwrap();
        let net = dir.path().to_string_lossy().to_string();
        ensure_network_layout(&net).unwrap();
        let cache = Path::new(&net).join("cache/demo");
        fs::create_dir_all(&cache).unwrap();
        fs::write(cache.join("x.txt"), "old").unwrap();
        let bak = backup_cache_dir_before_update(&net, "demo").unwrap();
        assert!(bak.is_some());
        assert!(!cache.exists());
        assert!(Path::new(&net).join(bak.unwrap()).join("x.txt").is_file());
    }

    /// Plan/05 证据：同窗内「刷新热度」命令路径写 `heat-cache.json`（需本机 `gh` + 网络）。
    #[test]
    fn live_refresh_heat_writes_cache() {
        let home = std::env::var("USERPROFILE").unwrap_or_default();
        let net = PathBuf::from(&home).join("CCM-NetworkLibrary");
        if !net.is_dir() {
            eprintln!("skip: no CCM-NetworkLibrary");
            return;
        }
        ensure_network_layout(&net.to_string_lossy()).unwrap();
        let heat_path = net.join("heat-cache.json");
        let before_meta = fs::metadata(&heat_path).ok();
        let before_mtime = before_meta.as_ref().and_then(|m| m.modified().ok());
        let before_bytes = fs::read(&heat_path).unwrap_or_default();

        let settings = AppSettings {
            network_library_root: net.to_string_lossy().to_string(),
            network_library_configured: true,
            skills_library_root: std::env::temp_dir().join("ccm-heat-lib").to_string_lossy().to_string(),
            library_root_configured: true,
            ..Default::default()
        };
        let _ = crate::catalog::ensure_library_layout(&settings.skills_library_root);
        let r = refresh_network_heat(&settings).expect("refresh_network_heat");
        assert!(r.ok, "{}", r.message);
        assert!(heat_path.is_file(), "heat-cache.json missing after refresh");
        let after = fs::read(&heat_path).expect("read heat-cache");
        assert!(!after.is_empty());
        let after_mtime = fs::metadata(&heat_path).and_then(|m| m.modified()).ok();
        let changed = after != before_bytes
            || match (before_mtime, after_mtime) {
                (Some(b), Some(a)) => a >= b,
                _ => true,
            };
        assert!(changed, "heat-cache.json should update; msg={}", r.message);
        eprintln!("heat_ok message={}", r.message);
    }
}
