# Skills Config Manager (CCM)

本机优先的 **技能 / 规则台账**：Cursor、Claude、Codex 的 skills 与 rules 有一份定稿，部署时才写进工具真正读取的目录。

[English README](README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/zhyyhz7785/skills-config-manager)](https://github.com/zhyyhz7785/skills-config-manager/releases)
[![CI](https://github.com/zhyyhz7785/skills-config-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/zhyyhz7785/skills-config-manager/actions/workflows/ci.yml)

> **0.2.0** 预览版，**仅 Windows**。安装包未代码签名，首次运行可能出现 SmartScreen 提示。

觉得有用就点一下 star，方便别人搜到。

## 为什么不是「库 = 生效」

多数管理器把中央文件夹（常靠 symlink）当成正在生效的那份。CCM 拆成三层：

1. **网络库**：开源 Git 源的只读检疫区，不能直部署。
2. **永久库**：磁盘上的定稿权威根。这里的文件**不生效**。
3. **容器**：Agent 真正读取的目录（`~/.cursor`、项目 `.cursor` 等）。默认工作区用复制；非默认用 symlink。冲突走**内容哈希人选**，禁止静默覆盖。

## 演示

请录 30 秒：扫描 → 入库 → 部署 → 哈希冲突人选。GIF 放到 `Docs/assets/demo.gif` 后会出现在英文 README。

![Skills Config Manager](app-icon.png)

## 安装

1. 从 [Releases](https://github.com/zhyyhz7785/skills-config-manager/releases) 下载 `.msi` 或 NSIS `.exe`。
2. 安装。设置在 `%APPDATA%\CCM-Tauri2`；默认库 `C:\CursorSkills`（可改）。
3. 打开应用 → 设置 → 选库路径 / 扫描根。
4. 扫描入库；或在网络货架粘贴 Git URL 拉取，再**转入**永久库。
5. 选工作区后 **部署**。默认工作区 = 复制；其它 = symlink。

窗口标题仍是 **CCM-Tauri2**（0.2.0 不改数据目录名）。

### 从源码构建

需要 Node.js、Rust ≥ 1.85、Windows。

```bash
npm install
npm run tauri:dev
```

```bash
npm run verify:tauri
npm run tauri:build
```

## 相关技能包

CCM **管理**技能。下面两个仓**本身是**可安装的技能：

- [software-product-discovery](https://github.com/zhyyhz7785/software-product-discovery) — 写代码前做竞品检索、五维打分、MVP 与实现路径。
- [first-principles-learning](https://github.com/zhyyhz7785/first-principles-learning) — 15 问从不可再拆的起点重建一门课。

```bash
npx skills add zhyyhz7785/software-product-discovery --skill software-product-discovery-zh --skill software-design-aesthetics-zh --skill extreme-speed-zh
npx skills add zhyyhz7785/first-principles-learning --skill first-principles-learning --skill first-principles-deep-dive
```

## 文档

| 文档 | 用途 |
|------|------|
| [01 核心逻辑](Docs/01-核心逻辑.md) | 产品机制 |
| [04 启动与测试](Docs/04-启动与测试.md) | 命令 |
| [06 帮助](Docs/06-帮助文档.md) | 五分钟路径 |
| [CONTRIBUTING](CONTRIBUTING.md) | 构建、测试、库布局 |

## 许可证

MIT。见 [LICENSE](LICENSE)。
