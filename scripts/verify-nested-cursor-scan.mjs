/**
 * 验证：嵌套 .cursor 发现 + 空台账不自愈相关路径辅助。
 * node scripts/verify-nested-cursor-scan.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function normalize(p) {
  return path.resolve(p).replace(/[/\\]+$/, '').toLowerCase()
}

const SKIP = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build'].map((s) => s.toLowerCase()))

function findNestedCursorDirs(projectRoot, maxDepth) {
  const results = []
  const direct = normalize(path.join(projectRoot, '.cursor'))
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (SKIP.has(e.name.toLowerCase())) continue
      const full = path.join(dir, e.name)
      if (e.name.toLowerCase() === '.cursor') {
        if (normalize(full) !== direct) results.push(full)
        continue
      }
      walk(full, depth + 1)
    }
  }
  walk(projectRoot, 0)
  return results
}

function isPathInActiveContainerTree(filePath, containerRoot, userGlobal) {
  const root = containerRoot
  const under = (a, b) => {
    const A = normalize(a)
    const B = normalize(b)
    return A === B || A.startsWith(B + '\\') || A.startsWith(B + '/')
  }
  if (under(filePath, root)) return true
  if (userGlobal) return false
  const projectRoot = path.basename(containerRoot).toLowerCase() === '.cursor'
    ? path.dirname(containerRoot)
    : containerRoot
  if (!under(filePath, projectRoot)) return false
  return /(?:^|[/\\])\.cursor(?:[/\\]|$)/i.test(filePath)
}

const nestedTarget = 'E:\\cursor\\00Engineering\\shuipingdingxiangzuan\\.cursor'
const ruleFile = path.join(nestedTarget, 'rules', '01.mdc')
const found = findNestedCursorDirs('E:\\cursor', 5)
const hit = found.some((d) => normalize(d) === normalize(nestedTarget))
console.log({
  nestedExists: fs.existsSync(ruleFile),
  foundCount: found.length,
  hitShuiping: hit,
  sample: found.filter((d) => /shuiping|00Engineering/i.test(d)).slice(0, 5),
})

const containerRoot = 'E:\\cursor\\.cursor'
const ok = isPathInActiveContainerTree(ruleFile, containerRoot, false)
const bad = isPathInActiveContainerTree('E:\\other\\proj\\.cursor\\rules\\x.mdc', containerRoot, false)
console.log({ nestedCountsAsContainer: ok, foreignRejected: !bad })

if (!fs.existsSync(ruleFile)) throw new Error('expected nested rule missing')
if (!hit) throw new Error('nested .cursor not discovered')
if (!ok) throw new Error('filter should accept nested path')
if (bad) throw new Error('filter should reject foreign path')

// 空台账语义：模拟删除后不应“凭空”有条目——只断言 catalog 可为不存在
const catalogPath = 'E:\\cursor\\CursorSkills\\catalog.json'
console.log({ catalogExists: fs.existsSync(catalogPath) })

console.log('OK verify-nested-cursor-scan')
