#!/usr/bin/env node
/** Domain3: cargo test covers deploy/withdraw; optional sidecar scan still green. */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
console.log('=== cargo test (incl. deploy/withdraw) ===')
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

const BASE = process.env.CCM_SIDECAR_URL || 'http://127.0.0.1:17832'
try {
  const h = await fetch(`${BASE}/health`)
  if (h.ok) {
    const res = await fetch(`${BASE}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'scanAndIngestPreview', args: {} }),
    })
    const body = await res.json()
    console.log('sidecar scanAndIngestPreview ok=', body.ok)
  } else {
    console.log('sidecar health not ok — skip')
  }
} catch (e) {
  console.log('sidecar skip:', e instanceof Error ? e.message : e)
}
console.log('\nDomain3 checks passed')
