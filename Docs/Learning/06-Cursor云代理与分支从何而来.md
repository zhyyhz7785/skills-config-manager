# 06 · Cursor 云代理与分支从何而来

> **结论先行（已验证）**：你「只是尝试用云去完成计划」时，Cursor 会**自动**新建并推送 `cursor/cloud-agent-*` 分支（把当时工作区快照打包成一次 commit），还会把本地未提交改动打成 **stash**（是什么：Git 临时搁置区；起什么作用：先腾空工作树再交给云）。这些分支**不是**你手敲 `git checkout -b` 建的；眼下的 `cursor/network-library-n1-n4-p2` 才是后来本地「建分支并提交」动作留下的。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-02 |
| 动机 | 看不懂多条 `cursor/cloud-agent-*` / GitHub「分支删除或无权限」提示 |
| 证据来源 | 本机 `git branch -vv` / `git stash list` / `gh` 远程分支列表（**已验证**） |
| 合并操作 | 见同目录 [07-云代理分支检测与合并手册](07-云代理分支检测与合并手册.md) |

---

## 1. 一张图：谁造了谁

```text
你在 Cursor 里点「用云做计划 / Background Composer / Cloud Agent」
        │
        ├─① 把本地未提交改动 stash（文案常含 moved local changes to cloud agent）
        ├─② 新建远程+本地分支：cursor/cloud-agent-<时间戳>-<短 id>
        └─③ 在该分支上 commit：消息多为「Cursor: Apply local changes for cloud agent」

本地 Agent「创建分支并提交」（diff-tab）
        │
        └─④ 新建本地分支：cursor/<你起的短名>  （例：network-library-n1-n4-p2）
            默认未必 push → GitHub 网页上「找不到分支」
```

**Cloud Agent**（云代理）是什么：在 Cursor 云端虚拟机里跑的 Agent；起什么作用：不占你本机长时间编译/改代码，但要能访问 GitHub 仓才能读写分支。  
**OAuth**（开放授权）是什么：用 GitHub 账号登录第三方；起什么作用：让 Cursor 的 GitHub App 代替你访问仓库——私有仓必须单独授权，否则就会报「no access」。

---

## 2. 你仓库里现在有哪些相关分支

盘点时间：2026-08-02（本机 + `origin`，**已验证**）。

| 分支名 | 在哪 | 最新提交（摘要） | 怎么来的（推断→已用 git 佐证） |
|---|---|---|---|
| `main` | 本地 + 远程 | `924edc5` docs Pro 练习…（本地比 `origin/main` 超前 2 个 commit） | 日常主线 |
| `cursor/cloud-agent-1785592982212-mw2rn` | 本地 + 远程 | `e9034fc` Apply local changes…（2026-08-01 22:03） | **第 1 次云尝试**快照（网络库相关一大包，约 +3330 行） |
| `cursor/cloud-agent-1785595775928-fqzoo` | 本地 + 远程 | `3aa3b01` Apply local changes…（2026-08-01 22:49） | **第 2 次云尝试**快照（含 `NetworkShelf` / `network_p2` 等，后成本地网络库提交的母本） |
| `cursor/cloud-agent-1785631288728-m30of` | 本地 + 远程 | `a1f6c4a` Apply local changes…（2026-08-02 08:41） | **第 3 次云尝试**快照（更像 Plan/05 整包：漂移/CLI/E008/帮助等） |
| `cursor/network-library-n1-n4-p2` | **仅本地** | `05e9b30` feat(network): N1–N4…（2026-08-02 08:42） | 本地「建分支并提交」：内容与 `fqzoo` 那次 19 文件集对齐后 commit；**未 push** |

命名规律（**已验证**观察）：

- 云自动：`cursor/cloud-agent-<数字时间戳>-<随机后缀>`
- 本地人工/Agent 约定：`cursor/<短横线描述>`（仓库规则里也建议 `cursor/` 前缀）

---

## 3. 和「只是尝试用云」对得上的时间线

| 顺序 | 发生了什么 | 你能看到的痕迹 |
|---|---|---|
| A | 本地已有网络库等工作（未全提交） | 工作树脏 / 或已部分 commit 在 `main` |
| B | 多次启动云代理去做计划 | 远程多出 3 条 `cloud-agent-*`；每次一条 |
| C | 云启动前 Cursor 挪走本地改动 | `git stash list` 里多条 `moved local changes to cloud agent`（source agent `8afa9ed0-…`） |
| D | 云跑完或中断；GitHub App / 私有仓权限不稳 | Cursor 提示 OAuth / token / `repo_not_accessible` |
| E | 本地又做「只提交已暂存网络库」 | 新建 `cursor/network-library-n1-n4-p2`（本地-only） |

因此：**不是**「神秘多出来的无关功能分支」，而是「同一类实验（用云完成计划）重复了几次 + 一次本地收口提交」。

---

## 4. 为什么 GitHub / Cursor 会提示「分支删了或没权限」

常见叠了两层原因（对本仓同时成立，**已验证**）：

1. **分支确实不在远程**  
   例：当前工作分支 `cursor/network-library-n1-n4-p2` 从未 `git push`，网页/Cursor 云侧去解析它 → 「deleted or you don't have access」。

2. **私有仓 + Cursor GitHub 集成未授权**  
   仓 `CursorConfigManagerTauri2` 为 **PRIVATE**；本机 `gh` 有 `repo` scope 能读，但 Cursor 内置 GitHub App / OAuth 若没装到该仓，云功能仍会报 `ERROR_GITHUB_APP_NO_ACCESS` / 要求重新登录。

这和「代码写坏」无关；是**托管可见性 + 是否 push + Cursor 授权**三件套。

---

## 5. stash 是什么角色（别和分支搞混）

| | 分支 `cloud-agent-*` | stash「moved local changes…」 |
|---|---|---|
| 是什么 | 一条可推送的 commit 历史线 | 工作区临时备份包 |
| 起什么作用 | 给云 VM 一个可检出的起点/结果 | 启动云前腾空本地，避免冲突 |
| 会不会出现在 GitHub 分支列表 | 会（若已 push） | 不会 |
| 怎么看 | `git branch -a` | `git stash list` |

恢复 stash（慎用，先 `stash show`）：

```bash
git stash list
git stash show -p "stash@{0}"
# 确认后再：git stash apply "stash@{0}"
```

PowerShell 里 `stash@{0}` 要加引号，否则会被解析坏。

---

## 6. 你现在可以怎么整理（建议，不代执行）

| 目标 | 做法 |
|---|---|
| 只要本地继续做网络库 | 留在 `cursor/network-library-n1-n4-p2`；需要网页/PR 时再 `git push -u origin HEAD` |
| 确认某次云结果还要不要 | `git log main..<分支>` / `git show --stat <分支>`；不要的远程分支可删（删前确认无人依赖） |
| 减少下次「莫名分支」 | 用云前先自己 commit 或明确接受「云会建 `cloud-agent-*`」；私有仓先装好 Cursor GitHub App |
| 主线合并 | 审完后再 `merge`/`PR` 进 `main`；不必把三次云分支都合进去 |

**Won't（建议）**：不要为了消提示把仓改成 public——与开源决策「暂 private」无关，应修授权或 push。

---

## 7. 自检清单（以后再开云）

1. 开云前：`git status` 是否干净？不干净 → 预期会出现 stash 和/或 cloud-agent 分支。  
2. 开云后：远程是否多了 `cursor/cloud-agent-*`？那是正常副作用。  
3. 私有仓：Cursor Settings → GitHub 是否已授权本仓？  
4. 看 PR/网页前：当前分支是否已 `push`？

---

**版本**：v1.0 | **更新**：2026-08-02  
**证据级别**：分支名/提交/远程列表/stash 文案 → **已验证**；「三次云对应三次计划尝试」的意图对应 → **推断**（与时间戳与提交说明一致）；整理动作 → **建议**。
