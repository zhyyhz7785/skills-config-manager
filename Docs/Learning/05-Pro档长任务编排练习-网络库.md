# 05 · Pro 档长任务编排练习（网络库）

> 练习笔记 · 2026-08-01  
> **工作目录**：本仓 `CursorConfigManagerTauri2`（唯一）  
> **方法口径**（只读参考，未改源文件）：SoftwareDevelopment `Docs/Learning/05-Cursor-Pro档长任务编排.md`  
> 关联：[Plan/03 网络库](../Plan/03-网络库与开源获取-2026-07-31.md) · [03-实施与状态](../03-实施与状态.md)

## 总论

**结论（已验证）**：在 Pro 档用「计划一次 → 两片可测 → 两次 commit」跑通网络库验收闭环；不上 Cloud（无 `.cursor/environment.json`）；本地 Auto-review。与 Ultra Long-running 差一句：**无官方长时互检 harness，用切片交接补「跟完」。**

```text
门禁（Pro + Auto-review）
  → 切片 A：本地 Git 拉取 + 域验收测 → commit d6144ee
  → 切片 B：本仓 Docs / 本笔记收口 → commit（本文件同批）
```

---

## 1. 门禁

| 项 | 结果 |
|----|------|
| 账号 Pro / 无 Long-running | 执行本练习时按用户 Implement 计划视为已确认（**建议**复核 Settings） |
| Approvals = Auto-review | 同上（**建议**复核） |
| Cloud Environment | **本轮未做** — 仓内无 `.cursor/environment.json`，避免空转 → **待验证** |
| Spend limit | 建议自行在 Dashboard 设置（未代改） |

---

## 2. 切片与 Done

### 切片 A — GUI/域验收 + 修洞

| Done | 结果 | 证据 |
|------|------|------|
| 离线根 + `network-index.json` | **已验证** | `%USERPROFILE%\CCM-NetworkLibrary\network-index.json` 存在；单测 `network_root_differs_from_library` |
| 拒同根 | **已验证** | `reject_same_root_on_choose` |
| 拉取 → `net:` | **已验证** | 新增本地 bare 仓路径拉取 + `acceptance_fetch_local_git_discovers_entries`（不依赖外网）；UI 工具栏基线/粘贴 Git 已接线 |
| 只读 / 禁部署 | **已验证** | `load_network_detail` 文案含「只读」；`acceptance_promote_conflict_and_readonly_guards`；snapshot 对 `net:` 关 canDeploy |
| 晋升 + 冲突「来自网络库」 | **已验证** | 同上冲突单测；`promoteFromNetwork` UI 文案 |

**代码改动**：`fetch_network_source` 支持本地 Git 路径 / `file://`。  
**校验**：`npm run verify:tauri` → **73 tests** 绿。  
**commit 1**：`d6144ee` — `fix(network): accept local Git paths and add fetch acceptance test`

WebView 像素级点选外网 Anthropic 基线：可选复核（建议）；域路径五项已覆盖。

### 切片 B — 本仓 Docs 收口

| Done | 结果 |
|------|------|
| 更新 Plan/03、03-实施与状态 | 本批 |
| 本 Learning 笔记 + README 导航 | 本批 |
| 可重复冒烟 | 切片 A 已加 `acceptance_fetch_local_git_*`（精神对齐 Wails `netaccept`） |

**commit 2**：`docs: record Pro slice practice for network library`（`git log -1 --oneline` 于 Docs 收口提交；当前 tip 在 `d6144ee` 之上）

---

## 3. §9 等价自测清单

- [x] Pro / 无 Long-running（门禁；建议 Settings 再看一眼）  
- [x] 本地 Approvals 为 Auto-review（门禁；建议复核）  
- [ ] 目标仓 Cloud Environment 能装依赖并跑通一条测 — **本轮未做**（无 environment.json）→ **待验证**  
- [x] 真实任务：**计划 → 2 切片 → 2 commit**（网络库；均在本仓）  
- [x] 中途批准次数相对「一整段硬撑」可控（Auto-review + 片末看 diff）  
- [x] 能说与 Ultra Long-running 差一句：无官方长时互检 harness，用切片交接补跟完  

---

## 4. 最小记忆卡（本仓实践）

```text
Pro = 切片 + 本机 Auto-review（本轮未上云）
网络库五项：域测 + 本地 Git 拉取冒烟即可复跑
文档只写本仓 Docs/；不回写其它仓库
禁：无环境上空转 Cloud / 无限续跑 Hook
```

---

**版本**：v1.0 | **更新**：2026-08-01  
**证据级别**：切片 A `verify:tauri` 73 tests + commit `d6144ee` **已验证**；Cloud Environment **待验证**；门禁 Pro/Auto-review 以用户执行计划为 **建议** 已齐、建议本机 Settings 复核。
