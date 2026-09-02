/**
 * 验证：rules/backup 镜像视为污染，不扫描入库。
 * 运行：node scripts/verify-backup-mirror-pollution.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-backup-pollution-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-backup-pollution.json')
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
      'electron/services/libraryPollutionRules.ts',
      'electron/services/libraryCatalogService.ts',
      'electron/services/pathRules.ts',
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

  const pollution = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryPollutionRules.js')).href
  )
  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )

  const mirror = 'C:\\Users\\alice\\.cursor\\rules\\backup\\agents\\cad-developer.md'
  if (!pollution.isMirrorBackupPath(mirror)) fail('should detect rules/backup path')
  else ok('isMirrorBackupPath: rules/backup')

  if (pollution.isMirrorBackupPath('rules\\backup-agents-cad-developer\\x.md')) {
    fail('must not treat backup-agents library folder as mirror path')
  } else ok('libraryPath backup-agents* is not mirror path')

  const explained = pollution.tryExplain({
    sourcePath: mirror,
    suggestedId: 'backup-agents-cad-developer',
    kind: 'rule',
    isFolder: false,
  })
  if (!explained.isPollution) fail('tryExplain should mark mirror as pollution')
  else ok('tryExplain: backup mirror is pollution')

  if (!pollution.isPollutionCatalogId('backup-skills-foo')) fail('id prefix should be pollution')
  else ok('isPollutionCatalogId: backup-skills-*')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-bp-'))
  const libRoot = path.join(tmp, 'CursorSkills')
  fs.mkdirSync(path.join(libRoot, 'rules'), { recursive: true })
  fs.writeFileSync(
    path.join(libRoot, 'catalog.json'),
    JSON.stringify(
      {
        version: 2,
        libraryRoot: libRoot,
        projects: [],
        entries: [
          {
            id: 'backup-agents-cad-developer',
            kind: 'rule',
            libraryPath: 'rules\\backup-agents-cad-developer\\cad-developer.md',
            isInLibrary: false,
            isMissing: false,
            deployedPath: mirror,
            initialPath: mirror,
            contentHash: 'abc',
            origins: [{ tool: 'cursor', scope: 'user-global', originalPath: mirror }],
            history: [],
            tags: { scope: 'global', purposes: [] },
          },
          {
            id: 'real-rule',
            kind: 'rule',
            libraryPath: 'rules\\real-rule\\real-rule.mdc',
            isInLibrary: true,
            isMissing: false,
            deployedPath: '',
            initialPath: path.join(libRoot, 'rules', 'real-rule', 'real-rule.mdc'),
            contentHash: 'def',
            origins: [],
            history: [],
            tags: { scope: 'global', purposes: [] },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  )
  fs.mkdirSync(path.join(libRoot, 'rules', 'real-rule'), { recursive: true })
  fs.writeFileSync(path.join(libRoot, 'rules', 'real-rule', 'real-rule.mdc'), '# r\n', 'utf8')

  const catalog = new LibraryCatalogService(libRoot)
  catalog.load()
  const n = catalog.purgePollutionEntries()
  if (n !== 1) fail(`expected purge 1, got ${n}`)
  if (catalog.findById('backup-agents-cad-developer')) fail('backup entry should be gone')
  if (!catalog.findById('real-rule')) fail('real rule should remain')
  ok('purgePollutionEntries removes mirror entries only')

  if (process.exitCode) throw new Error('assertions failed')
  console.log('ALL OK: verify-backup-mirror-pollution')
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
