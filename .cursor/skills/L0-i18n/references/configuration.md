# 配置：locale 身份、回退、检测、持久化

**结论（建议）**：全仓只用 `zh-CN` + `en`；默认永远是简体中文；非法值忽略；持久化后重启仍保持。不要默认跟随浏览器语言。

回到入口：[SKILL.md](../SKILL.md)

## locale 身份

**locale**（语言区域码）是选定哪本词典、哪套 `lang` 的主键。四处必须相同：配置、词典文件名、切换器 `value`、回退规则。

| 角色 | locale 码 | **BCP 47**（语言标签标准）`language` | 界面显示名（走 `t()`，按键取当前语言字符串） | 词典 |
|---|---|---|---|---|
| 第一语言 / 默认 | `zh-CN` | `zh-CN` | `locale.zh` → 中文 / Chinese | `zh-CN.ts`（或 `zh-CN.json`） |
| 第二语言 | `en` | `en` 或 `en-US`（全仓只选一种） | `locale.en` → English | `en.ts`（或 `en.json`） |

仓库若已用 `en-US` 文件名，继续用 `en-US`，不要再引入 `en`。新建项目用 `en`（与 HyMdTauri2 已验证方案一致）。

白名单之外的值一律忽略，保持当前（或默认 `zh-CN`）。

## 回退

**回退**（fallback）是当前词典缺键时改用另一本词典，避免空白或抛错。

链固定为：

1. 当前 locale 的词典
2. `zh-CN`（源语言）
3. 键名字符串（开发期可见漏译，禁止用空串冒充）

```ts
const dict = DICTS[getLocale()] ?? zhCN;
let s = dict[key] ?? zhCN[key] ?? String(key);
```

未知 locale → 直接用 `zh-CN` 词典。不要回退到英文。

## 检测政策

**结论（建议）**：中文产品首次打开必须是简体中文；**不要**用浏览器 / **OS**（Operating System，操作系统）语言自动改默认。

| 来源 | 默认是否启用 | 原因 |
|---|---|---|
| 产品默认 | 是：`zh-CN` | 语言政策硬约束 |
| 用户上次选择（持久化） | 是 | 切过英文后重启应保持 |
| 浏览器 `Accept-Language`（HTTP 请求里声明的语言偏好）/ `navigator.language`（浏览器界面语言） | 否 | 英文系统会把中文产品第一次变成英文 |
| OS 区域设置 | 否 | 同上 |

仅当用户明确要求「跟随系统」时，才在**无持久化记录**的前提下读取浏览器语言，且仍须映射到白名单：`zh*` → `zh-CN`，`en*` → `en`，其它 → `zh-CN`。

## 持久化

桌面壳优先 **`localStorage`**（浏览器本地键值存储，关应用后仍在）键 `{app}.locale`（`{app}` 换成产品短名，如 `hymd.locale`）。与 Rust `settings.json` 分离时，在项目架构文档写清「界面语言存在哪」。

读写约定：

- 启动：读存储 → 在白名单内则用，否则 `zh-CN`
- 切换：写存储 → 通知订阅者 → UI 立即重渲染
- 无 **DOM**（Document Object Model，页面对象树；单测里常没有）：读失败视为 `zh-CN`，写失败忽略

Web 带账号的产品可用服务端偏好覆盖本地，但仍以用户显式选择为准，不以浏览器语言覆盖已保存值。

## `<html lang>`

切换 locale 时同步：

```ts
document.documentElement.lang = locale; // "zh-CN" | "en"
```

静态 `index.html` 写 `lang="zh-CN"` 作为无脚本回退。HyMdTauri2 未随切换更新此项（已验证缺口）——新项目应做。

## Verification

- [ ] 配置、文件名、切换器、回退四处 locale 码一致
- [ ] 无持久化时启动语言是 `zh-CN`，不是英文
- [ ] 非法存储值被忽略，界面仍为 `zh-CN` 或上次合法值
- [ ] 切到 `en` 后重启仍为 `en`
- [ ] 缺键回退到中文或键名，不出现空白
- [ ] `<html lang>` 随切换变化
