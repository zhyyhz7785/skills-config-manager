#!/usr/bin/env node
/**
 * Same-fixture Tauri perf bench (headless).
 * Env: CCM_BENCH_LIBRARY — optional existing library root
 *      CCM_BENCH_SCAN — optional scan root (default: <library>/../scan-fixture)
 *      CCM_BENCH_DEPTH — default 5
 *      CCM_BENCH_ROUNDS — default 3 (report median)
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function ensureFixture(baseDir) {
  const lib = path.join(baseDir, 'library')
  const scan = path.join(baseDir, 'scan-fixture')
  const proj = path.join(scan, 'BenchProj')
  fs.mkdirSync(path.join(lib, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(lib, 'rules'), { recursive: true })
  fs.mkdirSync(path.join(proj, '.cursor', 'skills', 'bench-skill'), { recursive: true })
  const skillMd = path.join(proj, '.cursor', 'skills', 'bench-skill', 'SKILL.md')
  if (!fs.existsSync(skillMd)) {
    fs.writeFileSync(skillMd, '# bench-skill\nfixture for Tauri vs Electron compare\n')
  }
  const catalog = path.join(lib, 'catalog.json')
  if (!fs.existsSync(catalog)) {
    fs.writeFileSync(
      catalog,
      JSON.stringify({ version: 1, entries: [], projects: [] }, null, 2),
    )
  }
  return { lib, scan }
}

const rounds = Math.max(1, Number(process.env.CCM_BENCH_ROUNDS || 3) || 3)
const depth = Number(process.env.CCM_BENCH_DEPTH || 5) || 5

let lib = process.env.CCM_BENCH_LIBRARY?.trim()
let scan = process.env.CCM_BENCH_SCAN?.trim()
if (!lib) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-bench-'))
  const fx = ensureFixture(base)
  lib = fx.lib
  scan = scan || fx.scan
  console.error(`using temp fixture: ${base}`)
} else if (!scan) {
  scan = path.join(path.dirname(lib), 'scan-fixture')
  if (!fs.existsSync(scan)) {
    const fx = ensureFixture(path.dirname(lib))
    scan = fx.scan
  }
}

function runOnce() {
  const r = spawnSync(
    process.execPath,
    [
      path.join(root, 'scripts', 'with-cargo.mjs'),
      'cargo',
      'run',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--example',
      'bench_perf',
      '--release',
      '--',
      lib,
      scan,
      String(depth),
    ],
    { cwd: root, encoding: 'utf8' },
  )
  if (r.status !== 0) {
    process.stderr.write(r.stderr || '')
    process.stderr.write(r.stdout || '')
    process.exit(r.status ?? 1)
  }
  const text = (r.stdout || '').trim()
  const jsonStart = text.indexOf('{')
  if (jsonStart < 0) {
    console.error('no JSON from bench_perf')
    process.exit(1)
  }
  return JSON.parse(text.slice(jsonStart))
}

const results = []
for (let i = 0; i < rounds; i++) {
  console.error(`round ${i + 1}/${rounds}…`)
  results.push(runOnce())
}

function median(nums) {
  const a = [...nums].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

const out = {
  product: 'tauri2',
  rounds,
  libraryRoot: lib,
  scanRoot: scan,
  projectScanMaxDepth: depth,
  snapshotMsMedian: median(results.map((r) => r.snapshotMs)),
  scanPreviewMsMedian: median(results.map((r) => r.scanPreviewMs)),
  last: results[results.length - 1],
  roundsRaw: results,
}

console.log(JSON.stringify(out, null, 2))
console.error(
  `\nMarkdown row:\n| Tauri2 | ${out.snapshotMsMedian.toFixed(1)} | ${out.scanPreviewMsMedian.toFixed(1)} | — | — |`,
)
