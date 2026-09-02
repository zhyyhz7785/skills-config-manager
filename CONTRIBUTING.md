# Contributing

**Skills Config Manager (CCM)** is a Windows desktop app (Tauri 2 + Rust). Please keep changes small and testable.

## Setup

- Node.js (npm)
- Rust stable ≥ 1.85 (`edition2024` is required by a dependency)
- Windows (most library tests hard-code Windows paths)

```bash
npm install
npm run tauri:dev
npm run typecheck
npm run verify:tauri
```

`verify:tauri` runs frontend i18n tests then `cargo test --lib`. On Linux, about 9–10 tests fail on hardcoded `C:\` paths — expected, do not “fix” those by weakening Windows behavior.

## Library layout (hard)

CCM writes skills and rules into the **permanent library** and **containers** as:

| kind | relative path |
|------|----------------|
| skill | `skills/{id}/` (directory unit with `SKILL.md`) |
| rule | `rules/{id}/{id}.mdc` (folder shell) |

Do not flatten nested rules back to `rules/{id}.mdc`. Opening a rule should reveal `rules/{id}/`, not a crowded `rules/` dump.

## Product boundaries

- **Default workspace** deploy = **copy**. No symlink “library = in effect”.
- **Non-default workspace** may symlink to the library. If create fails, error out — never silently fall back to copy.
- Network-library entries cannot deploy until promoted into the permanent library.
- Content-hash conflicts need a picker. Do not overwrite the canonical copy silently.

## Pull requests

1. One concern per PR.
2. New user-visible strings: add `zh-CN` first, then `en` (`src/i18n/`).
3. Fill the PR template. Link an issue if there is one.

## License

By contributing you agree the work is released under the MIT License.
