/** 与 Rust `source_id_for_url` 对齐：从 Git URL 得到 owner-repo slug。
 * `.git` 后缀大小写不敏感剥离（与后端 strip 规则一致）。 */
export function sourceIdFromUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  const parts = u.split('/').filter(Boolean)
  const last = parts[parts.length - 1] || 'repo'
  const prev = parts[parts.length - 2] || 'src'
  let raw = `${prev}-${last}`.toLowerCase()
  let out = ''
  for (const c of raw) {
    if (/[a-z0-9_-]/.test(c)) out += c
    else out += '-'
  }
  while (out.includes('--')) out = out.replace(/--/g, '-')
  const t = out.replace(/^-+|-+$/g, '')
  if (!t) return 'item'
  return t.slice(0, 80)
}
