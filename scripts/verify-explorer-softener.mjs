/**
 * 验证 Explorer softener 路径匹配（纯函数）；说明手动验收步骤。
 * 运行：node scripts/verify-explorer-softener.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-explorer-soften-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-explorer-soften.json')
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
    include: ['electron/services/explorerSoftener.ts'],
  }),
)

function fail(msg) {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

function ok(msg) {
  console.log('OK:', msg)
}

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

  const { isPathUnderAnyRoot, normalizeExplorerPath, softenExplorerBeforeDelete } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/explorerSoftener.js')).href
  )

  const cursor = 'E:\\cursor\\00Engineering\\demo\\.cursor'
  const rules = path.join(cursor, 'rules')
  const proj = 'E:\\cursor\\00Engineering\\demo'
  const other = 'E:\\cursor\\other\\.cursor'

  if (!isPathUnderAnyRoot(cursor, [cursor])) fail('exact .cursor should match')
  else ok('exact .cursor matches')

  if (!isPathUnderAnyRoot(rules, [cursor])) fail('rules under .cursor should match')
  else ok('child under .cursor matches')

  if (isPathUnderAnyRoot(proj, [cursor])) fail('project root must not match .cursor root')
  else ok('project root does not match')

  if (isPathUnderAnyRoot(other, [cursor])) fail('sibling .cursor must not match')
  else ok('foreign .cursor rejected')

  const a = normalizeExplorerPath(cursor + '\\')
  const b = normalizeExplorerPath(cursor)
  if (a !== b) fail(`normalize mismatch ${a} vs ${b}`)
  else ok('normalize strips trailing sep')

  // no-op / 不抛：不存在的路径或空列表
  await softenExplorerBeforeDelete([], proj)
  await softenExplorerBeforeDelete([path.join(os.tmpdir(), 'ccm-no-such-dir')], proj)
  ok('softenExplorerBeforeDelete no-op safe')

  console.log(
    'MANUAL: 用资源管理器打开某项目 .cursor → CCM 删除该项目 → 窗口应跳到项目根且 ideally 无「位置不可用」',
  )
  if (!process.exitCode) console.log('ALL OK: verify-explorer-softener')
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
}
