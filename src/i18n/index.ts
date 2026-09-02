import { useSyncExternalStore } from 'react'
import { en } from './en'
import { zhCN, type I18nKey } from './zh-CN'
import { getLocale, setLocale, subscribeLocale, type Locale } from './locale'

export type { I18nKey, Locale }
export { getLocale, setLocale, subscribeLocale, LOCALES } from './locale'
export { zhCN } from './zh-CN'
export { en } from './en'

const DICTS: Record<Locale, Record<I18nKey, string>> = {
  'zh-CN': zhCN,
  en,
}

export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const dict = DICTS[getLocale()] ?? zhCN
  let s = dict[key] ?? zhCN[key] ?? String(key)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v))
    }
  }
  return s
}

export function useI18n() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale)
  return { locale, t, setLocale }
}

const KIND_KEYS: Record<string, I18nKey> = {
  技能: 'kind.skill',
  规则: 'kind.rule',
  代理: 'kind.agent',
  命令: 'kind.command',
  钩子: 'kind.hook',
  skill: 'kind.skill',
  rule: 'kind.rule',
  agent: 'kind.agent',
  command: 'kind.command',
  hook: 'kind.hook',
}

export function translateKindLabel(kindOrLabel: string): string {
  const key = KIND_KEYS[kindOrLabel.trim()] ?? KIND_KEYS[kindOrLabel.trim().toLowerCase()]
  return key ? t(key) : kindOrLabel
}

const CLUSTER_KEYS: I18nKey[] = ['cluster.byLevel', 'cluster.byProject', 'cluster.flat']

export function clusterOptionLabel(index: number): string {
  return t(CLUSTER_KEYS[index] ?? 'cluster.byLevel')
}

export function navCategoryLabel(name: string): string {
  if (name === '工作区') return t('nav.workspaces')
  if (name === '容器') return t('nav.containers')
  if (name === '备份区域') return t('nav.backupArea')
  if (name === '隐藏容器') return t('nav.hiddenContainers')
  return name
}

export function chipText(copy: { zh: string; en: string }): string {
  return getLocale() === 'en' ? copy.en : copy.zh
}

export function displayUnconfigured(raw: string | null | undefined, fallback: string): string {
  const s = (raw || '').trim()
  if (!s || s.includes('未配置')) return fallback
  return s
}

const CONTAINER_HEADER_PREFIX = '容器中 · '

/** 快照分区标题「容器中」/「容器中 · {工作区}」对照当前语言。 */
export function translateContainerHeader(raw: string): string {
  const s = (raw || '').trim()
  if (!s || s === '容器中') return t('list.inContainerBare')
  if (s.startsWith(CONTAINER_HEADER_PREFIX)) {
    return t('list.inContainer', { name: s.slice(CONTAINER_HEADER_PREFIX.length) })
  }
  return s
}

/** 快照分区标题「永久库」对照当前语言。 */
export function translateLibraryHeader(raw: string): string {
  const s = (raw || '').trim()
  if (!s || s === '永久库') return t('settings.library')
  return s
}

/** 列表副标题里的部署位置词（当前容器 / 未部署 / 台账有部署路径）。 */
export function translatePlaceSubtitle(raw: string): string {
  if (!raw) return raw
  return raw
    .replaceAll('台账有部署路径', t('list.catalogHasDeployPath'))
    .replaceAll('当前容器', t('list.currentContainer'))
    .replaceAll('未部署', t('list.notDeployed'))
}

/** 聚类分组名「未分类」对照当前语言；项目名等用户数据原样返回。 */
export function translateClusterGroupName(name: string): string {
  if (name === '未分类' || name === 'uncategorized') return t('kind.uncategorized')
  return name
}

/** 网络侧栏热度词缀对照当前语言；星标数字与社区档名原样。 */
export function translateHeatLabel(raw: string | null | undefined): string {
  const s = (raw || '').trim()
  if (!s) return s
  return s
    .replaceAll('官方样例', t('heat.officialSample'))
    .replaceAll('无默认官方仓', t('heat.noOfficialRepo'))
}

/** 状态栏快照固定句对照当前语言；无法识别则原样（toast 已走词典）。 */
export function translateStatusText(raw: string): string {
  const s = (raw || '').trim()
  if (s === '尚未配置永久库目录。') return t('status.libraryNotConfigured')
  const fail = /^台账加载失败，已禁止当空账使用：([\s\S]*)$/.exec(s)
  if (fail) return t('status.catalogLoadFail', { err: fail[1] })
  const ready = /^容器 (\d+)$/.exec(s)
  if (ready) {
    return t('status.containerN', { n: ready[1] })
  }
  const legacyReady = /^永久库已配置；容器中 (\d+)，永久库 (\d+)。$/.exec(s)
  if (legacyReady) {
    return t('status.containerN', { n: legacyReady[1] })
  }
  return s
}
