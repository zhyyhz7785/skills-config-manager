/**
 * 验证：父级有 .cursor 时仍能发现嵌套项目；空 .cursor 也登记。
 * node scripts/verify-nested-project-discovery.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-nested-proj-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-nested-proj.json')
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
    include: ['electron/services/**/*.ts', 'shared/**/*.ts'],
    exclude: ['electron/appController.ts', 'electron/main.ts', 'electron/preload.ts'],
  }),
)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-proj-tree-'))
const parent = path.join(tmp, 'mono')
const nested = path.join(parent, 'apps', 'child')
fs.mkdirSync(path.join(parent, '.cursor'), { recursive: true })
fs.mkdirSync(path.join(nested, '.cursor', 'rules'), { recursive: true })
// parent .cursor 为空；child 仅有空 rules 目录

try {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', cfgPath, '--noEmit', 'false'],
    { cwd: root, encoding: 'utf8', shell: true },
  )
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout)
    throw new Error('tsc emit failed')
  }

  const { ProjectDiscoveryService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/projectDiscoveryService.js')).href
  )
  const svc = new ProjectDiscoveryService('')
  const found = svc.scan([tmp], 5, [])
  const roots = found.map((p) => path.normalize(p.rootPath).toLowerCase())
  const wantParent = path.normalize(parent).toLowerCase()
  const wantChild = path.normalize(nested).toLowerCase()

  if (!roots.includes(wantParent)) throw new Error('missing parent project: ' + roots.join(' | '))
  if (!roots.includes(wantChild)) throw new Error('missing nested project: ' + roots.join(' | '))

  console.log('OK: nested empty-.cursor projects discovered')
  console.log(
    found.map((p) => `${p.suggestedName} pendingMarkers=${p.markers}`).join('\n'),
  )
} finally {
  try {
    fs.unlinkSync(cfgPath)
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(outDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
