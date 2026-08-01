/**
 * 冲突比对：行级 LCS、空白可视化、相邻增删行内高亮。
 * 仅用于 UI 展示，不改变哈希/冲突判定。
 */

import type { ReactNode } from 'react'
import { createElement, Fragment } from 'react'
import { buildLineDiff, type DiffRow } from './lineDiff'

export type { DiffRow }
export { buildLineDiff }

/** 展示单元：same / del / add，或配对后的 mod（行内高亮） */
export type DiffUnit =
  | { kind: 'same'; left: string; right: string }
  | { kind: 'del'; left: string }
  | { kind: 'add'; right: string }
  | { kind: 'mod'; left: string; right: string }

export type DiffDisplayItem =
  | { type: 'line'; key: string; unit: DiffUnit }
  | { type: 'fold'; key: string; count: number; units: DiffUnit[] }

/** 连续相同行折叠块的最小行数 */
export const DIFF_FOLD_MIN_SAME = 4
/** 折叠时块两端各保留的上下文行数 */
export const DIFF_FOLD_CONTEXT = 1

const CHAR_PAIR_MIN_RATIO = 0.55

function charLcsLen(a: string, b: string): number {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0
  // 滚动数组，避免长行 O(n*m) 内存过大；行预览通常很短
  let prev = Array(m + 1).fill(0)
  let cur = Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    ;[prev, cur] = [cur, prev]
    cur.fill(0)
  }
  return prev[m]
}

export function shouldPairAsModify(left: string, right: string): boolean {
  if (left.trimEnd() === right.trimEnd()) return true
  const maxLen = Math.max(left.length, right.length)
  if (maxLen === 0) return true
  return charLcsLen(left, right) / maxLen >= CHAR_PAIR_MIN_RATIO
}

/** 将相邻 del+add 合成为 mod，便于行内高亮 */
export function pairDiffRows(rows: DiffRow[]): DiffUnit[] {
  const out: DiffUnit[] = []
  let i = 0
  while (i < rows.length) {
    const r = rows[i]
    if (r.kind === 'same') {
      out.push({ kind: 'same', left: r.left, right: r.right })
      i++
      continue
    }
    if (r.kind === 'del' && i + 1 < rows.length && rows[i + 1].kind === 'add') {
      const next = rows[i + 1]
      if (shouldPairAsModify(r.left, next.right)) {
        out.push({ kind: 'mod', left: r.left, right: next.right })
        i += 2
        continue
      }
    }
    if (r.kind === 'del') out.push({ kind: 'del', left: r.left })
    else out.push({ kind: 'add', right: r.right })
    i++
  }
  return out
}

export function buildDiffDisplayItems(units: DiffUnit[], foldSame: boolean): DiffDisplayItem[] {
  if (!foldSame || units.length === 0) {
    return units.map((unit, i) => ({ type: 'line' as const, key: `l${i}`, unit }))
  }
  const out: DiffDisplayItem[] = []
  let i = 0
  let foldSeq = 0
  while (i < units.length) {
    if (units[i].kind !== 'same') {
      out.push({ type: 'line', key: `l${i}`, unit: units[i] })
      i++
      continue
    }
    let j = i
    while (j < units.length && units[j].kind === 'same') j++
    const run = units.slice(i, j)
    const foldable = run.length - DIFF_FOLD_CONTEXT * 2
    if (run.length >= DIFF_FOLD_MIN_SAME && foldable > 0) {
      for (let k = 0; k < DIFF_FOLD_CONTEXT; k++) {
        out.push({ type: 'line', key: `l${i + k}`, unit: run[k] })
      }
      const mid = run.slice(DIFF_FOLD_CONTEXT, run.length - DIFF_FOLD_CONTEXT)
      out.push({ type: 'fold', key: `f${foldSeq++}`, count: mid.length, units: mid })
      for (let k = run.length - DIFF_FOLD_CONTEXT; k < run.length; k++) {
        out.push({ type: 'line', key: `l${i + k}`, unit: run[k] })
      }
    } else {
      for (let k = 0; k < run.length; k++) {
        out.push({ type: 'line', key: `l${i + k}`, unit: run[k] })
      }
    }
    i = j
  }
  return out
}

/** 按行 trimEnd 后正文相同，且原始文本不完全相同 → 仅空白/行尾差异 */
export function isWhitespaceOnlyDiff(leftText: string, rightText: string): boolean {
  const norm = (s: string) =>
    s
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t\u00a0]+$/g, ''))
      .join('\n')
  const a = leftText.replace(/\r\n/g, '\n')
  const b = rightText.replace(/\r\n/g, '\n')
  if (a === b) return false
  return norm(a) === norm(b)
}

type CharSeg = { text: string; changed: boolean }

/** 字符级 LCS 分段：相同段 / 变更段 */
export function charDiffSegments(left: string, right: string): { left: CharSeg[]; right: CharSeg[] } {
  const a = [...left]
  const b = [...right]
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const leftSegs: CharSeg[] = []
  const rightSegs: CharSeg[] = []
  const push = (side: 'l' | 'r', ch: string, changed: boolean) => {
    const segs = side === 'l' ? leftSegs : rightSegs
    const last = segs[segs.length - 1]
    if (last && last.changed === changed) last.text += ch
    else segs.push({ text: ch, changed })
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('l', a[i], false)
      push('r', b[j], false)
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('l', a[i], true)
      i++
    } else {
      push('r', b[j], true)
      j++
    }
  }
  while (i < n) {
    push('l', a[i], true)
    i++
  }
  while (j < m) {
    push('r', b[j], true)
    j++
  }
  return { left: leftSegs, right: rightSegs }
}

function wsGlyph(ch: string): string | null {
  if (ch === ' ') return '·'
  if (ch === '\t') return '→'
  if (ch === '\u00a0') return '⍽'
  return null
}

/** 将空白画成可见符号；changed 段包 inline 高亮 */
export function renderDiffText(
  text: string,
  opts: { showWhitespace: boolean; inlineKind?: 'del' | 'add' | null },
): ReactNode {
  if (!text) return '\u00a0'
  const { showWhitespace, inlineKind = null } = opts
  const nodes: ReactNode[] = []
  let buf = ''
  let key = 0
  const flushPlain = () => {
    if (!buf) return
    if (inlineKind) {
      nodes.push(
        createElement('span', { key: `ch-${key++}`, className: `conflict-diff-inline-${inlineKind}` }, buf),
      )
    } else {
      nodes.push(buf)
    }
    buf = ''
  }
  for (const ch of text) {
    const g = showWhitespace ? wsGlyph(ch) : null
    if (g != null) {
      flushPlain()
      nodes.push(
        createElement(
          'span',
          {
            key: `ws-${key++}`,
            className: `conflict-diff-ws${inlineKind ? ` conflict-diff-inline-${inlineKind}` : ''}`,
            title: ch === '\t' ? 'Tab' : ch === '\u00a0' ? 'NBSP' : '空格',
          },
          g,
        ),
      )
    } else {
      buf += ch
    }
  }
  flushPlain()
  if (nodes.length === 0) return '\u00a0'
  if (nodes.length === 1) return nodes[0]
  return createElement(Fragment, null, ...nodes)
}

export function renderSegmentedDiffText(
  segs: CharSeg[],
  opts: { showWhitespace: boolean; inlineKind: 'del' | 'add' },
): ReactNode {
  if (segs.length === 0) return '\u00a0'
  return createElement(
    Fragment,
    null,
    ...segs.map((seg, i) =>
      createElement(
        Fragment,
        { key: `s${i}` },
        renderDiffText(seg.text, {
          showWhitespace: opts.showWhitespace,
          inlineKind: seg.changed ? opts.inlineKind : null,
        }),
      ),
    ),
  )
}
