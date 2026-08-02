# 01 · 常用 Git 工作流程命令

> **结论先行**：日常协作可记成一条主链——**看状态 → 选片 → 提交 → 同步便签 → 推送 →（需要时）开 PR**。下面每段先给可复制命令块，再解释「是什么 / 起什么作用 / 何时用 / 边界」。概念底座（三区、便签、直播、PR）见 [../08-git-status与Pull-Request深入.md](../08-git-status与Pull-Request深入.md)。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-02 |
| 落点 | `Docs/Learning/git/`（Git 命令与流程速查） |
| 关联 | [08 status 与 PR](../08-git-status与Pull-Request深入.md) · [09 增量存储](../09-Git为何增量记忆与存储成本低.md) · [07 合并手册](../07-云代理分支检测与合并手册.md) |
| 证据 | 命令语义对照 Git 模型 → **已验证**；具体参数组合以本机 Git 版为准 → 个别标 **建议** |

---

## 0. 读本文前 30 秒

| 术语 | 是什么 | 起什么作用 |
|---|---|---|
| **工作区** | 项目根下整棵目录树（你正在改的文件） | 编辑 / 编译 / 运行 |
| **暂存区**（index） | 下次提交的选片清单 | 决定「这一刀」带哪些改动 |
| **commit**（提交） | 历史上一个固定快照点（有哈希 ID） | 可回退、可推送、可进 PR |
| **分支 tip** | 该分支名当前指向的最新 commit | 「这条线现在走到哪」 |
| **HEAD** | 「我现在检出在哪」的指针；日常贴在分支名上 | `status` 的已提交基线 |
| **便签**（教学比喻） | 远程跟踪支，如 `origin/main`：本地缓存的「上次同步时远端 tip」 | 比 ahead/behind；**不是直播** |
| **直播**（教学比喻） | 始终等于远端此刻 tip 的实时镜像 | Git **没有**；须 `fetch`/`pull` 才追上现场 |
| **PR**（Pull Request，拉取请求） | 请审阅并合并某分支相对 base 多出的 commits | 审查 / CI / 合入 main 的门 |

PowerShell：含 `stash@{0}` 一类参数请加引号（见 Learning/06）。

---

## 1. 每天开工：我在哪、脏不脏

**结论**：先 `status`，再决定是继续改、提交，还是先同步便签。

```bash
# 短格式：分支名 + 脏文件一览（日常首选）
git status -sb

# 完整段落说明（Changes not staged / to be committed / Untracked）
git status

# 未暂存：工作区相对暂存区/HEAD 的字节差
git diff

# 已暂存：即将进下一刀 commit 的差
git diff --cached
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git status -sb` | 工作区体检短报告 | 一眼看分支、ahead/behind、哪些路径脏 | ahead/behind 比的是**便签**，可能过期 |
| `git status` | 同上，英文分段版 | 分清「未暂存 / 已暂存 / 未跟踪」 | 不回答「相对 main 多了哪些功能」 |
| `git diff` | 未暂存内容差 | 看还没 `add` 的改动 | 不含已暂存、不含未跟踪新文件正文对比习惯用法 |
| `git diff --cached` | 已暂存内容差 | 提交前最后核对「这一刀」 | 工作区若又改过，与磁盘最新不完全相同 |

**建议自问三句**：① 在哪条支？② 脏的是未提交还是未 push？③ 便签是否该先 `fetch`？

---

## 2. 标准保存一刀：add → commit

**结论**：`commit` 只封存**暂存区**；先用 `add` 挑选，再写说明提交。

```bash
# 只把指定路径钉进暂存区（推荐：语义清晰）
git add Docs/Learning/git/01-常用Git工作流程命令.md
git add src-tauri/src/network_p2.rs

# 当前目录起已跟踪的改动都暂存（仍不含 ?? 未跟踪，除非路径被加进来）
git add -u

# 当前目录下能加的都加（含新文件；先看 status，防密钥/大目录）
git add .

# 交互式按块（hunk：diff 里一小段）挑选——进阶
git add -p

# 把暂存区打成 commit（会打开编辑器写说明；或用 -m）
git commit -m "说明：这一刀为什么留下（偏 why，少堆文件清单）"

# 偷懒：已跟踪且已修改的自动暂存再提交（仍不带 ??）
git commit -a -m "说明…"
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git add <路径>` | 把该路径当前内容写入暂存区 | 声明「下次 commit 带这一版」 | 之后若再改文件，须再 `add` 才进同一刀 |
| `git add -u` | 更新已跟踪文件的暂存 | 批量收已修改/删除 | **不**收全新未跟踪文件 |
| `git add .` | 从当前目录批量加入 | 快 | 易误加密钥、`target/` 等；先 `status` |
| `git commit -m "…"` | 封存暂存区为新 commit，分支 tip 前移 | 留下可推送的一刀 | 暂存区空则失败或无操作 |
| `git commit -a` | 自动暂存已跟踪修改再提交 | 少打一次 `add` | 不带 `??`；不能精细选片 |

**建议**：功能代码与 Learning 笔记尽量拆成两次 commit，避免语义捆死。

---

## 3. 开新功能线：从 main 拉分支

**结论**：在干净（或你愿意带着走的）工作区上，从最新 `main` 拉出功能支再改。

```bash
# 回到主线并更新便签 + 并入（当前在 main 上时）
git switch main
git pull

# 新建并切换到功能支（推荐用 switch）
git switch -c cursor/my-feature

# 旧写法等价（checkout 一物多用，易混）
git checkout -b cursor/my-feature

# 只切换到已有分支
git switch cursor/my-feature
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git switch <支>` | 检出到该分支 | 工作区换成该 tip；HEAD 贴分支名 | 有冲突级未提交改动时可能被拒 |
| `git switch -c <新支>` | 以当前 tip 为起点建支并切过去 | 隔离功能线 | 起点脏不脏都会「带着」未提交改动走（通常可） |
| `git pull` | ≈ fetch + 把上游并进当前支 | 本地 tip 跟上便签/网上 | 可能冲突；详见 §5 |

`git checkout <支>` 与 `git switch <支>` 在「切分支」上效果等价；只切分支时**建议**用 `switch`（见 Learning/08）。

---

## 4. 同步网上：便签 fetch / 吃进 pull

**结论**：`fetch` = 只换便签；`pull` = 换便签并并进当前本地分支。

```bash
# 只问网上走到哪：更新 origin/* 便签，不动本地分支 tip / 默认不改工作区文件
git fetch
git fetch origin

# 看便签刷新后：我比网上多/少哪些提交（以 main 为例）
git status -sb
git log --oneline main..origin/main      # 便签有、本地还没有（behind 侧）
git log --oneline origin/main..main      # 本地有、便签还没有（ahead 侧；常因未 push）

# 一键：刷新便签并并进当前分支（默认常为 merge）
git pull

# 更可控（建议）：先 fetch，再显式合并或变基
git fetch origin
git merge origin/main
# 或：git rebase origin/main
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git fetch` | 下载远端更新并改写远程跟踪支 | **只换便签** | 不把进度吃进本地 `main` |
| `git pull` | 常见 ≈ fetch + merge（可配 rebase） | 便签新且本地 tip 跟上 | 会改工作区；脏工作区易撞车 |
| `git merge origin/main` | 把便签指向的历史并进当前支 | 本地出现网上的 commits | 可能产生 merge commit 或冲突 |
| `git rebase origin/main` | 把你的提交「挪到」便签 tip 之后重放 | 历史更直 | 已 push 的共享支慎用；需懂冲突重放 |

**不是直播**：同事刚 push，你的 `origin/main` 不会自动跳——先 `fetch`。

---

## 5. 推上去、开 PR

**结论**：PR 比的是**已 push 的 commit 集合**，不是工作区脏文件。

```bash
# 把当前分支 tip 推到 origin；-u 写入上游跟踪（以后可直接 git push）
git push -u origin HEAD

# 已设上游后
git push

# 用 GitHub CLI 开 PR（需 gh 已登录且有权限）
gh pr create --base main --title "简短标题" --body "## Summary
- 点 1
- 点 2

## Test plan
- [ ] …"

# 查看
gh pr list
gh pr view
gh pr checks
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git push -u origin HEAD` | 把当前支推到远程同名支并设 upstream（上游：本地支默认跟踪的远端支） | 远端出现可开 PR 的 tip | 私有仓权限 / OAuth；冲突时须先拉再推 |
| `gh pr create` | 在 GitHub 上创建 Pull Request | 审查与合并门 | 未 push 则无可比 commits |
| `gh pr checks` | 看 CI（持续集成：自动测/编）状态 | 合并前是否绿灯 | 无 CI 则空或无检查 |

主链（**已验证**口径，与 Learning/08 一致）：

```text
改文件 → status → add → commit → push → gh pr create / 网页 Open PR
```

---

## 6. 审查后继续改：同一 PR 追加提交

**结论**：PR 开着时，本地再改 → 再 commit → 再 push，PR 自动指向新 tip。

```bash
git status -sb
git add <路径>
git commit -m "根据审查：…"
git push
gh pr checks
```

| 陷阱 | 正解 |
|---|---|
| 只改文件以为 PR 会变 | 必须 commit + push |
| 本地 clean 但网页旧 | 多半没 push，或看错分支 |

---

## 7. 合入后收尾（本地）

**结论**：网页或本地把功能支并进 `main` 后，切回 `main`、更新、删已合并的旧支（按需）。

```bash
git switch main
git pull

# 删本地已合并功能支（名字按实际替换）
git branch -d cursor/my-feature

# 删远程功能支（确认已合并且团队约定允许时）
git push origin --delete cursor/my-feature
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git branch -d` | 删除已合并的本地分支名 | 减少旧线干扰 | 未合并时 `-d` 会拒绝；强删用 `-D`（慎） |
| `git push origin --delete` | 删除远端分支 | 远程列表变干净 | 他人若还在用该支会受影响 |

本仓多云支收口优先读 Learning/07（超集支再合 main），勿对重叠支各开一个重复 PR（**建议**）。

---

## 8. 临时搁置与安全撤销（常用急救）

**结论**：未提交想换支 → 优先 `stash`；丢掉未暂存改动 → `restore`；动历史用重置类命令前先确认（本文只给常见安全档）。

```bash
# 把工作区/暂存改动捆成一包临时放下，工作区变干净
git stash push -m "换支前暂存"
git stash list
git stash pop              # 取出最近一包并尝试还原（PowerShell 对 stash@{0} 请加引号）
# git stash apply "stash@{0}"

# 丢弃某文件的未暂存改动，恢复成 HEAD（或暂存区）里的版本——不可轻易反悔
git restore -- 路径/文件.md

# 取消暂存（文件仍留在工作区改动里）
git restore --staged -- 路径/文件.md

# 看提交历史（只读）
git log --oneline -20
git log --oneline --graph --decorate -15
```

| 命令 | 是什么 | 起什么作用 | 边界 |
|---|---|---|---|
| `git stash` | 临时货架：搁置未提交改动 | 干净地切分支 / pull | 未跟踪文件默认可能不进 stash（可加 `-u`）；易忘取出 |
| `git restore` | 从 HEAD/暂存恢复文件内容或取消暂存 | 急救「改坏了 / 加错了」 | 丢弃工作区改动通常不可恢复 |
| `git log` | 只读浏览 commit 链 | 核对 tip、准备 PR 说明 | 不改任何区 |

**不在本文展开**（易伤历史，需单独学）：`reset --hard`、对已 push 历史 `rebase -i`、`push --force`。未明确需要时不要用。

---

## 9. 一张总流程（可钉在屏幕边）

```text
[每天]
  git fetch                 → 换新便签（可选但建议）
  git status -sb            → 我在哪 / 脏什么 / ahead|behind
  … 编辑工作区 …

[保存一刀]
  git add <路径>            → 选片进暂存
  git commit -m "…"         → tip 前移

[分享 / PR]
  git push -u origin HEAD   → 网上出现 tip
  gh pr create …            → 请审阅并入 base（常 main）

[跟上网上]
  git fetch                 → 只换便签
  git merge origin/main     → 或 git pull / rebase（按约定）

[合完收尾]
  git switch main && git pull
  git branch -d <功能支>
```

```text
工作区 --add--> 暂存 --commit--> 本地 tip --push--> 网上 tip --PR--> main
网上 tip --fetch--> 便签 origin/* --merge/pull--> 本地 tip 跟上
```

---

## 10. 场景速查表

| 我想… | 命令起点（**建议**） |
|---|---|
| 看现在怎样 | `git status -sb` |
| 只更新「网上在哪」 | `git fetch` |
| 本地 main 跟上网上 | `git switch main` → `git pull` |
| 开功能支 | `git switch -c <名>` |
| 提交部分文件 | `git add <路径>` → `git commit` |
| 开 PR | `git push -u origin HEAD` → `gh pr create` |
| 审查后更新 PR | `commit` → `git push` |
| 暂存现场去切支 | `git stash push -m "…"` → `switch` → 回来 `stash pop` |
| 撤销某文件未暂存改动 | `git restore -- <路径>` |
| 比功能支相对 main 多什么 | `git log --oneline main..HEAD` 与 `git diff main...HEAD` |

---

**版本**：v1.0 | **更新**：2026-08-02  
**证据级别**：命令与三区/便签/PR 关系 → **已验证**（Git 模型 + Learning/08）；本机默认 `pull` 是 merge 还是 rebase → 视配置，本文按常见默认写，标 **建议**；强推/硬重置未写入正文（**建议**另学）。
