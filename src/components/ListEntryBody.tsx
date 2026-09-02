import type { ReactNode } from 'react'
import { WorkspaceToolIcon } from './WorkspaceToolIcon'
import { useI18n } from '../i18n'
import type { TaxonomySourceParts } from '../lib/levelCluster'
import { CollapseAllButton } from './navGlyphs'

function MetaCell({ text }: { text?: string }) {
  const v = text?.trim() || ''
  return (
    <span className="list-item-meta-cell" title={v || undefined}>
      {v}
    </span>
  )
}

/** 标题栏：路径占前两格（种类+文件名），后接人群/子档/功能/来源/级别，末格折叠。 */
export function ListMetaHeadings({
  lead,
  showCollapse = false,
  collapsed = false,
  onToggleCollapse,
}: {
  lead: ReactNode
  showCollapse?: boolean
  collapsed?: boolean
  onToggleCollapse?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="list-cols list-meta-headings">
      <div className="list-cols-lead">{lead}</div>
      <span className="list-cols-h">{t('funnel.persona')}</span>
      <span className="list-cols-h">{t('funnel.softwareSub')}</span>
      <span className="list-cols-h">{t('funnel.byFunction')}</span>
      <span className="list-cols-h">{t('net.colSource')}</span>
      <span className="list-cols-h is-level">{t('list.colLevel')}</span>
      <span className="list-cols-collapse">
        {showCollapse && onToggleCollapse ? (
          <CollapseAllButton
            collapsed={collapsed}
            onClick={onToggleCollapse}
            expandTitle={t('list.expandAll')}
            collapseTitle={t('list.collapseAll')}
          />
        ) : null}
      </span>
    </div>
  )
}

export function ListEntryBody({
  title,
  sub,
  inUseMark,
  originTools,
  libraryLayout,
  inContainer,
  kindText,
  metaParts,
  levelText,
  levelHint,
  levelEditable,
  onLevelChange,
  onOpenTitle,
  titleOpen,
}: {
  title: string
  sub?: string
  inUseMark?: string
  originTools?: string[]
  libraryLayout?: boolean
  /** 仅永久库：已在当前容器时文件名变绿 */
  inContainer?: boolean
  kindText?: string
  /** 文件名后分格：人群 / 子档 / 功能 / 来源 */
  metaParts?: TaxonomySourceParts
  /** 级别展示；可编辑时为下拉 */
  levelText?: string
  levelHint?: string
  levelEditable?: boolean
  onLevelChange?: (level: string) => void
  onOpenTitle?: () => void
  titleOpen?: boolean
}) {
  const { t } = useI18n()
  const openDocLabel = t('net.openDoc', { name: title })
  const inContainerClass = inContainer ? ' is-in-container' : ''
  const titleHint = inContainer
    ? `${title}\n${t('list.containerMarkIn')}`
    : title
  const titleInner = onOpenTitle ? (
    <button
      type="button"
      className={`list-item-title list-item-title-link${titleOpen ? ' is-open' : ''}${inContainerClass}`}
      title={titleHint}
      aria-label={openDocLabel}
      onClick={(e) => {
        e.stopPropagation()
        onOpenTitle()
      }}
    >
      {title}
    </button>
  ) : (
    <span className={`list-item-title${inContainerClass}`} title={titleHint}>
      {title}
    </span>
  )
  const levelValue =
    levelText === 'L0' || levelText === 'L1' || levelText === 'L2' ? levelText : ''
  const levelShown = levelText || t('kind.uncategorized')
  const showLevel = levelText !== undefined || levelEditable
  const tools =
    originTools && originTools.length > 0 ? (
      originTools.map((tid) => <WorkspaceToolIcon key={tid} id={tid} />)
    ) : null
  return (
    <div className={`name list-item-name-row${libraryLayout ? ' is-library' : ''}`}>
      {libraryLayout ? <span className="list-item-kind">{kindText || ''}</span> : null}
      {titleInner}
      {libraryLayout ? (
        <>
          <MetaCell text={metaParts?.persona} />
          <MetaCell text={metaParts?.sub} />
          <MetaCell text={metaParts?.fn} />
          <MetaCell text={metaParts?.source} />
        </>
      ) : null}
      {libraryLayout || showLevel ? (
        showLevel && levelEditable && onLevelChange ? (
          <select
            className="list-item-level-select"
            value={levelValue}
            title={levelHint || t('list.levelEditHint')}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              e.stopPropagation()
              onLevelChange(e.target.value)
            }}
          >
            <option value="L0">L0</option>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
            <option value="">{t('kind.uncategorized')}</option>
          </select>
        ) : showLevel || libraryLayout ? (
          <span className="list-item-level" title={levelHint || t('list.levelReadHint')}>
            {showLevel ? levelShown : ''}
          </span>
        ) : null
      ) : null}
      {!libraryLayout && inUseMark ? (
        <span className="list-item-in-use-mark">{inUseMark}</span>
      ) : null}
      {!libraryLayout && sub ? <span className="sub">{sub}</span> : null}
      {libraryLayout ? (
        <span className="list-item-origin-tools" title={tools ? t('list.originWs') : undefined}>
          {tools}
        </span>
      ) : tools ? (
        <span className="list-item-origin-tools" title={t('list.originWs')}>
          {tools}
        </span>
      ) : null}
    </div>
  )
}
