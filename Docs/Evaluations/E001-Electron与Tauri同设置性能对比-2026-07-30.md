# E001 · Electron 与 Tauri 同设置性能对比

> **日期**：2026-07-30  
> **目的**：在相同永久库与相同扫描根下，对比查询/扫描耗时与冷启，决定主力开发线。  
> **证据**：Tauri 侧脚本可自动计时；Electron 侧按本文件步骤手测后填表。

## 1. 结论（先空后填）

| 问题 | 答案 | 级别 |
|------|------|------|
| 台账快照谁更快？ | （填中位 ms） | **待验证** |
| 固定根扫描预览谁更快？ | （填中位 ms） | **待验证** |
| 发行冷启谁更快？ | （填中位 s） | **待验证** |
| 建议主力线？ | （Electron / Tauri / 双轨暂留） | **建议**（测后写） |

## 2. 同设置约束（硬）

两边必须一致：

| 项 | 要求 |
|----|------|
| `SkillsLibraryRoot` | 同一物理路径（可用 `CCM_BENCH_LIBRARY`） |
| `ProjectScanRoots` | 同一扫描子树（**禁止**默认全盘 A–Z） |
| `ProjectScanMaxDepth` | 同一整数（建议 5） |
| 轮次 | ≥3，取**中位** |
| 机器 | 同机、关无关重负载 |

AppData 可不同（`CCM-Tauri2` vs 主仓）；只对齐库与扫描根。

## 3. Tauri 侧（本仓·已自动化）

```bash
cd E:\Code\CursorConfigManagerTauri2
npm run bench:perf
```

指定 fixture：

```bash
$env:CCM_BENCH_LIBRARY="D:\path\to\library"
$env:CCM_BENCH_SCAN="D:\path\to\scan-fixture"
$env:CCM_BENCH_DEPTH="5"
$env:CCM_BENCH_ROUNDS="3"
npm run bench:perf
```

输出字段：`snapshotMsMedian`（台账/快照）、`scanPreviewMsMedian`（扫描建库预览）。

冷启：`npm run tauri:build` 后跑发行 exe，秒表到可点工具栏 ≥3 次。

包体：记录 `src-tauri/target/release` 下主 exe 大小。

## 4. Electron 侧（主仓·手测清单）

```bash
cd E:\Code\CursorConfigManager
```

1. 设置永久库 = 与 Tauri 相同的 `CCM_BENCH_LIBRARY`。  
2. settings 中 `ProjectScanRoots` / `ProjectScanMaxDepth` 与 Tauri 相同。  
3. 开发者工具或临时日志：对 `getSnapshot` / `scanAndIngestPreview` 打 `performance.now()` 或主进程计时，跑 ≥3 次取中位。  
4. 冷启：发行便携包 exe，秒表 ≥3 次。  
5. 记录 `release\win-unpacked` 或 portable 体积（勿与 Tauri 混比未标注形态）。

**本刀不改主仓源码**；若需脚本可另开任务。

## 5. 结果表

| 产品 | 快照中位 ms | 扫描预览中位 ms | 冷启中位 s | 包体 |
|------|-------------|-----------------|------------|------|
| Tauri2 | | | | |
| Electron 主仓 | | | | |

原始 JSON（Tauri）：粘贴 `bench:perf` 输出。

## 6. 判定建议

- 扫描与快照 **稳定慢 >2×** 且冷启无优势 → 倾向保留 Electron 主力，Tauri 作壳实验。  
- Tauri 扫描/快照不差且包体/冷启明显优 → 倾向切 Tauri 主力。  
- 接近 → 功能与维护成本定夺，性能不作否决。

---

**证据级别**：协议与 Tauri 脚本 **已验证**（脚本可跑）。  
**实测数字**：见 [E002-同fixture性能实测对比-2026-07-30](E002-同fixture性能实测对比-2026-07-30.md)（域路径已填；冷启仍待验证）。  
**版本**：v1.1 | **更新**：2026-07-30
