/**
 * 验证删除相关策略：forceDelete / purge 残留不去登记。
 * 迁入备份库走标题栏 moveIntoBackup，不在 removeProject 路径内。
 * 运行：node scripts/verify-remove-project-modes.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-rm-modes-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-rm-modes.json')
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
 * 与 appController.removeProject 一致：
 * - forceDeleteMarkers：整树 rm 后去登记
 * - purgeEmptyMarkers：kept 非空则不去登记（无 migrate 分支）
 */
function applyRemovePolicy(catalog, projectId, { forceDeleteMarkers, purgeEmptyMarkers, purgeResult }) {
  if (forceDeleteMarkers) {
    const removed = catalog.removeProject(projectId)
    return { unlisted: removed, reason: removed ? 'force-removed' : 'missing' }
  }
  if (purgeEmptyMarkers && purgeResult.kept.length > 0) {
    return { unlisted: false, reason: 'purge-kept' }
  }
  const removed = catalog.removeProject(projectId)
  return { unlisted: removed, reason: removed ? 'removed' : 'missing' }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-rm-modes-'))
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

  const { purgeEmptyMarkerDirs } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/fsMove.js')).href
  )
  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )

  const catalog = new LibraryCatalogService(libRoot)

  // --- forceDelete：整树 rm 后去登记 ---
  {
    const proj = path.join(tmp, 'force')
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(path.join(cursor, 'rules'), { recursive: true })
    fs.writeFileSync(path.join(cursor, 'orphan.txt'), 'x', 'utf8')
    fs.writeFileSync(path.join(cursor, 'rules', 'a.mdc'), '---\ndescription: a\n---\n# a\n', 'utf8')
    const id = 'proj-force'
    catalog.addProject({
      id,
      name: 'force',
      rootPath: proj,
      category: '其它项目',
      pinned: false,
    })
    fs.rmSync(cursor, { recursive: true, force: true })
    if (fs.existsSync(cursor)) fail('force rm should remove .cursor with files')
    const policy = applyRemovePolicy(catalog, id, {
      forceDeleteMarkers: true,
      purgeEmptyMarkers: false,
      purgeResult: { purged: [], kept: [] },
    })
    if (!policy.unlisted) fail('forceDelete should unlist')
    if (catalog.findProjectById(id)) fail('project should be gone after forceDelete')
    ok('forceDelete: recursive rm + unlist')
  }

  // --- purge 残留：有文件则不去登记（删除弹窗应提示打开目录或强制删除，不走迁入） ---
  {
    const proj = path.join(tmp, 'leftover')
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(cursor, { recursive: true })
    fs.writeFileSync(path.join(cursor, 'keep.txt'), 'stay', 'utf8')
    const id = 'proj-leftover'
    catalog.addProject({
      id,
      name: 'leftover',
      rootPath: proj,
      category: '其它项目',
      pinned: false,
    })
    const purge = purgeEmptyMarkerDirs(proj)
    if (!purge.kept.includes('.cursor')) fail('expected kept .cursor')
    const policy = applyRemovePolicy(catalog, id, {
      forceDeleteMarkers: false,
      purgeEmptyMarkers: true,
      purgeResult: purge,
    })
    if (policy.unlisted) fail('purge leftover must not unlist')
    if (!catalog.findProjectById(id)) fail('project should still be registered')
    ok('purge leftover: kept .cursor; catalog unchanged (no migrate on delete)')
  }

  // --- 空 .cursor：purge 后可去登记 ---
  {
    const proj = path.join(tmp, 'empty')
    const cursor = path.join(proj, '.cursor')
    fs.mkdirSync(cursor, { recursive: true })
    const id = 'proj-empty'
    catalog.addProject({
      id,
      name: 'empty',
      rootPath: proj,
      category: '其它项目',
      pinned: false,
    })
    const purge = purgeEmptyMarkerDirs(proj)
    if (purge.kept.length > 0) fail('empty .cursor should purge')
    if (!purge.purged.includes('.cursor')) fail('empty .cursor should be in purged')
    if (fs.existsSync(cursor)) fail('empty .cursor dir should be gone')
    const policy = applyRemovePolicy(catalog, id, {
      forceDeleteMarkers: false,
      purgeEmptyMarkers: true,
      purgeResult: purge,
    })
    if (!policy.unlisted) fail('empty purge should unlist')
    ok('empty .cursor: purge + unlist')
  }

  if (process.exitCode) throw new Error('assertions failed')
  console.log('ALL OK: verify-remove-project-modes')
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
