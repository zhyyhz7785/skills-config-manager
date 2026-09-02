//! Official Agent sources + GitHub popular catalog (Research/03) + heat cache.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use crate::settings::AppSettings;

pub const HEAT_CACHE_FILE: &str = "heat-cache.json";
/// 社区精选常存上限（按星标取 TopN；官网样例与用户粘贴源不占名额）。
pub const COMMUNITY_STORE_CAP: usize = 50;
/// 兼容旧名：等同 [`COMMUNITY_STORE_CAP`]。
pub const POPULAR_STORE_CAP: usize = COMMUNITY_STORE_CAP;

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
    /// 大模型公司 / 平台 skills 官方样例（侧栏置顶段）
    pub is_official_sample: bool,
    /// 官方样例所属公司显示名（非官方为 None）
    pub official_company: Option<&'static str>,
}

const fn p(
    id: &'static str,
    label: &'static str,
    url: &'static str,
    stars: u64,
    install_band: &'static str,
    is_official_sample: bool,
    official_company: Option<&'static str>,
) -> PopularSourceDef {
    PopularSourceDef {
        id,
        label,
        url,
        stars,
        install_band,
        is_official_sample,
        official_company,
    }
}

pub fn is_official_popular_sample(id: &str) -> bool {
    POPULAR_SOURCES
        .iter()
        .any(|p| p.id.eq_ignore_ascii_case(id) && p.is_official_sample)
}

#[cfg(test)]
pub fn official_company_for(id: &str) -> Option<&'static str> {
    POPULAR_SOURCES
        .iter()
        .find(|p| p.id.eq_ignore_ascii_case(id))
        .and_then(|p| p.official_company)
}

/// 源内容类型：`skills` / `generic`。
/// 起什么作用：侧栏徽标与拉取 0 条文案分档；精选源一律按 Skill 货源。
pub fn content_type_for(source_id: &str) -> &'static str {
    let id = source_id.trim();
    if id.is_empty() {
        return "generic";
    }
    if POPULAR_SOURCES
        .iter()
        .any(|p| p.id.eq_ignore_ascii_case(id))
    {
        return "skills";
    }
    "generic"
}

/// 已从精选表退役的 id（课程/示例/无 SKILL.md 的框架仓/404/纯 Awesome 列表/合集噪音/杀软误报仓/桌面竞品管理器）。
/// 起什么作用：启动时从 pinned/order 与网络索引剔除，并清该源缓存目录，避免幽灵侧栏行与杀软反复扫网盘。
pub const RETIRED_POPULAR_IDS: &[&str] = &[
    "anthropics-courses",
    "anthropics-claude-cookbooks",
    "microsoft-generative-ai-for-beginners",
    "microsoft-azure-skills",
    "vercel-agent-browser",
    "vercel-skills-cli",
    "google-adk-samples",
    "langchain-ai-langchain",
    "run-llama-llama-index",
    "geekan-metaclaw",
    "stanfordnlp-dspy",
    "browserbase-stagehand",
    "davepoon-claude-code-skills",
    "arch3rpro-skills-manager-plus",
    "hesreallyhim-awesome-claude-code",
    "voltagent-awesome-agent-skills",
    "travisvn-awesome-claude-skills",
    "behisecc-awesome-claude-skills",
    "heilcheng-awesome-agent-skills",
    "chrlsio-agent-skills",
    "composio-awesome-claude-skills",
    "antigravity-awesome-skills",
    "joaomdmoura-crewai",
    "xingkongliang-skills-manager",
    "luongnv89-agent-skill-manager",
    "eyh0602-skillshub",
    "significant-gravitas-auto-gpt",
    "jackyst0-awesome-agent-skills",
    "larksuite-cli",
    "affaan-m-ecc",
    "alirezarezvani-claude-skills",
];

pub fn is_retired_popular_id(id: &str) -> bool {
    RETIRED_POPULAR_IDS
        .iter()
        .any(|r| r.eq_ignore_ascii_case(id.trim()))
}

/// 从 pinned / order 剔除退役官方源 id（幂等）。
pub fn prune_retired_popular_from_settings(settings: &mut AppSettings) -> bool {
    let before_pins = settings.network_popular_pinned_ids.len();
    let before_order = settings.network_popular_order.len();
    settings
        .network_popular_pinned_ids
        .retain(|id| !is_retired_popular_id(id));
    settings
        .network_popular_order
        .retain(|id| !is_retired_popular_id(id));
    settings.network_popular_pinned_ids.len() != before_pins
        || settings.network_popular_order.len() != before_order
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

/// 固化精选源仓（Research/03 + 有效 skill 包；不含 Rules 邻域 / 桌面竞品仓）。
/// 星数：2026-08-04 `gh api` 已验证为主；个别沿用调研量级。
pub const POPULAR_SOURCES: &[PopularSourceDef] = &[
    p(
        "obra-superpowers",
        "obra/superpowers",
        "https://github.com/obra/superpowers",
        265_863,
        "框架",
        false,
        None,
    ),
    p(
        "mattpocock-skills",
        "mattpocock/skills",
        "https://github.com/mattpocock/skills",
        201_965,
        "~grill/TDD",
        false,
        None,
    ),
    p(
        "anthropics-skills",
        "anthropics/skills",
        "https://github.com/anthropics/skills",
        166_089,
        "官方样例",
        true,
        Some("Anthropic"),
    ),
    p(
        "nextlevelbuilder-ui-ux-pro-max-skill",
        "nextlevelbuilder/ui-ux-pro-max-skill",
        "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
        113_163,
        "UI/UX",
        false,
        None,
    ),
    p(
        "juliusbrussee-caveman",
        "JuliusBrussee/caveman",
        "https://github.com/JuliusBrussee/caveman",
        95_589,
        "~0.39M 装",
        false,
        None,
    ),
    p(
        "addyosmani-agent-skills",
        "addyosmani/agent-skills",
        "https://github.com/addyosmani/agent-skills",
        81_504,
        "生命周期",
        false,
        None,
    ),
    p(
        "coreyhaines31-marketingskills",
        "coreyhaines31/marketingskills",
        "https://github.com/coreyhaines31/marketingskills",
        42_912,
        "营销",
        false,
        None,
    ),
    p(
        "github-awesome-copilot",
        "github/awesome-copilot",
        "https://github.com/github/awesome-copilot",
        37_410,
        "官方样例",
        true,
        Some("GitHub"),
    ),
    p(
        "vercel-agent-skills",
        "vercel-labs/agent-skills",
        "https://github.com/vercel-labs/agent-skills",
        29_728,
        "官方样例",
        true,
        Some("Vercel Labs"),
    ),
    p(
        "openai-skills",
        "openai/skills",
        "https://github.com/openai/skills",
        24_478,
        "官方样例",
        true,
        Some("OpenAI"),
    ),
    p(
        "remotion-skills",
        "remotion-dev/skills",
        "https://github.com/remotion-dev/skills",
        4_199,
        "Remotion",
        false,
        None,
    ),
    p(
        "microsoft-skills",
        "microsoft/skills",
        "https://github.com/microsoft/skills",
        2_857,
        "官方样例",
        true,
        Some("Microsoft"),
    ),
    p(
        "softaworks-agent-toolkit",
        "softaworks/agent-toolkit",
        "https://github.com/softaworks/agent-toolkit",
        2_274,
        "工具包",
        false,
        None,
    ),
    p(
        "inference-sh-skills",
        "inference-sh/skills",
        "https://github.com/inference-sh/skills",
        677,
        "生成媒体",
        false,
        None,
    ),
    p(
        "spencerpauly-awesome-cursor-skills",
        "spencerpauly/awesome-cursor-skills",
        "https://github.com/spencerpauly/awesome-cursor-skills",
        652,
        "Cursor",
        false,
        None,
    ),
    p(
        "lackeyjb-playwright-skill",
        "lackeyjb/playwright-skill",
        "https://github.com/lackeyjb/playwright-skill",
        900,
        "Playwright",
        false,
        None,
    ),
    p(
        "obra-superpowers-lab",
        "obra/superpowers-lab",
        "https://github.com/obra/superpowers-lab",
        400,
        "方法论实验",
        false,
        None,
    ),
    p(
        "get-convex-agent-skills",
        "get-convex/agent-skills",
        "https://github.com/get-convex/agent-skills",
        700,
        "Convex",
        false,
        None,
    ),
    p(
        "supabase-agent-skills",
        "supabase/agent-skills",
        "https://github.com/supabase/agent-skills",
        1_500,
        "Supabase",
        false,
        None,
    ),
    p(
        "assafelovic-gpt-researcher",
        "assafelovic/gpt-researcher",
        "https://github.com/assafelovic/gpt-researcher",
        20_000,
        "研究代理",
        false,
        None,
    ),
    // —— 社区扩容（2026-08-11；均含 SKILL.md；非官方样例）——
    p(
        "kepano-obsidian-skills",
        "kepano/obsidian-skills",
        "https://github.com/kepano/obsidian-skills",
        44_819,
        "Obsidian",
        false,
        None,
    ),
    p(
        "blader-humanizer",
        "blader/humanizer",
        "https://github.com/blader/humanizer",
        34_830,
        "去AI味",
        false,
        None,
    ),
    p(
        "k-dense-ai-scientific-agent-skills",
        "K-Dense-AI/scientific-agent-skills",
        "https://github.com/K-Dense-AI/scientific-agent-skills",
        33_190,
        "科学",
        false,
        None,
    ),
    p(
        "phuryn-pm-skills",
        "phuryn/pm-skills",
        "https://github.com/phuryn/pm-skills",
        25_141,
        "产品",
        false,
        None,
    ),
    p(
        "muratcankoylan-agent-skills-for-context-engineering",
        "muratcankoylan/Agent-Skills-for-Context-Engineering",
        "https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering",
        17_687,
        "上下文工程",
        false,
        None,
    ),
    p(
        "earthtojake-text-to-cad",
        "earthtojake/text-to-cad",
        "https://github.com/earthtojake/text-to-cad",
        13_249,
        "CAD",
        false,
        None,
    ),
    p(
        "jeffallan-claude-skills",
        "Jeffallan/claude-skills",
        "https://github.com/Jeffallan/claude-skills",
        10_961,
        "全栈",
        false,
        None,
    ),
    p(
        "nicobailon-visual-explainer",
        "nicobailon/visual-explainer",
        "https://github.com/nicobailon/visual-explainer",
        9_459,
        "可视化",
        false,
        None,
    ),
    p(
        "antfu-skills",
        "antfu/skills",
        "https://github.com/antfu/skills",
        5_746,
        "前端",
        false,
        None,
    ),
    // —— 社区补满 50（2026-08-13）：根 SKILL.md 仓复位 + 新含清单仓；不回填空/404 退役源 ——
    p(
        "multica-ai-andrej-karpathy-skills",
        "multica-ai/andrej-karpathy-skills",
        "https://github.com/multica-ai/andrej-karpathy-skills",
        201_921,
        "行为准则",
        false,
        None,
    ),
    p(
        "garrytan-gstack",
        "garrytan/gstack",
        "https://github.com/garrytan/gstack",
        127_721,
        "角色工作流",
        false,
        None,
    ),
    p(
        "vercel-labs-agent-browser",
        "vercel-labs/agent-browser",
        "https://github.com/vercel-labs/agent-browser",
        40_503,
        "浏览器",
        false,
        None,
    ),
    p(
        "op7418-guizang-ppt-skill",
        "op7418/guizang-ppt-skill",
        "https://github.com/op7418/guizang-ppt-skill",
        23_869,
        "PPT",
        false,
        None,
    ),
    p(
        "huggingface-skills",
        "huggingface/skills",
        "https://github.com/huggingface/skills",
        10_923,
        "HF",
        false,
        None,
    ),
    p(
        "open-gsd-gsd-core",
        "open-gsd/gsd-core",
        "https://github.com/open-gsd/gsd-core",
        8_133,
        "GSD",
        false,
        None,
    ),
    p(
        "kangarooking-cangjie-skill",
        "kangarooking/cangjie-skill",
        "https://github.com/kangarooking/cangjie-skill",
        7_482,
        "蒸馏",
        false,
        None,
    ),
    p(
        "trailofbits-skills",
        "trailofbits/skills",
        "https://github.com/trailofbits/skills",
        6_563,
        "安全",
        false,
        None,
    ),
    p(
        "google-gemini-gemini-skills",
        "google-gemini/gemini-skills",
        "https://github.com/google-gemini/gemini-skills",
        3_900,
        "Gemini",
        false,
        None,
    ),
    p(
        "nvidia-skills",
        "NVIDIA/skills",
        "https://github.com/NVIDIA/skills",
        2_877,
        "NVIDIA",
        false,
        None,
    ),
    p(
        "vuejs-ai-skills",
        "vuejs-ai/skills",
        "https://github.com/vuejs-ai/skills",
        2_779,
        "Vue",
        false,
        None,
    ),
    p(
        "expo-skills",
        "expo/skills",
        "https://github.com/expo/skills",
        2_403,
        "Expo",
        false,
        None,
    ),
    p(
        "aws-agent-toolkit-for-aws",
        "aws/agent-toolkit-for-aws",
        "https://github.com/aws/agent-toolkit-for-aws",
        2_324,
        "AWS",
        false,
        None,
    ),
    p(
        "onmax-nuxt-skills",
        "onmax/nuxt-skills",
        "https://github.com/onmax/nuxt-skills",
        699,
        "Nuxt",
        false,
        None,
    ),
    p(
        "vueuse-skills",
        "vueuse/skills",
        "https://github.com/vueuse/skills",
        379,
        "VueUse",
        false,
        None,
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HeatCache {
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub stars: HashMap<String, u64>,
    #[serde(default)]
    pub forks: HashMap<String, u64>,
    /// ISO-8601 `pushed_at` from GitHub (or empty).
    #[serde(default)]
    pub pushed_at: HashMap<String, String>,
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
    /// 网络索引 `sources[]` 是否已有该源且磁盘缓存健康（已拉取过，即使发现 0 条）
    pub has_cached_source: bool,
    /// 索引有该源但磁盘缓存缺失/损坏，侧栏应提示重新拉取
    #[serde(default)]
    pub needs_refetch: bool,
    /// 精选源是否为官方样例（侧栏分段 / 星标）；与 baseline_id（拉取基线）正交
    pub is_official_sample: bool,
    /// 官方样例所属公司（分层标题）；非官方为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub official_company: Option<String>,
    /// skills | courses | cookbooks | generic
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_type: Option<String>,
    /// 是否落在社区候选池前 N（官网/用户源恒为 false）
    pub in_candidate_pool: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NetworkPinDefaultsResult {
    pub changed: bool,
    pub popular_defaults_applied: bool,
}

/// Mark popular pin state as user-owned (bulk hide / single pin / persisted choice).
pub fn mark_network_popular_pins_initialized(settings: &mut AppSettings) {
    settings.network_popular_pins_initialized = true;
}

fn infer_network_popular_pins_initialized(settings: &mut AppSettings) -> bool {
    if settings.network_popular_pins_initialized {
        return true;
    }
    if !settings.network_popular_pinned_ids.is_empty() {
        settings.network_popular_pins_initialized = true;
        return true;
    }
    // Order persisted while pins empty ⇒ explicit bulk-hide (not first-run unset).
    if !settings.network_popular_order.is_empty() {
        settings.network_popular_pins_initialized = true;
        return true;
    }
    false
}

pub fn ensure_network_pin_defaults(settings: &mut AppSettings) -> NetworkPinDefaultsResult {
    let mut changed = false;
    let mut popular_defaults_applied = false;
    if prune_retired_popular_from_settings(settings) {
        changed = true;
    }
    if settings.network_official_pinned_ids.is_empty() {
        settings.network_official_pinned_ids = DEFAULT_OFFICIAL_PINNED
            .iter()
            .map(|s| (*s).to_string())
            .collect();
        changed = true;
    }
    let popular_initialized = infer_network_popular_pins_initialized(settings);
    // 扩容：新精选 id 未入 order → 先追加；随后社区按星标截断 Top50（不自动开眼）。
    for p in POPULAR_SOURCES {
        let in_order = settings
            .network_popular_order
            .iter()
            .any(|id| id.eq_ignore_ascii_case(p.id));
        if !in_order {
            settings.network_popular_order.push(p.id.to_string());
            changed = true;
        }
    }
    if sync_popular_store_cap(settings, None) {
        changed = true;
    }
    // 热门：首次未配置 → 按默认 N 开眼社区候选前 N（不覆盖官网/用户策略）。
    if !popular_initialized && settings.network_popular_pinned_ids.is_empty() {
        clamp_settings_visible_limit(settings);
        settings.network_popular_pinned_ids = community_candidate_ids(settings);
        mark_network_popular_pins_initialized(settings);
        popular_defaults_applied = true;
        changed = true;
    }
    let sort = settings.network_popular_sort.trim().to_ascii_lowercase();
    if sort.is_empty()
        || !matches!(
            sort.as_str(),
            "stars" | "stars-asc" | "updated" | "updated-asc" | "forks" | "forks-asc" | "custom"
        )
    {
        settings.network_popular_sort = "stars".into();
        changed = true;
    }
    NetworkPinDefaultsResult {
        changed,
        popular_defaults_applied,
    }
}

/// 社区源 id（`POPULAR_SOURCES` 中非官方样例）。
pub fn community_source_ids() -> Vec<&'static str> {
    POPULAR_SOURCES
        .iter()
        .filter(|p| !p.is_official_sample)
        .map(|p| p.id)
        .collect()
}

/// 官网样例 id（`is_official_sample == true`）。
pub fn official_web_source_ids() -> Vec<&'static str> {
    POPULAR_SOURCES
        .iter()
        .filter(|p| p.is_official_sample)
        .map(|p| p.id)
        .collect()
}

pub fn is_community_popular_id(id: &str) -> bool {
    POPULAR_SOURCES
        .iter()
        .any(|p| p.id.eq_ignore_ascii_case(id) && !p.is_official_sample)
}

/// 社区候选池 = 当前社区 order 前 N 项（含开眼+闭眼；排除官网与用户源）。
pub fn community_candidate_ids(settings: &AppSettings) -> Vec<String> {
    let n = settings.network_popular_visible_limit as usize;
    settings
        .network_popular_order
        .iter()
        .filter(|id| is_community_popular_id(id))
        .take(n)
        .cloned()
        .collect()
}

/// 单行开眼 / 拖入主列表的社区源若在候选池外，扩 N 恰好把它纳入：
/// 用户对单行的显式「显示」意图优先于池上限（否则 N=0 时开眼永远不生效）。
pub fn ensure_community_candidate(settings: &mut AppSettings, id: &str) {
    if !is_community_popular_id(id) {
        return;
    }
    let Some(pos) = settings
        .network_popular_order
        .iter()
        .filter(|x| is_community_popular_id(x))
        .position(|x| x.eq_ignore_ascii_case(id))
    else {
        return;
    };
    let needed = (pos + 1) as u32;
    if settings.network_popular_visible_limit < needed {
        let community_len = community_len_in_order(settings);
        settings.network_popular_visible_limit =
            clamp_popular_visible_limit(needed, community_len);
    }
}

pub fn community_len_in_order(settings: &AppSettings) -> usize {
    settings
        .network_popular_order
        .iter()
        .filter(|id| is_community_popular_id(id))
        .count()
}

/// 钳制社区候选池 N：`0..=min(community_len, COMMUNITY_STORE_CAP)`。
pub fn clamp_popular_visible_limit(n: u32, community_len: usize) -> u32 {
    let max = community_len.min(POPULAR_STORE_CAP) as u32;
    n.min(max)
}

pub fn clamp_settings_visible_limit(settings: &mut AppSettings) {
    let community_len = community_len_in_order(settings);
    settings.network_popular_visible_limit =
        clamp_popular_visible_limit(settings.network_popular_visible_limit, community_len);
}

/// 整理 order、钳制 N、标记已初始化；**不**用前 N 覆盖 `network_popular_pinned_ids`。
#[cfg(test)]
pub fn apply_popular_visible_limit(settings: &mut AppSettings) {
    let pool = popular_pool_ids(settings);
    for id in &pool {
        if !settings
            .network_popular_order
            .iter()
            .any(|x| x.eq_ignore_ascii_case(id))
        {
            settings.network_popular_order.push(id.clone());
        }
    }
    let ordered: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for id in &settings.network_popular_order {
            if pool.iter().any(|p| p.eq_ignore_ascii_case(id))
                && seen.insert(id.to_ascii_lowercase())
            {
                out.push(id.clone());
            }
        }
        for id in &pool {
            if seen.insert(id.to_ascii_lowercase()) {
                out.push(id.clone());
            }
        }
        out
    };
    settings.network_popular_order = ordered;
    clamp_settings_visible_limit(settings);
    mark_network_popular_pins_initialized(settings);
}

fn community_store_ids_by_stars(heat: Option<&HeatCache>) -> Vec<String> {
    let mut community: Vec<String> = POPULAR_SOURCES
        .iter()
        .filter(|p| !p.is_official_sample)
        .map(|p| p.id.to_string())
        .collect();
    community.sort_by(|a, b| {
        let (pa, sa) = popular_metric(a, "stars", heat);
        let (pb, sb) = popular_metric(b, "stars", heat);
        cmp_popular_metric((pa, sa), (pb, sb), false).then_with(|| a.cmp(b))
    });
    community.truncate(COMMUNITY_STORE_CAP);
    community
}

fn collect_user_tail(settings: &AppSettings) -> Vec<String> {
    let mut user_tail: Vec<String> = Vec::new();
    let mut seen_user = std::collections::HashSet::new();
    for id in &settings.network_popular_order {
        if is_curated_popular_id(id) {
            continue;
        }
        if settings
            .network_user_sources
            .iter()
            .any(|u| u.id.eq_ignore_ascii_case(id))
            && seen_user.insert(id.to_ascii_lowercase())
        {
            user_tail.push(id.clone());
        }
    }
    for u in &settings.network_user_sources {
        let id = u.id.trim();
        if id.is_empty() {
            continue;
        }
        if seen_user.insert(id.to_ascii_lowercase()) {
            user_tail.push(id.to_string());
        }
    }
    user_tail
}

/// 社区按星标截断至 [`COMMUNITY_STORE_CAP`]；官网 5 始终保留；用户源附末尾。
/// `custom` 保序过滤成员，不按星标重建。跌出社区 50 的精选 id 才可从 pinned 去掉。
pub fn sync_popular_store_cap(settings: &mut AppSettings, heat: Option<&HeatCache>) -> bool {
    let community = community_store_ids_by_stars(heat);
    let community_set: HashSet<String> = community.iter().map(|s| s.to_ascii_lowercase()).collect();
    let official: Vec<String> = official_web_source_ids()
        .into_iter()
        .map(|s| s.to_string())
        .collect();
    let official_set: HashSet<String> = official.iter().map(|s| s.to_ascii_lowercase()).collect();
    let user_tail = collect_user_tail(settings);
    let user_set: HashSet<String> = user_tail.iter().map(|s| s.to_ascii_lowercase()).collect();

    let member_ok = |id: &str| -> bool {
        let k = id.to_ascii_lowercase();
        official_set.contains(&k) || community_set.contains(&k) || user_set.contains(&k)
    };

    let mode = normalize_popular_sort(&settings.network_popular_sort);
    let new_order = if mode == "custom" {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for id in &settings.network_popular_order {
            if member_ok(id) && seen.insert(id.to_ascii_lowercase()) {
                out.push(id.clone());
            }
        }
        for id in official
            .iter()
            .chain(community.iter())
            .chain(user_tail.iter())
        {
            if seen.insert(id.to_ascii_lowercase()) {
                out.push(id.clone());
            }
        }
        out
    } else {
        // 非 custom：官网段在前（具体公司聚类交给 apply_popular_sort_mode），社区按星截断，用户尾。
        let mut out = official;
        out.extend(community);
        out.extend(user_tail);
        out
    };

    // 仅当社区精选跌出 Top50 时去掉其 pin；超出候选 N 的 pin 保留；官网/用户 pin 保留。
    let user_id_set: HashSet<String> = settings
        .network_user_sources
        .iter()
        .map(|u| u.id.to_ascii_lowercase())
        .collect();
    let before_pins = settings.network_popular_pinned_ids.clone();
    settings.network_popular_pinned_ids.retain(|id| {
        if is_official_popular_sample(id) || user_id_set.contains(&id.to_ascii_lowercase()) {
            return true;
        }
        if is_community_popular_id(id) {
            return community_set.contains(&id.to_ascii_lowercase());
        }
        // 未知 id：若仍在 order 成员集合中则保留
        member_ok(id)
    });

    let order_changed = new_order != settings.network_popular_order;
    let pins_changed = before_pins != settings.network_popular_pinned_ids;
    settings.network_popular_order = new_order;
    order_changed || pins_changed
}

/// 热度/检查更新后：同步社区 cap +（非 custom）重排；只钳制 N，不覆盖 pinned。
pub fn realign_popular_after_heat(settings: &mut AppSettings, heat: Option<&HeatCache>) {
    let _ = sync_popular_store_cap(settings, heat);
    let mode = normalize_popular_sort(&settings.network_popular_sort);
    if mode != "custom" {
        apply_popular_sort_mode(settings, heat);
    }
    clamp_settings_visible_limit(settings);
}

pub fn is_curated_popular_id(id: &str) -> bool {
    POPULAR_SOURCES
        .iter()
        .any(|p| p.id.eq_ignore_ascii_case(id))
}

/// 官网 ∪ 社区精选（order 内）∪ 用户源。
pub fn popular_pool_ids(settings: &AppSettings) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut seen = HashSet::new();
    let mut community_n = 0usize;
    for id in &settings.network_popular_order {
        if is_official_popular_sample(id) {
            if seen.insert(id.to_ascii_lowercase()) {
                ids.push(id.clone());
            }
            continue;
        }
        if is_community_popular_id(id) {
            if community_n >= COMMUNITY_STORE_CAP {
                continue;
            }
            if seen.insert(id.to_ascii_lowercase()) {
                ids.push(id.clone());
                community_n += 1;
            }
        }
    }
    if ids.is_empty() {
        for id in official_web_source_ids() {
            ids.push(id.to_string());
        }
        for id in community_source_ids().into_iter().take(COMMUNITY_STORE_CAP) {
            ids.push(id.to_string());
        }
    }
    for u in &settings.network_user_sources {
        let id = u.id.trim();
        if id.is_empty() {
            continue;
        }
        if seen.insert(id.to_ascii_lowercase()) {
            ids.push(id.to_string());
        }
    }
    ids
}

/// ASCII 大小写不敏感剥离尾部 `.git`，再小写化。
pub fn normalize_git_url_key(url: &str) -> String {
    let mut s = url.trim().trim_end_matches('/').to_ascii_lowercase();
    while s.ends_with('/') {
        s.pop();
    }
    if s.ends_with(".git") {
        s.truncate(s.len() - 4);
        while s.ends_with('/') {
            s.pop();
        }
    }
    s
}

/// 拉取成功后：非精选 Git URL upsert 进用户源并开眼。
pub fn persist_user_source_after_fetch(
    settings: &mut AppSettings,
    source_id: &str,
    label: &str,
    url: &str,
) -> bool {
    let sid = source_id.trim();
    let url = url.trim();
    if sid.is_empty() || url.is_empty() {
        return false;
    }
    // 精选仓不进用户表
    if POPULAR_SOURCES.iter().any(|p| {
        p.id.eq_ignore_ascii_case(sid) || normalize_git_url_key(p.url) == normalize_git_url_key(url)
    }) {
        return false;
    }
    let lab = {
        let t = label.trim();
        if t.is_empty() {
            sid.to_string()
        } else {
            t.to_string()
        }
    };
    let mut changed = false;
    if let Some(existing) = settings
        .network_user_sources
        .iter_mut()
        .find(|u| u.id.eq_ignore_ascii_case(sid) || normalize_git_url_key(&u.url) == normalize_git_url_key(url))
    {
        if existing.id != sid {
            existing.id = sid.to_string();
            changed = true;
        }
        if existing.label != lab {
            existing.label = lab;
            changed = true;
        }
        if existing.url != url {
            existing.url = url.to_string();
            changed = true;
        }
    } else {
        settings.network_user_sources.push(crate::settings::NetworkUserSource {
            id: sid.to_string(),
            label: lab,
            url: url.to_string(),
        });
        changed = true;
    }
    if !settings
        .network_popular_order
        .iter()
        .any(|id| id.eq_ignore_ascii_case(sid))
    {
        settings.network_popular_order.push(sid.to_string());
        changed = true;
    }
    if !settings
        .network_popular_pinned_ids
        .iter()
        .any(|id| id.eq_ignore_ascii_case(sid))
    {
        settings.network_popular_pinned_ids.push(sid.to_string());
        changed = true;
    }
    changed
}

/// Normalize sort mode string.
pub fn normalize_popular_sort(raw: &str) -> &'static str {
    match raw.trim().to_ascii_lowercase().as_str() {
        "updated" | "pushed" | "recent" => "updated",
        "updated-asc" | "updated_asc" | "oldest" | "least-updated" => "updated-asc",
        "forks" | "fork" => "forks",
        "forks-asc" | "forks_asc" | "fewest-forks" => "forks-asc",
        "stars-asc" | "stars_asc" | "fewest-stars" => "stars-asc",
        "custom" | "manual" => "custom",
        _ => "stars",
    }
}

/// 拆出（基础指标, 是否升序）：对齐 GitHub 排序（Most/Fewest stars、Recently/Least recently updated）。
fn popular_sort_base(mode: &str) -> (&str, bool) {
    match mode.strip_suffix("-asc") {
        Some(base) => (base, true),
        None => (mode, false),
    }
}

fn popular_metric(id: &str, mode: &str, heat: Option<&HeatCache>) -> (Option<u64>, u64) {
    let def = POPULAR_SOURCES.iter().find(|p| p.id.eq_ignore_ascii_case(id));
    let stars = heat
        .and_then(|h| h.stars.get(id).copied())
        .or_else(|| {
            heat.and_then(|h| {
                h.stars
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(id))
                    .map(|(_, v)| *v)
            })
        })
        .or_else(|| def.map(|p| p.stars));
    let forks = heat
        .and_then(|h| h.forks.get(id).copied())
        .or_else(|| {
            heat.and_then(|h| {
                h.forks
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(id))
                    .map(|(_, v)| *v)
            })
        });
    let pushed_rank = heat
        .and_then(|h| {
            h.pushed_at.get(id).or_else(|| {
                h.pushed_at
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(id))
                    .map(|(_, v)| v)
            })
        })
        .and_then(|s| {
            let r = pushed_at_rank(s);
            if r == 0 {
                None
            } else {
                Some(r)
            }
        });
    // 次指标：stars 未知时用 0 作 tie-break（不影响「未知主指标恒排尾」）
    let stars_sec = stars.unwrap_or(0);
    let forks_sec = forks.unwrap_or(0);
    match popular_sort_base(mode).0 {
        "updated" => (pushed_rank, stars_sec),
        "forks" => (forks, stars_sec),
        _ => (stars, forks_sec),
    }
}

/// 主指标未知（None）恒排段尾（升降序相同）；有值则按方向比较；次指标恒降序。
fn cmp_popular_metric(ma: (Option<u64>, u64), mb: (Option<u64>, u64), asc: bool) -> std::cmp::Ordering {
    let primary = match (ma.0, mb.0) {
        (None, None) => std::cmp::Ordering::Equal,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (Some(_), None) => std::cmp::Ordering::Less,
        (Some(va), Some(vb)) => {
            if asc {
                va.cmp(&vb)
            } else {
                vb.cmp(&va)
            }
        }
    };
    primary.then_with(|| mb.1.cmp(&ma.1))
}

/// Lexicographic ISO timestamps work for GitHub `pushed_at`; empty → 0.
fn pushed_at_rank(s: &str) -> u64 {
    let t = s.trim();
    if t.is_empty() {
        return 0;
    }
    // Prefer packing YYYYMMDDhhmmss from ISO prefix for stable u64 compare.
    let digits: String = t.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    digits.parse::<u64>().unwrap_or(0)
}

/// Reorder `network_popular_order` by GitHub metric. No-op for `custom`。
/// 只改 order，不改写 `network_popular_pinned_ids`。
pub fn apply_popular_sort_mode(settings: &mut AppSettings, heat: Option<&HeatCache>) {
    let mode = normalize_popular_sort(&settings.network_popular_sort);
    settings.network_popular_sort = mode.to_string();
    if mode == "custom" {
        return;
    }
    let mut official: Vec<String> = settings
        .network_popular_order
        .iter()
        .filter(|id| is_official_popular_sample(id))
        .cloned()
        .collect();
    for id in official_web_source_ids() {
        if !official.iter().any(|x| x.eq_ignore_ascii_case(id)) {
            official.push(id.to_string());
        }
    }
    let mut community: Vec<String> = settings
        .network_popular_order
        .iter()
        .filter(|id| is_community_popular_id(id))
        .cloned()
        .collect();
    community.truncate(COMMUNITY_STORE_CAP);
    // 升序（GitHub Fewest/Least 变体）时反转主指标；未知主指标恒排段尾。
    let asc = popular_sort_base(mode).1;
    let cmp_metric = |ma: (Option<u64>, u64), mb: (Option<u64>, u64)| cmp_popular_metric(ma, mb, asc);
    // 官方段单层：直接按 metric 排（每家仅保留一个 skills 主仓）
    official.sort_by(|a, b| {
        let ma = popular_metric(a, mode, heat);
        let mb = popular_metric(b, mode, heat);
        cmp_metric(ma, mb).then_with(|| a.cmp(b))
    });
    community.sort_by(|a, b| {
        let ma = popular_metric(a, mode, heat);
        let mb = popular_metric(b, mode, heat);
        cmp_metric(ma, mb).then_with(|| a.cmp(b))
    });
    let mut users: Vec<String> = settings
        .network_popular_order
        .iter()
        .filter(|id| !is_curated_popular_id(id))
        .cloned()
        .collect();
    for u in &settings.network_user_sources {
        let id = u.id.trim();
        if id.is_empty() {
            continue;
        }
        if !users.iter().any(|x| x.eq_ignore_ascii_case(id)) {
            users.push(id.to_string());
        }
    }
    users.sort_by(|a, b| {
        let ma = popular_metric(a, mode, heat);
        let mb = popular_metric(b, mode, heat);
        cmp_metric(ma, mb).then_with(|| a.cmp(b))
    });
    let mut ids = official;
    ids.extend(community);
    ids.extend(users);
    settings.network_popular_order = ids;
}

pub fn resolve_agent_repo(settings: &AppSettings, agent_key: &str) -> (String, Option<String>) {
    let key = agent_key.trim();
    let _ = settings;
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
    let u = normalize_git_url_key(url);
    let last = u.rsplit('/').next().unwrap_or("repo");
    let prev = u.rsplit('/').nth(1).unwrap_or("src");
    let raw = format!("{prev}-{last}");
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

fn source_id_in_cache(cached_source_ids: &HashSet<String>, id: &str, url: &str) -> bool {
    if id.is_empty() {
        return false;
    }
    if cached_source_ids
        .iter()
        .any(|k| k.eq_ignore_ascii_case(id))
    {
        return true;
    }
    if url.trim().is_empty() {
        return false;
    }
    let slug = source_id_for_url(url);
    cached_source_ids
        .iter()
        .any(|k| k.eq_ignore_ascii_case(&slug))
}

#[cfg(test)]
pub fn build_network_nav(
    settings: &AppSettings,
    cached_counts: &HashMap<String, u32>,
    cached_source_ids: &HashSet<String>,
    heat: Option<&HeatCache>,
) -> (Vec<NetworkNavNodeDto>, Vec<NetworkNavNodeDto>) {
    build_network_nav_ex(
        settings,
        cached_counts,
        cached_source_ids,
        &HashSet::new(),
        heat,
    )
}

pub fn build_network_nav_ex(
    settings: &AppSettings,
    cached_counts: &HashMap<String, u32>,
    cached_source_ids: &HashSet<String>,
    stale_source_ids: &HashSet<String>,
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
                has_cached_source: source_id_in_cache(cached_source_ids, &sid, &url),
                needs_refetch: source_id_in_cache(stale_source_ids, &sid, &url),
                is_official_sample: !url.trim().is_empty(),
                official_company: None,
                content_type: Some(content_type_for(&sid).to_string()),
                in_candidate_pool: false,
            }
        })
        .collect();
    let mut official = official;
    sort_network_nav(
        &mut official,
        &settings.network_official_pinned_ids,
        &settings.network_official_order,
        |id| {
            OFFICIAL_AGENTS
                .iter()
                .position(|a| a.agent_key == id)
                .unwrap_or(usize::MAX)
        },
    );

    let store_ids = popular_pool_ids(settings);
    let candidate_set: HashSet<String> = community_candidate_ids(settings)
        .into_iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    let mut popular: Vec<NetworkNavNodeDto> = POPULAR_SOURCES
        .iter()
        .filter(|p| {
            store_ids
                .iter()
                .any(|id| id.eq_ignore_ascii_case(p.id))
        })
        .map(|p| {
            // 双查：精选 id 与 URL slug（兼容旧索引未迁移前的 source_id）
            let count = cached_counts
                .get(p.id)
                .copied()
                .or_else(|| cached_counts.get(&source_id_for_url(p.url)).copied())
                .unwrap_or(0);
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
                has_cached_source: source_id_in_cache(cached_source_ids, p.id, p.url),
                needs_refetch: source_id_in_cache(stale_source_ids, p.id, p.url),
                is_official_sample: p.is_official_sample,
                official_company: p.official_company.map(|s| s.to_string()),
                content_type: Some(content_type_for(p.id).to_string()),
                in_candidate_pool: !p.is_official_sample
                    && candidate_set.contains(&p.id.to_ascii_lowercase()),
            }
        })
        .collect();
    for u in &settings.network_user_sources {
        let sid = u.id.trim();
        if sid.is_empty() {
            continue;
        }
        if popular.iter().any(|n| n.id.eq_ignore_ascii_case(sid)) {
            continue;
        }
        if POPULAR_SOURCES.iter().any(|p| {
            normalize_git_url_key(p.url) == normalize_git_url_key(&u.url)
        }) {
            continue;
        }
        let count = cached_counts
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(sid))
            .map(|(_, v)| *v)
            .unwrap_or(0);
        let pinned = settings
            .network_popular_pinned_ids
            .iter()
            .any(|id| id.eq_ignore_ascii_case(sid));
        let display = if u.label.trim().is_empty() {
            sid.to_string()
        } else {
            u.label.trim().to_string()
        };
        popular.push(NetworkNavNodeDto {
            id: sid.to_string(),
            kind: "user".into(),
            display_name: display,
            pinned,
            primary_repo_url: u.url.clone(),
            baseline_id: None,
            heat_label: heat_for_source_id(sid, heat),
            has_default_repo: !u.url.trim().is_empty(),
            cached_count: count,
            has_cached_source: source_id_in_cache(cached_source_ids, sid, &u.url),
            needs_refetch: source_id_in_cache(stale_source_ids, sid, &u.url),
            is_official_sample: false,
            official_company: None,
            content_type: Some(content_type_for(sid).to_string()),
            in_candidate_pool: false,
        });
    }
    let mode = normalize_popular_sort(&settings.network_popular_sort);
    if mode == "custom" {
        sort_network_nav(
            &mut popular,
            &settings.network_popular_pinned_ids,
            &settings.network_popular_order,
            |id| {
                popular_pool_ids(settings)
                    .iter()
                    .position(|p| p == id)
                    .unwrap_or(usize::MAX)
            },
        );
    } else {
        // Eye-open first; official → metric; community → metric.
        // 展示排序：降序；未知主指标恒排段尾（与 apply_popular_sort_mode 一致）。
        popular.sort_by(|a, b| {
            let pin_a = if a.pinned { 0u8 } else { 1 };
            let pin_b = if b.pinned { 0u8 } else { 1 };
            let off_a = if a.is_official_sample { 0u8 } else { 1 };
            let off_b = if b.is_official_sample { 0u8 } else { 1 };
            pin_a
                .cmp(&pin_b)
                .then_with(|| off_a.cmp(&off_b))
                .then_with(|| {
                    let ma = popular_metric(&a.id, mode, heat);
                    let mb = popular_metric(&b.id, mode, heat);
                    cmp_popular_metric(ma, mb, false)
                })
                .then_with(|| a.id.cmp(&b.id))
        });
    }

    (official, popular)
}

fn sort_network_nav(
    nodes: &mut [NetworkNavNodeDto],
    pinned: &[String],
    order: &[String],
    fallback: impl Fn(&str) -> usize,
) {
    nodes.sort_by(|a, b| {
        let rank = |id: &str, is_pinned: bool| -> (u8, usize) {
            if is_pinned {
                if let Some(i) = pinned.iter().position(|x| x.eq_ignore_ascii_case(id)) {
                    return (0, i);
                }
                return (0, usize::MAX);
            }
            if let Some(i) = order.iter().position(|x| x.eq_ignore_ascii_case(id)) {
                return (1, i);
            }
            (1, 10_000 + fallback(id))
        };
        rank(&a.id, a.pinned).cmp(&rank(&b.id, b.pinned))
    });
}

pub fn github_owner_repo(url: &str) -> Option<(String, String)> {
    let u = normalize_git_url_key(url);
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
        let result = ensure_network_pin_defaults(&mut s);
        assert!(result.changed);
        assert!(result.popular_defaults_applied);
        assert!(s.network_official_pinned_ids.contains(&"claude_code".into()));
        assert_eq!(
            s.network_popular_pinned_ids.len() as u32,
            s.network_popular_visible_limit
        );
        assert_eq!(s.network_popular_visible_limit, 10);
        assert!(s.network_popular_pins_initialized);
        assert_eq!(
            s.network_popular_order
                .iter()
                .filter(|id| is_curated_popular_id(id))
                .count(),
            POPULAR_SOURCES.len()
        );
        assert_eq!(normalize_popular_sort(&s.network_popular_sort), "stars");
        let (url, bid) = resolve_agent_repo(&s, "claude_code");
        assert!(url.contains("anthropics/skills"));
        assert_eq!(bid.as_deref(), Some("anthropics-skills"));
    }

    #[test]
    fn explicit_empty_with_order_not_refilled() {
        let mut s = AppSettings::default();
        s.network_popular_order = POPULAR_SOURCES.iter().map(|p| p.id.to_string()).collect();
        s.network_popular_pinned_ids.clear();
        assert!(!s.network_popular_pins_initialized);
        let result = ensure_network_pin_defaults(&mut s);
        assert!(!result.popular_defaults_applied);
        assert!(s.network_popular_pinned_ids.is_empty());
        assert!(s.network_popular_pins_initialized);
    }

    #[test]
    fn bulk_hide_then_single_pin_stays_one() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_pinned_ids.clear();
        mark_network_popular_pins_initialized(&mut s);
        let _ = ensure_network_pin_defaults(&mut s);
        assert!(s.network_popular_pinned_ids.is_empty());
        s.network_popular_pinned_ids
            .retain(|x| !x.eq_ignore_ascii_case("obra-superpowers"));
        s.network_popular_pinned_ids.push("obra-superpowers".into());
        assert_eq!(s.network_popular_pinned_ids.len(), 1);
    }

    #[test]
    fn pin_migration_appends_new_without_auto_pin() {
        let mut s = AppSettings::default();
        s.network_popular_pinned_ids = vec!["obra-superpowers".into()];
        s.network_popular_order = vec!["obra-superpowers".into()];
        s.network_popular_pins_initialized = true;
        s.network_popular_visible_limit = 1;
        assert!(ensure_network_pin_defaults(&mut s).changed);
        assert!(s
            .network_popular_order
            .iter()
            .any(|id| id == "travisvn-awesome-claude-skills" || is_curated_popular_id(id)));
        // 扩容只进 order，不自动开眼
        assert_eq!(s.network_popular_pinned_ids, vec!["obra-superpowers".to_string()]);
        // 已全部入 order、仅开一眼：再次 ensure 不得强行开眼其余项
        let mut s2 = AppSettings::default();
        s2.network_popular_order = POPULAR_SOURCES.iter().map(|p| p.id.to_string()).collect();
        s2.network_popular_pinned_ids = vec!["obra-superpowers".into()];
        s2.network_popular_pins_initialized = true;
        s2.network_popular_visible_limit = 1;
        let before = s2.network_popular_pinned_ids.clone();
        let _ = ensure_network_pin_defaults(&mut s2);
        assert_eq!(s2.network_popular_pinned_ids, before);
    }

    #[test]
    fn expansion_while_all_hidden_appends_order_not_pin() {
        let mut s = AppSettings::default();
        // 模拟全关眼 + order 缺最后一个精选源（版本扩容）
        let last = POPULAR_SOURCES.last().expect("sources");
        s.network_popular_order = POPULAR_SOURCES
            .iter()
            .filter(|p| p.id != last.id)
            .map(|p| p.id.to_string())
            .collect();
        s.network_popular_pinned_ids.clear();
        s.network_popular_pins_initialized = true;
        let result = ensure_network_pin_defaults(&mut s);
        assert!(result.changed);
        assert!(!result.popular_defaults_applied);
        assert!(s.network_popular_pinned_ids.is_empty());
        assert!(s
            .network_popular_order
            .iter()
            .any(|id| id.eq_ignore_ascii_case(last.id)));
    }

    #[test]
    fn user_sources_merge_into_nav() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_user_sources.push(crate::settings::NetworkUserSource {
            id: "acme-my-skills".into(),
            label: "acme/my-skills".into(),
            url: "https://github.com/acme/my-skills".into(),
        });
        s.network_popular_pinned_ids.push("acme-my-skills".into());
        let (_official, popular) = build_network_nav(&s, &HashMap::new(), &HashSet::new(), None);
        let u = popular
            .iter()
            .find(|n| n.id == "acme-my-skills")
            .expect("user source in nav");
        assert_eq!(u.kind, "user");
        assert!(u.baseline_id.is_none());
        assert!(u.pinned);
    }

    #[test]
    fn persist_user_source_skips_curated() {
        let mut s = AppSettings::default();
        assert!(!persist_user_source_after_fetch(
            &mut s,
            "anthropics-skills",
            "anthropics/skills",
            "https://github.com/anthropics/skills",
        ));
        assert!(s.network_user_sources.is_empty());
        assert!(persist_user_source_after_fetch(
            &mut s,
            "acme-pack",
            "acme/pack",
            "https://github.com/acme/pack",
        ));
        assert_eq!(s.network_user_sources.len(), 1);
        assert!(s
            .network_popular_pinned_ids
            .iter()
            .any(|id| id == "acme-pack"));
    }

    #[test]
    fn popular_sort_by_forks_orders_desc() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        let pins_before = s.network_popular_pinned_ids.clone();
        s.network_popular_sort = "forks".into();
        let mut heat = HeatCache::default();
        heat.forks.insert("anthropics-skills".into(), 10);
        heat.forks.insert("obra-superpowers".into(), 999);
        apply_popular_sort_mode(&mut s, Some(&heat));
        apply_popular_visible_limit(&mut s);
        // 官方段优先：社区高 forks 不能压过官方段
        assert_eq!(
            s.network_popular_order.first().map(|x| x.as_str()),
            Some("anthropics-skills")
        );
        // sort / limit 不得覆盖 pinned
        assert_eq!(s.network_popular_pinned_ids, pins_before);
        let (official, popular) = build_network_nav(&s, &HashMap::new(), &HashSet::new(), Some(&heat));
        assert!(!official.is_empty());
        assert_eq!(
            popular.iter().filter(|n| n.pinned).count(),
            pins_before.len()
        );
        assert!(POPULAR_SOURCES.len() <= 5 + COMMUNITY_STORE_CAP);
        assert_eq!(
            POPULAR_SOURCES.iter().filter(|p| p.is_official_sample).count(),
            5
        );
    }

    #[test]
    fn popular_sort_stars_asc_orders_community_ascending() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_sort = "stars-asc".into();
        let mut heat = HeatCache::default();
        heat.stars.insert("anthropics-skills".into(), 10);
        heat.stars.insert("obra-superpowers".into(), 999);
        apply_popular_sort_mode(&mut s, Some(&heat));
        // 官方段仍在最前
        assert_eq!(
            s.network_popular_order.first().map(|x| x.as_str()),
            Some("anthropics-skills")
        );
        // 社区段内：星少的排在星多的前面
        let i_low = s
            .network_popular_order
            .iter()
            .position(|x| {
                is_community_popular_id(x)
                    && popular_metric(x, "stars", Some(&heat))
                        .0
                        .is_some_and(|v| v < 999)
            })
            .unwrap();
        let i_high = s
            .network_popular_order
            .iter()
            .position(|x| x == "obra-superpowers")
            .unwrap();
        assert!(i_low < i_high, "ascending: low-star community before obra-superpowers");
        // 非法值仍回落 stars
        assert_eq!(normalize_popular_sort("stars-asc"), "stars-asc");
        assert_eq!(normalize_popular_sort("oldest"), "updated-asc");
        assert_eq!(normalize_popular_sort("bogus"), "stars");
    }

    #[test]
    fn popular_sort_unknown_metric_always_last() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        // forks-asc：无 forks 数据的社区源不得置顶
        s.network_popular_sort = "forks-asc".into();
        let mut heat = HeatCache::default();
        heat.forks.insert("obra-superpowers".into(), 5);
        heat.forks.insert("anthropics-skills".into(), 1);
        apply_popular_sort_mode(&mut s, Some(&heat));
        let community: Vec<&str> = s
            .network_popular_order
            .iter()
            .filter(|id| is_community_popular_id(id))
            .map(|s| s.as_str())
            .collect();
        assert!(
            !community.is_empty(),
            "community segment must be non-empty"
        );
        assert_eq!(
            community.first().copied(),
            Some("obra-superpowers"),
            "known low forks first under forks-asc, unknown must not lead: {community:?}"
        );
        let i_known = community
            .iter()
            .position(|x| *x == "obra-superpowers")
            .unwrap();
        let i_unknown = community
            .iter()
            .position(|x| popular_metric(x, "forks", Some(&heat)).0.is_none())
            .expect("at least one community without forks heat");
        assert!(
            i_known < i_unknown,
            "unknown forks must trail known: known={i_known} unknown={i_unknown} {community:?}"
        );

        // updated-asc：缺 pushed_at 的源排段尾
        s.network_popular_sort = "updated-asc".into();
        heat.pushed_at
            .insert("obra-superpowers".into(), "2020-01-01T00:00:00Z".into());
        heat.pushed_at
            .insert("anthropics-skills".into(), "2024-01-01T00:00:00Z".into());
        apply_popular_sort_mode(&mut s, Some(&heat));
        let community2: Vec<&str> = s
            .network_popular_order
            .iter()
            .filter(|id| is_community_popular_id(id))
            .map(|s| s.as_str())
            .collect();
        assert_eq!(
            community2.first().copied(),
            Some("obra-superpowers"),
            "oldest known update first; unknown must not lead: {community2:?}"
        );
        let i_known2 = community2
            .iter()
            .position(|x| *x == "obra-superpowers")
            .unwrap();
        let i_unknown2 = community2
            .iter()
            .position(|x| popular_metric(x, "updated", Some(&heat)).0.is_none())
            .expect("at least one community without pushed_at");
        assert!(
            i_known2 < i_unknown2,
            "unknown pushed_at must trail known: {community2:?}"
        );
    }

    #[test]
    fn official_samples_sort_before_community() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_sort = "stars".into();
        let mut heat = HeatCache::default();
        for p in POPULAR_SOURCES {
            heat.stars.insert(p.id.to_string(), p.stars);
        }
        // 社区最高星仍应排在全部官方之后
        heat.stars.insert("obra-superpowers".into(), 9_999_999);
        apply_popular_sort_mode(&mut s, Some(&heat));
        let curated: Vec<&str> = s
            .network_popular_order
            .iter()
            .filter(|id| is_curated_popular_id(id))
            .map(|x| x.as_str())
            .collect();
        let first_community = curated
            .iter()
            .position(|id| !is_official_popular_sample(id))
            .expect("community");
        assert!(first_community > 0);
        assert!(curated[..first_community]
            .iter()
            .all(|id| is_official_popular_sample(id)));
        assert!(!is_official_popular_sample(curated[first_community]));
        // 官方段内：高星在前
        assert_eq!(curated[0], "anthropics-skills");
        let (_, popular) = build_network_nav(&s, &HashMap::new(), &HashSet::new(), Some(&heat));
        let anth = popular
            .iter()
            .find(|n| n.id == "anthropics-skills")
            .expect("anth");
        assert!(anth.is_official_sample);
        assert!(anth.heat_label.contains("官方样例"));
        let obra = popular
            .iter()
            .find(|n| n.id == "obra-superpowers")
            .expect("obra");
        assert!(!obra.is_official_sample);
        assert!(!obra.heat_label.contains("官方样例"));
        let official_n = POPULAR_SOURCES
            .iter()
            .filter(|p| p.is_official_sample)
            .count();
        assert_eq!(official_n, 5);
    }

    #[test]
    fn official_heat_band_is_unified() {
        for p in POPULAR_SOURCES.iter().filter(|p| p.is_official_sample) {
            assert_eq!(p.install_band, "官方样例", "{}", p.id);
            assert!(p.official_company.is_some(), "{}", p.id);
            let label = heat_for_source_id(p.id, None);
            assert!(
                label.contains("官方样例"),
                "{} => {}",
                p.id,
                label
            );
        }
        for p in POPULAR_SOURCES.iter().filter(|p| !p.is_official_sample) {
            assert!(p.official_company.is_none(), "{}", p.id);
        }
    }

    #[test]
    fn official_sources_sorted_by_metric_single_layer() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_sort = "stars".into();
        let mut heat = HeatCache::default();
        for p in POPULAR_SOURCES {
            heat.stars.insert(p.id.to_string(), p.stars);
        }
        apply_popular_sort_mode(&mut s, Some(&heat));
        let official: Vec<&str> = s
            .network_popular_order
            .iter()
            .filter(|id| is_official_popular_sample(id))
            .map(|x| x.as_str())
            .collect();
        assert_eq!(official.len(), 5);
        // 每家公司仅一行
        let mut companies = std::collections::HashSet::new();
        for id in &official {
            let c = official_company_for(id).expect("company");
            assert!(
                companies.insert(c),
                "company {c} appears more than once in official segment"
            );
        }
        // Anthropic skills 星最高 → 官方段首位
        assert_eq!(official[0], "anthropics-skills");
        let (_, popular) = build_network_nav(&s, &HashMap::new(), &HashSet::new(), Some(&heat));
        let anth = popular
            .iter()
            .find(|n| n.id == "anthropics-skills")
            .expect("anth");
        assert_eq!(anth.official_company.as_deref(), Some("Anthropic"));
        let obra = popular
            .iter()
            .find(|n| n.id == "obra-superpowers")
            .expect("obra");
        assert!(obra.official_company.is_none());
    }

    #[test]
    fn visible_limit_opens_top_n_by_order() {
        // 首次默认才开眼社区前 N；其后改 limit / apply 不重写 pins
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        assert_eq!(s.network_popular_pinned_ids.len(), 10);
        assert_eq!(
            s.network_popular_pinned_ids,
            community_candidate_ids(&s)
        );
        let pins = s.network_popular_pinned_ids.clone();
        s.network_popular_visible_limit = 3;
        apply_popular_visible_limit(&mut s);
        assert_eq!(s.network_popular_visible_limit, 3);
        assert_eq!(s.network_popular_pinned_ids, pins);
    }

    #[test]
    fn store_cap_keeps_top_stars_and_user_tail() {
        let mut s = AppSettings::default();
        s.network_popular_order = POPULAR_SOURCES.iter().map(|p| p.id.to_string()).collect();
        s.network_user_sources.push(crate::settings::NetworkUserSource {
            id: "acme-extra".into(),
            label: "acme/extra".into(),
            url: "https://github.com/acme/extra".into(),
        });
        s.network_popular_order.push("acme-extra".into());
        let mut heat = HeatCache::default();
        for p in POPULAR_SOURCES {
            heat.stars.insert(p.id.to_string(), p.stars);
        }
        assert!(sync_popular_store_cap(&mut s, Some(&heat)));
        let official_n = s
            .network_popular_order
            .iter()
            .filter(|id| is_official_popular_sample(id))
            .count();
        let community_n = s
            .network_popular_order
            .iter()
            .filter(|id| is_community_popular_id(id))
            .count();
        assert_eq!(official_n, 5);
        assert!(community_n <= COMMUNITY_STORE_CAP);
        assert!(s
            .network_popular_order
            .iter()
            .any(|id| id == "acme-extra"));
    }

    #[test]
    fn sort_then_limit_reopens_top_n() {
        // 新语义：sort / limit 不改 pins；仅首次默认开眼前 N
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        let pins_before = s.network_popular_pinned_ids.clone();
        s.network_popular_visible_limit = 2;
        let mut heat = HeatCache::default();
        heat.stars.insert("anthropics-skills".into(), 9_999_999);
        heat.stars.insert("obra-superpowers".into(), 1);
        apply_popular_sort_mode(&mut s, Some(&heat));
        apply_popular_visible_limit(&mut s);
        assert_eq!(s.network_popular_visible_limit, 2);
        assert_eq!(s.network_popular_pinned_ids, pins_before);
        assert_eq!(
            s.network_popular_order.first().map(|x| x.as_str()),
            Some("anthropics-skills")
        );
    }

    #[test]
    fn official_count_is_five_community_under_cap() {
        let official_n = POPULAR_SOURCES
            .iter()
            .filter(|p| p.is_official_sample)
            .count();
        let community_n = POPULAR_SOURCES
            .iter()
            .filter(|p| !p.is_official_sample)
            .count();
        assert_eq!(official_n, 5);
        assert!(community_n > 0);
        assert!(community_n <= COMMUNITY_STORE_CAP);
        assert_eq!(POPULAR_SOURCES.len(), official_n + community_n);
        assert_eq!(official_web_source_ids().len(), 5);
        assert_eq!(community_source_ids().len(), community_n);
        let expected_official: [(&str, &str); 5] = [
            ("anthropics-skills", "https://github.com/anthropics/skills"),
            (
                "github-awesome-copilot",
                "https://github.com/github/awesome-copilot",
            ),
            (
                "vercel-agent-skills",
                "https://github.com/vercel-labs/agent-skills",
            ),
            ("openai-skills", "https://github.com/openai/skills"),
            ("microsoft-skills", "https://github.com/microsoft/skills"),
        ];
        for (id, url) in expected_official {
            let p = POPULAR_SOURCES.iter().find(|x| x.id == id).expect(id);
            assert!(p.is_official_sample, "{id}");
            assert_eq!(p.url, url, "{id}");
        }
        assert_eq!(
            official_web_source_ids(),
            expected_official.map(|(id, _)| id).to_vec()
        );
        // 退役源不得再出现在精选表
        for id in crate::network_catalog::RETIRED_POPULAR_IDS {
            assert!(
                !POPULAR_SOURCES.iter().any(|p| p.id.eq_ignore_ascii_case(id)),
                "retired {id} still in POPULAR_SOURCES"
            );
        }
        for id in [
            "kepano-obsidian-skills",
            "blader-humanizer",
            "k-dense-ai-scientific-agent-skills",
            "phuryn-pm-skills",
            "muratcankoylan-agent-skills-for-context-engineering",
            "earthtojake-text-to-cad",
            "jeffallan-claude-skills",
            "nicobailon-visual-explainer",
            "antfu-skills",
            "garrytan-gstack",
            "op7418-guizang-ppt-skill",
            "kangarooking-cangjie-skill",
            "huggingface-skills",
            "vercel-labs-agent-browser",
        ] {
            let p = POPULAR_SOURCES.iter().find(|x| x.id == id).expect(id);
            assert!(!p.is_official_sample, "{id}");
            assert!(p.official_company.is_none(), "{id}");
        }
        assert!(
            !crate::network_catalog::is_retired_popular_id("blader-humanizer"),
            "root-SKILL.md 仓不得退役"
        );
        assert!(
            !crate::network_catalog::is_retired_popular_id("op7418-guizang-ppt-skill"),
            "root-SKILL.md 仓不得退役"
        );
        assert!(
            !crate::network_catalog::is_retired_popular_id("kangarooking-cangjie-skill"),
            "root-SKILL.md 仓不得退役"
        );
        assert!(
            crate::network_catalog::is_retired_popular_id("vercel-agent-browser"),
            "旧官网 id vercel-agent-browser 仍退役；社区用 vercel-labs-agent-browser"
        );
        for id in [
            "composio-awesome-claude-skills",
            "antigravity-awesome-skills",
            "joaomdmoura-crewai",
            "xingkongliang-skills-manager",
            "luongnv89-agent-skill-manager",
            "eyh0602-skillshub",
            "significant-gravitas-auto-gpt",
            "jackyst0-awesome-agent-skills",
            "larksuite-cli",
            "affaan-m-ecc",
            "alirezarezvani-claude-skills",
        ] {
            assert!(
                crate::network_catalog::is_retired_popular_id(id),
                "{id} 须在 RETIRED_POPULAR_IDS"
            );
            assert!(
                !POPULAR_SOURCES.iter().any(|p| p.id.eq_ignore_ascii_case(id)),
                "{id} 不得再出现在 POPULAR_SOURCES"
            );
        }
    }

    #[test]
    fn custom_order_survives_sync_cap() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_sort = "custom".into();
        // 故意把社区低星源排到前面
        let mut custom = vec![
            "antfu-skills".to_string(),
            "obra-superpowers".to_string(),
            "anthropics-skills".to_string(),
        ];
        for id in &s.network_popular_order {
            if !custom.iter().any(|x| x.eq_ignore_ascii_case(id)) {
                custom.push(id.clone());
            }
        }
        s.network_popular_order = custom.clone();
        let pins = s.network_popular_pinned_ids.clone();
        let mut heat = HeatCache::default();
        for p in POPULAR_SOURCES {
            heat.stars.insert(p.id.to_string(), p.stars);
        }
        let _ = sync_popular_store_cap(&mut s, Some(&heat));
        // custom：前缀保序（仍在成员集合内的 id）
        assert_eq!(s.network_popular_order[0], "antfu-skills");
        assert_eq!(s.network_popular_order[1], "obra-superpowers");
        assert_eq!(s.network_popular_order[2], "anthropics-skills");
        assert_eq!(s.network_popular_pinned_ids, pins);
    }

    #[test]
    fn visible_limit_does_not_rewrite_pins() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        s.network_popular_pinned_ids = vec!["obra-superpowers".into(), "antfu-skills".into()];
        mark_network_popular_pins_initialized(&mut s);
        s.network_popular_visible_limit = 5;
        apply_popular_visible_limit(&mut s);
        assert_eq!(
            s.network_popular_pinned_ids,
            vec!["obra-superpowers".to_string(), "antfu-skills".to_string()]
        );
        assert_eq!(s.network_popular_visible_limit, 5);
        realign_popular_after_heat(&mut s, None);
        assert_eq!(
            s.network_popular_pinned_ids,
            vec!["obra-superpowers".to_string(), "antfu-skills".to_string()]
        );
    }

    #[test]
    fn source_id_strips_git_suffix_case_insensitive() {
        assert_eq!(
            source_id_for_url("https://github.com/Acme/Pack.GIT"),
            "acme-pack"
        );
        assert_eq!(
            normalize_git_url_key("https://github.com/Acme/Pack.GIT"),
            normalize_git_url_key("https://github.com/acme/pack")
        );
        assert_eq!(
            source_id_for_url("https://github.com/foo/bar.git"),
            "foo-bar"
        );
    }

    #[test]
    fn popular_cached_count_falls_back_to_url_slug() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        // 保证 vercel 精选在侧栏池内
        if !s
            .network_popular_order
            .iter()
            .any(|id| id.eq_ignore_ascii_case("vercel-agent-skills"))
        {
            s.network_popular_order.push("vercel-agent-skills".into());
        }
        let slug = source_id_for_url("https://github.com/vercel-labs/agent-skills");
        assert_eq!(slug, "vercel-labs-agent-skills");
        let mut counts = HashMap::new();
        counts.insert(slug, 7u32);
        let (_, popular) = build_network_nav(&s, &counts, &HashSet::new(), None);
        let node = popular
            .iter()
            .find(|n| n.id == "vercel-agent-skills")
            .expect("vercel-agent-skills in nav");
        assert_eq!(node.cached_count, 7);
        // 表内 id 优先
        counts.insert("vercel-agent-skills".into(), 3);
        let (_, popular2) = build_network_nav(&s, &counts, &HashSet::new(), None);
        let node2 = popular2
            .iter()
            .find(|n| n.id == "vercel-agent-skills")
            .unwrap();
        assert_eq!(node2.cached_count, 3);
    }

    #[test]
    fn popular_has_cached_source_from_index_ids() {
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        if !s
            .network_popular_order
            .iter()
            .any(|id| id.eq_ignore_ascii_case("microsoft-skills"))
        {
            s.network_popular_order.push("microsoft-skills".into());
        }
        let mut ids = HashSet::new();
        ids.insert("microsoft-skills".into());
        let (_, popular) = build_network_nav(&s, &HashMap::new(), &ids, None);
        let node = popular
            .iter()
            .find(|n| n.id == "microsoft-skills")
            .expect("microsoft-skills in nav");
        assert!(node.has_cached_source);
        assert_eq!(node.cached_count, 0);
        let untouched = popular
            .iter()
            .find(|n| n.id == "anthropics-skills")
            .expect("anth");
        assert!(!untouched.has_cached_source);
    }

    #[test]
    fn content_type_for_skills_and_generic() {
        assert_eq!(content_type_for("anthropics-skills"), "skills");
        assert_eq!(content_type_for("anthropics-courses"), "generic");
        assert_eq!(content_type_for("obra-superpowers"), "skills");
        assert_eq!(content_type_for("acme-custom-paste"), "generic");
        let mut s = AppSettings::default();
        let _ = ensure_network_pin_defaults(&mut s);
        let (_, popular) = build_network_nav(&s, &HashMap::new(), &HashSet::new(), None);
        assert!(popular.iter().all(|n| n.id != "anthropics-courses"));
        let skills = popular
            .iter()
            .find(|n| n.id == "anthropics-skills")
            .expect("skills");
        assert_eq!(skills.content_type.as_deref(), Some("skills"));
        assert_eq!(official_web_source_ids().len(), 5);
    }

    #[test]
    fn prune_retired_ids_from_settings() {
        let mut s = AppSettings::default();
        s.network_popular_order = vec![
            "anthropics-skills".into(),
            "anthropics-courses".into(),
            "obra-superpowers".into(),
        ];
        s.network_popular_pinned_ids = vec![
            "anthropics-courses".into(),
            "microsoft-azure-skills".into(),
        ];
        assert!(prune_retired_popular_from_settings(&mut s));
        assert!(!s
            .network_popular_order
            .iter()
            .any(|id| is_retired_popular_id(id)));
        assert!(!s
            .network_popular_pinned_ids
            .iter()
            .any(|id| is_retired_popular_id(id)));
        assert!(s
            .network_popular_order
            .iter()
            .any(|id| id == "anthropics-skills"));
    }
}
