# GitHub 热门 Agent Skills 与相关软件调研

> 调研日期：2026-07-31  
> 目标形态：生态全景（内容包 / 索引 / CLI / 桌面管理 / 市场 / SaaS）  
> 一句话目标：摸清 GitHub 与 skills.sh 上最热的 `SKILL.md` 包与周边软件各类型头部，供选装与 CCM（CursorConfigManager，本机配置资产管理器）对标。

## 总论

**结论（已验证检索 + 推断）**：2026 年 Agent Skills（给 AI 编程代理按需加载的专用说明包，核心是目录内 `SKILL.md`）已从「少数仓库」膨胀为「开放包生态」——GitHub 星数最高的是**方法论框架**与**个人/官方技能包**，安装量最高的是**发现类 meta-skill** 与**一作框架最佳实践**；周边软件上，`npx skills` + [skills.sh](https://skills.sh/) 是装机分发主通道，桌面「多工具同步管理」仍是小众赛道（见 [02](02-CCM竞品与产品定位-2026-07-31.md)）。星数与安装量**不是同一信号**：大仓 ≠ 最常装的单个 skill。

**数据口径（已验证）**：仓库 ★/fork/`pushed_at` 来自 2026-07-31 `gh api`；单 skill 安装量来自 [skills-rank.com](https://skills-rank.com/) 与 [skills.sh](https://skills.sh/) 公开榜（第三方汇总，可能与官方仪表盘有偏差，标 **待验证** 精确到个位）。

## 0. 目标与约束

**结论（假设）**：本报告是**生态盘点**，不是另起一款产品立项；产品定义仍以 02 为准。

- 核心功能：按类型列出「最热 skills 文件包」与「相关软件」，覆盖内容/索引/安装/管理/邻域
- 目标用户：要挑装技能、或做 CCM 差异化的开发者（假设）
- 平台形态：GitHub 开源为主；附 Web 市场、CLI、桌面、SaaS
- 关键约束：只记公开可核数据；不编造未查到的价格/日活
- 成功标准：读者能分清「该 clone 哪个仓 / 该 `npx skills add` 哪个 skill / 哪类软件管装机」
- 五维权重（评「生态位价值」）：功能 20% / 易用 20% / 可靠安全 25% / 稳定 15% / 差异化 20%（合计 100%；生态盘点偏安全与差异）

## 1. 竞品与标的清单（按类型）

**结论（已验证）**：可分成六类——① 官方/大 V 技能包；② 巨型合集；③ Awesome 索引；④ 单 skill 安装榜头部；⑤ 安装与市场基础设施；⑥ 本机/云管理软件。Rules（`.mdc` 规则）是邻域，不是 Skills。

### 1.1 官方与头部技能包（GitHub ★）

| 名称 | 形态 | ★（已验证） | 活跃度 | 链接 | 一句话定位 |
|---|---|---:|---|---|---|
| **obra/superpowers** | 方法论 + 可组合 skills | **264,205** | 2026-07-28 push | [GitHub](https://github.com/obra/superpowers) | SDLC（Software Development Life Cycle，软件开发生命周期）全流程强制技能框架（TDD/调试/计划/子代理） |
| **mattpocock/skills** | 个人工程技能包 | **197,088** | 2026-07-29 | [GitHub](https://github.com/mattpocock/skills) | grill-me / TDD / triage / handoff 等；skills.sh 多席霸榜 |
| **anthropics/skills** | 官方演示技能 | **165,372** | 2026-07-24 | [GitHub](https://github.com/anthropics/skills) | Anthropic 公开 Agent Skills 样例（含 frontend-design、文档类 pptx/xlsx 等） |
| **addyosmani/agent-skills** | 跨 Agent 生命周期包 | **81,083** | 2026-07-26 | [GitHub](https://github.com/addyosmani/agent-skills) | ~24 个带门禁的工程技能；站点 skills.addy.ie |
| **ComposioHQ/awesome-claude-skills** | 精选列表 + 大量技能 | **71,421** | 2026-07-24 | [GitHub](https://github.com/ComposioHQ/awesome-claude-skills) | 千级 Claude/多 Agent 技能与插件索引（含 Composio 集成） |
| **sickn33/antigravity-awesome-skills** | 巨型可安装合集 | **44,214** | 2026-07-31 | [GitHub](https://github.com/sickn33/antigravity-awesome-skills) | 自称 950+ 通用 agentic skills，多工具一键装 |
| **PatrickJS/awesome-cursorrules** | Rules 索引（邻域） | **40,475** | 2026-05-30 | [GitHub](https://github.com/PatrickJS/awesome-cursorrules) | Cursor Rules 最全社区列表（非 SKILL.md） |
| **vercel-labs/agent-browser** | CLI + skill | **39,607** | 2026-07-31 | [GitHub](https://github.com/vercel-labs/agent-browser) | 代理用浏览器自动化（CDP）；安装榜常驻前五 |
| **vercel-labs/agent-skills** | 一作框架技能 | **29,641** | 2026-07-24 | [GitHub](https://github.com/vercel-labs/agent-skills) | React/Web 设计与性能最佳实践包 |
| **vercel-labs/skills** | Skills CLI 本体 | **27,671** | 2026-07-31 | [GitHub](https://github.com/vercel-labs/skills) | `npx skills` 包管理器；含 find-skills |
| **larksuite/cli** | 企业 SaaS CLI + skills | **16,019** | 2026-07-31 | [GitHub](https://github.com/larksuite/cli) | 飞书开放能力；多条 lark-* skill 批量上榜 |
| **travisvn/awesome-claude-skills** | Awesome 列表 | **14,437** | 2026-04-28 | [GitHub](https://github.com/travisvn/awesome-claude-skills) | Claude Code 向精选资源 |
| **heilcheng/awesome-agent-skills** | Awesome + 站点 | **6,041** | 2026-04-05 | [GitHub](https://github.com/heilcheng/awesome-agent-skills) | 跨平台索引；链到 SkillsMP / skills.sh |
| **remotion-dev/skills** | 垂直框架技能 | **4,160** | 2026-07-31 | [GitHub](https://github.com/remotion-dev/skills) | Remotion（用 React 做程序化视频）官方最佳实践 |
| **xingkongliang/skills-manager** | 桌面管理软件 | **3,425** | 2026-07-14 | [GitHub](https://github.com/xingkongliang/skills-manager) | 中央库 + 15+ 工具同步（CCM 直接竞品） |
| **microsoft/azure-skills** | 云厂商技能包 | **1,343** | 2026-07-30 | [GitHub](https://github.com/microsoft/azure-skills) | ★ 不高但 Azure 系 skill **安装量极高**（捆绑效应） |
| **spencerpauly/awesome-cursor-skills** | Cursor 向 Awesome | **639** | 2026-04-28 | [GitHub](https://github.com/spencerpauly/awesome-cursor-skills) | Cursor Skills 精选入口 |
| **JackyST0/awesome-agent-skills** | 中英 Awesome | **608** | 2026-07-27 | [GitHub](https://github.com/JackyST0/awesome-agent-skills) | 多平台路径表 + 在线检索页 |

### 1.2 skills.sh / 排行榜：单 skill 安装量 Top（类型覆盖）

**结论（已验证榜单结构；数值待验证到个位）**：榜首长期被「找技能 / 反 AI 丑 UI / 拷问式澄清 / 浏览器 / React 规范」占据；其后是**厂商捆绑包**（Microsoft Azure、飞书 Lark）用多 skill 冲总量。

| 类型 | 代表 skill | 来源仓 | 安装量量级 | 作用 |
|---|---|---|---|---|
| 发现 / Meta | `find-skills` | vercel-labs/skills | ~2.7M | 教代理去搜、装其他 skill |
| 前端审美 | `frontend-design` | anthropics/skills | ~0.72M | 避免通用「AI 丑界面」 |
| 需求澄清 | `grill-me` / `grill-with-docs` | mattpocock/skills | ~0.70M / ~0.59M | 编码前穷尽拷问计划 |
| 浏览器自动化 | `agent-browser` | vercel-labs/agent-browser | ~0.60M | CDP 驱动页面操作 |
| React/Next 性能 | `vercel-react-best-practices` | vercel-labs/agent-skills | ~0.59M | 一作性能规则 |
| 架构重构 | `improve-codebase-architecture` | mattpocock/skills | ~0.57M | 深模块/可测性 RFC |
| TDD | `tdd` | mattpocock/skills | ~0.55M | 行为级测试哲学 |
| Web 规范审计 | `web-design-guidelines` | vercel-labs/agent-skills | ~0.50M | 对照 Web Interface Guidelines |
| 云平台（捆绑） | `microsoft-foundry` 及 azure-* 一串 | microsoft/azure-skills | 各 ~0.49M | 部署/诊断/存储等全生命周期 |
| 协作 SaaS | `lark-*`（doc/im/drive/…） | larksuite/cli | 各 ~0.39M+ | 飞书文档/日历/任务等 |
| 视频工程 | `remotion-best-practices` | remotion-dev/skills | ~0.45M | Remotion 领域知识 |
| 生成媒体 | `ai-video-generation` 等 | 101-skills/skills | ~0.46M | 经 inference.sh CLI 调模型 |
| 风格人格 | `caveman` | juliusbrussee/caveman | ~0.39M | 极简口语回复风格 |
| 工程方法论子集 | `using-superpowers` / `brainstorming` / `systematic-debugging` 等 | obra/superpowers | 榜中下部常见 | 框架内单点技能 |

来源：[skills-rank.com](https://skills-rank.com/)（2026-07-31 抓取）、[skills.sh](https://skills.sh/) Leaderboard、[Skillselion 评述 2026-07-29](https://dev.to/skillselion/the-entire-claude-code-skills-top-10-belongs-to-three-authors-anthropic-holds-one-slot-27jc)。

### 1.3 相关软件（非「技能正文」本体）

| 名称 | 形态 | 商业模式 | 开源? | 链接 | 一句话定位 |
|---|---|---|---|---|---|
| **vercel-labs/skills** + skills.sh | CLI + Web 排行榜 | 免费（Vercel 生态） | 是 | [skills](https://github.com/vercel-labs/skills) / [skills.sh](https://skills.sh/) | 跨 40+ Agent 的 skill 包管理与发现 |
| **SkillsMP** | Web 市场 | 免费浏览（推断） | 索引层 | [skillsmp.com](https://skillsmp.com) | 按 GitHub 自动索引 Skill 项目 |
| **agentskills.io** | 规范站点 | 标准文档 | 开放规范 | [agentskills.io](https://agentskills.io) | Agent Skills 跨平台标准说明 |
| **Skills Manager** | 桌面 + CLI | 免费/捐赠 | MIT | [xingkongliang/skills-manager](https://github.com/xingkongliang/skills-manager) | 本机中央库 + 多工具同步 + 市场 |
| **Praxl** | SaaS + CLI + 自托管 | Free / Pro $5/月 | AGPL 自托管 | [praxl.app](https://praxl.app/) | 云端技能中枢、版本史、AI 审阅 |
| **SkillManager / Manage My Skills 等** | 桌面 | 免费开源 | 不一 | 见 02 | 矩阵视图或扫描同步类 |
| **Claude Code / Cursor / Codex…** | Agent 宿主 | 订阅制商业 | 宿主闭源；skills 开放 | 各官网 | **消费** skills 的运行时，不是技能仓 |

## 2. 五维度分析（生态位，非整款「该做软件」打分）

**结论（推断）**：内容侧，**方法论完整度**（superpowers）与**可安装实用度**（mattpocock / Vercel / Anthropic）分流；基础设施侧，skills CLI 垄断「装」；管理侧桌面产品 ★ 远低于内容仓——机会仍在「可信台账」而非再做一个合集。

### 汇总对比（对「使用者价值」加权）

| 标的 | 功能 | 易用 | 可靠安全 | 稳定 | 差异化 | 加权 | 总评（含证据级别） |
|---|---:|---:|---:|---:|---:|---:|---|
| obra/superpowers | 5 | 3 | 4 | 4 | 5 | **4.20** | 星数顶；改变整段开发流程（已验证★；体感待验证） |
| mattpocock/skills | 5 | 4 | 4 | 4 | 5 | **4.40** | 安装榜多席；工程澄清类最强（已验证榜+★） |
| anthropics/skills | 4 | 4 | 5 | 4 | 4 | **4.25** | 官方信任锚 + frontend-design（已验证） |
| vercel-labs/skills(+sh) | 5 | 5 | 3 | 4 | 5 | **4.30** | 分发枢纽；安全争议在开放注册（推断） |
| addyosmani/agent-skills | 4 | 4 | 4 | 4 | 4 | **4.00** | 生命周期门禁齐全、体量可控（已验证★） |
| antigravity-awesome-skills | 5 | 4 | 2 | 3 | 3 | **3.35** | 量大；质量/安全需自筛（推断） |
| Skills Manager | 4 | 4 | 3 | 4 | 4 | **3.75** | 管理软件里最完整直接对手（推断，见 02） |
| microsoft/azure-skills | 5 | 3 | 4 | 4 | 3 | **3.85** | ★ 低、装机高——厂商分发≠社区星（已验证） |

加权 = 功能×0.20 + 易用×0.20 + 可靠安全×0.25 + 稳定×0.15 + 差异化×0.20。

### 头部要点（各≤3）

### obra/superpowers
- 优点：流程技能链完整；多宿主安装说明；社区声量最大
- 缺点：强制感强，与「轻量单 skill」用户冲突；学习曲线高
- 评分：功能 5 · 易用 3 · 可靠安全 4 · 稳定 4 · 差异化 5

### mattpocock/skills
- 优点：grill / handoff / triage 解决真实工程摩擦；安装榜统治力强
- 缺点：个人品牌捆绑；与 superpowers 部分能力重叠
- 评分：功能 5 · 易用 4 · 可靠安全 4 · 稳定 4 · 差异化 5

### vercel-labs/skills + skills.sh
- 优点：一条命令装到多 Agent；排行榜即发现层
- 缺点：开放注册体量大，恶意/低质 skill 风险被多次讨论（推断；精确漏洞细节待验证）
- 评分：功能 5 · 易用 5 · 可靠安全 3 · 稳定 4 · 差异化 5

### 行业现状小结
- 普遍做得好：`SKILL.md` 跨 Cursor / Claude Code / Codex / Copilot 等可移植；一作框架与大 V 包质量信号清晰
- 普遍短板：合集仓「堆数量」；安装量可被捆绑/搭售扭曲；本机「永久库 vs 生效容器」对账仍弱（对齐 02）

## 3. 该怎么用这些热门物（对读者 / 对 CCM）

**结论（建议）**：选装按「类型 1～2 个源头 + 按需单 skill」，勿盲目 clone 千级合集；CCM 应对接 skills.sh/`npx skills` 的**入库与对账**，而不是再做第三套 Awesome。

- 机会矩阵：发现（skills.sh 强）× 可信台账（市场弱）→ CCM 切入点仍在对账/冲突
- 一句话定位（本报告用途）：为【开发者】提供【热门 Skills/软件地图】，区别于【Awesome 长列表】在于【★与安装量双口径 + 类型分桶 + 管理软件对照】
- 目标用户画像：主＝要快速挑装；次＝做配置管理产品的人
- MVP 选装建议（MoSCoW：Must/Should/Could/Won't，按优先级切割范围）

| 优先级 | 含义 | 建议 |
|---|---|---|
| Must | 没有就难开工 | `frontend-design` 或自有 UI 规则；工程向二选一：`mattpocock/skills` 核心几条 **或** `superpowers` 精简集 |
| Should | 明显增益 | `vercel-react-best-practices`（React 栈）；`find-skills`（发现）；`agent-browser`（需浏览器自动化时） |
| Could | 场景化 | Remotion / Azure / Lark / 营销 SEO 等垂直包 |
| Won't(now) | 本期不建议 | 无差别安装 antigravity 千级合集；把 Awesome README 整仓当运行时技能 |

- 非功能目标：装前看许可证与最近 push；优先官方/一作源；脚本类 skill 先只读审查
- 差异化锚点（CCM）：哈希对账 + 库/容器分离 + 规则与技能同管（非安装量）
- 不做清单：不维护平行「热门榜镜像站」；不把第三方安装遥测当本机真相源

## 4. 最优实现路径（消费生态，非另起产品）

**结论（建议）**：个人侧用 CLI 装精选；团队侧用 Git 钉版本；产品侧（CCM）对接导入路径即可。高风险：开放市场 skill 含诱导指令/脚本。

- 构建方式：推荐【套用 skills CLI + 精选仓】；备选【只 clone 单仓手工拷贝到 `~/.cursor/skills`】
- 技术选型：默认 `npx skills add owner/repo -s <name> -a cursor -g`；规范见 [agentskills.io](https://agentskills.io)；许可证以各仓为准（多为 MIT，须逐仓核对）
- 架构概要：发现（skills.sh）→ 安装（CLI 写入 Agent 目录）→ 可选台账（CCM 永久库）→ 宿主运行时按 description 触发
- 路线图：先装 Must → 按项目加垂直 Could → 用 CCM 扫描对账（验收：磁盘路径与 UI 一致；未实测标待验证）
- 风险与对策：

| 风险 | 类型 | 影响 | 对策 |
|---|---|---|---|
| 恶意/投毒 skill | 安全 | 数据外泄、危险命令 | 优先官方仓；审查 `scripts/`；少装未知作者 |
| 安装量虚高（捆绑） | 市场 | 误判「人人都在用」 | 看独立 skill 与作者分散度，不只看仓总安装 |
| 合集过大拖慢发现 | 稳定 | Agent 误触发/上下文膨胀 | 只启用少量；项目级与用户级分桶 |
| ★ 与安装量背离 | 认知 | 跟错风向 | 双口径对照（本报告表） |

- 假设验证：最危险假设＝「装越多越好」→ 用 1 个真实项目只开 3～5 个 skill 对比一周效率（待验证）

## 5. 结论

**结论（建议）**：GitHub 上最热的是 **superpowers / mattpocock / anthropics / addyosmani** 一类**内容与方法论仓**，以及 **vercel-labs/skills** 这一**分发层**；单 skill 热度由 **find-skills、frontend-design、grill-me、agent-browser、React 规范** 与**云/协作厂商捆绑包**主导；管理类桌面软件热度低一个数量级。下一步：按 MoSCoW 精装，再用 CCM 做本机权威台账（详见 02）。

### 速查：按需求选源

| 你要… | 优先看 |
|---|---|
| 整套工程方法论 | [obra/superpowers](https://github.com/obra/superpowers) |
| 澄清/TDD/交接单点技能 | [mattpocock/skills](https://github.com/mattpocock/skills) |
| 官方样例与前端审美 | [anthropics/skills](https://github.com/anthropics/skills) |
| React/Web 一作规范 | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| 一条命令安装/更新 | [vercel-labs/skills](https://github.com/vercel-labs/skills) + [skills.sh](https://skills.sh/) |
| 逛目录/中文索引 | [heilcheng/awesome-agent-skills](https://github.com/heilcheng/awesome-agent-skills)、[JackyST0/awesome-agent-skills](https://github.com/JackyST0/awesome-agent-skills)、[SkillsMP](https://skillsmp.com) |
| 本机多工具管理 | Skills Manager / CCM（见 02） |
| Cursor Rules（非 Skills） | [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules) |

---

**版本**：v1.0 | **更新**：2026-07-31  
**关联**：[02-CCM竞品与产品定位-2026-07-31](02-CCM竞品与产品定位-2026-07-31.md)
