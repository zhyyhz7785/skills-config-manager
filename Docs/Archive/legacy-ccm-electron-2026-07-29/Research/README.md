# Research

竞品与产品调研、技术选型对比、目录与产品语义约定。

| 文件 | 说明 |
|------|------|
| [001-Windows漂亮UI选型-2026-07-21](001-Windows漂亮UI选型-2026-07-21.md) | Windows 漂亮 UI 最简方案调研 |
| [002-WebView2与Electron对比-2026-07-21](002-WebView2与Electron对比-2026-07-21.md) | 壳技术对比 |
| [003-React与Vue对比-2026-07-21](003-React与Vue对比-2026-07-21.md) | 前端框架对比 |
| [004-目录录入映射-Cursor-Claude-Codex-2026-07-21](004-目录录入映射-Cursor-Claude-Codex-2026-07-21.md) | **哪些目录录入为何 kind/tool/scope** |
| [005-CursorSkills-Rules盘点与分类优化-2026-07-22](005-CursorSkills-Rules盘点与分类优化-2026-07-22.md) | L0/L1(D·T·G)/L2 分层与继承规划；活跃聚类 D10/T00/T10 |
| [006-扫描项目与建库规则-LinLin未扫入-2026-07-23](006-扫描项目与建库规则-LinLin未扫入-2026-07-23.md) | 扫描建库闭环：默认全盘符发现 `.cursor` 项目根并登记项目+资产；含 LinLin 根因与修正 |
| [007-无catalog时L0L1L2划分逻辑-2026-07-26](007-无catalog时L0L1L2划分逻辑-2026-07-26.md) | 简化分层：项目→L2、用户级 rule→L0、其余未分类；拖拽定级；L0 无套娃 |
| [008-自动归类与原划分原则对比-审视优化-2026-07-26](008-自动归类与原划分原则对比-审视优化-2026-07-26.md) | 对照 005 原原则 vs 旧自动归类；其后已按 1A/2A 简化（见 007） |
| [009-用户级分桶与skill包扫描-2026-07-26](009-用户级分桶与skill包扫描-2026-07-26.md) | 永久库≠用户级；扫描 Cursor `.skill` ZIP 包 |
| [011-代码审查-saveAs路径冲突与性能问题-2026-07-27](011-代码审查-saveAs路径冲突与性能问题-2026-07-27.md) | saveAs 路径冲突与性能（审查留档） |
| [012-详情Markdown多页签Context-nodes-not-found-2026-07-27](012-详情Markdown多页签Context-nodes-not-found-2026-07-27.md) | **难查**：dev 多页签 Crepe `Context "nodes" not found`；生产正常；插件工厂 + Vite dedupe |
| [013-详情Markdown保存最小差异写回-2026-07-28](013-详情Markdown保存最小差异写回-2026-07-28.md) | **难查**：编辑一点就整篇 diff；序列化反投影 + dirty 基线 + EOL 保留 |
| [014-sandbox与危险IPC评估-2026-07-28](014-sandbox与危险IPC评估-2026-07-28.md) | Electron sandbox 与危险 IPC 面评估 |
| [015-冷启动测试三种形态差异-2026-07-28](015-冷启动测试三种形态差异-2026-07-28.md) | 冷启动测时：dev / build+start / win-unpacked |
| [016-做成VSCode扩展可行性-2026-07-29](016-做成VSCode扩展可行性-2026-07-29.md) | **决策**：整仓迁 VS Code 扩展不方便；薄伴侣可评估；Plugin 不对口 |
| [017-商业前景与运营调研-2026-07-29](017-商业前景与运营调研-2026-07-29.md) | **决策**：直接卖软件弱；品类爆发可继续投；动力=开源卡位；Skills 收集对接 skills.sh |
| [018-市场格局与竞品产品调研-2026-07-29](018-市场格局与竞品产品调研-2026-07-29.md) | **L1G90 立项对标**：五维打分；错位=Copy/冲突/编辑；增量=skills.sh+安全；xingkongliang=Tauri非Electron |
| [019-Tauri2与本仓Electron对比-2026-07-29](019-Tauri2与本仓Electron对比-2026-07-29.md) | **决策**：本期不迁 Tauri；体积优但须重写 Node services；本仓 unpacked≈403MB / portable≈95MB |

新调研按 `{序号}-{主题}-{yyyy-MM-dd}.md` 递增序号。
