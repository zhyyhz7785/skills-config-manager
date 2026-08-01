/**
 * 验证：双份并存时保持在库 + 容器可见；项目导航下不进「曾用于」；
 * 其它导航（无 live）下备份库仍可见；迁走容器后进「曾用于」。
 * 运行：node scripts/verify-container-classification.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-classify-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-classify.json')
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
      'electron/services/libraryCatalogService.ts',
      'electron/services/skillScanService.ts',
      'electron/services/skillIngestService.ts',
      'electron/services/pathRules.ts',
      'electron/services/libraryPollutionRules.ts',
      'electron/services/metadataReader.ts',
      'electron/services/purposeTaxonomyHelper.ts',
      'electron/services/fsMove.ts',
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-classify-data-'))
const libRoot = path.join(tmp, 'CursorSkills')
const projectRoot = path.join(tmp, 'proj')
const containerRoot = path.join(projectRoot, '.cursor')
const otherContainer = path.join(tmp, 'other', '.cursor')
const rulesDir = path.join(containerRoot, 'rules')
const libRules = path.join(libRoot, 'rules')

fs.mkdirSync(rulesDir, { recursive: true })
fs.mkdirSync(libRules, { recursive: true })
fs.mkdirSync(otherContainer, { recursive: true })

const ruleName = 'demo-rule.mdc'
const containerFile = path.join(rulesDir, ruleName)
const libraryFile = path.join(libRules, 'demo-rule', ruleName)
fs.mkdirSync(path.dirname(libraryFile), { recursive: true })
const body = '---\ndescription: demo\n---\n# demo\n'
fs.writeFileSync(containerFile, body, 'utf8')
fs.writeFileSync(libraryFile, body, 'utf8')

const catalogPath = path.join(libRoot, 'catalog.json')
fs.writeFileSync(
  catalogPath,
  JSON.stringify(
    {
      version: 2,
      projects: [
        {
          id: 'p1',
          name: 'proj',
          rootPath: projectRoot,
          category: '其它项目',
          pinned: false,
        },
      ],
      entries: [
        {
          id: 'demo-rule',
          kind: 'rule',
          libraryPath: path.join('rules', 'demo-rule', ruleName),
          isInLibrary: true,
          isMissing: false,
          deployedPath: '',
          lastContainerPath: containerRoot,
          initialPath: libraryFile,
          contentHash: 'abc',
          origins: [
            {
              tool: 'library',
              scope: 'library-disk',
              originalPath: libraryFile,
              discoveredAt: new Date().toISOString(),
              isRestored: false,
            },
            {
              tool: 'cursor',
              scope: 'project:p1',
              originalPath: containerFile,
              discoveredAt: new Date().toISOString(),
              isRestored: false,
            },
          ],
          history: [],
          tags: { scope: 'project:p1', purposes: [] },
        },
      ],
    },
    null,
    2,
  ),
  'utf8',
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
  const catalog = new LibraryCatalogService()
  catalog.setLibraryRoot(libRoot)
  catalog.load()

  // 模拟扫描发现容器副本：先错误地标成仅容器，再 infer 应对齐为双份在库
  const entry = catalog.findById('demo-rule')
  if (!entry) {
    fail('找不到 demo-rule')
  } else {
    entry.deployedPath = containerFile
    entry.isInLibrary = false
    catalog.upsert(entry)
    catalog.inferDeploymentStates()
  }

  const after = catalog.findById('demo-rule')
  if (!after) {
    fail('infer 后丢失条目')
  } else if (!after.isInLibrary) {
    fail(`双份并存应保持 isInLibrary=true，实际=${after.isInLibrary}`)
  } else if (!after.deployedPath || !fs.existsSync(after.deployedPath)) {
    fail('应保留 deployedPath')
  } else {
    ok(`inferOne 双份：在库且保留 deployed (${after.deployedPath})`)
  }

  const inCont = catalog.filterDeployedInContainer(false, 'p1', containerRoot)
  const history = catalog.filterHistoryForContainer(containerRoot)
  const permanentOnProject = catalog.filterPermanentLibraryRest(containerRoot)
  const permanentOnOther = catalog.filterPermanentLibraryRest(otherContainer)

  if (!inCont.some((e) => e.id === 'demo-rule')) fail('应出现在容器中')
  else ok('filterDeployed：在容器中')

  if (history.some((e) => e.id === 'demo-rule')) fail('不应出现在曾用于（容器仍有活文件）')
  else ok('filterHistory：互斥排除')

  if (permanentOnProject.some((e) => e.id === 'demo-rule')) {
    ok('项目导航：永久库含容器中双份项')
  } else {
    fail('项目导航下永久库应含容器中双份项（与容器中并存展示）')
  }

  if (!permanentOnOther.some((e) => e.id === 'demo-rule')) {
    fail('其它导航下备份库应仍可见双份项')
  } else ok('其它导航：备份库仍可见')

  // 模拟迁入：删除容器副本
  fs.unlinkSync(containerFile)
  after.deployedPath = ''
  catalog.upsert(after)
  catalog.inferDeploymentStates()

  const afterMove = catalog.findById('demo-rule')
  const inCont2 = catalog.filterDeployedInContainer(false, 'p1', containerRoot)
  const history2 = catalog.filterHistoryForContainer(containerRoot)

  if (inCont2.some((e) => e.id === 'demo-rule')) fail('迁入后不应在容器中')
  else ok('迁入后离开容器中')

  if (!afterMove?.isInLibrary) fail('迁入后应 isInLibrary')
  else if (!history2.some((e) => e.id === 'demo-rule')) fail('迁入后应进曾用于')
  else ok('迁入后进入曾用于')

  // --- 误放在 .cursor/<id>/ 而非 rules/：自愈后回链应进「容器中」 ---
  {
    const { healMisplacedCursorRules } = await import(
      pathToFileURL(path.join(outDir, 'electron/services/skillScanService.js')).href
    )
    const { SkillIngestService } = await import(
      pathToFileURL(path.join(outDir, 'electron/services/skillIngestService.js')).href
    )
    const { computeContentHash } = await import(
      pathToFileURL(path.join(outDir, 'electron/services/metadataReader.js')).href
    )

    const misRoot = path.join(tmp, 'misplaced')
    const misCursor = path.join(misRoot, '.cursor')
    const misLib = path.join(tmp, 'mis-lib')
    const misLibRules = path.join(misLib, 'rules', 'zh-rule')
    fs.mkdirSync(misLibRules, { recursive: true })
    fs.mkdirSync(path.join(misCursor, 'zh-rule'), { recursive: true })
    const body2 = '---\ndescription: zh\n---\n# zh\n'
    const libFile2 = path.join(misLibRules, 'zh-rule.mdc')
    const badFile = path.join(misCursor, 'zh-rule', 'zh-rule.mdc')
    fs.writeFileSync(libFile2, body2, 'utf8')
    fs.writeFileSync(badFile, body2, 'utf8')
    fs.writeFileSync(
      path.join(misLib, 'catalog.json'),
      JSON.stringify(
        {
          version: 2,
          libraryRoot: misLib,
          projects: [{ id: 'pm', name: 'mis', rootPath: misRoot, category: '其它项目', pinned: false }],
          entries: [
            {
              id: 'zh-rule',
              kind: 'rule',
              libraryPath: path.join('rules', 'zh-rule', 'zh-rule.mdc'),
              isInLibrary: true,
              isMissing: false,
              deployedPath: '',
              lastContainerPath: '',
              initialPath: libFile2,
              contentHash: computeContentHash(libFile2, false),
              origins: [
                {
                  tool: 'library',
                  scope: 'library-disk',
                  originalPath: libFile2,
                  discoveredAt: new Date().toISOString(),
                  isRestored: false,
                },
              ],
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

    const healed = healMisplacedCursorRules(misCursor)
    if (healed.moved.length < 1) fail('应迁入 rules/')
    const goodFile = path.join(misCursor, 'rules', 'zh-rule', 'zh-rule.mdc')
    if (!fs.existsSync(goodFile)) fail('自愈后文件应在 .cursor/rules/')
    if (fs.existsSync(badFile)) fail('误放目录应已搬走')
    ok('healMisplacedCursorRules: 迁入 rules/')

    const cat2 = new LibraryCatalogService()
    cat2.setLibraryRoot(misLib)
    cat2.load()
    const ingest = new SkillIngestService(cat2)
    const n = ingest.relinkDeployedPathsFromDiscovered([
      {
        kind: 'rule',
        suggestedId: 'zh-rule',
        sourcePath: goodFile,
        tool: 'cursor',
        scope: 'project:pm',
        isFolder: false,
        contentHash: computeContentHash(goodFile, false),
        existingEntryId: 'zh-rule',
        needsAttention: true,
        isSelected: true,
        contentChanged: false,
        remarkZh: '',
        trigger: '',
        description: '',
      },
    ])
    if (n < 1) fail('relink 应更新 deployedPath')
    const e2 = cat2.findById('zh-rule')
    if (!e2?.isInLibrary) fail('回链后应保持在库')
    if (!e2?.deployedPath || !fs.existsSync(e2.deployedPath)) fail('回链后应有活 deployedPath')
    const inMis = cat2.filterDeployedInContainer(false, 'pm', misCursor)
    if (!inMis.some((x) => x.id === 'zh-rule')) fail('回链后应出现在容器中')
    else ok('误放自愈 + 回链 → 容器中可见')
  }

  if (!process.exitCode) console.log('All classification checks passed.')
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
