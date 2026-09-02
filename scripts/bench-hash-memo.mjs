/**
 * 哈希 memo 基准：对临时库内 N 个规则连续 computeContentHash。
 * node scripts/bench-hash-memo.mjs [50|200]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const n = Number(process.argv[2] || 50)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-bench-emit-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-bench-hash.json')
fs.writeFileSync(
  cfgPath,
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      outDir,
      rootDir: root,
      strict: false,
      skipLibCheck: true,
      types: ['node'],
    },
    include: ['electron/services/metadataReader.ts'],
  }),
)

const r = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', cfgPath, '--noEmit', 'false'],
  { cwd: root, encoding: 'utf8', shell: true },
)
if (r.status !== 0) {
  console.error(r.stderr || r.stdout)
  process.exit(1)
}

const { computeContentHash, clearContentHashMemo } = await import(
  pathToFileURL(path.join(outDir, 'electron/services/metadataReader.js')).href
)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-bench-'))
const files = []
for (let i = 0; i < n; i++) {
  const f = path.join(tmp, `r${i}.mdc`)
  fs.writeFileSync(f, `---\ndescription: b${i}\n---\n# ${i}\n` + 'x'.repeat(200), 'utf8')
  files.push(f)
}

clearContentHashMemo()
const t0 = Date.now()
for (const f of files) computeContentHash(f, false)
const cold = Date.now() - t0

const t1 = Date.now()
for (const f of files) computeContentHash(f, false)
const warm = Date.now() - t1

console.log(`N=${n} cold=${cold}ms warm=${warm}ms (memo)`)
fs.rmSync(tmp, { recursive: true, force: true })
try {
  fs.unlinkSync(cfgPath)
} catch {
  /* ignore */
}
