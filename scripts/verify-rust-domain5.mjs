#!/usr/bin/env node
/** Domain5: cargo test covers projects + tags_purpose (+ domain3–4 regression). */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
console.log('=== cargo test (incl. projects / tags_purpose) ===')
const cargo = spawnSync(
  process.execPath,
  [
    path.join(root, 'scripts', 'with-cargo.mjs'),
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    '--',
    '--test-threads=1',
  ],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(cargo.stdout || '')
process.stderr.write(cargo.stderr || '')
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

console.log(
  '\nDomain5 checks passed (MVP: projects CRUD + tags/purpose; refresh / full discovery / backup still sidecar)',
)
