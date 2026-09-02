import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type UIEvent,
} from 'react'
import type { NetworkNavNodeDto } from '../../shared/ipc'
import { type FunnelListItem } from '../lib/personaPhrases'
import {
  translateClusterGroupName,
  translateHeatLabel,
  translateKindLabel,
  useI18n,
} from '../i18n'
import { ListEntryBody } from './ListEntryBody'
import {
  EyeGlyph,
  EyeHideAllGlyph,
  EyeShowAllGlyph,
  PoolToggleGlyph,
  RefreshGlyph,
  StarGlyph,
} from './navGlyphs'
import {
  displayLevelLabel,
  groupItemsByLevelBucket,
  LEVEL_BUCKETS,
  sortItemsByLevelBucket,
  sortItemsInLevelBuckets,
  taxonomySourceParts,
  type LevelBucket,
} from '../lib/levelCluster'
import { usePointerListReorder } from '../lib/usePointerListReorder'
import { isNetworkNavMainVisible } from '../lib/networkStandby'

export { isNetworkNavMainVisible }

/** 网络侧栏选中：仅容器源（精选/用户钉；官方分区已去掉）。 */
export type NetworkNavSel = { kind: 'popular'; id: string } | null

export type NetworkReorderOpts = {
  direction?: 'up' | 'down' | 'top' | 'bottom'
  toIndex?: number
  targetPinned?: boolean
}

export type NetworkPopularSort = 'stars' | 'updated' | 'forks' | 'custom'

/** 分组刷新目标：主列表可见且有默认仓（不含隐藏池）。 */
export function networkNavSectionRefreshIds(
  popular: NetworkNavNodeDto[],
  scope: 'official' | 'community',
): string[] {
  return popular
    .filter((n) => {
      if (!isNetworkNavMainVisible(n) || !n.hasDefaultRepo) return false
      if (scope === 'official') return Boolean(n.isOfficialSample)
      return !n.isOfficialSample
    })
    .map((n) => n.id)
}

/** 无缓存或磁盘损坏须重拉：批量「拉取未缓存」的目标。 */
export function navSourceNeedsFetch(n: NetworkNavNodeDto): boolean {
  if (!n.hasDefaultRepo) return false
  return !n.hasCachedSource || Boolean(n.needsRefetch)
}

function navCacheKind(n: NetworkNavNodeDto): 'cached' | 'uncached' | 'refetch' {
  if (n.needsRefetch) return 'refetch'
  if (n.hasCachedSource) return 'cached'
  return 'uncached'
}

/** 侧栏可见行序（官网主列表 → 社区主列表+用户源；不含隐藏池），供 Shift 范围选。 */
export function networkNavVisibleIds(
  popular: NetworkNavNodeDto[],
  visibleLimit: number,
): string[] {
  const official = popular.filter((n) => Boolean(n.isOfficialSample))
  const communityCurated = popular.filter(
    (n) => !n.isOfficialSample && n.kind !== 'user',
  )
  const userSources = popular.filter((n) => n.kind === 'user')
  const isCommunityCandidate = (n: NetworkNavNodeDto) =>
    typeof n.inCandidatePool === 'boolean'
      ? n.inCandidatePool
      : communityCurated.indexOf(n) < visibleLimit
  const communityMain = [
    ...communityCurated.filter(isCommunityCandidate),
    ...userSources,
  ].filter(isNetworkNavMainVisible)
  return [
    ...official.filter(isNetworkNavMainVisible),
    ...communityMain,
  ].map((n) => n.id)
}

function PopularRow({
  n,
  active,
  picked,
  busy,
  poolOpen,
  inGear,
  rowPropsWithLabel,
  onSelect,
  onTogglePin,
  onFetch,
  onContextNode,
}: {
  n: NetworkNavNodeDto
  active: boolean
  picked: boolean
  busy: boolean
  poolOpen: boolean
  inGear: boolean
  rowPropsWithLabel: (
    id: string,
    section: string,
    label: string,
    extraClass?: string,
  ) => Record<string, unknown>
  onSelect: (id: string, e: ReactMouseEvent<HTMLButtonElement>) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onFetch: (id: string) => void
  onContextNode: (e: ReactMouseEvent, id: string, node: NetworkNavNodeDto) => void
}) {
  const { t } = useI18n()
  const isOfficial = Boolean(n.isOfficialSample)
  // 官网与社区同格式：完整 owner/repo（公司在前、仓名在后）
  const rowName = n.displayName || n.id
  const section = inGear ? 'popular:general' : 'popular:pinned'
  if (inGear && !poolOpen) return null
  const cacheKind = navCacheKind(n)
  const rowClass = `nav-item net-nav-row project-nav nav-item-draggable${
    active ? ' active' : ''
  }${picked && !active ? ' net-nav-picked' : ''}${
    cacheKind === 'cached' ? ' net-nav-cached' : ''
  }${cacheKind === 'uncached' ? ' net-nav-uncached' : ''}${
    cacheKind === 'refetch' ? ' net-nav-refetch' : ''
  }${inGear ? ' ws-nav-pool' : ''}`
  const drag = busy
    ? { className: rowClass }
    : rowPropsWithLabel(n.id, section, n.displayName || n.id, rowClass)
  return (
    <div
      {...drag}
      title={t('net.dragSortHint')}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextNode(e, n.id, n)
      }}
    >
      <button
        type="button"
        className="net-nav-main"
        disabled={busy}
        title={
          n.hasDefaultRepo
            ? `${n.displayName || n.id}\n${n.primaryRepoUrl}\n${t('net.fetchHint')}`
            : t('net.noDefaultPaste')
        }
        onClick={(e) => onSelect(n.id, e)}
        onDoubleClick={() => {
          if (n.hasDefaultRepo) onFetch(n.id)
        }}
      >
        <span className="nav-ws-label net-nav-name">
          {rowName}
          {n.contentType === 'courses' ? (
            <span className="net-ctype-badge" title={t('net.courseTitle')}>
              {t('net.course')}
            </span>
          ) : null}
          {n.contentType === 'cookbooks' ? (
            <span className="net-ctype-badge" title={t('net.recipeTitle')}>
              {t('net.cookbook')}
            </span>
          ) : null}
        </span>
        <span className="net-nav-meta">
          {translateHeatLabel(n.heatLabel)}
          {cacheKind === 'cached' ? (
            <span className="net-nav-meta-cached">{t('net.cachedN', { n: n.cachedCount })}</span>
          ) : cacheKind === 'refetch' ? (
            <span className="net-nav-meta-refetch">{t('net.needRefetch')}</span>
          ) : (
            <span className="net-nav-meta-uncached">{t('net.uncached')}</span>
          )}
        </span>
      </button>
      <span
        className="nav-ws-checks net-nav-checks"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`nav-ws-icon-btn${isOfficial ? ' nav-ws-star' : ''}${
            n.pinned ? ' is-on' : ''
          }`}
          disabled={busy}
          title={
            isOfficial
              ? n.pinned
                ? t('net.officialHide')
                : t('net.officialShow')
              : n.pinned
                ? t('net.hideToPool')
                : t('net.showSidebar')
          }
          aria-label={`${n.displayName}${isOfficial ? t('net.officialSuffix') : ''} ${
            n.pinned ? t('menu.hide') : t('menu.show')
          }`}
          aria-pressed={n.pinned}
          onClick={() => onTogglePin(n.id, !n.pinned)}
        >
          {isOfficial ? <StarGlyph filled={n.pinned} /> : <EyeGlyph off={!n.pinned} />}
        </button>
      </span>
    </div>
  )
}

export function NetworkNav({
  busy,
  configured,
  popular,
  selected,
  pickedIds,
  visibleLimit,
  onPickRoot,
  onSelectNode,
  onTogglePin,
  onBulkVisibility,
  onSetVisibleLimit,
  onPasteGitUrl,
  popularSort = 'stars',
  onSetPopularSort,
  onRefreshSection,
  onFetchNode,
  onFetchUncached,
  onContextNode,
  onReorderNav,
}: {
  busy: boolean
  configured: boolean
  popular: NetworkNavNodeDto[]
  selected: NetworkNavSel
  pickedIds: Set<string>
  visibleLimit: number
  onPickRoot: () => void
  onSelectNode: (id: string, e: ReactMouseEvent<HTMLButtonElement>) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onBulkVisibility: (show: boolean, scope?: 'official' | 'community') => void
  onSetVisibleLimit: (limit: number) => void
  onPasteGitUrl: (url: string) => void
  popularSort?: string
  onSetPopularSort?: (mode: string) => void
  onRefreshSection?: (scope: 'official' | 'community') => void
  onFetchNode: (id: string) => void
  onFetchUncached: () => void
  onContextNode: (e: ReactMouseEvent, id: string, node: NetworkNavNodeDto) => void
  onReorderNav?: (id: string, opts: NetworkReorderOpts) => void
}) {
  const { t } = useI18n()
  const [officialPoolOpen, setOfficialPoolOpen] = useState(false)
  const [communityPoolOpen, setCommunityPoolOpen] = useState(false)
  const [limitOpen, setLimitOpen] = useState(false)
  const [limitDraft, setLimitDraft] = useState(String(visibleLimit))
  const [gitUrlDraft, setGitUrlDraft] = useState('')
  const limitMenuRef = useRef<HTMLDivElement>(null)

  const official = useMemo(
    () => popular.filter((n) => Boolean(n.isOfficialSample)),
    [popular],
  )
  const communityCurated = useMemo(
    () => popular.filter((n) => !n.isOfficialSample && n.kind !== 'user'),
    [popular],
  )
  const userSources = useMemo(
    () => popular.filter((n) => n.kind === 'user'),
    [popular],
  )
  const curatedStoreTotal = communityCurated.length
  /** 候选池成员判定：后端布尔优先，缺失时按当前顺序前 N 回退 */
  const isCommunityCandidate = (n: NetworkNavNodeDto) =>
    typeof n.inCandidatePool === 'boolean'
      ? n.inCandidatePool
      : communityCurated.indexOf(n) < visibleLimit
  const candidateCount = communityCurated.filter(isCommunityCandidate).length
  const candidateOpenCount = communityCurated.filter(
    (n) => isCommunityCandidate(n) && n.pinned,
  ).length
  const mainNodes = popular.filter(isNetworkNavMainVisible)
  // 隐藏池 peers 与渲染一致：候选池外的社区行不渲染，也不参与拖拽
  const gearNodes = popular.filter(
    (n) =>
      !isNetworkNavMainVisible(n) &&
      (Boolean(n.isOfficialSample) || n.kind === 'user' || isCommunityCandidate(n)),
  )
  const maxLimit = Math.min(50, curatedStoreTotal)
  const uncachedPickedCount = popular.filter(
    (n) => pickedIds.has(n.id) && navSourceNeedsFetch(n),
  ).length


  useEffect(() => {
    if (!limitOpen) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!limitMenuRef.current?.contains(t)) setLimitOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLimitOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [limitOpen])

  useEffect(() => {
    if (limitOpen) setLimitDraft(String(visibleLimit))
  }, [limitOpen, visibleLimit])

  const commitVisibleLimit = () => {
    const cap = Math.min(50, maxLimit)
    const n = Math.max(0, Math.min(cap, Number.parseInt(limitDraft, 10) || 0))
    onSetVisibleLimit(n)
    setLimitOpen(false)
  }

  const peersBySection = useMemo(() => {
    return {
      'popular:pinned': mainNodes.map((n) => n.id),
      'popular:general': gearNodes.map((n) => n.id),
    }
  }, [mainNodes, gearNodes])

  const { rowPropsWithLabel, dragGhost } = usePointerListReorder({
    disabled: busy || !onReorderNav,
    allowCrossSection: true,
    getPeers: (section) => peersBySection[section as keyof typeof peersBySection] ?? [],
    onDrop: ({ id, sourceSection, targetSection, toIndex }) => {
      if (!onReorderNav) return
      const [srcKind] = sourceSection.split(':')
      const [tgtKind, tgtPin] = targetSection.split(':')
      if (srcKind !== 'popular' || tgtKind !== 'popular') return
      if (tgtPin === 'general') {
        const node = popular.find((n) => n.id === id)
        if (node?.isOfficialSample) setOfficialPoolOpen(true)
        else setCommunityPoolOpen(true)
      }
      onReorderNav(id, {
        toIndex,
        targetPinned: tgtPin === 'pinned',
      })
    },
  })

  /** 官网段单层：每公司仅一个 skills 主仓，无公司标题层 */
  const renderOfficialRows = (rows: NetworkNavNodeDto[], inPool: boolean) =>
    rows.map((n) => (
      <PopularRow
        key={n.id}
        n={n}
        active={selected?.id === n.id}
        picked={pickedIds.has(n.id)}
        busy={busy}
        poolOpen={officialPoolOpen}
        inGear={inPool}
        rowPropsWithLabel={rowPropsWithLabel}
        onSelect={onSelectNode}
        onTogglePin={onTogglePin}
        onFetch={onFetchNode}
        onContextNode={onContextNode}
      />
    ))

  return (
    <div className="network-nav">
      <div className="net-nav-ops">
        <div className="net-nav-ops-row">
          <button
            type="button"
            disabled={busy || !gitUrlDraft.trim()}
            title={t('net.pasteTitle')}
            onClick={() => {
              const url = gitUrlDraft.trim()
              if (!url) return
              onPasteGitUrl(url)
            }}
          >
            {t('net.pasteGit')}
          </button>
          <input
            type="text"
            className="net-nav-ops-input"
            disabled={busy}
            placeholder={t('net.gitPlaceholder')}
            value={gitUrlDraft}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setGitUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              const url = gitUrlDraft.trim()
              if (!url || busy) return
              onPasteGitUrl(url)
            }}
          />
        </div>
      </div>
      {!configured ? (
        <div className="net-nav-empty-hint">
          {t('net.unconfigured')}
          <button type="button" disabled={busy} onClick={onPickRoot}>
            {t('net.pickNow')}
          </button>
        </div>
      ) : null}

      {official.length > 0 ? (
        <div className="nav-block-sep">
          <div
            className={`nav-item cat cat-toggle${officialPoolOpen ? ' is-ws-setup-open' : ''}`}
          >
            <span className="nav-cat-label">{t('net.official')}</span>
            <span
              className="nav-ws-checks nav-cat-checks"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="nav-ws-icon-btn"
                disabled={busy || !onRefreshSection}
                title={t('net.refreshOfficial')}
                aria-label={t('net.refreshOfficialAria')}
                onClick={() => onRefreshSection?.('official')}
              >
                <RefreshGlyph />
              </button>
              <button
                type="button"
                className="nav-ws-icon-btn is-on"
                disabled={busy}
                title={t('net.showAllOfficial')}
                aria-label={t('net.showAllOfficialAria')}
                onClick={() => onBulkVisibility(true, 'official')}
              >
                <EyeShowAllGlyph />
              </button>
              <button
                type="button"
                className="nav-ws-icon-btn"
                disabled={busy}
                title={t('net.hideAllOfficial')}
                aria-label={t('net.hideAllOfficialAria')}
                onClick={() => {
                  onBulkVisibility(false, 'official')
                  setOfficialPoolOpen(true)
                }}
              >
                <EyeHideAllGlyph />
              </button>
              <button
                type="button"
                className={`nav-ws-icon-btn nav-ws-pool-toggle${
                  officialPoolOpen ? ' is-on' : ''
                }`}
                title={officialPoolOpen ? t('net.collapseOfficialPool') : t('net.expandOfficialPool')}
                aria-label={t('net.officialPoolToggle')}
                aria-pressed={officialPoolOpen}
                onClick={() => setOfficialPoolOpen((o) => !o)}
              >
                <PoolToggleGlyph open={officialPoolOpen} />
              </button>
            </span>
          </div>
          {renderOfficialRows(
            official.filter((n) => isNetworkNavMainVisible(n)),
            false,
          )}
          {officialPoolOpen
            ? renderOfficialRows(
                official.filter((n) => !isNetworkNavMainVisible(n)),
                true,
              )
            : null}
        </div>
      ) : null}

      <div className="nav-block-sep">
        <div
          className={`nav-item cat cat-toggle${communityPoolOpen ? ' is-ws-setup-open' : ''}`}
          data-nav-drop="section:popular:pinned"
        >
          <span className="nav-cat-label">{t('net.community')}</span>
          <div
            className="net-limit-dropdown"
            ref={limitMenuRef}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`net-nav-cat-count${limitOpen ? ' is-open' : ''}`}
              disabled={busy}
              title={t('net.communityLimitTitle', {
                cand: candidateCount,
                store: curatedStoreTotal,
                open: candidateOpenCount,
              })}
              aria-haspopup="dialog"
              aria-expanded={limitOpen}
              aria-label={t('net.communityLimitAria', {
                open: candidateOpenCount,
                cand: candidateCount,
                store: curatedStoreTotal,
              })}
              onClick={() => setLimitOpen((o) => !o)}
            >
              <span className="net-nav-cat-count-open">{candidateOpenCount}</span>
              <span className="net-nav-cat-count-sep">/</span>
              <span className="net-nav-cat-count-total">{candidateCount}</span>
            </button>
            {limitOpen ? (
              <div className="net-limit-menu" role="dialog" aria-label={t('net.adjustCommunity')}>
                <label className="net-limit-label">
                  {t('net.communityCandidateN')}
                  <input
                    type="number"
                    className="net-limit-input"
                    min={0}
                    max={Math.min(50, maxLimit)}
                    disabled={busy}
                    value={limitDraft}
                    onChange={(e) => setLimitDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitVisibleLimit()
                      }
                    }}
                  />
                  <span className="net-limit-hint">{t('net.poolOf', { n: curatedStoreTotal })}</span>
                </label>
                <div className="net-limit-actions">
                  <button
                    type="button"
                    disabled={busy || visibleLimit <= 0}
                    title={t('net.minus1')}
                    onClick={() => onSetVisibleLimit(Math.max(0, visibleLimit - 1))}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    disabled={busy || visibleLimit >= Math.min(50, maxLimit)}
                    title={t('net.plus1')}
                    onClick={() =>
                      onSetVisibleLimit(Math.min(50, maxLimit, visibleLimit + 1))
                    }
                  >
                    +
                  </button>
                  <button type="button" disabled={busy} onClick={commitVisibleLimit}>
                    {t('dialog.ok')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <span
            className="nav-ws-checks nav-cat-checks"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {onSetPopularSort ? (
              <select
                className="net-sort-select"
                value={popularSort}
                disabled={busy}
                title={t('net.sortTitle')}
                aria-label={t('net.sortAria')}
                onChange={(e) => onSetPopularSort(e.target.value)}
              >
                <option value="stars">{t('net.sortStars')}</option>
                <option value="updated">{t('net.sortUpdated')}</option>
                <option value="forks">{t('net.sortForks')}</option>
                <option value="custom">{t('net.sortCustom')}</option>
              </select>
            ) : null}
            <button
              type="button"
              className="nav-ws-icon-btn"
              disabled={busy || !onRefreshSection}
              title={t('net.refreshCommunity')}
              aria-label={t('net.refreshCommunityAria')}
              onClick={() => onRefreshSection?.('community')}
            >
              <RefreshGlyph />
            </button>
            {pickedIds.size > 1 && uncachedPickedCount > 0 ? (
              <button
                type="button"
                className="net-nav-fetch-uncached"
                disabled={busy}
                title={t('net.fetchUncachedTitle')}
                onClick={onFetchUncached}
              >
                {t('net.fetchUncachedN', { n: uncachedPickedCount })}
              </button>
            ) : null}
            <button
              type="button"
              className="nav-ws-icon-btn is-on"
              disabled={busy}
              title={t('net.showAllCommunity')}
              aria-label={t('net.showAllCommunityAria')}
              onClick={() => onBulkVisibility(true, 'community')}
            >
              <EyeShowAllGlyph />
            </button>
            <button
              type="button"
              className="nav-ws-icon-btn"
              disabled={busy}
              title={t('net.hideAllCommunity')}
              aria-label={t('net.hideAllCommunityAria')}
              onClick={() => {
                onBulkVisibility(false, 'community')
                setCommunityPoolOpen(true)
              }}
            >
              <EyeHideAllGlyph />
            </button>
            <button
              type="button"
              className={`nav-ws-icon-btn nav-ws-pool-toggle${
                communityPoolOpen ? ' is-on' : ''
              }`}
              title={communityPoolOpen ? t('net.collapseCommunityPool') : t('net.expandCommunityPool')}
              aria-label={t('net.communityPoolToggle')}
              aria-pressed={communityPoolOpen}
              onClick={() => setCommunityPoolOpen((o) => !o)}
            >
              <PoolToggleGlyph open={communityPoolOpen} />
            </button>
          </span>
        </div>

        {(() => {
          // N（候选池）直接决定社区段列出的行数；用户源不受 N 限制
          const all = [...communityCurated.filter(isCommunityCandidate), ...userSources]
          const rows = [
            ...all.filter((n) => isNetworkNavMainVisible(n)),
            ...all.filter((n) => !isNetworkNavMainVisible(n)),
          ]
          return rows.map((n) => {
            const inGear = !isNetworkNavMainVisible(n)
            return (
              <PopularRow
                key={n.id}
                n={n}
                active={selected?.id === n.id}
                picked={pickedIds.has(n.id)}
                busy={busy}
                poolOpen={communityPoolOpen}
                inGear={inGear}
                rowPropsWithLabel={rowPropsWithLabel}
                onSelect={onSelectNode}
                onTogglePin={onTogglePin}
                onFetch={onFetchNode}
                onContextNode={onContextNode}
              />
            )
          })
        })()}
      </div>
      {dragGhost}
    </div>
  )
}

/** 网络工作台行高（与 .list-item / .cluster-group-header 对齐），供窗口化渲染 */
const NET_WB_ROW_H = 22
const NET_WB_OVERSCAN = 12
/** 超过此数量禁用指针拖拽排序（窗口化下列序不可靠）；请先按源筛选缩小列表再拖 */
const NET_WB_DRAG_MAX = 200

type WbRow =
  | { kind: 'group'; id: LevelBucket; count: number }
  | { kind: 'item'; item: FunnelListItem }

export function NetworkWorkbench({
  busy,
  fetchInProgress = false,
  items,
  selectedIds,
  onToggle,
  onOpenDoc,
  openEntryId = null,
  onToggleSelectAll: _onToggleSelectAll,
  onFetchCurrent,
  hasNavFilter,
  selectedHasCachedSource = false,
  lastFetchError = null,
  emptyHint = null,
  onReorderItem,
  onItemContext,
  levelGroups = false,
  onCollapseChange,
  collapseApiRef,
}: {
  busy: boolean
  fetchInProgress?: boolean
  items: FunnelListItem[]
  selectedIds: Set<string>
  onToggle: (id: string, e: React.MouseEvent) => void
  onOpenDoc?: (id: string) => void
  openEntryId?: string | null
  onToggleSelectAll: () => void
  onFetchCurrent: () => void
  hasNavFilter: boolean
  selectedHasCachedSource?: boolean
  lastFetchError?: string | null
  emptyHint?: string | null
  onReorderItem?: (entryId: string, opts: NetworkReorderOpts) => void
  onItemContext?: (e: ReactMouseEvent, item: FunnelListItem) => void
  /** 仅本地货架画 L0/L1/L2 分组；网络/筛选扁平 */
  levelGroups?: boolean
  onCollapseChange?: (allCollapsed: boolean) => void
  collapseApiRef?: MutableRefObject<(() => void) | null>
}) {
  const { t, locale } = useI18n()
  const grouped = useMemo(
    () => (levelGroups ? sortItemsInLevelBuckets(items) : groupItemsByLevelBucket(items)),
    [items, levelGroups],
  )
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const rows = useMemo(() => {
    if (!levelGroups) {
      return sortItemsByLevelBucket(items).map((item) => ({ kind: 'item' as const, item }))
    }
    const out: WbRow[] = []
    for (const id of LEVEL_BUCKETS) {
      const list = grouped[id]
      out.push({ kind: 'group', id, count: list.length })
      if (!collapsedGroups[id]) {
        for (const item of list) out.push({ kind: 'item', item })
      }
    }
    return out
  }, [grouped, collapsedGroups, items, levelGroups])
  const visibleIds = useMemo(
    () =>
      rows
        .filter((r): r is Extract<WbRow, { kind: 'item' }> => r.kind === 'item')
        .map((r) => r.item.entryId),
    [rows],
  )
  const allowDrag = Boolean(onReorderItem) && items.length <= NET_WB_DRAG_MAX
  const allCollapsed =
    levelGroups && LEVEL_BUCKETS.every((id) => collapsedGroups[id] === true)
  const collapseOrExpandAll = useCallback(() => {
    if (!levelGroups) return
    setCollapsedGroups((c) => {
      const every = LEVEL_BUCKETS.every((id) => c[id] === true)
      return every ? {} : Object.fromEntries(LEVEL_BUCKETS.map((id) => [id, true]))
    })
  }, [levelGroups])

  useEffect(() => {
    onCollapseChange?.(allCollapsed)
  }, [allCollapsed, onCollapseChange])

  useEffect(() => {
    if (!collapseApiRef) return
    collapseApiRef.current = levelGroups ? collapseOrExpandAll : null
    return () => {
      collapseApiRef.current = null
    }
  }, [collapseApiRef, collapseOrExpandAll, levelGroups])

  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(480)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () => setViewportH(el.clientHeight || 480)
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [items.length, rows.length])

  const { start, end, padTop, padBottom } = useMemo(() => {
    const total = rows.length
    if (total === 0) {
      return { start: 0, end: 0, padTop: 0, padBottom: 0 }
    }
    const first = Math.max(0, Math.floor(scrollTop / NET_WB_ROW_H) - NET_WB_OVERSCAN)
    const visible = Math.ceil(viewportH / NET_WB_ROW_H) + NET_WB_OVERSCAN * 2
    const last = Math.min(total, first + visible)
    return {
      start: first,
      end: last,
      padTop: first * NET_WB_ROW_H,
      padBottom: Math.max(0, (total - last) * NET_WB_ROW_H),
    }
  }, [rows.length, scrollTop, viewportH])

  const windowRows = rows.slice(start, end)

  const { rowPropsWithLabel, dragGhost } = usePointerListReorder({
    disabled: busy || !allowDrag,
    getPeers: () => visibleIds,
    onDrop: ({ id, toIndex }) => {
      onReorderItem?.(id, { toIndex })
    },
  })

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  const groupTitle = (id: LevelBucket) =>
    id === 'uncategorized' ? translateClusterGroupName('未分类') : id

  return (
    <div className="network-workbench">
      {items.length === 0 ? (
        <div className="empty" style={{ padding: '12px 10px' }}>
          {lastFetchError ? (
            <>
              <div>{t('net.fetchFail', { msg: lastFetchError })}</div>
              <div style={{ marginTop: 6, opacity: 0.85 }}>
                {t('net.keepCacheOnFail')}
              </div>
              <button
                type="button"
                style={{ marginTop: 8 }}
                disabled={busy || fetchInProgress || !hasNavFilter}
                onClick={onFetchCurrent}
              >
                {t('net.retry')}
              </button>
            </>
          ) : emptyHint
            ? emptyHint
            : !hasNavFilter
              ? t('funnel.noIndexed')
              : selectedHasCachedSource
                ? t('net.fetchedNoSkill')
                : t('net.noCacheClickFetch')}
        </div>
      ) : (
        <>
          <div className="net-wb-scroll" ref={scrollRef} onScroll={onScroll}>
            {padTop > 0 ? <div aria-hidden style={{ height: padTop }} /> : null}
            {windowRows.map((row, i) => {
              if (row.kind === 'group') {
                const isCollapsed = collapsedGroups[row.id] === true
                return (
                  <div
                    key={`g:${row.id}:${start + i}`}
                    className="cluster-group-header"
                    onClick={() =>
                      setCollapsedGroups((c) => ({ ...c, [row.id]: !isCollapsed }))
                    }
                  >
                    <span className="cluster-caret">
                      <PoolToggleGlyph open={!isCollapsed} />
                    </span>
                    <span>
                      {groupTitle(row.id)} ({row.count})
                    </span>
                  </div>
                )
              }
              const it = row.item
              const idx = start + i
              const checked = selectedIds.has(it.entryId)
              const isLocal = it.funnelOrigin === 'library'
              const inContainer = isLocal && Boolean(it.isInActiveUse || it.isInContainerList)
              const extraClass = [
                'list-item',
                'list-item-cluster-leaf',
                checked ? 'selected' : '',
                inContainer ? 'list-item-in-use' : '',
              ]
                .filter(Boolean)
                .join(' ')
              const drag = allowDrag
                ? rowPropsWithLabel(
                    it.entryId,
                    'list',
                    it.displayName || it.entryId,
                    extraClass,
                  )
                : { className: extraClass }
              const sourceLabel = isLocal ? t('net.colLocal') : it.sourceId || '—'
              const sourceHint = isLocal
                ? t('net.colLocal')
                : [it.sourceId, it.sourceUrl].filter(Boolean).join(' · ')
              const menuHint =
                onItemContext || onReorderItem
                  ? allowDrag
                    ? t('net.tableHintReorder')
                    : t('net.tableHintMenu')
                  : t('net.tableHint')
              const metaParts = taxonomySourceParts(it, locale, sourceLabel)
              const kindText = translateKindLabel(it.kindLabel || '')
              const levelText = displayLevelLabel(it, t('kind.uncategorized'))
              return (
                <div
                  key={`${it.entryId}:${idx}`}
                  {...drag}
                  title={[sourceHint, menuHint].filter(Boolean).join('\n') || undefined}
                  onClick={(e) => onToggle(it.entryId, e)}
                  onContextMenu={(e) => {
                    if (!onItemContext) return
                    e.preventDefault()
                    e.stopPropagation()
                    onItemContext(e, it)
                  }}
                >
                  <ListEntryBody
                    libraryLayout
                    kindText={kindText || undefined}
                    title={it.displayName || it.entryId}
                    metaParts={metaParts}
                    levelText={levelText}
                    levelHint={
                      isLocal ? t('list.levelReadHint') : t('net.rowLevelHint')
                    }
                    originTools={isLocal ? it.originTools : undefined}
                    onOpenTitle={onOpenDoc ? () => onOpenDoc(it.entryId) : undefined}
                    titleOpen={openEntryId === it.entryId}
                  />
                </div>
              )
            })}
            {padBottom > 0 ? <div aria-hidden style={{ height: padBottom }} /> : null}
          </div>
        </>
      )}
      {dragGhost}
    </div>
  )
}
