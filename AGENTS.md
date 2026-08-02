# AGENTS.md

## Cursor Cloud specific instructions

**结论（已验证）**：本仓是 **CCM-Tauri2** —— 一个用 Tauri 2 构建的桌面配置管理器（Tauri＝以 Rust 为后端、系统 WebView 为前端的桌面应用框架，作用类似轻量版 Electron）。产品**面向 Windows**：默认路径用 `%APPDATA%`、图标含 `.ico`、路径比较按 Windows 大小写不敏感（把 `/` 统一成 `\` 再小写）。在本 Linux 云环境里它**能编译、能启动、后端能跑**，但有若干 Windows↔Linux 差异需注意（见下）。标准命令见 `README.md` 与 `Docs/04-启动与测试.md`，此处只补充非显而易见的坑。

### 运行前置（非显而易见）

- **必须设置 `APPDATA` 环境变量**（已验证）：应用与只读 CLI 都用 `$APPDATA/CCM-Tauri2/settings.json` 定位设置（`settings.rs::settings_dir`）。Windows 天然有 `APPDATA`，Linux 没有——不设置会直接报 `APPDATA not set`。运行前先 `export APPDATA=$HOME/.ccm-appdata`（目录可自选）。缺 `settings.json` 时会用默认设置，不会崩。
- **GUI 需要显示服务器**：本环境已提供 `DISPLAY=:1`。`npm run tauri:dev` 会自动经 `beforeDevCommand` 拉起 Vite 开发服务器（端口 **1420**，`strictPort`）再编译并打开窗口。libEGL/DRI3 警告是软件渲染回退，非致命。
- **Rust 工具链需 ≥ 1.85**（已验证）：传递依赖 `dlopen2_derive` 要求 `edition2024`，默认的 1.83 会在 `cargo` 解析清单阶段失败。本环境已 `rustup default stable`（1.97.x）。若未来 VM 又退回 1.83，先 `rustup default stable`。
- **Tauri 的 Linux 系统库**（WebKitGTK 等）已随环境快照安装（`libwebkit2gtk-4.1-dev`、`libgtk-3-dev`、`libayatana-appindicator3-dev`、`librsvg2-dev`、`libxdo-dev`、`libssl-dev`、`build-essential` 等）；这些是系统依赖，不进 update script。

### 已知 Linux 差异（重要）

- **Milkdown 编辑器正文渲染故障（渲染层，非功能）**（已验证）：右侧详情面板的 Markdown 富文本编辑器（`@milkdown/crepe`，基于 ProseMirror）在本环境的 WebKitGTK 2.52.3 下会把正文**每个字符/词片单独换行**、竖排显示，几乎不可读。但**主界面（导航/列表/描述/工具栏）渲染正常**，且**保存功能正常**——点"保存"（或 Ctrl+S）经 IPC 把内容写盘（`library_io.rs::save_detail_markdown`）确实生效。做 GUI 验证时**别依赖编辑器的视觉排版**，改用磁盘内容核对（读对应文件）。IPC＝前端 JS 调 Rust 命令的桥。
- **`cargo test --lib`：79 通过 / 10 失败**（已验证，非本机新引入）：失败集中在 `path_guard` / `deploy` / `catalog` / `library_io` / `projects` / `scan_ingest` / `recipes`，根因是这些代码与测试硬编码 **Windows 路径语义**（`C:\...` 绝对判定、反斜杠分隔符）。例如 `deploy` 把 `library_path` 以反斜杠拼接后在 Linux 上会创建**文件名里带字面 `\` 的目录**（如 `src-tauri/\tmp\.tmpXXX\.claude`）——跑完测试记得 `git clean -fd` 清理这些污染，勿提交。**部署（deploy）功能在 Linux 上因此不可靠；跨平台可靠的是"库侧读/写条目 markdown"**（用正斜杠 `library_path`，`resolve_library_safe_path` 在 Linux 正确解析）。
- 校验入口 `npm run verify:tauri`（= `verify:no-sidecar`）会做残留检查＋静态检查＋`cargo test --lib`，因此在 Linux 上会以上述 10 个 Windows 专用测试失败而整体非零退出——属预期平台差异，不是环境损坏。

### 服务与命令速查

- 桌面应用（产品本体，必需）：`APPDATA=$HOME/.ccm-appdata npm run tauri:dev`（Vite 1420 + Rust 窗口）。
- 只读 CLI（可选，验后端最快）：`APPDATA=$HOME/.ccm-appdata cargo run --manifest-path src-tauri/Cargo.toml --bin ccm -- status`（须 `Cargo.toml` 含 `default-run = "ccm-tauri2"`，双 binary 才不被 cargo 拒跑）。
- 类型检查：`npm run typecheck`（Linux 正常通过）。
- 单测：`cargo test --manifest-path src-tauri/Cargo.toml --lib`（Linux 上 79/89，见上）。
