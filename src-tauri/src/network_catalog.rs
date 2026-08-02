//! Official Agent sources + GitHub popular catalog (Research/03) + heat cache.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::settings::AppSettings;

pub const HEAT_CACHE_FILE: &str = "heat-cache.json";

#[derive(Debug, Clone)]
pub struct OfficialAgentDef {
    pub agent_key: &'static str,
    pub display_name: &'static str,
    pub primary_repo_url: &'static str,
    pub baseline_id: Option<&'static str>,
}

#[derive(Debug, Clone)]
pub struct PopularSourceDef {
    pub id: &'static str,
    pub label: &'static str,
    pub url: &'static str,
    pub stars: u64,
    pub install_band: &'static str,
    pub sort_key: u64,
}

pub const OFFICIAL_AGENTS: &[OfficialAgentDef] = &[
    OfficialAgentDef {
        agent_key: "claude_code",
        display_name: "Claude Code",
        primary_repo_url: "https://github.com/anthropics/skills",
        baseline_id: Some("anthropics-skills"),
    },
    OfficialAgentDef {
        agent_key: "cursor",
        display_name: "Cursor",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "codex",
        display_name: "Codex",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "gemini_cli",
        display_name: "Gemini CLI",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "opencode",
        display_name: "OpenCode",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "kilo_code",
        display_name: "Kilo Code",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "roo_code",
        display_name: "Roo Code",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "goose",
        display_name: "Goose",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "github_copilot",
        display_name: "GitHub Copilot",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "droid",
        display_name: "Droid",
        primary_repo_url: "",
        baseline_id: None,
    },
    OfficialAgentDef {
        agent_key: "windsurf",
        display_name: "Windsurf",
        primary_repo_url: "",
        baseline_id: None,
    },
];

pub const DEFAULT_OFFICIAL_PINNED: &[&str] = &["claude_code", "cursor", "codex"];

pub const POPULAR_SOURCES: &[PopularSourceDef] = &[
    PopularSourceDef {
        id: "obra-superpowers",
        label: "obra/superpowers",
        url: "https://github.com/obra/superpowers",
        stars: 264_205,
        install_band: "框架",
        sort_key: 264_205,
    },
    PopularSourceDef {
        id: "mattpocock-skills",
        label: "mattpocock/skills",
        url: "https://github.com/mattpocock/skills",
        stars: 197_088,
        install_band: "~grill/TDD",
        sort_key: 197_088,
    },
    PopularSourceDef {
        id: "anthropics-skills",
        label: "anthropics/skills",
        url: "https://github.com/anthropics/skills",
        stars: 165_372,
        install_band: "官方样例",
        sort_key: 165_372,
    },
    PopularSourceDef {
        id: "addyosmani-agent-skills",
        label: "addyosmani/agent-skills",
        url: "https://github.com/addyosmani/agent-skills",
        stars: 81_083,
        install_band: "生命周期",
        sort_key: 81_083,
    },
    PopularSourceDef {
        id: "composio-awesome-claude-skills",
        label: "ComposioHQ/awesome-claude-skills",
        url: "https://github.com/ComposioHQ/awesome-claude-skills",
        stars: 71_421,
        install_band: "索引",
        sort_key: 71_421,
    },
    PopularSourceDef {
        id: "antigravity-awesome-skills",
        label: "sickn33/antigravity-awesome-skills",
        url: "https://github.com/sickn33/antigravity-awesome-skills",
        stars: 44_214,
        install_band: "合集",
        sort_key: 44_214,
    },
    PopularSourceDef {
        id: "vercel-agent-browser",
        label: "vercel-labs/agent-browser",
        url: "https://github.com/vercel-labs/agent-browser",
        stars: 39_607,
        install_band: "~0.60M 装",
        sort_key: 39_607,
    },
    PopularSourceDef {
        id: "vercel-agent-skills",
        label: "vercel-labs/agent-skills",
        url: "https://github.com/vercel-labs/agent-skills",
        stars: 29_641,
        install_band: "React/Web",
        sort_key: 29_641,
    },
    PopularSourceDef {
        id: "vercel-skills-cli",
        label: "vercel-labs/skills",
        url: "https://github.com/vercel-labs/skills",
        stars: 27_671,
        install_band: "find-skills",
        sort_key: 27_671,
    },
    PopularSourceDef {
        id: "larksuite-cli",
        label: "larksuite/cli",
        url: "https://github.com/larksuite/cli",
        stars: 16_019,
        install_band: "飞书",
        sort_key: 16_019,
    },
    PopularSourceDef {
        id: "remotion-skills",
        label: "remotion-dev/skills",
        url: "https://github.com/remotion-dev/skills",
        stars: 4_160,
        install_band: "Remotion",
        sort_key: 4_160,
    },
    PopularSourceDef {
        id: "microsoft-azure-skills",
        label: "microsoft/azure-skills",
        url: "https://github.com/microsoft/azure-skills",
        stars: 1_343,
        install_band: "高装机",
        sort_key: 1_343,
    },
];

pub const DEFAULT_POPULAR_PINNED: &[&str] = &[
    "anthropics-skills",
    "vercel-agent-skills",
    "obra-superpowers",
    "mattpocock-skills",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeatCache {
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub stars: HashMap<String, u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkNavNodeDto {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    pub pinned: bool,
    pub primary_repo_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_id: Option<String>,
    pub heat_label: String,
    pub has_default_repo: bool,
    pub cached_count: u32,
}

pub fn ensure_network_pin_defaults(settings: &mut AppSettings) -> bool {
    let mut changed = false;
    if settings.network_official_pinned_ids.is_empty() {
        settings.network_official_pinned_ids = DEFAULT_OFFICIAL_PINNED
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        changed = true;
    }
    if settings.network_popular_pinned_ids.is_empty() {
        settings.network_popular_pinned_ids = DEFAULT_POPULAR_PINNED
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        changed = true;
    }
    changed
}

pub fn resolve_agent_repo(settings: &AppSettings, agent_key: &str) -> (String, Option<String>) {
    let key = agent_key.trim();
    if let Some(url) = settings
        .network_agent_repo_overrides
        .get(key)
        .cloned()
        .filter(|u| !u.trim().is_empty())
        .or_else(|| {
            settings
                .network_agent_repo_overrides
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(key))
                .map(|(_, u)| u.clone())
                .filter(|u| !u.trim().is_empty())
        })
    {
        return (url, None);
    }
    if let Some(def) = OFFICIAL_AGENTS
        .iter()
        .find(|a| a.agent_key.eq_ignore_ascii_case(key))
    {
        return (
            def.primary_repo_url.to_string(),
            def.baseline_id.map(|s| s.to_string()),
        );
    }
    (String::new(), None)
}

pub fn source_id_for_url(url: &str) -> String {
    let u = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let last = u.rsplit('/').next().unwrap_or("repo");
    let prev = u.rsplit('/').nth(1).unwrap_or("src");
    let raw = format!("{prev}-{last}").to_ascii_lowercase();
    let mut out = String::new();
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
            out.push(c);
        } else {
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

fn format_stars(n: u64) -> String {
    if n >= 1000 {
        format!("{:.1}k", n as f64 / 1000.0)
    } else {
        n.to_string()
    }
}

pub fn load_heat_cache(network_root: &str) -> HeatCache {
    let path = Path::new(network_root.trim()).join(HEAT_CACHE_FILE);
    if !path.is_file() {
        return HeatCache::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_heat_cache(network_root: &str, cache: &HeatCache) -> Result<(), String> {
    let root = Path::new(network_root.trim());
    fs::create_dir_all(root).map_err(|e| format!("mkdir network: {e}"))?;
    let path = root.join(HEAT_CACHE_FILE);
    let raw = serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?;
    fs::write(&path, raw).map_err(|e| format!("write heat-cache: {e}"))
}

pub fn heat_for_source_id(source_id: &str, heat: Option<&HeatCache>) -> String {
    let cached = heat.and_then(|h| h.stars.get(source_id).copied());
    if let Some(p) = POPULAR_SOURCES
        .iter()
        .find(|p| p.id.eq_ignore_ascii_case(source_id))
    {
        let stars = cached.unwrap_or(p.stars);
        return format!("★{} · {}", format_stars(stars), p.install_band);
    }
    if let Some(p) = POPULAR_SOURCES
        .iter()
        .find(|p| source_id_for_url(p.url).eq_ignore_ascii_case(source_id))
    {
        let stars = cached
            .or_else(|| heat.and_then(|h| h.stars.get(p.id).copied()))
            .unwrap_or(p.stars);
        return format!("★{} · {}", format_stars(stars), p.install_band);
    }
    if let Some(n) = cached {
        return format!("★{}", format_stars(n));
    }
    "—".into()
}

pub fn build_network_nav(
    settings: &AppSettings,
    cached_counts: &HashMap<String, u32>,
    heat: Option<&HeatCache>,
) -> (Vec<NetworkNavNodeDto>, Vec<NetworkNavNodeDto>) {
    let official: Vec<NetworkNavNodeDto> = OFFICIAL_AGENTS
        .iter()
        .map(|a| {
            let (url, baseline) = resolve_agent_repo(settings, a.agent_key);
            let sid = if let Some(ref b) = baseline {
                b.clone()
            } else if !url.is_empty() {
                source_id_for_url(&url)
            } else {
                String::new()
            };
            let count = if sid.is_empty() {
                0
            } else {
                *cached_counts.get(&sid).unwrap_or(&0)
            };
            let pinned = settings
                .network_official_pinned_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case(a.agent_key));
            NetworkNavNodeDto {
                id: a.agent_key.to_string(),
                kind: "official".into(),
                display_name: a.display_name.to_string(),
                pinned,
                primary_repo_url: url.clone(),
                baseline_id: baseline,
                heat_label: if url.is_empty() {
                    "无默认官方仓".into()
                } else {
                    heat_for_source_id(&sid, heat)
                },
                has_default_repo: !url.trim().is_empty(),
                cached_count: count,
            }
        })
        .collect();

    let mut popular: Vec<NetworkNavNodeDto> = POPULAR_SOURCES
        .iter()
        .map(|p| {
            let count = *cached_counts.get(p.id).unwrap_or(&0);
            let pinned = settings
                .network_popular_pinned_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case(p.id));
            NetworkNavNodeDto {
                id: p.id.to_string(),
                kind: "popular".into(),
                display_name: p.label.to_string(),
                pinned,
                primary_repo_url: p.url.to_string(),
                baseline_id: if p.id == "anthropics-skills" || p.id == "vercel-agent-skills" {
                    Some(p.id.to_string())
                } else {
                    None
                },
                heat_label: heat_for_source_id(p.id, heat),
                has_default_repo: true,
                cached_count: count,
            }
        })
        .collect();
    popular.sort_by(|a, b| {
        let sa = POPULAR_SOURCES
            .iter()
            .find(|p| p.id == a.id)
            .map(|p| {
                heat.and_then(|h| h.stars.get(p.id).copied())
                    .unwrap_or(p.sort_key)
            })
            .unwrap_or(0);
        let sb = POPULAR_SOURCES
            .iter()
            .find(|p| p.id == b.id)
            .map(|p| {
                heat.and_then(|h| h.stars.get(p.id).copied())
                    .unwrap_or(p.sort_key)
            })
            .unwrap_or(0);
        sb.cmp(&sa)
    });

    (official, popular)
}

pub fn github_owner_repo(url: &str) -> Option<(String, String)> {
    let u = url.trim().trim_end_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = u.split('/').collect();
    if parts.len() < 2 {
        return None;
    }
    let repo = parts[parts.len() - 1].to_string();
    let owner = parts[parts.len() - 2].to_string();
    if owner.is_empty() || repo.is_empty() {
        None
    } else {
        Some((owner, repo))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_pins_and_claude_repo() {
        let mut s = AppSettings::default();
        assert!(ensure_network_pin_defaults(&mut s));
        assert!(s.network_official_pinned_ids.contains(&"claude_code".into()));
        let (url, bid) = resolve_agent_repo(&s, "claude_code");
        assert!(url.contains("anthropics/skills"));
        assert_eq!(bid.as_deref(), Some("anthropics-skills"));
    }
}
