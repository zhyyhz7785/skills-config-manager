/**
 * 对当前 catalog / 磁盘执行一次路径自愈并打印结果。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(os.tmpdir(), 'ccm-emit-' + Date.now())
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify({ type: 'module' }))

const cfgPath = path.join(root, '.tmp-emit-tsconfig.json')
const tsconfig = {
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
    allowImportingTsExtensions: false,
    types: ['node'],
  },
  include: [
    'electron/services/**/*.ts',
    'shared/**/*.ts',
  ],
  exclude: ['electron/appController.ts', 'electron/main.ts', 'electron/preload.ts'],
}
fs.writeFileSync(cfgPath, JSON.stringify(tsconfig, null, 2))

try {
  const r = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['tsc', '-p', cfgPath],
    { cwd: root, encoding: 'utf8', shell: true },
  )
  if (r.status !== 0) {
    console.error(r.stdout)
    console.error(r.stderr)
    process.exit(r.status ?? 1)
  }

  // Rewrite .js imports for Node ESM: keep as-is if already .js
  const { SkillIngestService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/skillIngestService.js')).href
  )
  const { LibraryCatalogService } = await import(
    pathToFileURL(path.join(outDir, 'electron/services/libraryCatalogService.js')).href
  )

  const libraryRoot = 'E:\\cursor\\CursorSkills'
  const catalog = new LibraryCatalogService(libraryRoot)
  catalog.load()
  const ingest = new SkillIngestService(catalog)
  const result = ingest.repairNestedCursorPaths()
  console.log(JSON.stringify(result, null, 2))

  const nestedProbe =
    'E:\\BaiduSyncdisk\\Code\\CSharp\\CursorProjects\\hy-cad-tool\\.cursor\\.cursor\\rules\\l0-cursor-user-rules\\l0-cursor-user-rules.md'
  const goodProbe =
    'E:\\BaiduSyncdisk\\Code\\CSharp\\CursorProjects\\hy-cad-tool\\.cursor\\rules\\l0-cursor-user-rules\\l0-cursor-user-rules.md'
  const emptyUser = 'C:\\Users\\ZHY\\.cursor\\rules\\l0-cursor-user-rules'
  console.log({
    nestedExists: fs.existsSync(nestedProbe),
    goodExists: fs.existsSync(goodProbe),
    emptyUserExists: fs.existsSync(emptyUser),
  })
} finally {
  fs.rmSync(cfgPath, { force: true })
  fs.rmSync(outDir, { recursive: true, force: true })
}
