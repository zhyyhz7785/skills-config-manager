/**
 * Markdown 最小差异写回：把「序列化全文」相对基线的改动，反投影回磁盘原文。
 * 未触碰区域保持原文字节（含 EOL、表格填充、***、转义等）。
 */

import { buildLineDiff } from './lineDiff'

export type LineWithEol = { text: string; eol: string }

export type MergeResult = {
  body: string
  /** 相对原文被替换/插入涉及的行量（删 + 增） */
  changedLines: number
}

/** 供 remark-stringify / Milkdown remarkStringifyOptionsCtx 使用的子集 */
export type InferredRemarkStringifyOptions = {
  rule: '-' | '*' | '_'
  ruleSpaces: false
  bullet: '-' | '*' | '+'
  emphasis: '*'
  strong: '*'
  fence: '`'
  fences: true
  listItemIndent: 'one'
}

/** 按行拆分并保留各自行尾（混合 EOL 可字节级还原）。 */
export function splitLinesWithEol(text: string): LineWithEol[] {
  const out: LineWithEol[] = []
  let i = 0
  while (i < text.length) {
    const start = i
    while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++
    const lineText = text.slice(start, i)
    let eol = ''
    if (i < text.length) {
      if (text[i] === '\r' && text[i + 1] === '\n') {
        eol = '\r\n'
        i += 2
      } else if (text[i] === '\r' || text[i] === '\n') {
        eol = text[i]
        i += 1
      }
    }
    out.push({ text: lineText, eol })
  }
  if (out.length === 0) out.push({ text: '', eol: '' })
  return out
}

/** CRLF 多于孤立 LF 则 `\r\n`，否则 `\n`。 */
export function detectDominantEol(text: string): '\r\n' | '\n' {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\r' && text[i + 1] === '\n') {
      crlf++
      i++
    } else if (text[i] === '\n') {
      lf++
    }
  }
  return crlf > lf ? '\r\n' : '\n'
}

/** 将文本统一为指定 EOL（保留是否以换行结尾）。 */
export function withDominantEol(text: string, eol: '\r\n' | '\n'): string {
  const endsWithNl = /(?:\r\n|\n|\r)$/.test(text)
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '' && endsWithNl) {
    lines.pop()
  }
  if (lines.length === 0) return endsWithNl ? eol : ''
  const body = lines.join(eol)
  return endsWithNl ? body + eol : body
}

/**
 * 仅用于 O↔S0 锚点比较：抹平列表标记、分隔线、表格空格、行尾空白、\\~。
 * 不改变写出内容。
 */
export function normalizeLineForAnchor(line: string): string {
  let s = line.replace(/\s+$/u, '')
  if (/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(s)) return '---'
  s = s.replace(/^(\s*)[*+-](\s+)/, '$1-$2')
  if (s.includes('|')) {
    s = s.replace(/\s*\|\s*/g, '|')
  }
  s = s.replace(/\\~/g, '~')
  return s
}

/** 按原文样本推断 stringify 风格；无样本时默认 `-`。 */
export function inferRemarkStringifyOptions(originalBody: string): InferredRemarkStringifyOptions {
  let starBullet = 0
  let dashBullet = 0
  let plusBullet = 0
  let ruleStar = 0
  let ruleDash = 0
  let ruleUnderscore = 0

  for (const raw of originalBody.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/u, '')
    const bullet = line.match(/^([*+-])\s+\S/)
    if (bullet) {
      if (bullet[1] === '*') starBullet++
      else if (bullet[1] === '-') dashBullet++
      else plusBullet++
    }
    if (/^\*{3,}$/.test(line)) ruleStar++
    else if (/^-{3,}$/.test(line)) ruleDash++
    else if (/^_{3,}$/.test(line)) ruleUnderscore++
  }

  let bullet: '-' | '*' | '+' = '-'
  if (starBullet >= dashBullet && starBullet >= plusBullet && starBullet > 0) bullet = '*'
  else if (plusBullet > dashBullet && plusBullet > starBullet) bullet = '+'
  else if (dashBullet > 0 || starBullet > 0 || plusBullet > 0) {
    if (dashBullet >= starBullet && dashBullet >= plusBullet) bullet = '-'
    else if (starBullet >= plusBullet) bullet = '*'
    else bullet = '+'
  }

  let rule: '-' | '*' | '_' = '-'
  if (ruleStar >= ruleDash && ruleStar >= ruleUnderscore && ruleStar > 0) rule = '*'
  else if (ruleUnderscore > ruleDash && ruleUnderscore > ruleStar) rule = '_'
  else if (ruleDash > 0 || ruleStar > 0 || ruleUnderscore > 0) {
    if (ruleDash >= ruleStar && ruleDash >= ruleUnderscore) rule = '-'
    else if (ruleStar >= ruleUnderscore) rule = '*'
    else rule = '_'
  }

  return {
    rule,
    ruleSpaces: false,
    bullet,
    emphasis: '*',
    strong: '*',
    fence: '`',
    fences: true,
    listItemIndent: 'one',
  }
}

function joinLines(lines: LineWithEol[]): string {
  return lines.map((l) => l.text + l.eol).join('')
}

function preserveTrailingNewline(lines: LineWithEol[], originalEndsWithNl: boolean, eol: string): void {
  if (lines.length === 0) return
  const last = lines[lines.length - 1]
  if (originalEndsWithNl) {
    if (!last.eol) last.eol = eol
  } else {
    last.eol = ''
  }
}

type EditHunk = { s0Start: number; s0End: number; addLines: string[] }

function collectEditHunks(baseline: string, next: string): EditHunk[] {
  const rows = buildLineDiff(baseline, next)
  const hunks: EditHunk[] = []
  let s0 = 0
  let cur: EditHunk | null = null
  const flush = () => {
    if (cur) {
      hunks.push(cur)
      cur = null
    }
  }
  for (const row of rows) {
    if (row.kind === 'same') {
      flush()
      s0++
    } else if (row.kind === 'del') {
      if (!cur) cur = { s0Start: s0, s0End: s0, addLines: [] }
      cur.s0End = s0 + 1
      s0++
    } else {
      if (!cur) cur = { s0Start: s0, s0End: s0, addLines: [] }
      cur.addLines.push(row.right)
    }
  }
  flush()
  return hunks
}

/** S0 行号 → 原文行号（化妆品归一化后的 same 锚点） */
function buildSameAnchorMap(original: string, baseline: string): Map<number, number> {
  const rows = buildLineDiff(original, baseline, normalizeLineForAnchor)
  const map = new Map<number, number>()
  let oi = 0
  let si = 0
  for (const row of rows) {
    if (row.kind === 'same') {
      map.set(si, oi)
      oi++
      si++
    } else if (row.kind === 'del') {
      oi++
    } else {
      si++
    }
  }
  return map
}

function resolveInsertPoint(map: Map<number, number>, s0Index: number): number {
  if (map.has(s0Index)) return map.get(s0Index)!
  let best = -1
  for (const [s0, ori] of map) {
    if (s0 < s0Index && ori > best) best = ori
  }
  return best + 1
}

function resolveOrigStart(map: Map<number, number>, s0Start: number): number {
  if (map.has(s0Start)) return map.get(s0Start)!
  return resolveInsertPoint(map, s0Start)
}

function resolveOrigEnd(map: Map<number, number>, s0End: number, origLen: number): number {
  let best = Infinity
  for (const [s0, ori] of map) {
    if (s0 >= s0End && ori < best) best = ori
  }
  return best === Infinity ? origLen : best
}

/**
 * 将 next 相对 baseline 的编辑反投影到 originalBody。
 * 锚点交叉/无法定位时返回 null（调用方走整篇兜底）。
 */
export function mergeSerializedEdit(
  originalBody: string,
  baseline: string,
  next: string,
): MergeResult | null {
  if (baseline === next) {
    return { body: originalBody, changedLines: 0 }
  }

  const origLines = splitLinesWithEol(originalBody)
  const eol = detectDominantEol(originalBody)
  const originalEndsWithNl = /(?:\r\n|\n|\r)$/.test(originalBody)
  const map = buildSameAnchorMap(originalBody, baseline)
  const hunks = collectEditHunks(baseline, next)

  if (hunks.length === 0) {
    return { body: originalBody, changedLines: 0 }
  }

  const out: LineWithEol[] = []
  let oriCursor = 0
  let changedLines = 0

  for (const hunk of hunks) {
    let oriStart: number
    let oriEnd: number
    if (hunk.s0Start === hunk.s0End) {
      oriStart = resolveInsertPoint(map, hunk.s0Start)
      oriEnd = oriStart
    } else {
      oriStart = resolveOrigStart(map, hunk.s0Start)
      oriEnd = resolveOrigEnd(map, hunk.s0End, origLines.length)
    }

    if (oriStart < oriCursor || oriEnd < oriStart || oriEnd > origLines.length) {
      return null
    }

    for (let i = oriCursor; i < oriStart; i++) out.push(origLines[i])

    changedLines += oriEnd - oriStart + hunk.addLines.length
    for (const line of hunk.addLines) {
      out.push({ text: line, eol })
    }
    oriCursor = oriEnd
  }

  for (let i = oriCursor; i < origLines.length; i++) out.push(origLines[i])

  preserveTrailingNewline(out, originalEndsWithNl, eol)
  return { body: joinLines(out), changedLines }
}
