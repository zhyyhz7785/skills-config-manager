/**
 * 验证「自主操作」护栏：
 * U1 — 残缺 catalog 不得被空台账覆盖；原子写后文件仍可读；缺失主文件可从 .bak 恢复
 * U4 — 迁入同哈希删容器失败时不改 deployedPath（确定性 mock）
 * 路径 — libraryPath 穿越拒绝
 *
 * 运行：node scripts/verify-autonomous-ops-guards.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-auto-ops-emit-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))

const cfgPath = path.join(root, '.tmp-emit-autonomous-ops.json')
fs.writeFileSync(
  cfgPath,
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        outDir,
        rootDir: root,
        strict: false,
        skipLibCheck: true,
        esModuleInterop: true,
        declaration: false,
        types: ['node'],
      },
      include: ['electron/services/**/*.ts', 'shared/**/*.ts'],
      exclude: ['electron/appController.ts', 'electron/main.ts', 'electron/preload.ts'],
    },
    null,
    2,
  ),
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
    console.error(r.stdout || '')
    console.error(r.stderr || '')
    throw new Error('tsc emit failed')
  }

  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )
  const { SkillIngestService, setDeleteContainerCopyForTest } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/skillIngestService.js')).href
  )
  const { createEmptyLibraryEntry } = await import(
    pathToFileURL(path.join(outDir, 'shared/types.js')).href
  )
  const { resolveLibrarySafePath } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/pathRules.js')).href
  )
  const { computeContentHash } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/metadataReader.js')).href
  )

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-auto-ops-'))
  const lib = path.join(tmp, 'CursorSkills')
  fs.mkdirSync(path.join(lib, 'rules'), { recursive: true })

  // --- U1: 写入非空台账 ---
  const svc = new LibraryCatalogService(lib)
  const entry = {
    ...createEmptyLibraryEntry(),
    id: 'keep-me',
    kind: 'rule',
    libraryPath: 'rules/keep-me.mdc',
    isInLibrary: true,
    contentHash: 'a'.repeat(64),
  }
  fs.writeFileSync(path.join(lib, 'rules', 'keep-me.mdc'), 'hello\n', 'utf8')
  svc.upsert(entry)
  const before = fs.readFileSync(path.join(lib, 'catalog.json'), 'utf8')
  if (!before.includes('keep-me')) fail('seed catalog missing keep-me')
  else ok('seed catalog written')

  // 截断 / 损坏 JSON
  fs.writeFileSync(path.join(lib, 'catalog.json'), '{"version":2,"projects":[],"entries":[', 'utf8')
  svc.load()
  if (svc.isCatalogHealthy) fail('corrupt catalog should mark unhealthy')
  else ok('corrupt load → unhealthy')

  let threw = false
  try {
    svc.save()
  } catch {
    threw = true
  }
  if (!threw) fail('save should refuse when unhealthy')
  else ok('unhealthy save refused')

  const afterCorrupt = fs.readFileSync(path.join(lib, 'catalog.json'), 'utf8')
  if (
    afterCorrupt.includes('"entries": []') ||
    afterCorrupt.trim() === '{"version":2,"projects":[],"entries":[]}'
  ) {
    fail('disk catalog was overwritten with empty')
  } else ok('disk catalog preserved (still corrupt/truncated)')

  // 同进程修复磁盘后应恢复 healthy
  fs.writeFileSync(path.join(lib, 'catalog.json'), before, 'utf8')
  svc.load()
  if (!svc.isCatalogHealthy || svc.getAll().length < 1) fail('same-process recover after fix failed')
  else ok('same-process recover after fix')

  // 主文件缺失 + .bak 可恢复
  const bak = path.join(lib, `catalog.json.${process.pid}.bak`)
  fs.copyFileSync(path.join(lib, 'catalog.json'), bak)
  fs.unlinkSync(path.join(lib, 'catalog.json'))
  const svcMissing = new LibraryCatalogService(lib)
  if (!svcMissing.isCatalogHealthy || svcMissing.getAll().length < 1) {
    fail('missing catalog should recover from .bak')
  } else ok('missing catalog recovered from .bak')

  // 路径穿越
  const bad = resolveLibrarySafePath(lib, '..\\..\\Windows\\evil.txt')
  if (bad.ok) fail('traversal libraryPath should be rejected')
  else ok('libraryPath traversal rejected')

  // --- U4: 确定性删失败 ---
  const container = path.join(tmp, 'project', '.cursor', 'rules')
  fs.mkdirSync(container, { recursive: true })
  const containerFile = path.join(container, 'keep-me.mdc')
  const libFile = path.join(lib, 'rules', 'keep-me.mdc')
  fs.writeFileSync(libFile, 'same-body\n', 'utf8')
  fs.writeFileSync(containerFile, 'same-body\n', 'utf8')
  const hash = computeContentHash(libFile, false)
  const e2 = svcMissing.findById('keep-me')
  e2.deployedPath = containerFile
  e2.contentHash = hash
  e2.libraryPath = 'rules/keep-me.mdc'
  e2.isInLibrary = true
  e2.lastContainerPath = path.join(tmp, 'project', '.cursor')
  svcMissing.upsert(e2)
  // 登记项目根以便 assertManagedContainerPath 通过
  svcMissing.addProject({
    id: 'p-test',
    name: 't',
    rootPath: path.join(tmp, 'project'),
    category: '其它项目',
    pinned: false,
  })

  const restoreDelete = setDeleteContainerCopyForTest(() => {
    throw new Error('mock delete denied')
  })
  const ingest = new SkillIngestService(svcMissing)
  const beforeDep = containerFile
  const result = ingest.moveIntoBackupLibrary(['keep-me'], [], {
    requireConflictResolutions: true,
  })
  restoreDelete()
  const afterDep = svcMissing.findById('keep-me')?.deployedPath ?? ''
  if (result.failed > 0 && afterDep === beforeDep && fs.existsSync(containerFile)) {
    ok('U4: delete fail keeps deployedPath')
  } else {
    fail(
      `U4 unexpected: moved=${result.moved} failed=${result.failed} deployed="${afterDep}" exists=${fs.existsSync(containerFile)} msg=${(result.messages || []).join('; ')}`,
    )
  }

  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    // ignore
  }
  try {
    fs.unlinkSync(cfgPath)
  } catch {
    // ignore
  }
} catch (err) {
  fail(String(err instanceof Error ? err.message : err))
}
