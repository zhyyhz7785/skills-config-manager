/**
 * 运行可移植 verify 脚本集合（排除 MANUAL / 本机硬编码路径）。
 * node scripts/run-all-verify.mjs
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scripts = [
  'verify-autonomous-ops-guards.mjs',
  'verify-backup-mirror-pollution.mjs',
  'verify-catalog-projects.mjs',
  'verify-container-classification.mjs',
  'verify-md-minimal-merge.mjs',
  'verify-move-restore-conflicts.mjs',
  'verify-nested-project-discovery.mjs',
  'verify-path-fix.mjs',
  'verify-remove-project.mjs',
  'verify-remove-project-modes.mjs',
  'verify-scan-build-scope.mjs',
]

let failed = 0
for (const name of scripts) {
  console.log(`\n=== ${name} ===`)
  const r = spawnSync(process.execPath, [path.join('scripts', name)], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.stderr) process.stderr.write(r.stderr)
  if (r.status !== 0) {
    console.error(`FAILED: ${name} (exit ${r.status})`)
    failed++
  } else {
    console.log(`PASSED: ${name}`)
  }
}

if (failed > 0) {
  console.error(`\nverify:all failed: ${failed}/${scripts.length}`)
  process.exit(1)
}
console.log(`\nverify:all passed: ${scripts.length}/${scripts.length}`)
