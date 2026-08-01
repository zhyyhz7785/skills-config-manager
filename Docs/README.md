# Cursor Config Manager Tauri2 文档

> **纯 Tauri 2 产品仓**：运行时仅 WebView2 + Rust；无 Electron、无 Node sidecar。  
> 与主仓 Electron（`E:\Code\CursorConfigManager`）对测见 [Evaluations/E001](Evaluations/E001-Electron与Tauri同设置性能对比-2026-07-30.md)。  
> 三壳结案与主力线决策见 [Evaluations](Evaluations/README.md)（E003–E007；含自 Wails2 迁入）。  
> 迁移史见 [Plan/02](Plan/02-CCM全量迁Tauri-2026-07-29.md)；闸门史见 [Plan/01](Plan/01-Tauri2重构闸门-2026-07-29.md)。

## 快速导航

| 文档 | 读者 | 用途 |
|------|------|------|
| [01-核心逻辑](01-核心逻辑.md) | 人类 | 产品机制与边界 |
| [02-项目架构](02-项目架构.md) | AI | 模块与数据流 |
| [03-实施与状态](03-实施与状态.md) | 双方 | 阶段与快照 |
| [04-启动与测试](04-启动与测试.md) | 开发者 | `tauri:dev` / `verify:tauri` / `bench:perf` |
| [05-经验教训](05-经验教训.md) | 双方 | 多轮坑 |

## 分类目录

| 目录 | 用途 |
|------|------|
| [Research/](Research/) | 调研 |
| [Learning/](Learning/) | 学习笔记（含 [05 Pro 切片练习·网络库](Learning/05-Pro档长任务编排练习-网络库.md)） |
| [Archive/](Archive/) | 归档（含旧 Electron 文档包，不进构建） |
| [Plan/](Plan/) | 迁移计划 |
| [Evaluations/](Evaluations/) | 双壳 + 三壳测评结案（E001–E007） |

---

**版本**：v4.2 | **更新**：2026-08-01
