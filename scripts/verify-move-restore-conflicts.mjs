/**
 * 验证：迁入备份库 requireConflictResolutions；恢复初始冲突默认 skip / overwrite。
 * 运行：node scripts/verify-move-restore-conflicts.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-move-restore-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-move-restore.json')
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
      'electron/services/skillIngestService.ts',
      'electron/services/skillScanService.ts',
      'electron/services/ingestConflict.ts',
      'electron/services/projectScanExclusions.ts',
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-mr-'))
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

  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )
  const { SkillIngestService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/skillIngestService.js')).href
  )
  const { computeContentHash } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/metadataReader.js')).href
  )

  // --- 迁入：同名不同内容 + requireConflictResolutions ---
  {
    const proj = path.join(tmp, 'move-conflict')
    const cursorRules = path.join(proj, '.cursor', 'rules', 'same-id')
    fs.mkdirSync(cursorRules, { recursive: true })
    const srcFile = path.join(cursorRules, 'same-id.mdc')
    fs.writeFileSync(srcFile, '---\ndescription: source\n---\n# source\n', 'utf8')

    const libDir = path.join(libRoot, 'rules', 'same-id')
    fs.mkdirSync(libDir, { recursive: true })
    fs.writeFileSync(path.join(libDir, 'same-id.mdc'), '---\ndescription: lib\n---\n# lib\n', 'utf8')

    const catalog = new LibraryCatalogService(libRoot)
    catalog.load()
    catalog.addProject({
      id: 'p-move',
      name: 'move-conflict',
      rootPath: proj,
      category: '其它项目',
      pinned: false,
    })
    catalog.upsert({
      id: 'same-id',
      kind: 'rule',
      libraryPath: path.join('rules', 'same-id', 'same-id.mdc'),
      isInLibrary: false,
      isMissing: false,
      deployedPath: srcFile,
      lastContainerPath: path.join(proj, '.cursor'),
      initialPath: srcFile,
      contentHash: computeContentHash(srcFile, false),
      remarkZh: '',
      trigger: '',
      description: '',
      ingestedAt: new Date().toISOString(),
      tags: { scope: 'global', purposes: [] },
      origins: [],
      history: [],
    })
    catalog.save()

    const ingest = new SkillIngestService(catalog)
    const dry = ingest.moveIntoBackupLibrary([], [], { requireConflictResolutions: true })
    if (dry.conflicts.length < 1) fail('requireConflictResolutions should report conflicts')
    if (dry.moved !== 0) fail('should not move without resolution')
    if (!fs.existsSync(srcFile)) fail('source should remain without resolution')
    ok('move requireConflictResolutions: reports conflict, no move')

    const resolved = ingest.moveIntoBackupLibrary(
      [],
      [{ key: 'move:same-id', choice: 'overwrite' }],
      { requireConflictResolutions: true },
    )
    if (resolved.conflicts.length > 0) fail('overwrite should clear conflicts')
    if (resolved.moved < 1) fail('overwrite should move')
    if (fs.existsSync(srcFile)) fail('source should be gone after overwrite move')
    ok('move with overwrite resolution succeeds')
  }

  // 恢复初始能力已从产品移除；不再验证 restore API

  if (process.exitCode) throw new Error('assertions failed')
  console.log('ALL OK: verify-move-restore-conflicts')
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
