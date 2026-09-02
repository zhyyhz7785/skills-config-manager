/**
 * Verify catalog.projects is SSOT: empty catalog, persist, legacy normalize, reload.
 * node scripts/verify-catalog-projects.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-catalog-projects-emit-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))

const cfgPath = path.join(root, '.tmp-emit-catalog-projects-tsconfig.json')
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

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-catalog-projects-'))
  const lib = path.join(tmp, 'CursorSkills')
  fs.mkdirSync(lib, { recursive: true })

  const svc = new LibraryCatalogService(lib)
  if (svc.getProjects().length !== 0 || svc.getAll().length !== 0) {
    throw new Error('empty catalog should have no projects/entries')
  }

  svc.addProject({
    id: 'p1',
    name: 'demo',
    rootPath: 'E:\\demo',
    category: '其它项目',
    pinned: false,
  })
  const raw = JSON.parse(fs.readFileSync(path.join(lib, 'catalog.json'), 'utf8'))
  if (!Array.isArray(raw.projects) || raw.projects.length !== 1 || raw.projects[0].id !== 'p1') {
    throw new Error('project not written to catalog.json')
  }
  if ((raw.version ?? 0) < 2) throw new Error('catalog version should be >= 2')

  fs.writeFileSync(path.join(lib, 'catalog.json'), JSON.stringify({ version: 1, entries: [] }, null, 2))
  svc.load()
  if (svc.getProjects().length !== 0) throw new Error('legacy catalog should normalize to empty projects')

  svc.setProjects([
    { id: 'a', name: 'A', rootPath: 'E:\\a', category: '其它项目', pinned: true },
    { id: 'b', name: 'B', rootPath: 'E:\\b', category: '其它项目', pinned: false },
  ])
  const svc2 = new LibraryCatalogService(lib)
  if (svc2.getProjects().map((p) => p.id).join(',') !== 'a,b') {
    throw new Error('projects not reloaded: ' + JSON.stringify(svc2.getProjects()))
  }

  console.log('OK: catalog.projects SSOT checks passed')
  fs.rmSync(tmp, { recursive: true, force: true })
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
