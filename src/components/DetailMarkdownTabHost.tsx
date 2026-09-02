import { lazy, Suspense, type MouseEvent as ReactMouseEvent } from 'react'
import { t, useI18n } from '../i18n'
import type { MdStyleState } from '../lib/mdStylePrefs'
import { SideBySideDiff } from './SideBySideDiff'

const DetailMarkdownCrepe = lazy(() =>
  import('./DetailMarkdownCrepe').then((m) => ({ default: m.DetailMarkdownCrepe })),
)

export type MdPathSide = 'container' | 'library'
export type MdTabKind = 'edit' | 'diff'

export type MdTab = {
  /** 稳定键：`entryId#container|library|diff` */
  tabId: string
  kind: MdTabKind
  entryId: string
  filePath: string
  title: string
  /** 编辑页签正文；对比页签可空 */
  initialFullText: string
  editable: boolean
  /** 编辑侧；对比页签固定为 library 占位，以 kind 为准 */
  pathSide: MdPathSide
  /** 对比页签数据 */
  compareLeftText?: string
  compareRightText?: string
  compareLeftPath?: string
  compareRightPath?: string
  remountKey?: number
  lastActiveAt: number
}

export const MD_TAB_MAX = 5

export function makeEditTabId(entryId: string, pathSide: MdPathSide): string {
  return `${entryId}#${pathSide}`
}

export function makeDiffTabId(entryId: string): string {
  return `${entryId}#diff`
}

export function sideLabel(pathSide: MdPathSide): string {
  return pathSide === 'container' ? t('detail.sideContainer') : t('detail.sideLibrary')
}

export function formatEditTabTitle(fileName: string, pathSide: MdPathSide): string {
  return `${fileName} · ${sideLabel(pathSide)}`
}

type DetailMarkdownTabHostProps = {
  tabs: MdTab[]
  activeId: string | null
  dirtyById: Record<string, boolean>
  mdStyle: MdStyleState
  paneActive: boolean
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onDirtyChange: (tabId: string, dirty: boolean) => void
  onSave: (tabId: string, entryId: string, fullContent: string) => Promise<boolean>
  onTabContextMenu?: (e: ReactMouseEvent, tabId: string) => void
}

export function DetailMarkdownTabHost({
  tabs,
  activeId,
  dirtyById,
  mdStyle,
  paneActive,
  onActivate,
  onClose,
  onDirtyChange,
  onSave,
  onTabContextMenu,
}: DetailMarkdownTabHostProps) {
  const { t } = useI18n()
  if (tabs.length === 0) {
    return <div className="detail-md-empty">{t('empty.pickMd')}</div>
  }

  const activeTab = tabs.find((t) => t.tabId === activeId)

  return (
    <div className="detail-md-tab-host">
      <div className="detail-md-tabs" role="tablist" aria-label={t('detail.mdTabs')}>
        {tabs.map((tab) => {
          const selected = tab.tabId === activeId
          const dirty = tab.kind === 'edit' && Boolean(dirtyById[tab.tabId])
          return (
            <div
              key={tab.tabId}
              className={`detail-md-tab${selected ? ' is-active' : ''}`}
              role="tab"
              aria-selected={selected}
              onContextMenu={(e) => onTabContextMenu?.(e, tab.tabId)}
            >
              <button
                type="button"
                className="detail-md-tab-label"
                title={tab.filePath || tab.title}
                onClick={() => onActivate(tab.tabId)}
              >
                <span className="detail-md-tab-title">{tab.title}</span>
                {dirty ? <span className="detail-md-dirty-dot" aria-label={t('detail.unsaved')} /> : null}
              </button>
              <button
                type="button"
                className="detail-md-tab-close"
                title={t('menu.close')}
                aria-label={t('detail.closeTab', { title: tab.title })}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.tabId)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
      <div className="detail-md-tab-panes">
        {tabs.map((tab) => {
          const isActive = tab.tabId === activeId && paneActive
          return (
            <div
              key={tab.tabId}
              className={`detail-md-tab-pane${isActive ? ' is-active' : ''}`}
              role="tabpanel"
              aria-hidden={!isActive}
            >
              {tab.kind === 'diff' ? (
                <div className="detail-md-compare">
                  <div className="detail-md-docbar">
                    <div className="detail-md-docbar-main">
                      <span className="detail-md-filename">{tab.title}</span>
                    </div>
                  </div>
                  <SideBySideDiff
                    leftLabel={t('detail.leftCode')}
                    rightLabel={t('detail.rightContainer')}
                    leftPath={tab.compareLeftPath || ''}
                    rightPath={tab.compareRightPath || ''}
                    leftText={tab.compareLeftText || ''}
                    rightText={tab.compareRightText || ''}
                  />
                </div>
              ) : (
                <Suspense
                  fallback={<div className="detail-md-empty">{t('md.loadingEditor')}</div>}
                >
                  <DetailMarkdownCrepe
                    key={`${tab.tabId}:${tab.remountKey ?? 0}`}
                    entryId={tab.entryId}
                    fullText={tab.initialFullText}
                    filePath={tab.filePath}
                    editable={tab.editable}
                    active={isActive}
                    dirty={Boolean(dirtyById[tab.tabId])}
                    mdStyle={mdStyle}
                    onDirtyChange={(dirty) => onDirtyChange(tab.tabId, dirty)}
                    onSave={(content) => onSave(tab.tabId, tab.entryId, content)}
                  />
                </Suspense>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** 打开或激活；超额时淘汰最久未用且未 dirty 的页签 */
export function openOrActivateMdTab(
  prev: MdTab[],
  next: Omit<MdTab, 'lastActiveAt'>,
  dirtyById: Record<string, boolean>,
  now = Date.now(),
): { tabs: MdTab[]; evicted: MdTab[]; blocked: boolean } {
  const tabId = next.tabId
  const existing = prev.find((t) => t.tabId === tabId)
  if (existing) {
    return {
      tabs: prev.map((t) =>
        t.tabId === tabId
          ? {
              ...t,
              ...next,
              lastActiveAt: now,
              remountKey:
                next.kind === 'diff' ||
                next.initialFullText !== t.initialFullText ||
                next.filePath !== t.filePath
                  ? (t.remountKey ?? 0) + 1
                  : t.remountKey,
            }
          : t,
      ),
      evicted: [],
      blocked: false,
    }
  }

  let tabs = [...prev, { ...next, lastActiveAt: now }]
  const evicted: MdTab[] = []
  while (tabs.length > MD_TAB_MAX) {
    const candidates = tabs
      .filter((t) => t.tabId !== tabId && !dirtyById[t.tabId])
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)
    if (candidates.length === 0) {
      return { tabs: prev, evicted: [], blocked: true }
    }
    const victim = candidates[0]
    tabs = tabs.filter((t) => t.tabId !== victim.tabId)
    evicted.push(victim)
  }
  return { tabs, evicted, blocked: false }
}
