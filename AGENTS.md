# CCM-Tauri2 Agent notes

## Cursor Cloud specific instructions

**结论（已验证）**：本仓是 **CCM-Tauri2**——用 Tauri 2（Rust 后端 + 系统 WebView 前端的桌面框架）做的配置管理器，**产品面向 Windows**。在 Cursor Cloud 的 Linux 环境里可编译、可起 GUI、可跑绝大多数 Rust 单测，但有若干 Windows↔Linux 差异。Cloud Agents（云端 Agent）在本仓以 **校验为主**，不要求拉起 WebView GUI；标准命令见 `README.md`、`Docs/04-启动与测试.md` 与 `package.json` scripts，下文只补非显而易见的坑。

术语：**APPDATA**＝Windows 应用配置目录环境变量（`%APPDATA%`），本应用用它定位 `settings.json`；**WebKitGTK**＝Linux 上 Tauri 渲染前端的引擎（对标 Windows 的 WebView2）；**edition2024**＝Rust 2024 语言特性，需 Rust ≥ 1.85。

### 验收命令（Done）

```bash
npm run verify:tauri
```

等价核心：`cargo test --manifest-path src-tauri/Cargo.toml --lib -- --test-threads=1`（经 `scripts/with-cargo.mjs`）。在 Linux 上该入口会因约 **9～10** 项硬编码 Windows 路径（`C:\` / 反斜杠）的单测失败而整体非零退出——属预期平台差异，不是环境损坏，**不要为此改业务代码**。失败多落在 `path_guard` / `deploy` / `catalog` / `library_io` / `projects` / `scan_ingest` / `recipes`。

### 环境

- 安装脚本：`.cursor/cloud-install.sh`（由 `.cursor/environment.json` 的 `install` 调用）
- 需要：Node（跑 `npm ci` / verify 脚本）+ Rust/cargo（跑库测）；工具链须 **stable ≥ 1.85**（传递依赖 `dlopen2_derive` 要 `edition2024`）。若报 `feature edition2024 is required`，执行 `rustup default stable`。
- Tauri Linux 系统库（WebKitGTK 等，随环境快照，不进 update script）：如 `libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`libxdo-dev`、`libssl-dev`、`build-essential`、`libsoup-3.0-dev` 等。
- **不必**在云上跑 `npm run tauri:dev` 或完整 GUI 手测；若要手测，见下文「可选 GUI」。

### 必须设置 APPDATA

`settings.rs::settings_dir` 读 `APPDATA`。Linux 默认没有——不设会报 `APPDATA not set`，GUI 可能卡在「加载中…」。运行 GUI、`ccm` CLI 或触及设置的操作前：

```bash
export APPDATA=$HOME/.ccm-appdata   # 任意可写目录；settings.json 在 $APPDATA/CCM-Tauri2/
```

可选：在该目录写入已配置的 `settings.json`（字段 PascalCase）以便冒烟，如 `SkillsLibraryRoot`、`LibraryRootConfigured`、`ProjectScanRoots`、`BackupRoot`、`NetworkLibraryRoot`。

### 可选 GUI（`npm run tauri:dev`）

需要显示服务器（常见 `DISPLAY=:1`）。无硬件 GPU 时建议关合成/DMABUF，减少白屏：

```bash
export DISPLAY=:1 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
export APPDATA=$HOME/.ccm-appdata
npm run tauri:dev
```

`libEGL` / DRI3 警告多为软件渲染回退，非致命。Vite 开发端口 **1430**（`strictPort`；与 HyMdTauri2 的 1420 错开，便于双开）。

### 已知 Linux 差异

- **Milkdown 正文渲染**（已验证，渲染层）：右侧 Markdown 富文本（`@milkdown/crepe`）在部分 WebKitGTK 下会「每字/词片换行」、难读；主界面与**保存写盘仍正常**。GUI 验收以磁盘内容为准，勿依赖编辑器视觉排版。
- **`deploy` 与路径守卫**：硬编码 Windows 反斜杠时，在 Linux 可能生成文件名含字面 `\` 的目录；跑完 `cargo test` 后可用 `git clean -fd` 清理，勿提交。跨平台较稳的是库侧读/写条目 markdown（正斜杠 `library_path`）。
- **可冒烟流程**：「扫描建库」（发现项目 `.cursor/skills` 等 → 登记 `catalog.json` 并入库）在 Linux 可用；依赖反斜杠路径的直部署在 Linux 不可靠。

### 硬边界（改码时遵守）

- **默认工作区**部署 = **复制**进容器 + 刷新哈希人选；禁止对默认槽用 symlink「库=生效」
- **非默认工作区**可 symlink 指向永久库（跟随库改动）；创建失败须明确报错，禁止静默降级为 copy
- 网络库条目不可直部署；须先晋升永久库
- 冲突走哈希人选窗，禁止静默覆盖定稿（symlink 且仍指向库则跳过假冲突）

### 服务与命令速查

- 校验：`npm run verify:tauri` / `npm run typecheck`
- 桌面应用：`APPDATA=… npm run tauri:dev`
- 只读 CLI：`APPDATA=… cargo run --manifest-path src-tauri/Cargo.toml --bin ccm -- status`

### 文档

- 长程切片编排：`Docs/Plan/04-全局工作区与多容器-2026-08-01.md`
- 启动与测试：`Docs/04-启动与测试.md`
