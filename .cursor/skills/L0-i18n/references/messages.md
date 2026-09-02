# 文案：键、插值、源语言定键、对齐

**结论（建议）**：中文词典是键的唯一来源；英文用同一套键强制齐套；扁平点分键 + `{name}` 插值足够两语种桌面应用。

**locale**（语言区域码）用来选定哪本词典；本篇只管键怎么写、怎么对齐。

回到入口：[SKILL.md](../SKILL.md)

## 源语言定键

**源语言定键**是先在中文对象上加键，再用类型或测试迫使英文覆盖全部键。漏译在编译期或单测失败，而不是上线后空白。

TypeScript（已验证于 HyMdTauri2 `src/i18n/`）：

```ts
// zh-CN.ts —— 键的单一来源
export const zhCN = {
  "settings.language": "界面语言",
  "status.selected": "已选 {n} 字",
};

export type I18nKey = keyof typeof zhCN;

// en.ts —— 少键或多键都会让 tsc 失败
export const en: Record<I18nKey, string> = {
  "settings.language": "Display Language",
  "status.selected": "{n} selected",
};
```

JSON 项目没有 **`Record`**（要求对象必须具备指定键集的 TypeScript 类型）时，用单测比较 `Object.keys(zhCN)` 与 `Object.keys(en)` 必须相等。硬门禁：`Record` 或键集合测试，二者至少一条。

加键顺序：`zh-CN` → `en` → 调用 `t("…")`（按键取当前语言字符串）。禁止只写中文、英文留空。

## 键名

扁平点分，不用嵌套 JSON 当运行时结构（文件里可以按前缀分组书写）：

```
area.feature
area.feature.detail
```

常见前缀：`locale` / `settings` / `cmd` / `menu` / `status` / `confirm` / `error`。

键是语义，不是某一种语言的句子：

- 用：`confirm.deleteFile`
- 不用：`confirm.确定删除吗`

禁止在组件 / 命令注册表里拼接用户可见中文。动态枚举用 helper 映射到已声明键，少用 `as I18nKey`。

```ts
function paperMarginLabel(id: "narrow" | "normal" | "wide"): I18nKey {
  return `paper.margin.${id}` as I18nKey; // 仅当三键都已在 zh-CN 声明
}
```

## 插值

默认 `{name}` 占位 + 替换，不引 ICU（International Components for Unicode，复杂复数/阴阳性/日期格式库）：

```ts
s = dict[key] ?? zhCN[key] ?? String(key);
if (params) {
  for (const [k, v] of Object.entries(params)) {
    s = s.split(`{${k}}`).join(String(v));
  }
}
```

| 场景 | 做法 |
|---|---|
| 文件名、数量、路径 | `{name}` / `{n}` / `{path}` |
| 中英语序不同 | 整句各写一条，不要用字符串拼接语序 |
| 真复数（one/other/many） | 升级 ICU / 框架自带 plural；两语种桌面默认不必 |

日期与数字：两语种桌面可用 `Intl.DateTimeFormat` / `Intl.NumberFormat`（JavaScript 标准库里按 locale 格式化日期、数字的 API），传入当前 `zh-CN` 或 `en`。不要把格式化结果写进词典当死字符串，除非文案本身含固定示例。

## 调用面

| 场景 | 做法 |
|---|---|
| React 组件 | `const { t, locale, setLocale } = useI18n()`（订阅当前语言并在切换时重渲染的 Hook） |
| 非 React / 命令注册 | `import { t } from "./i18n"`；注册表依赖 `locale` 重建 |
| 只要订阅、自己不取文案 | 仍调用 `useI18n()`，让切语言时重渲染 |
| 可发布包 | 包内自带小词典 + `setLocale`；禁止 `import` 应用 `src/i18n` |

`t` 的 key 必须是 `I18nKey`（或框架等价的 typed key）。禁止 `t(someString)` 从接口错误信息直接当 key。

## 空串与漏译

- 词典值长度必须 > 0（单测扫一遍）
- 运行时缺键：回退中文，再缺则返回键名
- 不要用 `""`、`"TODO"`、`"***"` 占位提交

## Verification

- [ ] 每个新键先出现在 `zh-CN`，再出现在 `en`
- [ ] `en` 满足 `Record<I18nKey, string>`，或 keys 单测相等
- [ ] 无空串；插值句在中英都代入同一组 `{param}` 能读
- [ ] 组件 / 命令 / 对话框无硬编码用户可见中文
- [ ] 动态键都能在源词典里找到对应静态键
