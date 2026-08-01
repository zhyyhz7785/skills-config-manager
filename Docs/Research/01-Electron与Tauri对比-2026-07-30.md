# 01 · Electron 与 Tauri 对比（CCM 双仓）

> **日期**：2026-07-30  
> **对象**：主仓 Electron 产品线 ↔ 本仓 Tauri 2 产品线（同一 CCM 产品机制，不同壳与后端）。  
> **关联**：[E001](../Evaluations/E001-Electron与Tauri同设置性能对比-2026-07-30.md) 协议、[E002](../Evaluations/E002-同fixture性能实测对比-2026-07-30.md) 实测；历史纸面「本期不迁」见 [Archive/019](../Archive/legacy-ccm-electron-2026-07-29/Research/019-Tauri2与本仓Electron对比-2026-07-29.md)（已被 Plan/02 推翻）。

## 1. 结论

| 问题 | 答案 | 级别 |
|------|------|------|
| 壳与后端谁更「薄」？ | **Tauri 2**（系统 WebView + Rust）远小于 Electron（自带 Chromium + Node） | **已验证**·体积量级 |
| 同 fixture 快照 / 扫描谁更快？ | **Tauri**（快照约 14×、扫描约 2.8×） | **已验证**·E002 |
| 发行冷启谁更快？ | 未同机秒表 | **待验证** |
| 功能是否已可替代主仓？ | 日常主路径已迁；少数体验缺口仍在（审计写回、拖出同步、用途大启发式等） | **已验证**·读码；缺口见 Learning/03 |
| 建议主力线？ | **已裁定：Tauri 本仓为开发主力**（2026-07-31）；Electron = 维护/对照 | **已验证**（用户裁定；[E002](../Evaluations/E002-同fixture性能实测对比-2026-07-30.md) / 三壳 [E004](../Evaluations/E004-三壳冷启动与性能测试-2026-07-31.md)、[E007](../Evaluations/E007-主力线切换Tauri2-2026-07-31.md)） |

相对 Archive/019（2026-07-29「本期不迁」）：迁移账单已付清大半，对比问题从「要不要迁」变为「谁当自用主力、缺口何时补」。

---

## 2. 对比对象（前提）

| | **Electron（维护线）** | **Tauri 本仓（主力）** |
|--|-------------------|----------------|
| 路径 | `E:\Code\CursorConfigManager` | `E:\Code\CursorConfigManagerTauri2` |
| 仓角色（2026-07-31） | 维护 / 对照 | **开发与交付主力** |
| **Electron** 是什么 | 自带 Chromium（浏览器内核）+ Node 的桌面运行时 | — |
| 起什么作用 | 渲染 UI + 用 TypeScript 写本机文件与业务 | — |
| **Tauri 2** 是什么 | — | 薄壳：系统 **WebView2**（Windows 嵌入式 Edge 控件）渲染 + **Rust** 提供本机能力 |
| 起什么作用 | — | 少捆绑引擎体积；业务在 Rust 命令里 |
| 前端 | React | React（同系 UI） |
| 业务后端 | Node / TypeScript `electron/services` | Rust（无 Node sidecar） |
| AppData | `CursorConfigManager` | `CCM-Tauri2`（隔离，勿混库根） |

产品机制相同：**永久库**（停用仓库与权威源）↔ **容器**（工具真正读取、才生效）+ **台账** `catalog.json`。壳不改变「库 ≠ 生效」。

---

## 3. 机制分叉

```text
用户点「放入容器」
  ├─ Electron：React → preload IPC → 主进程 TS → Node fs
  └─ Tauri：   React → Bridge invoke → Rust command → std::fs
```

| 维度 | Electron | Tauri 2 | 取舍 |
|------|----------|---------|------|
| 渲染一致性 | 各 OS 同捆 Chromium，观感稳 | Win=WebView2；他 OS 为各系统 WebKit 系 | CCM 当前主战场是 Windows → WebView2 可接受 |
| 本机 API | npm / Node 生态直接用 | Rust 或插件；无 Node 主进程 | 迁完后生态换栈，维护面变双语言→已沉没为单 Rust 后端 |
| IPC | 白名单 `ccm.invoke` | 同契约名经 Bridge → Rust；另有 capabilities（能力清单：声明前端能调什么） | 契约可对齐；实现语言不同 |
| 安全默认 | 可开 sandbox（主仓已开） | 默认只暴露白名单命令 | 两边都可做到「前端不能任意读盘」 |

---

## 4. 五维对照（对本产品的权重）

权重假设（个人桌面工具）：**功能对等 30%** / **性能与体感 25%** / **体积内存 20%** / **维护成本 15%** / **安全模型 10%**。

| 维度 | Electron | Tauri | 说明 |
|------|----------|-------|------|
| 体积 | unpacked 约数百 MB；portable 约数十～百 MB 级（Archive/019 本机测） | release 主 exe 约 **6.4 MB**（**已验证**·本仓） | 量级差仍成立；前端资产会抬安装包，但引擎不再占 300MB+ |
| 域路径性能 | 快照/扫描中位见 E002 | 同 fixture 更快（E002） | **已验证**；非完整 GUI 端到端 |
| 冷启 | 主仓有历史三形态测法 | 本仓发行秒表未齐 | **待验证** |
| 功能完整度 | 自用主线最熟；用途大启发式等齐全 | 日常路径已齐；Config 五件套为 legacy 空操作（与主仓无 UI 一致）；审计写回 / 拖出同步 / 用途大词表有缺口 | 见 [Learning/03](../Learning/03-Config五件套-LastActionLog-拖出同步-PurposeTaxonomy.md) |
| 维护 | 纯 TS 单栈；与 hymd Electron 习惯近 | Rust + 前端；本仓已清 Electron 残留 | 双仓并行则维护税高 → 应尽快定主力 |
| 安全 | sandbox + IPC 白名单已够用 | capabilities 默认更紧 | 非当前决胜项 |

---

## 5. 性能与体积数字（勿混口径）

| 指标 | Electron | Tauri | 级别 |
|------|----------|-------|------|
| 快照中位 | 1.94 ms | 0.14 ms | **已验证**·E002 同 fixture |
| 扫描预览中位 | 28.0 ms | 10.0 ms | **已验证**·E002 |
| 计时范围 | headless 域服务直调 | Rust 域路径直调 | 双方都**不是**完整 App（UI+IPC）端到端 |
| release 主程序 | 本机未见发行产物 | ≈ 6.4 MB | Tauri **已验证**；Electron 包体 **待验证** |
| 冷启中位 | — | — | **待验证** |

判定（对照 E001）：扫描/快照 Tauri 未慢于 Electron，且扫描仍快于约 2× → **性能不作否决，支持切 Tauri 主力**（**建议**，与 E002 一致）。

---

## 6. 决策框

| 若真实目标是… | 建议 |
|---------------|------|
| 自用尽快以更小包、更快域路径为主 | **切 Tauri 本仓为自用主力**；主仓冻结或只修致命洞 |
| 必须证明「打开窗口到可点」也更快 | 先补双方发行冷启 ≥3 次（E001/E002 待填），再钉死 |
| 归类体验必须与主仓大启发式一致 | 在 Tauri 补 PurposeTaxonomy（用途词表）与审计/拖出同步后再宣布对等 |
| 只想省事、短期零迁移风险 | 可暂留 Electron；接受体积与双仓税（与已付迁移成本相悖） |

**综合建议（建议）**：以 Tauri 为本仓产品线继续补缺口；Electron 主仓作对照与回退，直至冷启与关键体验缺口关闭后再谈停更主仓。

---

## 7. 证据汇总

| 结论 | 级别 |
|------|------|
| 架构：Electron=Chromium+Node；Tauri=WebView2+Rust | **已验证** |
| 同 fixture 快照/扫描 Tauri 更快 | **已验证**·E002 |
| Tauri release exe ≈ 6.4 MB | **已验证** |
| 冷启与 Electron 发行包体对照 | **待验证** |
| 日常路径已迁；少数体验缺口仍在 | **已验证**·读码 |
| 倾向 Tauri 主力，补测后钉死 | **建议** |

---

**版本**：v1.0 | **更新**：2026-07-30
