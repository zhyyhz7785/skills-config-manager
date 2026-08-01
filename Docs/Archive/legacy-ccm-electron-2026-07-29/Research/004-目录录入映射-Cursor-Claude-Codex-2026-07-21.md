# 目录录入映射：永久库 ↔ Cursor / Claude / Codex

> 目标：明确「磁盘上哪些目录会被扫描迁入」，以及迁入后在台账里记成什么（kind / tool / scope）。  
> 依据：当前 `electron/services/skillScanService.ts` 与永久库目录约定（`kindFolderName`）。  
> 导航文案：左侧「通用」下分 Cursor / Claude / Codex；「项目」下扁平列出已登记项目（不再嵌套「Cursor项目」）。

---

## 1. 关键前提

| 概念 | 含义 |
|------|------|
| **永久库** | 台账根目录（如 `C:\CursorSkills` 或已配置的 `LibraryRoot`）。文件在这里时 **不会被** Cursor/Claude/Codex 调用。 |
| **容器** | 工具实际读取配置的目录。通用级在用户主目录下；项目级在项目根下的标记目录。 |
| **录入 / 迁入** | 扫描发现容器（或备份）中的资产 → 用户确认后 **Move** 进永久库，并写入 `catalog.json`。 |
| **放入 / 移出** | 永久库 ↔ 当前选中容器之间的 Move（Deploy / Withdraw）。 |

台账一条记录的核心字段：

| 字段 | 作用 |
|------|------|
| `kind` | 资产类型：`skill` / `rule` / `agent` / `command` / `hook` |
| `tool` | 工具归属：`cursor` / `claude` / `codex` |
| `scope` | 作用域：`user-global`（Cursor 用户级）、`user`（Claude/Codex 用户级扫描值）、`project:{id}`、`backup` |

---

## 2. 永久库内应当如何存放（迁入后）

迁入后按 **kind** 落在永久库子目录（与工具无关；工具信息在 catalog / origins）：

| kind | 永久库相对路径 | 形态 |
|------|----------------|------|
| skill | `{LibraryRoot}/skills/{id}/` | 目录，内含 `SKILL.md` |
| rule | `{LibraryRoot}/rules/{filename}` | 多为 `.mdc` / `.md` 文件 |
| agent | `{LibraryRoot}/agents/{id}.md` | 文件 |
| command | `{LibraryRoot}/commands/{id}.md` | 文件 |
| hook | `{LibraryRoot}/hooks/{id}.ps1` 或 `hooks.json` | 脚本或配置 |

**不应**把整个 `%USERPROFILE%\.cursor` 或项目根目录本身登记为「项目」或迁入为一条资产。

---

## 3. 通用（用户级）——扫描录入表

路径均相对 `%USERPROFILE%`（即 `os.homedir()`）。

### 3.1 Cursor → tool=`cursor`，scope=`user-global`

| 磁盘路径 | 录入 kind | 识别条件 | 备注 |
|----------|-----------|----------|------|
| `.cursor/skills/{name}/` | skill | 目录内存在 `SKILL.md` | 整目录为一条 |
| `.cursor/rules/**` | rule | 规则文件（含嵌套） | 见 `scanCursorRules` |
| `.cursor/agents/*.md` | agent | 普通 md 文件 | |
| `.cursor/commands/*.md` | command | 普通 md 文件 | |
| `.cursor/hooks/*.ps1` | hook | PowerShell 脚本 | |
| `.cursor/hooks.json` | hook | 单文件 | Hook 事件映射 |

导航「通用 → Cursor」时，当前容器根 = `%USERPROFILE%\.cursor`。

### 3.2 Claude → tool=`claude`，scope=`user`（扫描字段）

| 磁盘路径 | 录入 kind | 识别条件 | 备注 |
|----------|-----------|----------|------|
| `.claude/skills/{name}/` | skill | 目录内存在 `SKILL.md` | **当前仅扫 skills** |

导航「通用 → Claude」时，当前容器根 = `%USERPROFILE%\.claude`。

未纳入扫描（现状，勿假设会自动录入）：`.claude` 下 rules / agents / commands / hooks 等其它布局。

### 3.3 Codex → tool=`codex`，scope=`user`（扫描字段）

| 磁盘路径 | 录入 kind | 识别条件 | 备注 |
|----------|-----------|----------|------|
| `.agents/skills/{name}/` | skill | 有 `SKILL.md` | Codex 生态常见路径之一 |
| `.codex/skills/{name}/` | skill | 有 `SKILL.md` | 与上并列扫描；同内容按路径去重 |

导航「通用 → Codex」时，当前容器根 = `%USERPROFILE%\.codex`（放入默认落在此根下；`.agents` 仍会被扫描发现）。

未纳入扫描（现状）：`.codex` 下非 skills 的其它插件/tmp 等（且项目扫描会排除 `.codex/.tmp`、`.codex/plugins`）。

---

## 4. 项目级——扫描录入表

前提：项目已登记在 settings 的 `Projects` 中，且 `rootPath` **不是**用户主目录 / 用户 `.cursor`。

对每个项目 `root`，scope = `project:{projectId}`：

| 磁盘路径 | tool | kind | 识别条件 |
|----------|------|------|----------|
| `{root}/.cursor/skills/{name}/` | cursor | skill | 有 `SKILL.md` |
| `{root}/.cursor/skills-cursor/{name}/` | cursor | skill | 有 `SKILL.md`（Cursor 内置/扩展技能区） |
| `{root}/.cursor/rules/**` | cursor | rule | 规则文件 |
| `{root}/.cursor/agents/*.md` | cursor | agent | |
| `{root}/.cursor/commands/*.md` | cursor | command | |
| `{root}/.cursor/hooks/*.ps1` | cursor | hook | |
| `{root}/.cursor/hooks.json` | cursor | hook | |
| `{root}/.claude/skills/{name}/` | claude | skill | 有 `SKILL.md` |
| `{root}/.agents/skills/{name}/` | codex | skill | 有 `SKILL.md` |

导航「项目 → {名称}」时，**当前放入/移出容器根** = `{root}/.cursor`（项目级多工具容器切换尚未做；扫描仍会发现 `.claude` / `.agents` 下的 skills）。

项目分类字段 `category`（如历史「Cursor项目」）**仅存盘**，左侧导航不再用其分子标题。

---

## 5. 备份根（可选扫描源）

`BackupRoot`（默认常见为 `E:\cursorBf`，以 settings 为准）：

| 磁盘路径 | tool | scope | kind |
|----------|------|-------|------|
| `{BackupRoot}/skills/{name}/` | cursor | backup | skill |
| `{BackupRoot}/skills-cursor/{name}/` | cursor | backup | skill |

用于从旧备份迁入；不是日常「容器」。

---

## 6. 明确不录入 / 会跳过

| 情况 | 原因 |
|------|------|
| 路径已在永久库目录下 | 避免把库内文件再当「发现项」 |
| `libraryPollutionRules` 判定为污染项 | 系统垃圾、不应进台账的路径 |
| 同路径已扫描过（normalize 去重） | 多工具路径重叠时只保留一条发现 |
| 用户主目录或 `%USERPROFILE%\.cursor` 被登记为「项目」 | 校验拒绝 |
| 无 `SKILL.md` 的 skills 子目录 | 不视为合法 skill |
| Claude/Codex 用户级非 skills 目录 | **当前代码未扫**，不要指望自动录入 |

---

## 7. 导航 ↔ 容器根对照（UI）

```
导航
├── 通用                    ← 分组标题（不可点选为容器）
│   ├── Cursor              → %USERPROFILE%\.cursor
│   ├── Claude              → %USERPROFILE%\.claude
│   └── Codex               → %USERPROFILE%\.codex
└── 项目                    ← 分组标题
    ├── ★ {置顶项目}
    └── {其它已登记项目}    → {root}\.cursor
```

---

## 8. 录入决策速查（给操作者）

1. 问：文件在哪个工具目录树下？→ 定 `tool`（cursor / claude / codex）。  
2. 问：在用户主目录下还是某项目根下？→ 定 `scope`（通用 vs `project:id`）。  
3. 问：是带 `SKILL.md` 的技能夹、规则、agent md、command md，还是 hook？→ 定 `kind`。  
4. 若不在上表路径中 → **默认不要迁入**；先改扫描规则或手工拷贝进永久库对应 kind 目录后再对账。

---

## 9. 已知不对称（实现边界）

| 项 | 现状 | 含义 |
|----|------|------|
| Cursor 用户级扫描最全 | skills/rules/agents/commands/hooks | 主路径 |
| Claude/Codex 用户级 | 基本只扫 skills | 其它类型需扩展扫描再谈录入 |
| 项目导航容器 | 固定 `.cursor` | 项目下 Claude/Codex skills 可被扫到，但「当前容器」仍是 `.cursor` |
| scope 字符串 | Cursor 用 `user-global`，Claude/Codex 用户扫到为 `user` | 读 catalog / 过滤时注意别混用 |

后续若扩展扫描或项目级工具切换，应 **先改本表，再改代码**，避免台账语义漂移。

---

**版本**：v1.0 | **更新**：2026-07-21
