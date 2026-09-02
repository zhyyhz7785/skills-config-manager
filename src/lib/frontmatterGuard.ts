/**
 * Frontmatter 防护：Milkdown 不认识 YAML frontmatter。
 * 宿主剥离 frontmatter，编辑器只编辑正文，写回时拼回。
 * （与 HYmd hymd-webview-core/frontmatterGuard 行为对齐）
 */

export interface FrontmatterSplit {
  frontmatter: string
  body: string
}

export function splitFrontmatter(text: string): FrontmatterSplit {
  if (!text.startsWith('---')) return { frontmatter: '', body: text }

  const firstLineEnd = text.indexOf('\n')
  if (firstLineEnd === -1) return { frontmatter: '', body: text }
  if (text.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') {
    return { frontmatter: '', body: text }
  }

  let searchFrom = firstLineEnd + 1
  while (searchFrom <= text.length) {
    const lineEnd = text.indexOf('\n', searchFrom)
    const rawLine = lineEnd === -1 ? text.slice(searchFrom) : text.slice(searchFrom, lineEnd)
    if (rawLine.replace(/\r$/, '') === '---') {
      const end = lineEnd === -1 ? text.length : lineEnd + 1
      return { frontmatter: text.slice(0, end), body: text.slice(end) }
    }
    if (lineEnd === -1) break
    searchFrom = lineEnd + 1
  }
  return { frontmatter: '', body: text }
}

/**
 * @param eol 拼接 frontmatter 与正文之间的换行；缺省 `\n`。
 *   若 frontmatter 已以换行结尾则不再追加；正文若已以换行开头也不再插分隔行。
 */
export function joinFrontmatter(frontmatter: string, body: string, eol: '\r\n' | '\n' = '\n'): string {
  if (!frontmatter) return body
  const fmEndsNl = /(?:\r\n|\n|\r)$/.test(frontmatter)
  const fm = fmEndsNl ? frontmatter : `${frontmatter}${eol}`
  if (body.length === 0) return fm
  if (body.startsWith('\n') || body.startsWith('\r\n') || body.startsWith('\r')) return fm + body
  return `${fm}${eol}${body}`
}
