# Launch drafts (do not post until GIF + Release installer exist)

**结论（建议）**：所有渠道压进同一个周二～周四的 48 小时窗口。一句差异化：**库 ≠ 生效，冲突有哈希人选。**

录 GIF（30 秒）：扫描 → 入库 → 部署 → 哈希冲突人选。上传仓库 Settings → Social preview（1280×640）。每条评论 6 小时内回。

仓库：https://github.com/zhyyhz7785/skills-config-manager

---

## Show HN

**Title:** Show HN: Skills Config Manager – local ledger for Cursor/Claude skills (library ≠ in effect)

I got tired of “install a skill” meaning “symlink it into the live folder and hope”. Skills Config Manager (CCM) is a Windows Tauri 2 app that keeps three layers apart:

- Network library: Git sources, read-only quarantine, cannot deploy
- Permanent library: canonical files on disk (they do not take effect)
- Container: what Cursor / Claude / Codex actually read

Default workspace deploy is a copy. Other workspaces can symlink. When copies diverge, you pick by content hash — no silent overwrite.

0.2.0 preview, Windows only, unsigned installer (SmartScreen may warn). MIT.

https://github.com/zhyyhz7785/skills-config-manager

---

## Reddit r/cursor

**Title:** I built a local ledger for Cursor skills/rules so the library is not “in effect”

Most managers treat a central folder as live. CCM keeps a canonical library, deploys into `~/.cursor` / project `.cursor`, and quarantines Git sources until you promote them. Conflicts are a hash picker.

Windows preview: https://github.com/zhyyhz7785/skills-config-manager

---

## Reddit r/ClaudeAI

**Title:** Local-first manager for Claude Code skills: quarantine → library → container

Same pitch. Claude is a first-class workspace alongside Cursor and Codex.

https://github.com/zhyyhz7785/skills-config-manager

---

## Reddit r/rust

**Title:** Built with Tauri 2 + Rust: a desktop ledger for AI coding-agent skills

Windows desktop app. Rust does scan / catalog / deploy / hash conflicts; React UI in WebView2.

https://github.com/zhyyhz7785/skills-config-manager

---

## V2EX · 分享创造

**标题：** Skills Config Manager：本机技能台账，库 ≠ 生效

一句话：Cursor / Claude / Codex 的 skills、rules 先入永久库记账，部署才进工具真正读取的目录；开源仓先进只读网络库，确认后再晋升。冲突按内容哈希人选，不静默覆盖。

Windows 预览 0.2.0，MIT。安装包未签名。

https://github.com/zhyyhz7785/skills-config-manager

---

## 掘金 / Linux.do

**标题：** 为什么 AI 技能需要台账，而不是 symlink 同步

正文骨架：

1. 痛：同名多份、不知道哪份定稿、开源技能直接装进生效目录。
2. 三层：网络库（检疫）→ 永久库（定稿、不生效）→ 容器（生效）。
3. 默认工作区复制、非默认 symlink；失败禁止静默改复制。
4. 哈希人选窗 vs 备份式 keep mine / remote。
5. 链接仓库、安装包、两个技能仓（product discovery / first-principles learning）。

---

## X / Twitter

1/ Skills Config Manager (CCM): local-first ledger for Cursor / Claude / Codex skills.

Library ≠ in effect. Git sources stay in quarantine until you promote. Conflicts: content hash, not “overwrite”.

2/ Windows preview 0.2.0 (unsigned). MIT.

https://github.com/zhyyhz7785/skills-config-manager

---

## Manual checklist

- [ ] Record `Docs/assets/demo.gif`
- [ ] GitHub Settings → Social preview 1280×640
- [ ] Confirm Release has `.msi` / `.exe`
- [ ] Pin three repos on GitHub profile
- [ ] Post Show HN + Reddit + V2EX + 掘金 + X the same Tue–Thu
- [ ] Reply to comments within 6 hours
- [ ] If trending: pitch 5–10 newsletters

## List PRs (status)

- `tauri-apps/awesome-tauri`：**不再收应用**（contributing.md 写 Application submissions are not accepted anymore）。本轮不提应用 PR。
- `JackyST0/awesome-agent-skills`：社区项目默认 **64 stars**。0 star 时提了也会被拒；star 过线后再投 Skills Collections / 管理器。
- `spencerpauly/awesome-cursor-skills`：跟进已开 PR #60，另开 first-principles-learning。
