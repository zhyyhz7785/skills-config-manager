# Cursor Config Manager Tauri2

**结论**：本仓是 CCM 的 **以后开发与交付主力**（Tauri 2 + Rust，纯 Tauri，无 Electron/sidecar）。决策日期 **2026-07-31**（见 [Docs/Evaluations/E007](Docs/Evaluations/E007-主力线切换Tauri2-2026-07-31.md)；Plan/02 迁移已完成）。

| 姊妹仓 | 角色 |
|---|---|
| `E:\Code\CursorConfigManager`（Electron） | **维护/对照**；非默认新功能落点 |
| `E:\Code\CursorConfigManagerWails2` | **壳实验** |

## 栈

| | |
|--|--|
| **壳** | Tauri 2 |
| **UI** | 全量 `App.tsx` + `src/tauri/ccmBridge.ts` |
| **业务** | Rust（`src-tauri`） |
| **隔离** | `%APPDATA%\CCM-Tauri2` · 默认库可配置（对比期曾用 Spike 根） |

## 命令

```bash
npm install
npm run tauri:dev
npm run verify:tauri
npm run tauri:build
```

## 文档

| 文档 | 用途 |
|------|------|
| [03 实施与状态](Docs/03-实施与状态.md) | 进度与最近变更 |
| [04 启动与测试](Docs/04-启动与测试.md) | 命令 |
| [Plan/02 迁移](Docs/Plan/02-CCM全量迁Tauri-2026-07-29.md) | 迁移史（终态已达） |
| [Research/01 对比](Docs/Research/01-Electron与Tauri对比-2026-07-30.md) | 与 Electron 对照 |

## 目录

- `src-tauri/` — Tauri / Rust
- `src/tauri/ccmBridge.ts` — 前端 IPC 桥
- `shared/` — IPC 与类型契约

---

**版本**：v2.0 | **更新**：2026-07-31
