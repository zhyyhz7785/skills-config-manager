/**
 * 验证：扫描建库范围默认全盘符；配置根优先；未登记 .cursor 可合并进资产扫描；
 * 空容器可登记；已登记去重；嵌套项目更深者优先。
 * node scripts/verify-scan-build-scope.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-scan-scope-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))
const cfgPath = path.join(root, '.tmp-emit-scan-scope.json')
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-scan-scope-tree-'))
const scanRoot = path.join(tmp, 'scanRoot')
const parent = path.join(scanRoot, 'parent')
const nested = path.join(parent, 'apps', 'child')
const emptyProj = path.join(scanRoot, 'emptyProj')
const libRoot = path.join(tmp, 'library')
fs.mkdirSync(path.join(parent, '.cursor', 'rules'), { recursive: true })
fs.writeFileSync(path.join(parent, '.cursor', 'rules', 'parent.mdc'), '# parent\n')
fs.mkdirSync(path.join(nested, '.cursor', 'skills', 'child-skill'), { recursive: true })
fs.writeFileSync(
  path.join(nested, '.cursor', 'skills', 'child-skill', 'SKILL.md'),
  '---\nname: child-skill\n---\n# child\n',
)
fs.mkdirSync(path.join(emptyProj, '.cursor'), { recursive: true })
fs.mkdirSync(path.join(libRoot, 'skills'), { recursive: true })
// 备份库内不应被发现为项目
fs.mkdirSync(path.join(libRoot, 'fake-proj', '.cursor', 'rules'), { recursive: true })
fs.writeFileSync(path.join(libRoot, 'fake-proj', '.cursor', 'rules', 'lib.mdc'), '# lib\n')

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

  const base = pathToFileURL(path.join(outDir, 'electron/services/')).href
  const { ProjectDiscoveryService } = await import(base + 'projectDiscoveryService.js')
  const {
    resolveProjectScanRoots,
    mergeProjectsForContainerScan,
    stableProjectIdForRoot,
    projectRootDepth,
  } = await import(base + 'scanScopeHelper.js')
  const { SkillScanService } = await import(base + 'skillScanService.js')
  const { LibraryCatalogService } = await import(base + 'libraryCatalogService.js')

  // 1) 配置根优先
  const configured = resolveProjectScanRoots([scanRoot, path.join(tmp, 'missing')])
  if (configured.length !== 1 || path.resolve(configured[0]) !== path.resolve(scanRoot)) {
    throw new Error('configured roots should prefer existing ProjectScanRoots: ' + configured.join('|'))
  }

  // 2) 空配置 → 默认全盘符（至少有一个）
  const defaults = resolveProjectScanRoots([])
  if (defaults.length === 0) throw new Error('default scan roots empty')

  // 3) 发现未登记 + 空容器；跳过备份库
  const discovery = new ProjectDiscoveryService(libRoot)
  const found = discovery.scan([scanRoot], 5, [])
  const roots = found.map((p) => path.normalize(p.rootPath).toLowerCase())
  const wantParent = path.normalize(parent).toLowerCase()
  const wantNested = path.normalize(nested).toLowerCase()
  const wantEmpty = path.normalize(emptyProj).toLowerCase()
  const libFake = path.normalize(path.join(libRoot, 'fake-proj')).toLowerCase()
  if (!roots.includes(wantParent)) throw new Error('missing parent')
  if (!roots.includes(wantNested)) throw new Error('missing nested')
  if (!roots.includes(wantEmpty)) throw new Error('missing empty .cursor project')
  if (roots.includes(libFake)) throw new Error('library project should be skipped')

  // 4) 合并：未登记进 pending；深度更深优先
  const { merged, pendingNew } = mergeProjectsForContainerScan([], found)
  if (pendingNew.length < 3) throw new Error('expected pendingNew >= 3, got ' + pendingNew.length)
  const id1 = stableProjectIdForRoot(parent)
  const id2 = stableProjectIdForRoot(parent)
  if (id1 !== id2) throw new Error('stable id unstable')
  if (projectRootDepth(nested) <= projectRootDepth(parent)) {
    throw new Error('nested should be deeper than parent')
  }
  const idxNested = merged.findIndex(
    (p) => path.normalize(p.rootPath).toLowerCase() === wantNested,
  )
  const idxParent = merged.findIndex(
    (p) => path.normalize(p.rootPath).toLowerCase() === wantParent,
  )
  if (idxNested < 0 || idxParent < 0 || idxNested > idxParent) {
    throw new Error('deeper project should sort before parent for scan')
  }

  // 5) 已登记去重：同一根只用真实 id
  const registered = [
    {
      id: 'real-parent-id',
      name: 'parent',
      rootPath: parent,
      category: 'Cursor项目',
      pinned: true,
    },
  ]
  const { merged: merged2, pendingNew: pending2 } = mergeProjectsForContainerScan(
    registered,
    found,
  )
  if (pending2.some((p) => path.normalize(p.rootPath).toLowerCase() === wantParent)) {
    throw new Error('registered parent must not appear in pendingNew')
  }
  const parentItem = merged2.find(
    (p) => path.normalize(p.rootPath).toLowerCase() === wantParent,
  )
  if (!parentItem || parentItem.id !== 'real-parent-id') {
    throw new Error('registered id must win')
  }

  // 6) 未登记根的资产可被 scanAll 发现
  const catalog = new LibraryCatalogService(libRoot)
  catalog.ensureLibraryLayout()
  const scan = new SkillScanService(catalog, '')
  scan.setProjectScanMaxDepth(5)
  const items = scan.scanAll(merged)
  const paths = items.map((i) => path.normalize(i.sourcePath).toLowerCase())
  const parentRule = path.normalize(path.join(parent, '.cursor', 'rules', 'parent.mdc')).toLowerCase()
  const childSkill = path
    .normalize(path.join(nested, '.cursor', 'skills', 'child-skill'))
    .toLowerCase()
  if (!paths.includes(parentRule)) throw new Error('parent rule not scanned: ' + paths.join('|'))
  if (!paths.includes(childSkill)) throw new Error('child skill not scanned')

  // 嵌套 skill 的 scope 应属于更深项目（因排序 + 去重先命中）
  const childItem = items.find((i) => path.normalize(i.sourcePath).toLowerCase() === childSkill)
  const nestedId = stableProjectIdForRoot(nested)
  if (!childItem?.scope.includes(nestedId) && !childItem?.scope.startsWith('project:')) {
    throw new Error('child skill scope unexpected: ' + childItem?.scope)
  }
  if (childItem.scope !== `project:${nestedId}`) {
    // 若已登记场景可能不同；此处全未登记时应为 nested 稳定 id
    throw new Error(`expected scope project:${nestedId}, got ${childItem.scope}`)
  }

  console.log('OK: scan-build scope / unregistered merge / nested priority')
  console.log(
    [
      `defaults=${defaults.length}`,
      `found=${found.length}`,
      `pendingNew=${pendingNew.length}`,
      `assets=${items.length}`,
    ].join(' · '),
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
