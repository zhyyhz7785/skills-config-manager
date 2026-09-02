/** 网络表/筛选池是否折叠语言镜像。与界面语言一样走 localStorage，不进 ccm-settings。 */
const STORAGE_KEY = 'ccm.hideMirrors'

/** 默认开：同源去 locale 后缀后同名只留一条。 */
export const DEFAULT_HIDE_MIRRORS = true

export function loadHideMirrors(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === '0') return false
    if (raw === '1') return true
  } catch {
    /* 单测 / 无 DOM */
  }
  return DEFAULT_HIDE_MIRRORS
}

export function saveHideMirrors(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    /* 无 DOM */
  }
}
