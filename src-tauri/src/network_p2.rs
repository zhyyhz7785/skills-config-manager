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
    snap_pub, NetworkOpResult, SkillsShItemDto, NETWORK_CACHE_DIR,
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
    for p in POPULAR_SOURCES {
        let Some((owner, repo)) = github_owner_repo(p.url) else {
            warn.push(format!("{}: 无法解析 owner/repo", p.id));
            continue;
        };
        match run_gh_stars(&owner, &repo) {
            Ok(n) => {
                cache.stars.insert(p.id.to_string(), n);
                ok_n += 1;
            }
            Err(e) => {
                warn.push(format!("{}: {e}", p.id));
            }
        }
    }
    cache.updated_at = now_secs().to_string();
    save_heat_cache(&net_root, &cache)?;
    let msg = if warn.is_empty() {
        format!("已刷新热度 {ok_n} 项")
    } else {
        format!(
            "已刷新热度 {ok_n} 项；{} 项失败（无 gh/网络时保留旧值）",
            warn.len()
        )
    };
    Ok(NetworkOpResult {
        ok: true,
        message: msg,
        snapshot: snap_pub(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        search_items: None,
    })
}

fn run_gh_stars(owner: &str, repo: &str) -> Result<u64, String> {
    let mut cmd = Command::new("gh");
    cmd.args([
        "api",
        &format!("repos/{owner}/{repo}"),
        "--jq",
        ".stargazers_count",
    ]);
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
    s.parse::<u64>()
        .map_err(|_| format!("解析星数失败：{s}"))
}

pub fn search_skills_sh(settings: &AppSettings, q: &str) -> Result<NetworkOpResult, String> {
    let token = settings.skills_sh_api_token.trim();
    if token.is_empty() {
        return Err(
            "未配置 skills.sh API Key。请在设置中填写；当前请使用侧栏固化「GitHub 热门」清单。"
                .into(),
        );
    }
    let q = q.trim();
    if q.is_empty() {
        return Err("请输入搜索词".into());
    }
    let url = format!(
        "https://skills.sh/api/v1/search?q={}",
        urlencoding_minimal(q)
    );
    let mut cmd = Command::new("curl");
    cmd.args([
        "-sS",
        "-H",
        &format!("Authorization: Bearer {token}"),
        "-H",
        "Accept: application/json",
        &url,
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().map_err(|e| format!("无法启动 curl：{e}"))?;
    if !out.status.success() {
        return Err(format!(
            "skills.sh 请求失败：{}",
            String::from_utf8_lossy(&out.stderr).chars().take(160).collect::<String>()
        ));
    }
    let body = String::from_utf8_lossy(&out.stdout);
    if body.contains("authentication_required") {
        return Err("skills.sh 返回 401：请检查 API Key".into());
    }
    let items = parse_skills_sh_items(&body);
    Ok(NetworkOpResult {
        ok: true,
        message: format!("skills.sh 命中 {} 项（只读发现，拉取仍走 Git）", items.len()),
        snapshot: snap_pub(settings),
        conflicts: None,
        promoted: None,
        update_available: None,
        security: None,
        reapply_hints: None,
        blocked: None,
        search_items: Some(items),
    })
}

fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn parse_skills_sh_items(body: &str) -> Vec<SkillsShItemDto> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(body) else {
        return vec![];
    };
    let arr = v
        .as_array()
        .cloned()
        .or_else(|| v.get("skills").and_then(|x| x.as_array().cloned()))
        .or_else(|| v.get("results").and_then(|x| x.as_array().cloned()))
        .or_else(|| v.get("data").and_then(|x| x.as_array().cloned()))
        .unwrap_or_default();
    let mut out = Vec::new();
    for it in arr.into_iter().take(40) {
        let name = it
            .get("name")
            .or_else(|| it.get("slug"))
            .or_else(|| it.get("id"))
            .and_then(|x| x.as_str())
            .unwrap_or("skill")
            .to_string();
        let repo = it
            .get("repo")
            .or_else(|| it.get("repository"))
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let url = it
            .get("url")
            .or_else(|| it.get("html_url"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                if repo.contains('/') {
                    format!("https://github.com/{repo}")
                } else {
                    String::new()
                }
            });
        if url.is_empty() && repo.is_empty() {
            continue;
        }
        out.push(SkillsShItemDto {
            name,
            url: if url.is_empty() {
                format!("https://github.com/{repo}")
            } else {
                url
            },
            repo,
        });
    }
    out
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
                    fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
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
                    let _ = fs::remove_dir_all(&path);
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
        search_items: None,
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
}
