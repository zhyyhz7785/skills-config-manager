/**
 * 行级 LCS（Longest Common Subsequence，最长公共子序列）差分。
 * 纯函数、无 React 依赖，可供合并算法与 UI 共用。
 */

export type DiffRow =
  | { kind: 'same'; left: string; right: string }
  | { kind: 'del'; left: string; right: string }
  | { kind: 'add'; left: string; right: string }

function splitLinesLf(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

/**
 * 将两侧文本按行对齐。
 * @param normalize 若提供，仅用于相等判定；DiffRow 仍保留原始行内容。
 */
export function buildLineDiff(
  leftText: string,
  rightText: string,
  normalize?: (line: string) => string,
): DiffRow[] {
  const a = splitLinesLf(leftText)
  const b = splitLinesLf(rightText)
  const an = normalize ? a.map(normalize) : a
  const bn = normalize ? b.map(normalize) : b
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = an[i] === bn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (an[i] === bn[j]) {
      rows.push({ kind: 'same', left: a[i], right: b[j] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ kind: 'del', left: a[i], right: '' })
      i++
    } else {
      rows.push({ kind: 'add', left: '', right: b[j] })
      j++
    }
  }
  while (i < n) {
    rows.push({ kind: 'del', left: a[i], right: '' })
    i++
  }
  while (j < m) {
    rows.push({ kind: 'add', left: '', right: b[j] })
    j++
  }
  return rows
}
