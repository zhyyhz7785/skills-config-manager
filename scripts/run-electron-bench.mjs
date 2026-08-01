/**
 * Run Electron headless bench with cwd = sibling CursorConfigManager
 * so its node_modules resolve for electron/services imports.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const mainRepo = path.resolve(root, '../CursorConfigManager')
const script = path.join(root, 'scripts', 'bench-electron-perf.mts')

const r = spawnSync('npx', ['--yes', 'tsx', script], {
  cwd: mainRepo,
  env: process.env,
  stdio: 'inherit',
  shell: true,
})
process.exit(r.status ?? 1)
