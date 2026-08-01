/**
 * 对照 bf1/catalog.json 与当前 catalog / 磁盘文件夹，找出扫描遗漏。
 * 判定只看文件夹名（skills/xxx、rules/xxx），不要求内部有文件。
 * node scripts/compare-bf1-catalog.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const lib = 'E:/cursor/CursorSkills'
const bf1 = JSON.parse(fs.readFileSync(path.join(lib, 'bf1/catalog.json'), 'utf8'))
const cur = JSON.parse(fs.readFileSync(path.join(lib, 'catalog.json'), 'utf8'))

const kindDir = {
  skill: 'skills',
  rule: 'rules',
  agent: 'agents',
  command: 'commands',
  hook: 'hooks',
}

function libFolder(e) {
  const top = kindDir[e.kind] || e.kind
  const lp = String(e.libraryPath || '').replace(/\\/g, '/')
  const parts = lp.split('/').filter(Boolean)
  if (parts.length >= 2 && parts[0].toLowerCase() === top) {
    return `${top}/${parts[1]}`.toLowerCase()
  }
  return `${top}/${e.id}`.toLowerCase()
}

function listDiskFolders() {
  const out = []
  for (const dirName of Object.values(kindDir)) {
    const dir = path.join(lib, dirName)
    if (!fs.existsSync(dir)) continue
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (d.isDirectory()) out.push(`${dirName}/${d.name}`.toLowerCase())
    }
  }
  return out
}

function projectRootFromPath(p) {
  if (!p) return null
  const lower = p.toLowerCase()
  const marker = '\\.cursor'
  const mi = lower.indexOf(marker)
  if (mi <= 0) return null
  return p.slice(0, mi)
}

function isUserCursorProject(root) {
  const lower = root.toLowerCase()
  return /\\users\\[^\\]+$/i.test(root) || lower.endsWith('\\users\\zhy')
}

const bf1Map = new Map()
for (const e of bf1.entries) bf1Map.set(libFolder(e), e)
const curMap = new Map()
for (const e of cur.entries) curMap.set(libFolder(e), e)
const disk = new Set(listDiskFolders())

const bf1Only = [...bf1Map.keys()].filter((k) => !curMap.has(k)).sort()
const diskNotCur = [...disk].filter((k) => !curMap.has(k)).sort()
const bf1NotDisk = [...bf1Map.keys()].filter((k) => !disk.has(k)).sort()

console.log('bf1 entries', bf1.entries.length, '| cur', cur.entries.length, '| disk folders', disk.size)
console.log('')
console.log('=== A. bf1 有、当前 catalog 无（按库内文件夹）===', bf1Only.length)
for (const k of bf1Only) {
  const e = bf1Map.get(k)
  const tag = disk.has(k) ? '[磁盘有-应能登记]' : '[磁盘无]'
  console.log(tag, k, '| id=', e.id)
}

console.log('')
console.log('=== B. 磁盘有文件夹、当前 catalog 无（扫描漏登）===', diskNotCur.length)
for (const k of diskNotCur) console.log(k)

console.log('')
console.log('=== C. bf1 有、磁盘已无该文件夹 ===', bf1NotDisk.length)
for (const k of bf1NotDisk) console.log(k, '| id=', bf1Map.get(k).id)

// skills without SKILL.md (folder-only) — discovery skips these
console.log('')
console.log('=== D. 磁盘 skills 文件夹缺 SKILL.md（当前扫描会跳过）===')
const skillsDir = path.join(lib, 'skills')
let noSkillMd = 0
if (fs.existsSync(skillsDir)) {
  for (const name of fs.readdirSync(skillsDir)) {
    const dir = path.join(skillsDir, name)
    if (!fs.statSync(dir).isDirectory()) continue
    if (!fs.existsSync(path.join(dir, 'SKILL.md'))) {
      noSkillMd++
      console.log('skills/' + name)
    }
  }
}
if (noSkillMd === 0) console.log('(无)')

// rules folders without mdc/md
console.log('')
console.log('=== E. 磁盘 rules 文件夹无 .mdc/.md 主文件（当前扫描可能跳过）===')
const rulesDir = path.join(lib, 'rules')
let noRuleFile = 0
if (fs.existsSync(rulesDir)) {
  for (const name of fs.readdirSync(rulesDir)) {
    const dir = path.join(rulesDir, name)
    if (!fs.statSync(dir).isDirectory()) continue
    const files = fs.readdirSync(dir).filter((f) => /\.(mdc|md)$/i.test(f) && !f.toLowerCase().endsWith('.full.md'))
    if (files.length === 0) {
      noRuleFile++
      console.log('rules/' + name)
    }
  }
}
if (noRuleFile === 0) console.log('(无)')

// project roots from bf1
const proj = new Map()
for (const e of bf1.entries) {
  for (const o of e.origins || []) {
    const r = projectRootFromPath(o.originalPath || '')
    if (!r || isUserCursorProject(r) || /CursorSkills/i.test(r)) continue
    proj.set(r.toLowerCase(), r)
  }
  for (const h of e.history || []) {
    for (const field of [h.fromPath, h.toPath, h.containerRoot]) {
      const r = projectRootFromPath(field || '')
      if (!r || isUserCursorProject(r) || /CursorSkills/i.test(r)) continue
      proj.set(r.toLowerCase(), r)
    }
  }
}

console.log('')
console.log('=== F. bf1 origins/history 推断的项目根（文件夹判断）===', proj.size)
for (const r of [...proj.values()].sort((a, b) => a.localeCompare(b))) {
  const exists = fs.existsSync(r)
  const hasCursor = exists && fs.existsSync(path.join(r, '.cursor'))
  const tag = hasCursor ? '[有.cursor]' : exists ? '[无.cursor]' : '[路径不存在]'
  console.log(tag, r)
}
