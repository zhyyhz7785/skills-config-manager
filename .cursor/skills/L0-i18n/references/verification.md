# 双语言验收

**结论（建议）**：改动完成的标志是默认中文正确、切英文后对应面都变、重启仍保持、键对齐测试绿。缺一项不得称「已国际化」（**i18n**，internationalization，把界面文案抽成可切换词典）。

回到入口：[SKILL.md](../SKILL.md)

对照实现形态见 [messages.md](messages.md) 与 [configuration.md](configuration.md)。桌面骨架的测试写法摘自 HyMdTauri2 `src/i18n/i18n.test.ts`（已验证）。

## 自动测试（必做）

无测试框架时至少加这三条；有 vitest / jest（JavaScript 单测运行器）则落地为单测。

```ts
it("has no empty strings in zh-CN or en", () => {
  for (const [k, v] of Object.entries(zhCN)) expect(v.length, k).toBeGreaterThan(0);
  for (const [k, v] of Object.entries(en)) expect(v.length, k).toBeGreaterThan(0);
});

it("keeps zh-CN and en key sets aligned", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
});

it("interpolates placeholders in both locales", () => {
  setLocale("zh-CN");
  expect(t("status.selected", { n: 12 })).toBe("已选 12 字");
  setLocale("en");
  expect(t("status.selected", { n: 12 })).toBe("12 selected");
});
```

插值用例换成项目里真实的一条带 `{param}` 的键。TypeScript 已用 `Record<I18nKey, string>` 时，键对齐测试仍建议保留（防运行时对象被改）。

## GUI（Graphical User Interface，图形界面）/ 手测（改切换或新界面时做）

在**默认中文**与**英文**各走一遍同一路径：

- [ ] 启动无持久化 → 界面为简体中文
- [ ] 设置（或等价入口）能切到 English，菜单 / 命令面板 / 对话框同步变
- [ ] 再切回中文，无残留英文硬编码
- [ ] 重启后仍为上次选择
- [ ] `<html lang>` 为 `zh-CN` 或 `en`，与当前 **locale**（语言区域码）一致
- [ ] 带数量/文件名的句子插值正确，无残留 `{n}`

未测 GUI 时如实写「待验证」，不得称通过。

## 分层缺口清单（每次 Inspect 扫一眼）

下列不自动跟随应用 locale，漏接就标「单语不接入」或补接线：

| 面 | 验收问题 |
|---|---|
| Rust / **CLI**（Command Line Interface，命令行程序）错误 | 切英文后错误弹窗是否仍是中文硬编码？ |
| 可发布包内 **imperative DOM**（命令式直接改页面节点，相对 React 声明式） | 切语言后是否重建或调用了包内 `setLocale`？ |
| 第三方表格 / 编辑器 | 自带 locale 是否单独传入？ |
| 系统托盘 / 原生对话框 | 是否走同一套 `t()`？ |
| 静态 `index.html` 文案 | 有无未进词典的标题？ |

后端选择（硬门禁第 5 条）：错误码 + 前端映射，或标明单语。禁止静默中英各写一套互不同步的 Rust 字符串。

## 交付口径

向用户汇报时区分：

- **已验证**：单测绿；或 GUI 已在两种语言下走过受影响路径
- **推断**：代码路径显示已接 `t()`，但未手测
- **待验证**：第三方控件、原生对话框、`<html lang>` 等未测项
- **建议**：明确标了「单语不接入」的后端错误

无对齐测试且未手测双语言 → 不能写「已完成 i18n」。
