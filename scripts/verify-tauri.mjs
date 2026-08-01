#!/usr/bin/env node
/**
 * Verify pure Tauri2 product path (no Electron / sidecar remnants).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (fs.existsSync(path.join(root, 'electron'))) {
  console.error('FAIL: electron/ directory must be removed')
  process.exit(1)
}
if (fs.existsSync(path.join(root, 'src-tauri/src/sidecar.rs'))) {
  console.error('FAIL: sidecar.rs must be removed')
  process.exit(1)
}
if (fs.existsSync(path.join(root, 'scripts/run-sidecar.mjs'))) {
  console.error('FAIL: run-sidecar.mjs must be removed')
  process.exit(1)
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const name of ['electron', 'electron-builder', 'vite-plugin-electron', 'vite-plugin-electron-renderer']) {
  if (deps[name]) {
    console.error(`FAIL: package.json still depends on ${name}`)
    process.exit(1)
  }
}
const cargoToml = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')
if (/\bureq\b/.test(cargoToml)) {
  console.error('FAIL: Cargo.toml still has ureq (sidecar HTTP)')
  process.exit(1)
}
console.log('Remnant checks OK (no electron/sidecar)')

const bridge = fs.readFileSync(path.join(root, 'src/tauri/ccmBridge.ts'), 'utf8')
if (bridge.includes('useSidecarBypass') || bridge.includes('sidecarInvoke')) {
  console.error('FAIL: ccmBridge must not call sidecar bypass')
  process.exit(1)
}
if (!bridge.includes('stubUnimplemented')) {
  console.error('FAIL: ccmBridge missing stubUnimplemented')
  process.exit(1)
}
if (!bridge.includes('scan_projects_preview') && !bridge.includes('scanProjectsPreview')) {
  console.error('FAIL: scanProjectsPreview not wired')
  process.exit(1)
}
if (!bridge.includes('Config 已废弃')) {
  console.error('FAIL: Config retire message missing')
  process.exit(1)
}
if (!bridge.includes('resolve_drag_file_paths') && !bridge.includes('tauri-plugin-drag')) {
  console.error('FAIL: startDrag / drag resolve not wired')
  process.exit(1)
}
console.log('Bridge static checks OK')

const appTsx = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
if (!appTsx.includes('scanAndIngestPreview')) {
  console.error('FAIL: App should use scanAndIngestPreview for 扫描建库')
  process.exit(1)
}
console.log('App UI static checks OK')

const discoveryRs = fs.readFileSync(
  path.join(root, 'src-tauri/src/project_discovery.rs'),
  'utf8',
)
if (!discoveryRs.includes('discover_projects_merged')) {
  console.error('FAIL: project_discovery missing discover_projects_merged')
  process.exit(1)
}
console.log('Project discovery module OK')

console.log('=== cargo test ===')
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

console.log('\nverify:tauri passed (pure Tauri2)')
