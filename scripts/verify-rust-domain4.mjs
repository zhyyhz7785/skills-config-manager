#!/usr/bin/env node
/** Domain4: cargo test covers scan_ingest + project_discovery. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function cargoFilter(name) {
  console.log(`=== cargo test --lib ${name} ===`)
  const cargo = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts', 'with-cargo.mjs'),
      'cargo',
      'test',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--lib',
      name,
      '--',
      '--test-threads=1',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  process.stdout.write(cargo.stdout || '')
  process.stderr.write(cargo.stderr || '')
  if (cargo.status !== 0) process.exit(cargo.status ?? 1)
}

cargoFilter('scan_ingest')
cargoFilter('project_discovery')

console.log('\nDomain4 checks passed (full discovery + scan build)')
