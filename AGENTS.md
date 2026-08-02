# AGENTS.md

## Cursor Cloud specific instructions

**结论**：本仓是 **面向 Windows 的 Tauri 2 桌面应用**（壳 = Tauri 2，UI = React，业务 = Rust in `src-tauri/`）。在 Linux 云环境里能编译、能起 GUI、能跑绝大多数 Rust 单测，但有两处非显而易见的 Linux 适配点必须先知道，否则会卡住。标准命令见 `Docs/04-启动与测试.md` 与 `package.json` scripts，此处不重复。

术语：**APPDATA** 指 Windows 存放应用配置的目录环境变量（`%APPDATA%`）；本应用用它定位 `settings.json`。**WebKitGTK** 指 Linux 上 Tauri 用来渲染前端的浏览器引擎（等价 Windows 的 WebView2）。**edition2024** 指 Rust 2024 版语言特性，需 Rust ≥ 1.85 才能编译。

### 必须设置 APPDATA（否则 GUI 卡在「加载中…」）

`src-tauri/src/settings.rs` 的 `settings_dir()` 直接读 `APPDATA` 环境变量，Linux 默认没有，导致 `load_settings()` 返回 `Err("APPDATA not set")`，`get_snapshot` 随之失败，前端永远停在「加载中…」。运行 GUI、`ccm` CLI 或任何触及设置的操作前，先导出一个可写目录：

```bash
export APPDATA=/home/ubuntu/.ccm-appdata   # 任意可写目录即可；settings.json 落在 $APPDATA/CCM-Tauri2/
```

如需一个已配置好的「永久库」用于冒烟，可在 `$APPDATA/CCM-Tauri2/settings.json` 写入（字段为 PascalCase）：`SkillsLibraryRoot`、`LibraryRootConfigured=true`、`ProjectScanRoots`、`BackupRoot`、`NetworkLibraryRoot`。

### 运行桌面 GUI（`npm run tauri:dev`）

需要 X 显示（本环境 `DISPLAY=:1` 可用）。WebKitGTK 在无硬件 GPU 时需关闭合成/DMABUF，否则可能白屏：

```bash
export DISPLAY=:1 WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1
export APPDATA=/home/ubuntu/.ccm-appdata
npm run tauri:dev
```

启动日志里的 `libEGL warning: DRI3 error` 属软件渲染回退，无害。首次 `cargo` 编译较慢（约 1 分钟）。

### Rust 工具链

锁定的依赖需 **edition2024**，故默认工具链须为 stable ≥ 1.85（快照内已 `rustup default stable`）。若 `cargo` 报 `feature edition2024 is required`，说明落回了旧 1.83，执行 `rustup default stable` 即可。

### 单测：9 项 Linux 失败属预期（Windows 路径假设）

`cargo test --manifest-path src-tauri/Cargo.toml --lib`（即 `npm run verify:tauri` 内含）在 Linux 上 **80 通过 / 9 失败**。失败集中在 `path_guard`、`deploy`、`recipes`、`library_io`、`catalog`、`projects`：这些用例硬编码 `C:\` 绝对路径与反斜杠分隔符，而 `path_guard.rs` 的 `path_cmp_key` 把 `/` 归一成 `\`——是 **代码面向 Windows** 所致，非环境问题，**不要为此改代码**。`scan_ingest`（扫描建库）等其余用例全通过。

### 可在 Linux 冒烟的核心流程

「扫描建库」（scan & ingest：发现磁盘上项目的 `.cursor/skills` 等资产 → 登记进永久库台账 `catalog.json` 并复制入库）在 Linux **可用**，是最省心的端到端冒烟入口。依赖 Windows 反斜杠路径守卫的写操作（如 `deploy` 直接部署到容器）在 Linux 不可靠。
