/**
 * 验证：删除项目时 purge 失败封闭；常用/备份仅 pinned，不改变 purge 结果。
 * 运行：node scripts/verify-remove-project.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-remove-proj-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-remove-proj.json')
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
    include: [
      'electron/services/fsMove.ts',
      'electron/services/pathRules.ts',
      'electron/services/libraryCatalogService.ts',
      'electron/services/libraryPollutionRules.ts',
      'electron/services/metadataReader.ts',
      'electron/services/purposeTaxonomyHelper.ts',
      'shared/**/*.ts',
    ],
    exclude: ['electron/appController.ts', 'electron/main.ts'],
  }),
)

function fail(msg) {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

function ok(msg) {
  console.log('OK:', msg)
}

/**
 * 与 appController.removeProject 一致：purgeEmptyMarkers 时若 kept 非空则不去登记。
 * pinned 不参与决策（常用/备份仅为导航分组）。
 */
function applyRemovePolicy(catalog, projectId, { purgeEmptyMarkers, purgeResult }) {
  if (purgeEmptyMarkers && purgeResult.kept.length > 0) {
    return { unlisted: false, reason: 'purge-kept' }
  }
  const removed = catalog.removeProject(projectId)
  return { unlisted: removed, reason: removed ? 'removed' : 'missing' }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-rm-'))
const libRoot = path.join(tmp, 'CursorSkills')
fs.mkdirSync(path.join(libRoot, 'rules'), { recursive: true })
fs.writeFileSync(
  path.join(libRoot, 'catalog.json'),
  JSON.stringify({ version: 2, libraryRoot: libRoot, projects: [], entries: [] }, null, 2),
)

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

  const { purgeEmptyMarkerDirs, countFilesRecursive } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/fsMove.js')).href
  )
  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )

  const catalog = new LibraryCatalogService(libRoot)

  // --- 1) 空 .cursor：应 purge 成功并可去登记（pinned true / false 结果一致） ---
  for (const pinned of [true, false]) {
    const proj = path.join(tmp, `empty-${pinned ? 'pin' : 'unpin'}`)
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(path.join(cursor, 'rules'), { recursive: true })
    const id = `id-empty-${pinned}`
    catalog.addProject({
      id,
      name: `empty-${pinned}`,
      rootPath: proj,
      category: '其它项目',
      pinned,
    })
    const purge = purgeEmptyMarkerDirs(proj)
    if (purge.kept.length > 0) fail(`empty project kept=${purge.kept} pinned=${pinned}`)
    if (fs.existsSync(cursor)) fail(`.cursor still exists after purge pinned=${pinned}`)
    const policy = applyRemovePolicy(catalog, id, { purgeEmptyMarkers: true, purgeResult: purge })
    if (!policy.unlisted) fail(`empty project not unlisted pinned=${pinned}`)
    if (catalog.findProjectById(id)) fail(`catalog still has empty project pinned=${pinned}`)
    ok(`empty .cursor purged + unlisted (pinned=${pinned})`)
  }

  // --- 2) 残留不可迁入文件：purge 失败封闭，项目仍在 catalog ---
  for (const pinned of [true, false]) {
    const proj = path.join(tmp, `kept-${pinned ? 'pin' : 'unpin'}`)
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(cursor, { recursive: true })
    fs.writeFileSync(path.join(cursor, 'orphan.txt'), 'stay', 'utf8')
    const id = `id-kept-${pinned}`
    catalog.addProject({
      id,
      name: `kept-${pinned}`,
      rootPath: proj,
      category: '其它项目',
      pinned,
    })
    const beforeCount = countFilesRecursive(cursor)
    if (beforeCount < 1) fail(`expected leftover files pinned=${pinned}`)
    const purge = purgeEmptyMarkerDirs(proj)
    if (!purge.kept.includes('.cursor')) fail(`expected kept .cursor pinned=${pinned}`)
    if (!fs.existsSync(cursor)) fail(`.cursor should remain pinned=${pinned}`)
    const policy = applyRemovePolicy(catalog, id, { purgeEmptyMarkers: true, purgeResult: purge })
    if (policy.unlisted || policy.reason !== 'purge-kept') {
      fail(`fail-closed expected, got ${JSON.stringify(policy)} pinned=${pinned}`)
    }
    if (!catalog.findProjectById(id)) fail(`project should remain in catalog pinned=${pinned}`)
    ok(`leftover file → fail-closed, catalog kept (pinned=${pinned})`)
  }

  // --- 3) 仅去登记（不 purge）：.cursor 保留 ---
  {
    const proj = path.join(tmp, 'unlist-only')
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(cursor, { recursive: true })
    fs.writeFileSync(path.join(cursor, 'keep.txt'), 'x', 'utf8')
    const id = 'id-unlist'
    catalog.addProject({
      id,
      name: 'unlist-only',
      rootPath: proj,
      category: '其它项目',
      pinned: false,
    })
    const policy = applyRemovePolicy(catalog, id, {
      purgeEmptyMarkers: false,
      purgeResult: { purged: [], kept: [] },
    })
    if (!policy.unlisted) fail('unlist-only should remove catalog entry')
    if (!fs.existsSync(path.join(cursor, 'keep.txt'))) fail('unlist-only must keep .cursor files')
    ok('unlist-only: catalog removed, .cursor retained')
  }

  // --- 4) 手动清空（或标题栏迁入）后 purge：可去登记（非删除弹窗迁入） ---
  {
    const proj = path.join(tmp, 'cleared')
    const cursor = path.join(proj, '.cursor')
    const ruleDir = path.join(cursor, 'rules', 'demo')
    fs.mkdirSync(ruleDir, { recursive: true })
    const ruleFile = path.join(ruleDir, 'demo.mdc')
    fs.writeFileSync(ruleFile, '---\ndescription: d\nalwaysApply: true\n---\n# d\n', 'utf8')
    const id = 'id-cleared'
    catalog.addProject({
      id,
      name: 'cleared',
      rootPath: proj,
      category: '其它项目',
      pinned: true,
    })
    // 模拟用户打开目录后移走文件（或标题栏迁入备份库）
    const libRule = path.join(libRoot, 'rules', 'demo', 'demo.mdc')
    fs.mkdirSync(path.dirname(libRule), { recursive: true })
    fs.renameSync(ruleFile, libRule)
    const purge = purgeEmptyMarkerDirs(proj)
    if (purge.kept.length > 0) fail(`after clear kept=${purge.kept.join(',')}`)
    if (fs.existsSync(cursor)) fail('.cursor should be gone after clear+purge')
    const policy = applyRemovePolicy(catalog, id, { purgeEmptyMarkers: true, purgeResult: purge })
    if (!policy.unlisted) fail('cleared project should unlist')
    ok('clear-then-purge: .cursor gone + unlisted')
  }

  if (process.exitCode) throw new Error('assertions failed')
  console.log('ALL OK: verify-remove-project')
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
