# Skills Config Manager (CCM)

**Local-first library and ledger** for Cursor / Claude / Codex **skills** and **rules** — know which copy is canonical, deploy with confidence.

[简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/zhyyhz7785/skills-config-manager)](https://github.com/zhyyhz7785/skills-config-manager/releases)
[![CI](https://github.com/zhyyhz7785/skills-config-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/zhyyhz7785/skills-config-manager/actions/workflows/ci.yml)

> Preview **0.2.0**, **Windows only**. The installer is unsigned, so Windows SmartScreen may warn on first run.

If this is useful, a star helps others find it.

## Why this exists

Most skill managers treat a central folder as “in effect” (often via symlink). CCM keeps three layers apart:

1. **Network library** — read-only quarantine for Git sources. Cannot deploy directly.
2. **Permanent library** — the canonical copy on disk. Files here do **not** take effect.
3. **Container** — the directory the agent actually reads (`~/.cursor`, project `.cursor`, …). Deploy copies (default workspace) or symlinks (non-default). Conflicts open a **content-hash** picker; nothing is overwritten silently.

## Demo

Record a 30-second pass: scan → ingest → deploy → hash conflict picker. Drop the GIF at `Docs/assets/demo.gif` and it will render here.

![Skills Config Manager](app-icon.png)

## Install

1. Download the latest `.msi` or NSIS `.exe` from [Releases](https://github.com/zhyyhz7785/skills-config-manager/releases).
2. Install. Settings live under `%APPDATA%\CCM-Tauri2`; the default library is `C:\CursorSkills` (you can change it).
3. Open the app → Settings → pick library / scan roots.
4. Scan to ingest local skills and rules, or fetch a Git URL on the Network shelf then **promote** into the library.
5. Select a workspace and **Deploy**. Default workspace = copy; others = symlink.

The window title still says **CCM-Tauri2** (data directory is not renamed in 0.2.0).

### Build from source

Requires Node.js, Rust ≥ 1.85, and Windows.

```bash
npm install
npm run tauri:dev
```

```bash
npm run verify:tauri
npm run tauri:build
```

## Related skills

CCM **manages** skills. These repos **are** skills you can install into an agent:

- [software-product-discovery](https://github.com/zhyyhz7785/software-product-discovery) — competitor research, five-axis scores, MVP, implementation path.
- [first-principles-learning](https://github.com/zhyyhz7785/first-principles-learning) — 15 questions to rebuild a subject from the ground up.

```bash
npx skills add zhyyhz7785/software-product-discovery --skill software-product-discovery --skill software-design-aesthetics --skill extreme-speed
npx skills add zhyyhz7785/first-principles-learning --skill first-principles-learning --skill first-principles-deep-dive
```

## Docs

| Doc | For |
|-----|-----|
| [01 Core logic](Docs/01-核心逻辑.md) | Product mechanism |
| [04 Start and test](Docs/04-启动与测试.md) | Commands |
| [06 Help](Docs/06-帮助文档.md) | Five-minute path (Chinese) |
| [CONTRIBUTING](CONTRIBUTING.md) | Build, tests, library layout |

## License

MIT. See [LICENSE](LICENSE).
