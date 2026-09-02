/**
 * 临时目录验证：容器根归一、空目录清理、双重 .cursor 折叠。
 * 运行：node scripts/verify-path-fix.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function normalize(filePath) {
  return path.resolve(filePath.trim()).replace(/[/\\]+$/, '').toLowerCase()
}

function isConfigRootName(name) {
  const n = String(name ?? '').trim().toLowerCase()
  return n === '.cursor' || n === '.claude' || n === '.codex'
}

function resolveCursorConfigRoot(containerRoot, userGlobal = false) {
  const resolved = path.resolve(containerRoot.trim())
  if (userGlobal) return resolved
  if (isConfigRootName(path.basename(resolved))) return resolved
  return path.join(resolved, '.cursor')
}

function collapseNestedCursorPath(filePath) {
  const resolved = path.resolve(filePath.trim())
  const parts = resolved.split(/[/\\]/)
  const out = []
  for (const part of parts) {
    if (
      part.toLowerCase() === '.cursor' &&
      out.length > 0 &&
      out[out.length - 1].toLowerCase() === '.cursor'
    ) {
      continue
    }
    out.push(part)
  }
  if (out.length === 0) return resolved
  if (/^[a-zA-Z]:$/.test(out[0])) return out[0] + path.sep + out.slice(1).join(path.sep)
  if (out[0] === '') return path.sep + out.slice(1).join(path.sep)
  return out.join(path.sep)
}

function hasNestedCursorSegment(filePath) {
  return /(?:^|[/\\])\.cursor[/\\]\.cursor(?:[/\\]|$)/i.test(filePath)
}

function pruneEmptyDirsUpward(startDir, stopAt) {
  let dir = path.resolve(startDir)
  const stop = path.resolve(stopAt)
  const norm = (p) => p.replace(/[/\\]+$/, '').toLowerCase()
  const stopNorm = norm(stop)
  for (let i = 0; i < 64; i++) {
    const dirNorm = norm(dir)
    if (dirNorm === stopNorm) return
    if (!(dirNorm.startsWith(stopNorm + '\\') || dirNorm.startsWith(stopNorm + '/'))) return
    if (!fs.existsSync(dir)) {
      const parent = path.dirname(dir)
      if (parent === dir) return
      dir = parent
      continue
    }
    if (!fs.lstatSync(dir).isDirectory()) return
    if (fs.readdirSync(dir).length > 0) return
    fs.rmdirSync(dir)
    const parent = path.dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

function moveFileCrossVolume(source, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  try {
    fs.renameSync(source, dest)
  } catch {
    fs.copyFileSync(source, dest)
    fs.unlinkSync(source)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-path-fix-'))
const project = path.join(tmp, 'proj')
const cursorRoot = path.join(project, '.cursor')
const nested = path.join(cursorRoot, '.cursor', 'rules', 'l0-cursor-user-rules')
const nestedFile = path.join(nested, 'l0-cursor-user-rules.md')
const goodDir = path.join(cursorRoot, 'rules', 'l0-cursor-user-rules')
const goodFile = path.join(goodDir, 'l0-cursor-user-rules.md')
const emptyLeftover = path.join(cursorRoot, 'rules', 'empty-leftover')

try {
  const a = resolveCursorConfigRoot(cursorRoot, false)
  assert(normalize(a) === normalize(cursorRoot), `expected same cursor root, got ${a}`)
  const b = resolveCursorConfigRoot(project, false)
  assert(normalize(b) === normalize(cursorRoot), `expected project+.cursor, got ${b}`)
  const user = path.join(tmp, 'user', '.cursor')
  const c = resolveCursorConfigRoot(user, true)
  assert(normalize(c) === normalize(user), `userGlobal should keep root, got ${c}`)

  const collapsed = collapseNestedCursorPath(nestedFile)
  assert(normalize(collapsed) === normalize(goodFile), `collapse failed: ${collapsed} !== ${goodFile}`)
  assert(hasNestedCursorSegment(nestedFile), 'should detect nested')
  assert(!hasNestedCursorSegment(goodFile), 'should not detect on good path')

  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(nestedFile, 'content-a', 'utf8')
  fs.mkdirSync(emptyLeftover, { recursive: true })

  fs.mkdirSync(path.dirname(goodFile), { recursive: true })
  moveFileCrossVolume(nestedFile, goodFile)
  pruneEmptyDirsUpward(path.dirname(nestedFile), cursorRoot)
  assert(fs.existsSync(goodFile), 'good file missing after move')
  assert(!fs.existsSync(nestedFile), 'nested file should be gone')
  assert(!fs.existsSync(nested), 'nested empty dir should be pruned')
  assert(!fs.existsSync(path.join(cursorRoot, '.cursor')), 'extra .cursor should be gone')

  pruneEmptyDirsUpward(emptyLeftover, path.join(cursorRoot, 'rules'))
  assert(!fs.existsSync(emptyLeftover), 'empty leftover should be removed')
  assert(fs.existsSync(path.join(cursorRoot, 'rules')), 'category root must remain')

  const conflictSrc = path.join(cursorRoot, '.cursor', 'rules', 'x', 'x.md')
  fs.mkdirSync(path.dirname(conflictSrc), { recursive: true })
  fs.writeFileSync(conflictSrc, 'newer', 'utf8')
  assert(fs.existsSync(goodFile), 'target should exist for conflict case')
  assert(fs.readFileSync(goodFile, 'utf8') === 'content-a', 'must not overwrite')
  assert(fs.existsSync(conflictSrc), 'conflict source kept')

  console.log('OK verify-path-fix')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
