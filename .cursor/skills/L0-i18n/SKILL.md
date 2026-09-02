---
name: L0-i18n
description: |
  跨项目软件多语言国际化纪律：默认简体中文（zh-CN）、第二语言英文（en）；
  按 inspect → 开最小 guide → 实现 → 双语言验收 执行。
  覆盖加语言、切语言、翻译文案、locale、i18n、中英双语、界面语言。
  桌面/Tauri 默认自建轻量；已有 vue-i18n / react-i18next / nuxt-i18n / next-intl 时沿用并套本语言政策。
  不替代框架官方 Skill；不负责 CMS 内容多语言。
  触发：用户说「国际化 / i18n / 多语言 / locale / 翻译 / 中英 / 简体中文默认」或点名本 skill。
author: Cursor Agent
version: 1.0.0
date: 2026-08-16
---

# L0 · 软件多语言国际化

## 定位

> **界面怎么用简体中文做默认、英文做第二语言，并且切得动、测得过**——跨栈、跨项目的动手纪律。
> **不是**某框架的 API 手册（Nuxt / Next 等 Web 框架走其官方 Skill），**不是** **CMS**（Content Management System，内容管理系统）/ 数据库正文翻译。
>
> 口诀：**中文定键 → 英文齐套 → 一处状态 → 双语言验收**

**i18n**（internationalization，国际化）是把用户可见文案、日期数字、语言状态从代码里抽出来、可切换的做法；本 skill 管它的政策、路由与验收。

| 本 skill 负责 | 不负责（交给别人） |
|---|---|
| 语言政策、选型路由、键与**回退**（缺译时改用中文词典）、切换与持久化、双语言验收 | 框架专有 API：已有 `vue-i18n` / `react-i18next` / `@nuxtjs/i18n` / `next-intl` 时用其官方 Skill，本文件只约束政策 |
| 桌面 / **Tauri**（Rust 后端 + 系统 WebView 的桌面框架）自建轻量配方 | CMS / 数据库内容多语言 |
| 用户可见串的抽取与对齐 | 只改一句已有译文（直接改词典，不必套全流程） |

## 何时用 / 不用

**用**：新软件要中英双语；给现有界面加语言切换；加按钮/菜单/对话框文案；用户说「国际化 / 多语言 / i18n」。

**不用**：

- 只改已有键的译文 → 改对应词典，跑对齐测试即可
- 纯后端邮件/日志且产品接受单语 → 标明「单语不接入」后退出
- 用户点名第三语言 → 先问清语言码，再扩词典；本 skill 默认只有 `zh-CN` + `en`

## 语言政策（硬）

除非用户点名第三语言，否则不可改：

- 第一语言 / 默认：**简体中文**。**locale**（语言区域码，用来选定哪本词典）统一为 `zh-CN`（**BCP 47**，语言标签标准）。
- 第二语言：**English**。locale 统一为 `en`。若仓库已用 `en-US`，全仓只用那一种，禁止 `en` / `en-US` 混用。
- **源语言定键**：先在中文词典加键，英文必须齐套；缺键回退中文，禁止空串冒充已译。
- 新的用户可见字符串禁止硬编码进组件 / 命令 / 菜单。

## 路由

**禁止一次读完全部附件。** 先 Inspect，再按下表只开一篇。

1. **Inspect**（先读现有再改）：有无现成 i18n、locale 码是否一致、默认是否已是 `zh-CN`、词典落盘、切换入口、后端/第三方是否已接线。
2. **开最小 guide**（见下表）。
3. **实现**：locale 状态一处、文案走 `t(key)`（按键取当前语言字符串的函数）、切换即时、持久化可重启。
4. **验收**：默认中文 + 切英文各走一遍；重启仍保持。清单见 [references/verification.md](references/verification.md)。

| 任务 | 打开 |
|---|---|
| 定 locale、回退、检测、持久化 | [references/configuration.md](references/configuration.md) |
| 加键、插值、对齐测试 | [references/messages.md](references/messages.md) |
| 桌面 / Tauri / React 自建轻量 | [modules/desktop-lightweight.md](modules/desktop-lightweight.md) |
| 双语言怎么测 | [references/verification.md](references/verification.md) |
| 已是 Nuxt / Next / vue-i18n / react-i18next | 用其官方 Skill；本 skill 只约束语言政策与验收 |

## 选型

**结论（建议）**：两语种 TypeScript 桌面应用默认自建轻量；已有框架库则沿用，不重造。

- **桌面 / Tauri / 两语种 TypeScript**：默认自建（不引 i18next）。配方来自 HyMdTauri2 的 `src/i18n/`（已验证：类型对齐 + 即时切换 + 重启保持）。
- **项目已接 vue-i18n / react-i18next / @nuxtjs/i18n / next-intl**：沿用；仍强制 `zh-CN` 默认、`en` 第二、键对齐。
- 需要 **ICU**（International Components for Unicode，复杂复数/阴阳性/日期格式）时再升级格式库，不作为默认。

## 硬门禁

1. locale 码在配置、词典文件名、切换器、回退规则四处一致。
2. 回退链显式：当前词典 → `zh-CN` → 键名；非法 locale 忽略并保持默认。
3. 中英键集合必须相等（TypeScript **`Record`**——要求对象必须具备指定键集的类型——或单测，二者至少一条）。
4. 切换即时生效；持久化后重启仍保持（桌面可用 **`localStorage`**——浏览器本地键值存储，关应用后仍在——或项目 settings）。
5. 用户可见串在前端译；Rust / **CLI**（Command Line Interface，命令行程序）要么错误码 + 前端映射，要么标明单语不接入。
6. 可发布包自带最小词典 + 宿主注入 locale，禁止包反向 import 应用 i18n。
7. 第三方控件（表格/编辑器）自带 locale 须单独接线，不能假设自动跟随。
8. 命令 / 菜单 / 对话框与界面同一套 `t()`，禁止两套文案。
9. `<html lang>`（文档语言属性，给浏览器和无障碍用）随 locale 更新（HyMd 未做此项，标为应做）。

## 最小 baseline

新项目从这两本词典起，再接 `t()` 与切换器：

```ts
export const zhCN = {
  "locale.zh": "中文",
  "locale.en": "English",
  "settings.language": "界面语言",
};

export type I18nKey = keyof typeof zhCN;

export const en: Record<I18nKey, string> = {
  "locale.zh": "Chinese",
  "locale.en": "English",
  "settings.language": "Display Language",
};
```

locale 码、文件名、切换器取值必须都是 `zh-CN` / `en`。

## 反模式

- 英文当默认：与本政策冲突，禁止
- 组件里写死中文：切英文后漏译且测不出来
- `en` 与 `en-US` 混用：检测、存储、切换器对不上
- 空串占键：看起来「有译」实际空白
- 包反向依赖应用词典：可发布包无法独立构建
- 只译界面、不译命令面板：用户以为没切语言
- 跟浏览器语言走、首次打开变成英文：中文产品默认必须是 `zh-CN`
