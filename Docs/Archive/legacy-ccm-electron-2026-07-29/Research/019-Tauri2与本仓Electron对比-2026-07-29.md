# Tauri 2 与本仓 Electron 对比

> **日期**：2026-07-29  
> **对比对象**：Tauri 2（桌面壳：用系统 WebView + Rust 后端打包应用的框架）↔ **本仓现状** Electron 42.5.0 + React 19 + Vite 6 + Node/TS 主进程  
> **关联**：[002-WebView2与Electron对比](002-WebView2与Electron对比-2026-07-21.md)；[01-项目架构](../01-项目架构.md)；[014-sandbox与危险IPC](014-sandbox与危险IPC评估-2026-07-28.md)；[018-市场格局](018-市场格局与竞品产品调研-2026-07-29.md)  
> **结论（建议）**：**本期不迁 Tauri**。体积与内存 Tauri 明显更优，但 CCM 差异化在 Copy/冲突/编辑业务，不在壳；迁栈等于把已落地的 Node `services/*` **重写成 Rust**（或旁路），成本远高于收益。竞品用 Tauri（见 018）不是迁移理由。

---

## 0. 一句话对照

| | **本仓（Electron）** | **Tauri 2** |
|--|----------------------|-------------|
| 是什么 | 自带 Chromium + Node 的完整桌面运行时 | 薄壳：系统 WebView 渲染 + Rust 提供系统能力 |
| Windows 渲染 | 捆绑 Chromium（与发行包同版本） | **WebView2**（Edge 系，常已预装） |
| 主进程语言 | TypeScript / Node（`electron/services/*`） | **Rust**（`#[tauri::command]`） |
| 前端 | React（可保留） | 任意 Web 前端（可保留 React） |
| 对本仓含义 | **已交付路径** | 换壳 = 重写业务后端，不是「改 `package.json`」 |

---

## 1. 本仓现状（已验证）

| 项 | 事实 |
|----|------|
| 壳 | `electron` **42.5.0**（`package.json`） |
| UI | React 19 + Vite 6 + TypeScript |
| 业务 | 主进程 Node `fs` + TS services（自 WPF 移植） |
| IPC | 单一 `ccm.invoke` + 方法白名单；preload `contextBridge` |
| 安全基线 | `sandbox: true` + `contextIsolation` + 无 `nodeIntegration`（[014](014-sandbox与危险IPC评估-2026-07-28.md)） |
| 选型动机 | 对齐本机 hymd-code、复用 Electron Cache、AI 出活快（[01](../01-项目架构.md)） |
| 发行体积 | **`release\win-unpacked` ≈ 403.4 MB**；`portable.exe` ≈ **94.9 MB**（压缩包，2026-07-29 本机测目录） |
| 运行时本体 | `node_modules\electron\dist` ≈ **354.1 MB**（引擎占大头） |

历史：曾评估 WebView2/WPF（[002](002-WebView2与Electron对比-2026-07-21.md)），后整仓迁 Electron；`legacy-wpf` 已归档。

---

## 2. 架构分叉（机制）

```text
用户点「部署到容器」
  │
  ├─ Electron（本仓）
  │     React → preload ccm.invoke → 主进程 TS → Node fs → 磁盘
  │
  └─ Tauri 2（若迁）
        React → invoke('deploy', …) → Rust command → std::fs / 插件 → 磁盘
        （Windows 页面跑在 WebView2，不跑独立 Chromium 树）
```

| 维度 | Electron（本仓） | Tauri 2 |
|------|------------------|---------|
| 渲染一致性 | 各 OS 同捆 Chromium，观感稳 | Win=WebView2；mac=WKWebView；Linux=WebKitGTK → **跨 OS CSS/API 可能不一致** |
| 系统 API | Node / npm 生态直接用 | Rust 或官方/社区插件；**无 Node 主进程** |
| IPC | `ipcMain` / preload 桥（本仓已收敛） | 类型化 `invoke` + **capabilities**（能力清单：声明前端能调哪些命令/路径） |
| 沙箱默认 | 可关可开（本仓已开） | WebView 隔离 + 后端仅暴露白名单命令（默认更紧） |
| 移动端 | 无 | Tauri 2 可扩 iOS/Android（**CCM 不需要**） |

与 [002](002-WebView2与Electron对比-2026-07-21.md) 的关系：**Tauri 在 Windows 上≈「WebView2 壳 + 跨平台打包约定 + Rust 宿主」**；Electron 仍是「自带整车」。002 的「体积差一个数量级」逻辑对 Tauri **同样成立**。

---

## 3. 五维对比（对本仓权重）

权重（假设·工具类个人桌面）：迁移成本 **30%** / 业务契合 **25%** / 体积内存 **15%** / 安全模型 **15%** / 生态与一致性 **15%**。

| 维度 | Electron（本仓） | Tauri 2 | 说明 |
|------|------------------|---------|------|
| 体积 / 内存 / 冷启 | 弱（已测 unpacked ~403 MB） | **强**（行业常见安装包数 MB～数十 MB 级） | 量级差 **已验证·本仓 vs 公开对比**；本仓未实测同功能 Tauri 包 |
| 前端复用 | React 已深（Crepe/布局） | 前端可留；**后端不可留** | Crepe 在 Win WebView2 上通常可跑（推断）；跨 mac WebKit 需另测 |
| 业务后端 | Node TS 全量已写 | 须 Rust 重写或 sidecar | **迁移主成本** |
| 安全 | 已做 sandbox + IPC 白名单 | capabilities 默认更严 | Electron 已够用；非迁栈刚需 |
| 工具链 / 人力 | 纯 TS；对齐 hymd | 需 Rust 工具链 + 双语言调试 | 个人维护带宽敏感 |
| 与竞品同壳 | 少数（本仓） | 头部 skills-manager / skills-manage 用 Tauri | **营销叙事无关产品差异化**（见 018） |

**加权直觉（建议）**：若「从零做同类工具且团队会 Rust」→ Tauri 合理；若「已有 Electron 产品且差异化在业务」→ **留 Electron 分更高**。

---

## 4. 迁 Tauri 要付的真实账单（CCM 特有）

| 工作包 | 内容 | 粗量级（推断） |
|--------|------|----------------|
| 壳与工程 | `src-tauri`、打包、托盘/无边框/便携策略重做 | 中 |
| **services 重写** | Catalog / Scan / Ingest / Deploy / Withdraw / 冲突 / 路径护栏… → Rust | **大**（主成本） |
| IPC 契约 | `shared/ipc.ts` → Tauri commands + capabilities 范围（库根、容器路径） | 中 |
| 编辑器 | Crepe 在 WebView2 回归；sandbox/CSP 差异 | 中 |
| 验证资产 | 015 冷启三形态、014 安全、pack:win 路径全部作废重测 | 中 |
| 协同收益 | 与 hymd Electron Cache、纯 TS 单栈断裂 | 负 |

**不会自动继承的**：现有 `electron-builder` portable / win-unpacked 流程、主进程里所有 `node:fs` 习惯、部分依赖 Node 的 npm 原生模块（若有）。

**可选折中（一般不推荐本期）**：

| 折中 | 含义 | 问题 |
|------|------|------|
| Tauri + Node sidecar | UI 用 Tauri，业务仍 Node 子进程 | 两套运行时，体积优势打折，运维更复杂 |
| 仅新窗口/小工具用 Tauri | 双壳并存 | 两套发行与 IPC，维护税高 |

---

## 5. 行业数字 vs 本仓数字（分清证据级别）

| 指标 | 来源 | 级别 |
|------|------|------|
| CCM `win-unpacked` ≈ 403 MB；portable ≈ 95 MB；Electron dist ≈ 354 MB | 本机目录测量 2026-07-29 | **已验证** |
| Tauri 典型安装包数 MB～数十 MB；空闲内存常低于 Electron 一个数量级 | 2026 公开对比文/社区基准 | **推断·二手**（非本仓同功能复测） |
| 头部竞品选 Tauri 2 | 018 + 各仓 README | **已验证** |
| 「迁 Tauri 后 CCM 也能到 15–40 MB」 | — | **待验证**（取决于 Rust 实现与前端资产；Crepe 会抬前端体积） |

公开文常写「Tauri 比 Electron 小 90%+」——对 **Hello World / 轻前端** 成立；对本仓这种 **编辑器级前端 + 厚业务**，绝对差距仍大，但**比率会收窄**（推断）。

---

## 6. 决策框

| 若你的真实目标是… | 建议 |
|-------------------|------|
| 把 Skills 工作台功能做完（skills.sh、安全闸、冲突） | **留 Electron**；壳不是瓶颈 |
| 发行包必须显著小于 ~100 MB portable / 厌恶 400 MB unpacked | 可 **立项评估** Tauri；先做「最小 Deploy/Withdraw PoC」测体积，再谈全迁 |
| 与 xingkongliang 技术栈对齐好看 | **不构成迁移理由**（018：差异化不在壳） |
| 从零新开跨平台轻量工具且会 Rust | **优先 Tauri 2** |
| 只要 Win、且愿养 C# 宿主 | 回看 [002](002-WebView2与Electron对比-2026-07-21.md) WebView2，与 Tauri Win 路径同族 |

**综合建议（建议）**：维持 Electron 42 栈；把工程时间花在 018 的产品增量上。仅当「体积/内存」升为 P0 且接受 Rust 重写服务层时，再开 Tauri 迁移 Plan。

---

## 7. 若未来真迁：最小验证顺序（待执行）

1. 空壳 + 读一个目录列表（Rust `read_dir`）打出 Win 安装包 → 量 MB。  
2. 移植 **一条** Deploy 路径（含路径护栏）→ 对比正确性。  
3. 嵌入现有 React 构建，打开详情 Crepe → 目视与快捷键回归。  
4. 三者都过，再估全量 services 人周；否则停止。

---

## 8. 证据汇总

| 结论 | 级别 |
|------|------|
| 本仓 Electron 42.5 + 发行体积如上 | 已验证 |
| Tauri = 系统 WebView + Rust；Win 上用 WebView2 | 已验证·官方/文档常识 |
| 体积/内存通常远小于 Electron | 推断·公开基准；本仓未做同功能 Tauri 包 |
| 迁栈主成本 = 重写 Node services | 推断·架构必然 |
| 本期不迁、优先产品增量 | 建议 |

---

**版本**：v1.0 | **更新**：2026-07-29
