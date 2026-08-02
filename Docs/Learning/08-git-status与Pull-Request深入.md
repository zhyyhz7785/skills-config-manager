# 08 · `git status` 与 Pull Request 深入

> **结论先行**：`git status` 回答的是「相对**当前已提交基线**，我的**工作区整棵目录**现在怎样」；**PR**（Pull Request，拉取请求——请审阅并合并某条分支上的提交）回答的是「请把我这条分支上的提交，审过后并进目标分支（通常是 `main`）」。前者是本地体检单；后者是远程协作/审查门。没 commit / 没 push 时，开不出有意义的 PR。

| 项 | 值 |
|---|---|
| 日期 | 2026-08-02 |
| 样本仓 | 本仓 `CursorConfigManagerTauri2`（盘点时状态 **已验证**） |
| 关联 | [06 云代理与分支](06-Cursor云代理与分支从何而来.md) · [07 合并手册](07-云代理分支检测与合并手册.md) · [09 增量存储](09-Git为何增量记忆与存储成本低.md) · [git 常用工作流程命令](git/01-常用Git工作流程命令.md) |

---

## 1. 先建立三个区（读懂 status 的前提）

### 1.1 工作区是文件夹，不是「某一个文件」

**工作区**（working tree / working directory）：是什么——Git 为你在磁盘上展开的**整棵项目目录树**（本仓即 `E:\Code\CursorConfigManagerTauri2\` 这一层文件夹，及其下的 `src\`、`Docs\`、`src-tauri\` 等**许多文件与子文件夹**）。起什么作用——你日常编辑、编译、运行程序，都改的是这棵树上的文件。

| 易混说法 | 对不对 | 说明 |
|---|---|---|
| 「工作区 = 一个文件夹」 | **对（建议这么记）** | 指项目根目录这棵树，不是单个 `.md` / `.rs` |
| 「工作区 = 某一个单独文件」 | **不对** | 单个文件只是工作区里的一员；`status` 会列出树里多个改动路径 |
| 「那份文件」旧表述 | **含糊，已废止** | 易被读成单文件；下文一律说「目录树 / 整棵项目文件夹」 |

`.git\` 目录在项目根内，但是 Git 的**仓库数据库**（对象与引用），一般不当作「给你编辑的工作区内容」；你改的是工作区里的源码与文档。

### 1.2 分支 tip 与 HEAD 是什么

先分清三个词（本仓可对照）：

| 术语 | 是什么 | 起什么作用 | 本仓例子（**已验证**口径） |
|---|---|---|---|
| **commit**（提交） | 历史上的一个固定快照点（有哈希 ID） | 留下可回退、可推送的一刀 | `05e9b30`、`924edc5` |
| **分支 tip**（分支尖端） | **该分支名字当前指向的那一个最新 commit** | 「这条线现在走到哪」；新 commit 后 tip 会挪到新点 | 分支 `cursor/network-library-n1-n4-p2` 的 tip = `05e9b30` |
| **HEAD** | 「我现在检出在哪」的指针；日常开发时它通常**贴在某个分支名上**，因而间接等于「该分支的 tip」 | `git status` 用它当「已提交基线」：工作区相对这个基线比有没有改 | 在该功能支上时：HEAD → 分支名 → tip `05e9b30` |

「**一般是某分支 tip**」整句拆开（针对旧文含糊处）：

1. 你执行 `git checkout 某分支` / `git switch 某分支` 后，HEAD **附着**在该分支名上。  
2. 分支名本身永远指向它的 tip（最新那个 commit）。  
3. 所以日常说「HEAD 在分支 tip」=「我正站在这条线的最新提交上」——**不是**说 tip 是另一种神秘对象。  
4. 例外（知道即可）：`git checkout 某个哈希` 会进入 **detached HEAD**（分离头指针——HEAD 直接指某个 commit、不附着分支名）；新手少用。

```text
分支名  network-library-n1-n4-p2  ────►  commit 05e9b30
                                      （该分支的 tip = 最新提交）

HEAD 日常「附着」在分支名上
  ⇒ 你也站在 tip 上
  ⇒ status 拿 tip 当「已提交基线」去比工作区
```

### 1.3 三区怎么串起来

```text
工作区 = 项目根文件夹整棵树（你正在改的磁盘内容）
    │  git add（挑选路径）
    ▼
暂存区 = 下次 commit 的选片清单
    │  git commit
    ▼
仓库历史 = commit 链条；分支名是指向某个 commit 的可移动标签
```

| 术语 | 是什么 | 起什么作用 |
|---|---|---|
| **工作区** | 项目根下的整棵目录树（文件夹 + 其内多文件） | 编辑 / 编译 / 运行的场所 |
| **暂存区**（index / staging） | 下一次提交的「选片清单」 | 允许一次只提交部分文件或文件内部分改动块（hunk：diff 里的一小段） |
| **HEAD** | 当前检出位置；日常附着某分支，因而落在该分支 tip | `status` 的对比基线 |
| **分支** | 指向某个 commit 的可移动名字 | 隔离功能线；PR 比较的是「本分支 tip 相对 base 多出的那些 commit」 |
| **远程跟踪支**（remote-tracking branch） | 本地的一张「便签」，记下**上次**从网上同步时、远端某分支停在哪个 commit；名字形如 `origin/main`（`origin`＝惯用的远程仓库绰号，`main`＝远端上的分支名） | 用来和本地同名分支比「我多几个 / 少几个 commit」（ahead / behind）；**不能**当 GitHub 实时画面 |

#### 远程跟踪支：像便签，不是直播（专解易混点）

**结论**：`origin/main` **住在你电脑的 `.git` 里**；它是「上次打电话问过 GitHub 之后，对方 `main` 停在哪」的备忘录，不是打开网页看到的那条线本身。

##### 「便签」这个词：概念与含义

**便签**（本文教学比喻，不是 Git 官方术语）：是什么——一张贴在本地仓库里的**备忘纸条**，上面只写一件事：「**某次同步成功时**，网上某个分支的 tip（最新 commit）是哪一个哈希」。起什么作用——让你在**不联网、不打开网页**时，仍能拿「我记得的网上位置」和本地分支比 ahead / behind；并在 `pull` / `merge` 时当「要把网上进度并进来」的参照点。

| 维度 | 含义 |
|---|---|
| **对应 Git 里的真名** | **远程跟踪支**（remote-tracking branch），例：`origin/main`、`origin/cursor/某功能支` |
| **纸条上写什么** | 通常就是一个 commit 哈希（那次抄下来的 tip）+「这是 origin 上的哪条支」 |
| **谁写、谁改** | 只有 `git fetch`，或 `git pull` 里的 fetch 那一半会**擦掉旧字、写上新 tip**；你日常 `commit` / 改文件**不会**改便签 |
| **谁读** | `git status` 的 ahead/behind、`git log xxx..origin/main`、把 `origin/main` merge 进本地时 |
| **为什么叫「便签」而不是「分支副本」** | 强调三点：① **本地只读备忘**（一般不直接在 `origin/main` 上开发）；② **有时间戳意味**——写的是「上次问询结果」，会过期；③ **不是第二条可检出的工作线**（你检出的是本地 `main`，不是去「编辑便签」） |
| **类比边界** | 像冰箱上贴的「牛奶还有半盒（昨天量的）」——方便对照，**不等于**此刻打开冰箱看到的真实存量；网上一变、你不 `fetch`，便签就过期 |

一句话：**便签 = 本地缓存的「远端某分支上次已知 tip」**；名字 `origin/main` 读作「origin 仓库上的 main，我这边记下的位置」。

##### 「直播」这个词：概念与含义（以及为何说「不是直播」）

**直播**（本文教学比喻，与「便签」对举；不是 Git 官方术语）：是什么——一种**始终跟着现场变**的信息通道：远端一有新 commit，你这边立刻看到同一个 tip，中间**没有「上次抄写、可能过期」的延迟**。起什么作用——在本文里当**反面教材**：用来点明「很多人以为 `origin/main` / `git status` 的 ahead/behind 就是此刻 GitHub」，而 Git **并不是**这种通道。

| 维度 | 「若真是直播」会怎样 | Git 实际（便签）怎样 |
|---|---|---|
| **刷新时机** | 同事 `push` 的瞬间，你本地显示自动跳 | 必须你主动 `git fetch` / `git pull`（或某些 IDE 代你 fetch）才更新 |
| **断网时** | 直播中断或标「不可用」 | 便签仍在，但可能**过期**；`status` 仍拿旧便签比 ahead/behind |
| **你看的是什么** | 远端现场 tip 本身 | 本地 `.git` 里抄下来的 tip |
| **常见误读** | 把 `origin/main` 当成「网上 main 的实时镜子」 | `origin/main` 只是**上次问询结果** |

**不是直播**整句拆开：

1. **不是**说 GitHub 网页不是真的——网页上的 `main` 才更接近「现场」。  
2. **不是**说本地永远不知道网上变了——`fetch` 就是主动去抄一版新现场。  
3. **是**说：远程跟踪支 / `status` 里的 `...origin/main [ahead N]` **默认不保证**等于「此刻打开 GitHub 看到的 tip」。  
4. IDE 若开了自动 fetch，只是**替你定期换便签**，仍不是毫秒级直播；两次自动同步之间便签照样可能旧。

一句话：**直播 = 始终等于远端此刻 tip 的实时镜像（Git 没有）**；**不是直播 = 你本地只有会过期的便签，要靠 fetch/pull 才追上现场**。

分清三样东西：

| 名字 | 在哪 | 白话 |
|---|---|---|
| **GitHub 上的 `main`** | 网上（远端仓库） | 别人 push 后会变；你不 `fetch`/`pull`，本地不知道它变了 |
| **本地分支 `main`** | 你电脑 | 你自己检出、commit 的那条线；可以比网上超前或落后 |
| **远程跟踪支 `origin/main`（便签）** | 也在你电脑（`.git` 里的只读备忘） | 上次同步成功时，把「网上 `main` 当时的 tip」抄到本地的便签 |

```text
网上 GitHub 的 main  ──(只有 fetch / pull 时才抄一遍)──►  本地便签 origin/main
本地分支 main  ←── status 用这两头比「ahead / behind」──►  本地便签 origin/main
```

- **ahead 2**：本地 `main` 比便签 `origin/main` **多 2 个已提交**——多半是你 commit 了还没 `push`，或别人还没拿到你的提交。  
- **behind**：便签比你本地 `main` 更新——网上已经往前走了，你本地还没把便签上的新提交并进本地分支。  
- **为何不是直播**（见上节定义）：同事刚 push 到 GitHub，你的 `origin/main` **不会自动跳**；要跑下面的 `fetch` / `pull` 才会动便签。在那之前，`status` 里的 ahead/behind 比的是**旧便签**，不是此刻网页上的 tip。

##### 便签怎么更新：`git fetch` 与 `git pull`

**结论**：`fetch` = **只换新便签**（不动你正在改的工作区 / 本地分支 tip）；`pull` = **先换新便签，再把便签上的新提交并进当前本地分支**（可能改你的文件）。

| 命令 | 是什么 | 起什么作用（便签说法） | 会不会改工作区里的文件 |
|---|---|---|---|
| **`git fetch`**（拉取远端信息） | 向 `origin` 问一声：「你们各分支现在 tip 在哪？把缺的 commit 对象也下载下来」 | **只更新便签**（如把 `origin/main` 挪到网上最新 tip）；本地分支 `main`、HEAD、工作区原样不动 | **默认不改**你正在编辑的文件 |
| **`git pull`**（拉取并合并） | 常见默认 ≈ `git fetch` + 把对应远程跟踪支**合并进当前分支**（merge；也可配置成 rebase） | **先换新便签，再把便签内容吃进本地分支**——本地 tip 前移（或多一个 merge commit） | **会**（合并进当前支时改工作区；有冲突要你动手解决） |

```text
只想知道「网上走到哪了 / 我 ahead 还是 behind？」
  → git fetch
  → 看 status / git log main..origin/main
  （便签新了；你的本地 main 与工作区还停在原地）

既要便签新，又要本地分支跟上网上
  → git pull          （当前就在 main 上时最直观）
  或分两步（更可控，建议）：
       git fetch
       git merge origin/main    # 或 git rebase origin/main
```

对照口诀（**建议**）：

1. **便签**（`origin/main`）← 只有 `fetch` / `pull` 里的 fetch 部分会改它。  
2. **本地分支 tip** ← `commit` 往前推；`pull`/`merge`/`rebase` 也能往前推；**单靠 `fetch` 不会推**。  
3. **工作区脏文件** ← 与便签无关；`fetch` 不收拾它们；`pull` 若碰上未提交改动与网上改动撞车，可能拒绝或冲突。

**边界（建议记法）**：改文件、看工作区脏不脏 → 比的是 HEAD/tip；问「我和网上差几刀提交」→ 先 `fetch` 刷新便签，再比本地分支 vs `origin/…`。

**边界**：`status` **不**负责讲「相对 `main` 我多了哪些功能 commit」——那要用 `git log main..HEAD` / `git diff main...HEAD`。很多人把「工作区脏了」和「功能支比 main 超前」混成一句话，就会觉得 status「信息不对」。

---

## 2. `git status` 在报告什么

### 2.1 短格式（日常）

```bash
git status -sb
```

本仓某次真实输出（**已验证**，2026-08-02）：

```text
## cursor/network-library-n1-n4-p2
 M Docs/03-实施与状态.md
 ...
?? Docs/Learning/06-....md
```

| 符号/行 | 含义 |
|---|---|
| `## 分支名` | 当前在哪条支；若写成 `## main...origin/main [ahead 2]`，表示本地 tip 比远程跟踪支多 2 个 **已提交** |
| 行首空格 + `M` | **已修改、未暂存**（工作区 ≠ HEAD，且还没 `git add`） |
| 行首 `M` + 空格 | **已暂存**（index ≠ HEAD；工作区可能又改过 → 会出现 `MM`） |
| `??` | **未跟踪**：Git 还不认识这个路径，commit 永远带不上，除非 `add` |
| `A` / `D` 等 | 暂存的新增 / 删除 |

完整版 `git status` 会用英文段落写清：*Changes not staged* / *Changes to be committed* / *Untracked files*——对应上面三区。

### 2.2 三种「干净」容易误解

| 说法 | 真正意思 |
|---|---|
| working tree clean | 相对 **当前 HEAD / 分支 tip**（最新已提交快照）：工作区整棵树无未提交改动、无未跟踪（或已被 ignore） |
| 相对 main 已合完 | 需要看分支图 / PR；clean **不能**证明已并进 main |
| 和 GitHub 网页一致 | 还要 push；本地 clean 但未 push → 网页仍停在旧的 tip |

### 2.3 和「相对 main 的功能差」怎么分工

| 问题 | 命令 |
|---|---|
| 我改乱工作区了吗？有哪些没提交？ | `git status` |
| 看具体字节差 | `git diff`（未暂存）· `git diff --cached`（已暂存） |
| 这条功能支比 main 多哪些 **提交**？ | `git log --oneline main..HEAD` |
| 这条功能支比 main 多哪些 **文件内容**？ | `git diff main...HEAD`（三点：从合流点比到 tip） |

本仓当时：**status 很脏**（证据文档、单测、Learning 未提交），但 `HEAD` 已在 `network-library` 上有一个相对 main 的 commit `05e9b30`——这两件事同时成立，不矛盾。

### 2.4 为什么要有 `git add`？为什么不直接 `commit`？

**结论**：`git commit` 默认只把**暂存区**打成快照；`git add` 的作用是「**挑选**哪些改动进入下一次快照」。中间多这一步，是为了让「磁盘上正在改的一切」和「历史里值得留下的一刀」可以分离。

| 命令 | 是什么 | 起什么作用 |
|---|---|---|
| `git add <路径>` | 把工作区里该路径的当前内容写入暂存区 | 声明：「下次 commit 带上**这一版**」 |
| `git commit` | 把暂存区做成一个新的 commit，并把**当前分支名**挪去指向它（tip 前移） | 留下可推送、可 PR、可回滚的历史点 |

若设计成「commit = 工作区全盘拍照」，会失去：

1. **选片提交**：一次改了很多文件，只想先提交「网络库代码」，Learning 笔记明天再交——`add` 指定路径即可。  
2. **同文件拆两次交**：一个文件里既有功能又有随手调试；可 `git add -p` 按块暂存（进阶）。  
3. **未跟踪文件默认不进历史**：`??` 必须先 `add` 才被承认，降低误把密钥/大目录塞进仓库的概率（仍要靠 `.gitignore`）。  
4. **稳定「将提交内容」**：你继续改工作区时，已 `add` 的那一版可以先钉在暂存区；`commit` 拍的是钉住的版本，不是你鼠标下最新未 add 的字节（除非再 add）。

本仓直觉例子（**推断**你当前 status）：同时有 `deploy.rs` / `network_p2.rs`（代码）和 `Docs/Learning/06…`（笔记）。若「直接 commit 工作区全部」，一次提交会把「功能」和「学习笔记」捆死；用 `add` 可以拆成两次语义清晰的 commit。

**那 `git commit -a` 呢？**  
`-a` 会把**已跟踪且已修改**的文件自动塞进暂存再提交——跳过手写 `add`，但：

- **仍不会**带上 `??` 未跟踪文件；  
- 无法精细选文件；  
- 适合「我确定已跟踪文件的改动全都该进这一刀」时偷懒。

所以：不是「Git 故意麻烦」，而是默认假设——**工作区常常比一次好提交更脏、更混**；`add` 是过滤器。

```text
工作区（常更脏、更混）
    │  add = 挑选 / 钉住一版
    ▼
暂存区（即将成为历史的那一刀）
    │  commit = 封存
    ▼
提交历史（给 PR / 回滚 / 别人看的故事）
```

---

## 3. 从 status 到「可以开 PR」要过几道门

```text
改文件
  → status 出现 M / ??
  → git add …          （进暂存）
  → git commit         （进历史；status 对该部分变干净）
  → git push -u origin HEAD   （远端出现同名分支 tip）
  → gh pr create / 网页 Open PR
```

缺任一步：

| 卡在哪 | 现象 |
|---|---|
| 只改未 commit | status 有 M；PR **没有**这些改动 |
| commit 未 push | 本地有 tip；GitHub「分支不存在 / 无权限」或 PR 基线看不到新 commit |
| 私有仓未给 Cursor/GitHub App 授权 | 工具链报 OAuth / `repo_not_accessible`（见 Learning/06） |
| 已 push 但 base 选错 | PR 比错了目标支（应通常是 `main`） |

**PR 比的是 commit 集合，不是工作区。** 这是最深的一句。

---

## 4. Pull Request 是什么（机制，不只是按钮）

### 4.1 定义

**PR**（Pull Request）：在托管平台（本仓为 GitHub）上发起的请求——「请审阅分支 `feature` 相对 `base`（常为 `main`）多出来的 commits，并在通过后合并」。  
起什么作用：把 **代码审查、讨论、CI（持续集成，自动测/编）门禁、合并策略** 绑在一次可讨论的变更上，而不是直接 `push` 到 main。

它不是 Git 核心对象（本地没有「PR 类型」）；是 GitHub 用 API 记在远程的元数据 + 一套 UI。本地等价思维是：`git log base..head` + 人工合并。

### 4.2 PR 上的关键名词

| 术语 | 是什么 | 起什么作用 |
|---|---|---|
| **base** | 打算并进去的支（常 `main`） | 定义「相对谁」 |
| **compare / head** | 你的功能支 tip | 定义「多出来的 commits」 |
| **ahead / behind** | 相对对方多/少几个 commit | 判断要不要先 `git fetch` + rebase/merge base |
| **merge commit / squash / rebase** | 三种并入历史的形状 | 影响 main 是否保留功能支每一个小 commit |
| **draft PR** | 草稿，默认不合并 | 早分享 diff、仍继续推 |

### 4.3 和「本地 merge」的关系（见 Learning/07）

| 做法 | 场景 |
|---|---|
| 本地 `git checkout main && git merge <支>` | 单人、可直写 main、或不走网页 |
| GitHub PR | 要审查、CI、或权限上禁止直推 main |

对本仓：多条 `cloud-agent-*` **已经在远程**；`network-library-*` **仅本地**——若要对后者开 PR，必须先 `push`。若按 Learning/07 建议合 **m30of**，应对 `m30of`（或合并后的整理支）开 PR，而不是对四条支各开一个重复 PR。

---

## 5. 用本仓状态做「对照练习」（已验证快照）

盘点时（2026-08-02）：

| 观察 | 读法 |
|---|---|
| `On branch cursor/network-library-n1-n4-p2` | HEAD 在功能支，不在 main |
| 多文件 `Changes not staged` + 若干 `Untracked` | 工作区相对 tip `05e9b30` 又脏了；**这些不会进已有 PR**，除非再 commit+push |
| `main ... origin/main [ahead 2]` | 本地 `main` 比便签 `origin/main`（上次同步记下的网上位置）**多 2 个已提交**；与当前功能支脏文件无关 |
| `gh pr list` 空 | 远程尚无打开的 PR（或无权列出） |
| 远程有 `cloud-agent-*`，无 `network-library-*` | 云支可被网页看见；本地收口支网页默认看不见 |

**自问三句（建议每次看 status 时默念）**：

1. 我在哪条支？  
2. 脏的是「未提交工作区」还是「已提交但未 push」还是「相对 main 的功能 commits」？  
3. 若现在开 PR，平台能看到的 tip 是哪一个 commit？

---

## 6. 常用命令块（本机可复跑）

```bash
# 体检
git status
git status -sb

# 刷新便签（只更新 origin/*，不动本地分支 / 工作区）
git fetch

# 刷新便签并把网上进度并进当前分支（≈ fetch + merge；更可控可拆成 fetch 再 merge）
git pull

# 未暂存 / 已暂存 diff
git diff
git diff --cached

# 功能支相对 main（提交级 / 内容级）
git log --oneline main..HEAD
git diff main...HEAD

# 便签刷新后：本地 main 比网上（便签）多/少哪些提交
git log --oneline main..origin/main    # 便签有、本地还没有（behind 侧）
git log --oneline origin/main..main    # 本地有、便签还没有（ahead 侧；常因未 push）

# 推当前支并设上游（开 PR 前）
git push -u origin HEAD

# 用 GitHub CLI 开 PR（需已登录且有权限）
gh pr create --base main --head cursor/network-library-n1-n4-p2 --title "…" --body "…"

# 看 PR
gh pr list
gh pr view
gh pr checks
```

PowerShell 注意：含 `stash@{0}` 一类参数要加引号（见 Learning/06）。

---

## 7. 边界与陷阱

| 陷阱 | 正解 |
|---|---|
| status 干净 = 可以合 main | 否；只说明相对 **当前 tip** 无未提交改动 |
| `status` 的 ahead/behind = 此刻 GitHub（当成直播） | 否；比的是便签（可能过期）；先 `git fetch` 再看才接近「网上现在」 |
| `git fetch` 会改我正在写的文件 | 否；fetch **只换便签**；要改本地 tip/工作区才用 `pull` / `merge` / `rebase` |
| `git pull` = 只下载看看 | 否；pull 还会把便签并进当前分支，可能冲突 |
| 开了 PR 后本地再改文件 | 必须再 commit + push，PR 才会更新 |
| `git add .` 盲加 | 可能把密钥、巨大 `target/`（若未 ignore）塞进提交；先看 `status` |
| 多条云支各开 PR | 内容重叠，审查灾难；先按 Learning/07 选一条超集 |
| Cursor 网页说 branch deleted / no access | 常是未 push 或私有仓 OAuth，不是 status「撒谎」 |

---

## 8. 一张总图

```text
[工作区整棵文件夹脏] --add--> [暂存] --commit--> [本分支 tip 前移]
                                                    --push--> [网上同名分支 tip]
                                                                  |
                                                                  +-- PR --> 审完 merge 进 main

网上 tip --fetch--> [本地便签 origin/*] --pull 的后半 / merge--> [本地分支 tip 跟上]
                      ↑
              status 的 ahead/behind 拿「本地支」和「便签」比

git status：工作区 / 暂存 相对「当前 tip」比什么；
PR：谈的是 origin（网上）上已经有的 tip 与 base 的 commit 差。
```

---

**版本**：v1.5 | **更新**：2026-08-02  
**证据级别**：§1 工作区=目录树、tip=分支最新 commit、便签/直播=对举教学比喻（缓存 tip vs 实时镜像）、fetch 只换便签 / pull≈fetch+并入 → **已验证**（对照 Git 模型 + 本仓路径）；§2.1 / §5 命令输出 → **已验证**；合并选支 → Learning/07（**建议**）。
