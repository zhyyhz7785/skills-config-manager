# 桌面轻量配方（Tauri / React / TypeScript）

**结论（已验证于 HyMdTauri2）**：**Tauri**（Rust 后端 + 系统 WebView 的桌面框架）两语种壳用自建单例 **store**（全局状态）+ 中英 TypeScript 词典即可，不必引 **i18next**（流行的 JS 国际化库）。本篇是可复制骨架；把 `{app}` 换成产品短名。

回到入口：[SKILL.md](../SKILL.md)
政策与回退：[configuration.md](../references/configuration.md)
键与对齐：[messages.md](../references/messages.md)

**不要**把 `hymd.locale` 写成唯一合法键名。包边界、Rust 分层、切语言重建 **imperative DOM**（命令式直接改页面节点，相对 React 声明式）是可迁移部分。

## 何时用本篇

- 新 Tauri 2 / **Electron**（用 Chromium 套桌面的框架）/ 纯 React 桌面壳，只有 `zh-CN` + `en`
- 工作区尚无 vue-i18n / react-i18next

已有框架 i18n 库 → 不要套本骨架，只套 SKILL 的语言政策与验收。

## 文件布局

```
src/i18n/
  locale.ts     # Locale 类型、读写 {app}.locale、订阅
  zh-CN.ts      # 源语言词典（定键）
  en.ts         # Record<I18nKey, string>
  index.ts      # t() / useI18n()
  i18n.test.ts  # 空串、键对齐、插值
```

## locale 单例

**locale**（语言区域码）只在这一处读写；其它模块通过 `getLocale` / `subscribeLocale` 订阅。

```ts
export type Locale = "zh-CN" | "en";
export const LOCALES: readonly Locale[] = ["zh-CN", "en"];

const STORAGE_KEY = "{app}.locale";
const DEFAULT_LOCALE: Locale = "zh-CN";

const listeners = new Set<() => void>();
let current: Locale = loadLocale();

function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "zh-CN") return raw;
  } catch {
    /* 单测 / 无 DOM */
  }
  return DEFAULT_LOCALE;
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next !== "en" && next !== "zh-CN") return;
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  for (const cb of listeners) cb();
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
```

`document.documentElement.lang = next` 是本政策应做项；HyMd 未做，新项目不要省。无 `document` 时用 `typeof document !== "undefined"` 包一层。

## `t()`（按键取当前语言字符串）与 React Hook

```ts
import { useSyncExternalStore } from "react";
import { en } from "./en";
import { zhCN } from "./zh-CN";
import { getLocale, setLocale, subscribeLocale, type Locale } from "./locale";

export type I18nKey = keyof typeof zhCN;

const DICTS: Record<Locale, Record<I18nKey, string>> = {
  "zh-CN": zhCN,
  en,
};

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const dict = DICTS[getLocale()] ?? zhCN;
  let s = dict[key] ?? zhCN[key] ?? String(key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  return { locale, t, setLocale };
}
```

**useSyncExternalStore** 是 React 订阅外部 store 的 Hook，切语言时驱动重渲染。命令注册表用 `useMemo(..., [locale])` 重建 label，不要在模块顶层把 `t("cmd.save")` 算死一次。

## 切换器

设置页（或等价入口）顶部：

```tsx
const { locale, t, setLocale } = useI18n();

<label>{t("settings.language")}</label>
<select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
  <option value="zh-CN">{t("locale.zh")}</option>
  <option value="en">{t("locale.en")}</option>
</select>
<span>{t("settings.languageHint")}</span>
```

词典至少含：`locale.zh` / `locale.en` / `settings.language` / `settings.languageHint`（中文：「立即生效，重启后保持」）。

## 包边界

可发布包（编辑器核、webview）**禁止** `import` 应用的 `src/i18n`。

包内自带最小词典 + `setLocale(locale)` / `wt(key)`（包内翻译函数，名称自定）。宿主在创建实例时注入当前 locale；应用 `setLocale` 后**重建**该宿主（编辑器、预览面板），不要尝试逐节点改 imperative DOM。

非法 / 空 locale 在包内视为 `zh-CN`。

## Rust / 第三方

| 层 | 做法 |
|---|---|
| Tauri 命令错误 | 返回稳定错误码；前端 `t("error.whatever")` 映射。暂时不接则在架构文档标明「Rust 单语」 |
| **CLI**（Command Line Interface，命令行程序）独立二进制 | 可保持单语；不要与 **GUI**（Graphical User Interface，图形界面）词典各维护一套互不同步的长句 |
| Univer / CodeMirror（第三方表格 / 代码编辑器）及其它带 locale 的控件 | 单独把应用 locale 译成控件认识的码并传入；未接线 = 切英文后该块仍中文 |

## 实施顺序

1. 加 `src/i18n/` 四文件 + 单测（空串 / 键对齐 / 插值）
2. 根组件或设置页接 `useI18n` 与 `<select>`
3. 把当前改动涉及的硬编码中文迁进 `zh-CN.ts` / `en.ts`
4. 命令表、对话框走 `t()`
5. 包与第三方按上表决定注入或标明单语
6. 按 [verification.md](../references/verification.md) 跑默认中文 + 英文 + 重启

一次迁完全部历史字符串不是本篇的门禁；**新字符串**必须走词典。
