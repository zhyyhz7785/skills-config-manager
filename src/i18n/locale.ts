export type Locale = 'zh-CN' | 'en'
export const LOCALES: readonly Locale[] = ['zh-CN', 'en']

const STORAGE_KEY = 'ccm.locale'
const DEFAULT_LOCALE: Locale = 'zh-CN'

const listeners = new Set<() => void>()
let current: Locale = loadLocale()
applyDocumentLang(current)

function loadLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'en' || raw === 'zh-CN') return raw
  } catch {
    /* 单测 / 无 DOM */
  }
  return DEFAULT_LOCALE
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

export function getLocale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'zh-CN') return
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* ignore */
  }
  applyDocumentLang(next)
  for (const cb of listeners) cb()
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
