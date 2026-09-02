#!/usr/bin/env node
/** Refresh MVP: cargo test covers refresh dual-copy + reconcile (+ domain3–5 regression). */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
console.log('=== cargo test (incl. refresh) ===')
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
  '\nRefresh checks passed (MVP: spike + registered project .cursor; no ~/.cursor; full discovery / backup still sidecar)',
)
