# 012 · 详情 Markdown 多页签 `Context "nodes" not found`

> **日期**：2026-07-27  
> **状态**：已验证（生产多次正常；修复后 `npm run dev` 多页签通过）  
> **关联**：[`DetailMarkdownCrepe.tsx`](../../src/components/DetailMarkdownCrepe.tsx)、[`enterContract.ts`](../../src/lib/enterContract.ts)、[`vite.config.ts`](../../vite.config.ts)

## 1. 现象

| 项 | 内容 |
|---|---|
| 界面 | 右栏「Markdown」页签打开后画布空白或红条；文档条（文件名/路径）仍正常 |
| 红条文案 | `Markdown 编辑器创建失败: Context "nodes" not found, do you forget to inject it?` |
| 只读兜底 | 红条下方 `<pre>` 能显示正文（说明主进程读盘与 frontmatter 剥离正常） |
| 复现模式 | **第一个** Markdown 页签常正常；**第二个及以后**失败。`npm run build` + `npm start` 多次连开多页签**无此问题**；`npm run dev` 易复现 |

## 2. 排查时间线（为何难找）

按时间顺序，中间踩过的坑都记下来，避免以后再绕：

1. **先误判「正文为空 / 路径越界」**  
   文档条有路径 → `buildDetail` / `resolveMetadataFilePath` 已读到文件；`splitFrontmatter` 对 `SKILL.md` 正常。**已排除。**

2. **再误判「零高度 create + 3 次重试放弃」**  
   SplitView 初始化瞬间高度为 0 确实会导致 Crepe（Milkdown 开箱编辑器）空白，且旧逻辑静默放弃。已做：`ResizeObserver` 驱动、失败可见化、只读兜底、create/destroy 超时。  
   修完后红条出现 → 说明 create **真的抛错**，不是静默空白。

3. **红条给出真异常后，误判「HMR 残留」**  
   用户一度「只重启 `npm run dev` 不 Ctrl+Shift+R」后正常，以为是热更新。再次冷启后**第二个页签仍失败** → 不是偶发 HMR。

4. **关键对照：发行版多次多页签正常**  
   生产打包只有一份模块图；开发态 Vite 预构建可能拆出多份 `@milkdown/*`。现象「dev 坏、prod 好」把范围收窄到 **模块身份 / ctx 切片**。

5. **两层真因叠在一起**（都要修）  
   - **插件单例**：模块顶层 `export const enterContractProse = $prose(...)` 被多个编辑器 `editor.use` 复用；Milkdown `$prose` 插件有状态，第二份编辑器易炸。  
   - **Vite 开发态多份 Milkdown**：`@milkdown/utils` / `@milkdown/core` / `@milkdown/prose` 与 `@milkdown/crepe`（经 `@milkdown/kit`）若解析成不同物理模块，ctx 里的 `nodes` 切片身份不一致 → 经典报错 `Context "nodes" not found`。

控制台仅有 Electron 开发期 CSP（Content Security Policy）警告时**不能**据此下结论；该警告与本故障无关。

## 3. 根因（已验证 + 推断）

### 3.1 Milkdown ctx 切片

Milkdown 用 `Ctx` 注入 schema 的 `nodes` 等切片。切片按**模块单例身份**识别。开发态若同时存在两份 `@milkdown/ctx`（或两份导出 `nodesCtx` 的 core），Crepe 内置 commonmark 注入的是 A 份的 `nodes`，自定义 `$prose` 去取 B 份的 `nodes` → 「not found」。

生产 Rollup 把依赖打进同一图 → 通常只有一份 → 不复现。

### 3.2 多页签保活

`DetailMarkdownTabHost` 最多保活 5 个页签，每个挂一个 `DetailMarkdownCrepe`。非激活页签不销毁编辑器。因此**一定会**同时存在多个 Crepe 实例。

## 4. 修复（已落地）

| 措施 | 位置 | 作用 |
|---|---|---|
| `$prose` 改工厂 | `src/lib/enterContract.ts` → `createEnterContractProse()`；`PluginKey` 随实例新建 | 每编辑器独立插件，禁止跨页签复用 |
| create 时 `use(createEnterContractProse())` | `DetailMarkdownCrepe.tsx` | 每次 create/重试新实例 |
| `resolve.dedupe` + `optimizeDeps.include` | `vite.config.ts` 的 `MILKDOWN_DEDUPE` | 开发态强制同一份 `@milkdown/*` |
| 导入统一走 `@milkdown/kit/*` | `enterContract` / `ensureProseLanding` / `vscodeCaret` / Crepe 宿主 | 与 Crepe 同源 kit，减少双路径 |
| 创建健壮性（前序） | 同文件：单飞、error 禁 RO 自动重试、失败条展示 `err.message`、关默认 Latex、去掉 create 期 `visibility:hidden` | 失败可观测；减少竞态与误测高 |
| 生产 build 不挂 watch | `vite.config.ts`：仅 `command === 'serve'` 时给 electron 主进程 `build.watch` | 避免 `npm run build` 写出产物后挂起 |

## 5. 回归与排障口令

**必测（dev）**

1. 停掉旧 `npm run dev`  
2. 若仍怀疑缓存：删 `node_modules/.vite` 再启  
3. `npm run dev` → 连开 ≥3 个不同 skill 的 Markdown 页签 → 均应所见即所得、无红条  
4. 关一页签再开、摘要↔Markdown 切换、折叠详情栏再展开

**对照（prod）**

```text
npm run build
npm start
```

产物：`e:\Code\CursorConfigManager\dist\`、`dist-electron\main.js`。再次连开多页签应仍正常（本轮前即已通过）。

**若红条再现**：把完整 `err.message` 抄下；优先怀疑又引入了直接 `@milkdown/utils|core|prose` 导入或去掉了 `dedupe`。

## 6. 教训（给以后的自己）

1. 「第一个正常、第二个失败」优先查**共享可变单例 / 插件复用**，不要先怪 HMR。  
2. 「生产好、开发坏」优先查 Vite **`dedupe` / optimizeDeps / 双路径导入**。  
3. 编辑器类库失败必须把 **`err.message` 打到 UI**；静默 `catch {}` 会多耗数小时。  
4. 用生产构建做对照实验成本低，应尽早做。

## 7. 相关文档

- [06-技术实现细节](../06-技术实现细节.md)（索引与踩坑表）  
- [05-启动与测试](../05-启动与测试.md)（dev 排障步骤）  
- [03-当前状态](../03-当前状态.md)（变更日志）
