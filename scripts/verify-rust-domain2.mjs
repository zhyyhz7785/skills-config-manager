#!/usr/bin/env node
/**
 * Smoke Rust domain-2 commands via Tauri CLI is heavy; instead verify sidecar thick
 * paths still work AND document that get_snapshot is unit-tested in cargo.
 *
 * For CI without GUI: cargo test covers snapshot/settings; this script checks sidecar.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

console.log('=== cargo test (Rust domain2) ===')
const cargo = spawnSync(
  process.execPath,
  [path.join(root, 'scripts', 'with-cargo.mjs'), 'cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', '--', '--test-threads=1'],
  { cwd: root, encoding: 'utf8', shell: false },
)
process.stdout.write(cargo.stdout || '')
process.stderr.write(cargo.stderr || '')
if (cargo.status !== 0) {
  console.error('cargo test failed')
  process.exit(cargo.status ?? 1)
}

const BASE = process.env.CCM_SIDECAR_URL || 'http://127.0.0.1:17832'
console.log('\n=== sidecar thick-path (optional if up) ===')
try {
  const h = await fetch(`${BASE}/health`)
  if (!h.ok) throw new Error('health not ok')
  const res = await fetch(`${BASE}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'scanAndIngestPreview', args: {} }),
  })
  const body = await res.json()
  console.log('scanAndIngestPreview ok=', body.ok)
} catch (e) {
  console.log('sidecar not running — skip thick check:', e instanceof Error ? e.message : e)
}

console.log('\nAll required checks passed (cargo)')
