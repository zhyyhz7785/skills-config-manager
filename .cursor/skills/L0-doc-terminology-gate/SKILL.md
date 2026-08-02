---
name: L0-doc-terminology-gate
description: |
  Docs / Learning / 面向用户 Markdown 的术语与证据门闩（检查表，不替代 alwaysApply rules）。
  触发：写或改 Docs/**、docs/**、Learning、Plan、Research、Evaluations、README、帮助文档、
  「更新文档 / 更新日志 / 学习笔记 / 写 Markdown / 术语自检 / 交付自检」时必须先读本 skill，
  再按检查表过检；不通过先改再交。
author: Cursor Agent
version: 1.0.0
date: 2026-08-02
---

# L0 文档术语门闩

**结论**：本 skill 只做交付前检查表；**不替代** `.cursor/rules` 下 `alwaysApply` 的 L0-01～05。禁止把五份 L0 全文粘进本文件。

## 权威来源（只引用，不复制全文）

| 规则 | 路径 | 本门闩核对什么 |
|---|---|---|
| L0-01 思考与讲解 | `.cursor/rules/L0-01-thinking-and-explanation/` | 节首结论先行；简体中文 |
| L0-02 术语与验收 | `.cursor/rules/L0-02-terminology/` | 术语首现「是什么＋起什么作用」；与 01/04 冲突时 02 优先 |
| L0-03 证据与诚实 | `.cursor/rules/L0-03-evidence-and-honesty/` | 关键结论标 已验证 / 推断 / 建议 / 待验证 |
| L0-04 / L0-05 | 同目录对应文件夹 | 少排版、命名；不压过 02 |

## 何时用

- 新建或修改 `{DOCS}`（`Docs/` / `docs/`）下任意 Markdown（含子目录 Learning / Plan / Research 等）
- 面向用户的 README、帮助、计划说明、提交说明中的长文段落
- 用户点名「术语自检 / 交付自检」

## 不做什么

- 不删除、不搬迁 L0 rules
- 不替代 `L0-project-docs-structure` 的目录结构职责
- 不输出「自检过程」给用户（内部过检即可）

## 交付前检查表（必须全部通过）

```
□ 每节首句是结论，不是铺垫？
□ 本回复/本文档中每个首现术语或缩写已紧跟「是什么＋起什么作用」（缩写含全称）？
□ 表格内首现术语已在该格解释？
□ 关键结论已标 已验证 / 推断 / 建议 / 待验证？
□ 无含糊指代（禁止用「那份文件」指整棵工作区目录树；tip/HEAD/PR 等须先定义）？
□ 未用「简短」省略术语解释（L0-02 优先于 L0-01）？
```

任一项失败 → 先改文再交付。

## 与文档结构 skill 的关系

写完/改完文档结构相关产出后：先过本检查表，再结束回合。结构流程见 `L0-project-docs-structure`。
