import { memo, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  AppSnapshot,
  ClusterNodeDto,
  DiscoveredItemDto,
  EntryOperationLogDto,
  IpcMethod,
  LibraryListItemDto,
  MoveIntoBackupPreviewDto,
  NavNodeDto,
  NetworkFetchFinishedEvent,
  NetworkFetchProgressEvent,
  NetworkNavNodeDto,
  NetworkOpResultDto,
  ProjectItemDto,
  PathConflictDto,
  SelectionDetailDto,
  StartNetworkFetchResult,
  SuggestedPurposeDto,
  WorkspaceContainerSectionDto,
  WorkspaceDto,
} from '../shared/ipc'
import { sourceIdFromUrl } from '../shared/networkSourceId'
import {
  PERSONA_CHIPS,
  PHRASE_CHIP_MAX,
  FUNNEL_LIST_MAX,
  OTHER_ID,
  chipLabelZh,
  chipLabel,
  countByPersona,
  countByPersonaSub,
  countPhrases,
  filterByAssignment,
  funnelNeedsRefinePass,
  hideLocaleMirrors,
  itemMatchesPersonaFilter,
  partitionRefineResult,
  personaSubDefs,
  refineLayerKind,
  splittingChips,
  visiblePartitionChips,
  visiblePersonaSubCount,
  visiblePhraseChips,
  type ClassifiedPersona,
  type FunnelListItem,
  type FunnelOrigin,
  type PartitionChip,
  type PersonaId,
  type PersonaSubFilter,
  type RefineStep,
} from './lib/personaPhrases'
import {
  FUNNEL_PREFETCH_CHUNK,
  annotateItemsCached,
  funnelAnnotateKey,
  pruneAnnotateCache,
} from './lib/funnelAnnotateCache'
import { loadHideMirrors, saveHideMirrors } from './lib/hideMirrorsPref'
import { isBrowserPreview } from './browser/ccmMock'
import {
  DetailMarkdownTabHost,
  MD_TAB_MAX,
  formatEditTabTitle,
  makeDiffTabId,
  makeEditTabId,
  openOrActivateMdTab,
  type MdPathSide,
  type MdTab,
} from './components/DetailMarkdownTabHost'
import { SideBySideDiff } from './components/SideBySideDiff'
import { SettingsModal } from './components/SettingsModal'
import {
  NetworkNav,
  NetworkWorkbench,
  navSourceNeedsFetch,
  networkNavSectionRefreshIds,
  networkNavVisibleIds,
  type NetworkNavSel,
} from './components/NetworkShelf'
import { ThemeGalleryPanel } from './components/ThemeGalleryPanel'
import { loadMdStyleState, saveMdStyleState, type MdStyleState } from './lib/mdStylePrefs'
import { LayoutPriority, WorkbenchSplit } from './layout/WorkbenchSplit'
import { WorkspaceToolIcon } from './components/WorkspaceToolIcon'
import { ListEntryBody, ListMetaHeadings } from './components/ListEntryBody'
import {
  EyeGlyph,
  EyeHideAllGlyph,
  EyeShowAllGlyph,
  PenGlyph,
  PlusGlyph,
  ClearSkillsGlyph,
  PoolToggleGlyph,
  StarGlyph,
} from './components/navGlyphs'
import {
  destIndexFromInsert,
  LIST_DRAG_THRESHOLD_PX,
  type ReorderDirection,
} from './lib/listReorder'
import { ccmPerfOpen, ccmPerfSpan } from './lib/ccmPerf'
import { filterClusterTreeByIds, filterItemsByQuery } from './lib/searchFilter'
import {
  itemInStandbyLibrary,
  openEyeSourceIds,
} from './lib/networkStandby'
import {
  compareKindThenName,
  displayLevelLabel,
  sortItemsByLevelBucket,
  taxonomySourceParts,
} from './lib/levelCluster'
import {
  chipText,
  displayUnconfigured,
  navCategoryLabel,
  t,
  translateClusterGroupName,
  translateKindLabel,
  translateLibraryHeader,
  translatePlaceSubtitle,
  translateStatusText,
  useI18n,
} from './i18n'

async function invoke<T = unknown>(method: IpcMethod, args?: Record<string, unknown>) {
  if (!window.ccm?.invoke) {
    throw new Error(t('error.noCcm'))
  }
  return window.ccm.invoke<T>(method, args)
}

/** 搜索防抖：输入框即时受控，生效查询延迟该毫秒数再触发过滤（H5 性能） */
const SEARCH_DEBOUNCE_MS = 150

function scheduleIdle(fn: () => void): () => void {
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout: 200 })
    return () => w.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(fn, 0)
  return () => window.clearTimeout(id)
}

function refinePathKey(path: { id: string }[]): string {
  return path.map((s) => s.id).join('\0')
}

type RefineRowVisual = {
  chips: PartitionChip[]
  selected: RefineStep
  assignment: Map<string, string>
}

const EMPTY_REFINE_ASSIGN = new Map<string, string>()

function assignmentForRefineStep(
  i: number,
  rows: RefineRowVisual[],
  nextAssignment: Map<string, string>,
): Map<string, string> | null {
  if (i < rows.length) return rows[i].assignment
  if (i === rows.length) return nextAssignment
  return null
}

function applyRefineAssignments(
  items: FunnelListItem[],
  path: RefineStep[],
  rows: RefineRowVisual[],
  nextAssignment: Map<string, string>,
): FunnelListItem[] {
  let cur = items
  for (let i = 0; i < path.length; i++) {
    const assign = assignmentForRefineStep(i, rows, nextAssignment)
    if (!assign || assign.size === 0) return cur
    cur = filterByAssignment(cur, assign, path[i].id)
  }
  return cur
}

/** pending 时沿用上一帧芯片，用当前 refinePath 标亮；点 next 芯片时把该排升成已选行，避免功能行空白。 */
function overlayFunnelChips(
  path: RefineStep[],
  visual: { refineRows: RefineRowVisual[]; nextChips: PartitionChip[] },
  ready: boolean,
): { refineRows: { chips: PartitionChip[]; selected: RefineStep }[]; nextChips: PartitionChip[] } {
  if (ready) {
    return { refineRows: visual.refineRows, nextChips: visual.nextChips }
  }
  const visN = visual.refineRows.length
  const wantN = path.length
  if (wantN <= visN) {
    const rows = visual.refineRows.slice(0, wantN).map((row, i) => ({
      chips: row.chips,
      selected: path[i],
    }))
    const nextChips = wantN < visN ? visual.refineRows[wantN].chips : visual.nextChips
    return { refineRows: rows, nextChips }
  }
  const rows = visual.refineRows.map((row, i) => ({
    chips: row.chips,
    selected: path[i] ?? row.selected,
  }))
  if (visual.nextChips.length > 0 && path[visN]) {
    rows.push({ chips: visual.nextChips, selected: path[visN] })
  }
  return { refineRows: rows, nextChips: [] }
}

function funnelRefineLabelKey(
  chips: PartitionChip[],
): 'funnel.byFunction' | 'funnel.bySource' | 'funnel.byName' {
  const kind = refineLayerKind(chips)
  if (kind === 'name') return 'funnel.byName'
  if (kind === 'source') return 'funnel.bySource'
  return 'funnel.byFunction'
}

function funnelRefineRowClass(chips: PartitionChip[]): string {
  return refineLayerKind(chips) === 'name' ? 'funnel-row funnel-row-letters' : 'funnel-row'
}

/** 状态栏正中：当前选中行的「名称」列，三货架同一套。 */
function statusCurrentDocName(displayName: string | undefined, entryId: string): string {
  const name = (displayName || '').trim()
  if (name) return name
  const id = entryId || ''
  const i = id.lastIndexOf(':')
  return i >= 0 ? id.slice(i + 1) : id
}

type MenuItem = {
  label: string
  disabled?: boolean
  danger?: boolean
  /** 悬停说明（未迁/边界提示） */
  title?: string
  /** 当前项勾选标记（子菜单用） */
  checked?: boolean
  /** 有子项时展开侧栏；叶子项需 onClick */
  children?: MenuItem[]
  onClick?: () => void
}

/** 扫描建库：相对台账只显示增量；同名不同哈希留给「刷新」 */


type ScanBuildPreviewState = {
  items: DiscoveredItemDto[]
  pendingNewProjectCount: number
  message: string
  skippedContentConflict: number
  silentRelinkCount: number
}

type CtxState = { x: number; y: number; items: MenuItem[] } | null

type ConflictChoice = 'merge' | 'overwrite' | 'saveAs' | 'skip'

/** 网络库后台拉取 UI 状态（不占用全局 busy；可多源并行） */
type NetworkFetchUi = {
  jobId: string
  sourceId: string
  phase: string
  detail: string
  stalled: boolean
  /** git 进度 0–100；无匹配时 undefined */
  percent?: number
  startedAt: number
  modalOpen: boolean
  cancelling: boolean
}

/** 尚未 spawn git 的拉取请求（单点 / 批量共用队列）。 */
type NetworkFetchRequest = {
  kind?: string
  id?: string
  urlOrBaselineId?: string
  label?: string
}

function presumedFetchSourceId(args: NetworkFetchRequest): string {
  return (
    (args.id ?? '').trim() ||
    (args.urlOrBaselineId ? sourceIdFromUrl(args.urlOrBaselineId) : '')
  )
}

function fetchRequestKey(args: NetworkFetchRequest): string {
  const sid = presumedFetchSourceId(args)
  if (sid) return sid.toLowerCase()
  return (args.urlOrBaselineId ?? '').trim().toLowerCase()
}

function fetchQueueHasKey(queue: NetworkFetchRequest[], key: string): boolean {
  const k = key.trim().toLowerCase()
  if (!k) return false
  return queue.some((q) => fetchRequestKey(q) === k)
}

function networkFetchHasSource(
  map: Map<string, NetworkFetchUi>,
  sourceId: string,
): boolean {
  const sid = sourceId.trim().toLowerCase()
  if (!sid) return false
  for (const j of map.values()) {
    if (j.sourceId.trim().toLowerCase() === sid) return true
  }
  return false
}

/** VS Code SplitView 视图约束（与 workbench sidebar / editor / auxiliary 对齐） */
const NAV_MIN = 180
const LIST_MIN = 280
const DETAIL_MIN = 180
const DEFAULT_NAV = 220
const DEFAULT_LIST = 480
const DEFAULT_DETAIL = 260
const LIST_UPPER_MIN = 140
const LIST_LOWER_MIN = 96
/** 本地货架：上栏贴容器列表，避免中间留白；网络货架仍给工作台更多高度 */
const LIST_UPPER_DEFAULT = 240
const LIST_UPPER_NET_DEFAULT = 420
const LIST_LOWER_DEFAULT = 220

type NavShelf = 'local' | 'network' | 'filter'

function isNetworkLikeShelf(shelf: NavShelf): boolean {
  return shelf === 'network' || shelf === 'filter'
}
const FETCH_CONCURRENCY_MIN = 1
const FETCH_CONCURRENCY_MAX = 8
const FETCH_CONCURRENCY_DEFAULT = 3

function clampFetchConcurrency(n: number): number {
  if (!Number.isFinite(n)) return FETCH_CONCURRENCY_DEFAULT
  return Math.max(
    FETCH_CONCURRENCY_MIN,
    Math.min(FETCH_CONCURRENCY_MAX, Math.round(n)),
  )
}

/** Backend sentinel when network list payload was omitted (nav-only IPC). */
const OMIT_NETWORK_LIST_SUMMARY = '__omit_network_list__'

function isNavOnlySnapshot(incoming: AppSnapshot): boolean {
  return (
    incoming.omitNetworkLibraryList === true ||
    incoming.networkLibrarySummary === OMIT_NETWORK_LIST_SUMMARY
  )
}

/** Visible 容器 list order (pinned first; hidden pool appended when open). */
function visibleContainerProjectIds(
  nodes: NavNodeDto[] | undefined,
  projectPoolOpen: boolean,
): string[] {
  const out: string[] = []
  const hidden: string[] = []
  for (const top of nodes ?? []) {
    if (top.kind !== 'category' || top.name !== '容器') continue
    for (const c of top.children ?? []) {
      if (c.kind === 'category' && c.name === '隐藏容器') {
        for (const p of c.children ?? []) {
          if (p.projectId) hidden.push(p.projectId)
        }
        continue
      }
      if (c.projectId) out.push(c.projectId)
    }
  }
  if (projectPoolOpen) out.push(...hidden)
  return out
}

/** Count project leaves under 容器 (including 隐藏容器 pool). */
function countContainerProjectLeaves(nodes: NavNodeDto[] | undefined): number {
  let n = 0
  const walk = (list: NavNodeDto[]) => {
    for (const node of list) {
      if (node.kind === 'project') n += 1
      if (node.children?.length) walk(node.children)
    }
  }
  for (const top of nodes ?? []) {
    if (top.kind === 'category' && top.name === '容器') {
      walk(top.children ?? [])
    }
  }
  return n
}

/** Prefer incoming list when non-empty; keep prev if incoming wiped to []. */
function preferNonEmptyList<T>(incoming: T[] | undefined, prev: T[] | undefined): T[] {
  const next = incoming ?? prev ?? []
  const old = prev ?? []
  if (next.length === 0 && old.length > 0) return old
  return next
}

/**
 * Merge light snapshots that omit the network list: take all fields from incoming,
 * only restore network list payload from prev (workspace eye / network pin share this).
 */
function mergeOmitNetworkSnapshot(prev: AppSnapshot | null, incoming: AppSnapshot): AppSnapshot {
  if (!isNavOnlySnapshot(incoming)) return incoming
  if (!prev) return incoming
  return {
    ...incoming,
    networkLibraryItems: prev.networkLibraryItems ?? [],
    networkLibrarySummary:
      prev.networkLibrarySummary && prev.networkLibrarySummary !== OMIT_NETWORK_LIST_SUMMARY
        ? prev.networkLibrarySummary
        : String(prev.networkLibraryItems?.length ?? 0),
    networkLibraryHeader: prev.networkLibraryHeader || incoming.networkLibraryHeader,
    omitNetworkLibraryList: false,
  }
}

/**
 * Merge light (nav-only) snapshots: keep prev heavy lists / commands / detail;
 * take nav + projects from incoming (backend still loads real catalog for pin accuracy).
 * Workspace-eye light snaps prefer {@link mergeOmitNetworkSnapshot} via apply().
 */
function mergeNavOnlySnapshot(prev: AppSnapshot | null, incoming: AppSnapshot): AppSnapshot {
  const omit = isNavOnlySnapshot(incoming)
  if (!omit) return incoming
  if (!prev) return incoming

  // Workspace eye / bulk eye: need incoming workspaces + container sections.
  // Network pin historically kept prev as base; both share omit sentinel — prefer
  // incoming base and only restore network list (correct for both).
  const merged = mergeOmitNetworkSnapshot(prev, incoming)
  const projects = preferNonEmptyList(merged.projects, prev.projects)
  const incomingNav = merged.navNodes ?? prev.navNodes
  const prevNav = prev.navNodes ?? []
  const navNodes =
    countContainerProjectLeaves(incomingNav) === 0 && countContainerProjectLeaves(prevNav) > 0
      ? prevNav
      : (incomingNav ?? prevNav)

  return {
    ...merged,
    projects,
    navNodes,
  }
}

/** Optimistic popular/official pin flip before IPC returns. */
function optimisticNetworkPin(
  prev: AppSnapshot | null,
  section: 'popular' | 'official',
  id: string,
  pinned: boolean,
): AppSnapshot | null {
  if (!prev) return prev
  const patch = (list: NetworkNavNodeDto[] | undefined) =>
    (list ?? []).map((n) => (n.id === id ? { ...n, pinned } : n))
  if (section === 'official') {
    return { ...prev, networkOfficialNav: patch(prev.networkOfficialNav) }
  }
  return { ...prev, networkPopularNav: patch(prev.networkPopularNav) }
}

function optimisticPopularVisibilityAll(
  prev: AppSnapshot | null,
  show: boolean,
  scope: 'official' | 'community' = 'community',
): AppSnapshot | null {
  if (!prev) return prev
  const list = prev.networkPopularNav ?? []
  if (scope === 'official') {
    return {
      ...prev,
      networkPopularNav: list.map((n) =>
        n.isOfficialSample ? { ...n, pinned: show } : n,
      ),
    }
  }
  const community = list.filter((n) => !n.isOfficialSample && n.kind !== 'user')
  // 与后端对齐：闭眼保留 N；开眼时 N=0 → 恢复默认 10
  const cur = Number(prev.networkPopularVisibleLimit ?? 0)
  const limit = show ? Math.min(cur === 0 ? 10 : cur, community.length, 50) : cur
  let communityIdx = 0
  return {
    ...prev,
    networkPopularVisibleLimit: limit,
    networkPopularNav: list.map((n) => {
      if (n.isOfficialSample) return n
      // 社区分组批量眼覆盖用户源（与后端 set_network_popular_visibility_all 对齐）
      if (n.kind === 'user') return { ...n, pinned: show }
      const inCandidatePool = communityIdx < limit
      communityIdx += 1
      return { ...n, inCandidatePool, pinned: show ? inCandidatePool : false }
    }),
  }
}

/** Move a project leaf between 容器 main and 隐藏容器 pool (optimistic eye). */
function moveProjectNavNode(
  nodes: NavNodeDto[],
  projectId: string,
  wantPinned: boolean,
): NavNodeDto[] {
  let moved: NavNodeDto | null = null
  const strip = (list: NavNodeDto[]): NavNodeDto[] =>
    list.flatMap((n) => {
      if (n.kind === 'project' && n.projectId === projectId) {
        moved = n
        return []
      }
      if (n.children?.length) {
        return [{ ...n, children: strip(n.children) }]
      }
      return [n]
    })
  const stripped = strip(nodes)
  if (!moved) return nodes
  const leaf = moved
  return stripped.map((n) => {
    if (n.kind !== 'category' || n.name !== '容器') return n
    const kids = [...(n.children ?? [])]
    const poolIdx = kids.findIndex((c) => c.kind === 'category' && c.name === '隐藏容器')
    const pool =
      poolIdx >= 0
        ? kids[poolIdx]!
        : ({
            name: '隐藏容器',
            kind: 'category' as const,
            isExpanded: false,
            children: [] as NavNodeDto[],
          } satisfies NavNodeDto)
    const main = kids.filter(
      (c, i) => i !== poolIdx && !(c.kind === 'project' && c.projectId === projectId),
    )
    if (wantPinned) {
      return {
        ...n,
        children: [
          ...main.filter((c) => !(c.kind === 'category' && c.name === '隐藏容器')),
          leaf,
          {
            ...pool,
            children: (pool.children ?? []).filter((c) => c.projectId !== projectId),
          },
        ],
      }
    }
    return {
      ...n,
      children: [
        ...main.filter((c) => !(c.kind === 'category' && c.name === '隐藏容器')),
        {
          ...pool,
          children: [...(pool.children ?? []).filter((c) => c.projectId !== projectId), leaf],
        },
      ],
    }
  })
}

/** Optimistic project eye flip: projects.pinned + nav tree move. */
function optimisticToggleProjectPin(prev: AppSnapshot | null, id: string): AppSnapshot | null {
  if (!prev) return prev
  const cur = (prev.projects ?? []).find((p) => p.id === id)
  if (!cur) return prev
  const wantPinned = !cur.pinned
  const projects = (prev.projects ?? []).map((p) =>
    p.id === id ? { ...p, pinned: wantPinned } : p,
  )
  return {
    ...prev,
    projects,
    navNodes: moveProjectNavNode(prev.navNodes ?? [], id, wantPinned),
  }
}

/** Move a workspace leaf between 工作区 main and 备份区域 pool (optimistic eye). */
function moveWorkspaceNavNode(
  nodes: NavNodeDto[],
  toolId: string,
  wantInWorkArea: boolean,
): NavNodeDto[] {
  let moved: NavNodeDto | null = null
  const strip = (list: NavNodeDto[]): NavNodeDto[] =>
    list.flatMap((n) => {
      if (n.kind === 'global' && (n.tool || '') === toolId) {
        moved = n
        return []
      }
      if (n.children?.length) {
        return [{ ...n, children: strip(n.children) }]
      }
      return [n]
    })
  const stripped = strip(nodes)
  if (!moved) return nodes
  const leaf = moved
  return stripped.map((n) => {
    if (n.kind !== 'category' || n.name !== '工作区') return n
    const kids = [...(n.children ?? [])]
    const poolIdx = kids.findIndex((c) => c.kind === 'category' && c.name === '备份区域')
    const pool =
      poolIdx >= 0
        ? kids[poolIdx]!
        : ({
            name: '备份区域',
            kind: 'category' as const,
            isExpanded: false,
            children: [] as NavNodeDto[],
          } satisfies NavNodeDto)
    const main = kids.filter(
      (c, i) => i !== poolIdx && !(c.kind === 'global' && (c.tool || '') === toolId),
    )
    if (wantInWorkArea) {
      return {
        ...n,
        children: [
          ...main.filter((c) => !(c.kind === 'category' && c.name === '备份区域')),
          leaf,
          {
            ...pool,
            children: (pool.children ?? []).filter((c) => (c.tool || '') !== toolId),
          },
        ],
      }
    }
    return {
      ...n,
      children: [
        ...main.filter((c) => !(c.kind === 'category' && c.name === '备份区域')),
        {
          ...pool,
          children: [
            ...(pool.children ?? []).filter((c) => (c.tool || '') !== toolId),
            leaf,
          ],
        },
      ],
    }
  })
}

/** Optimistic workspace eye flip before IPC returns. */
function optimisticWorkspaceEye(
  prev: AppSnapshot | null,
  id: string,
  inWorkArea: boolean,
): AppSnapshot | null {
  if (!prev) return prev
  const list = prev.workspaces ?? []
  const cur = list.find((w) => w.id === id)
  if (!cur || cur.inWorkArea === inWorkArea) return prev

  if (!inWorkArea) {
    const others = list.filter((w) => w.inWorkArea && w.id !== id).length
    if (others === 0) return prev
  }

  let defaultId = prev.defaultWorkspaceId ?? 'cursor'
  if (!inWorkArea && defaultId === id) {
    const fb = list.find((w) => w.inWorkArea && w.id !== id)
    if (fb) defaultId = fb.id
  }

  const workspaces = list.map((w) => {
    if (w.id !== id) {
      return { ...w, isDefault: w.id === defaultId }
    }
    return {
      ...w,
      inWorkArea,
      enabled: inWorkArea ? true : w.enabled,
      isVisible: inWorkArea,
      isDefault: w.id === defaultId,
    }
  })

  let visibleWorkspaceIds = [...(prev.visibleWorkspaceIds ?? [])]
  if (inWorkArea) {
    if (!visibleWorkspaceIds.some((v) => v.toLowerCase() === id.toLowerCase())) {
      visibleWorkspaceIds.push(id)
    }
  } else {
    visibleWorkspaceIds = visibleWorkspaceIds.filter(
      (v) => v.toLowerCase() !== id.toLowerCase(),
    )
  }

  let selectedGlobalTool = prev.selectedGlobalTool ?? 'cursor'
  const focusStillIn = workspaces.some(
    (w) => w.id === selectedGlobalTool && w.inWorkArea && w.enabled,
  )
  if (!focusStillIn) {
    selectedGlobalTool = workspaces.find((w) => w.inWorkArea && w.enabled)?.id ?? defaultId
  }

  return {
    ...prev,
    workspaces,
    visibleWorkspaceIds,
    defaultWorkspaceId: defaultId,
    selectedGlobalTool,
    focusWorkspaceDisplayName:
      workspaces.find((w) => w.id === selectedGlobalTool)?.displayName ??
      prev.focusWorkspaceDisplayName,
    navNodes: moveWorkspaceNavNode(prev.navNodes ?? [], id, inWorkArea),
  }
}

/** Optimistic bulk workspace eye open/close. */
function optimisticWorkspaceEyeAll(prev: AppSnapshot | null, show: boolean): AppSnapshot | null {
  if (!prev) return prev
  const list = prev.workspaces ?? []
  if (show) {
    let next: AppSnapshot | null = prev
    for (const w of list) {
      if (!w.inWorkArea) {
        next = optimisticWorkspaceEye(next, w.id, true)
      }
    }
    return next
  }
  const keepId =
    list.find((w) => w.isDefault)?.id ||
    list.find((w) => w.inWorkArea)?.id ||
    list[0]?.id
  let next: AppSnapshot | null = prev
  for (const w of list) {
    if (w.inWorkArea && w.id !== keepId) {
      next = optimisticWorkspaceEye(next, w.id, false)
    }
  }
  return next
}

/** VS Code layout toggle：左侧栏（Primary Side Bar） */
function IconPanelLeft() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v12h4V2H2zm5 0v12h7V2H7z"
      />
    </svg>
  )
}

/** VS Code layout toggle：右侧栏（Secondary / Auxiliary Side Bar） */
function IconPanelRight() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M2 1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 1v12h7V2H2zm8 0v12h4V2h-4z"
      />
    </svg>
  )
}

const bootLogged = { current: false }

export default function App() {
  if (!bootLogged.current) {
    bootLogged.current = true
    ccmPerfOpen('boot')
  }
  const { t, locale } = useI18n()
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [firstTip, setFirstTip] = useState(() => {
    try {
      return localStorage.getItem('ccm.firstTip') !== '0'
    } catch {
      return true
    }
  })
  const [busy, setBusy] = useState(false)
  const [networkFetch, setNetworkFetch] = useState<Map<string, NetworkFetchUi>>(
    () => new Map(),
  )
  const networkFetchRef = useRef<Map<string, NetworkFetchUi>>(networkFetch)
  networkFetchRef.current = networkFetch
  const pumpFetchUncachedRef = useRef<() => void>(() => {})
  const [fetchQueue, setFetchQueue] = useState<NetworkFetchRequest[]>([])
  const fetchQueueRef = useRef<NetworkFetchRequest[]>(fetchQueue)
  const fetchPumpingRef = useRef(false)
  const [fetchModalOpen, setFetchModalOpen] = useState(false)
  const [fetchConcurrency, setFetchConcurrency] = useState(FETCH_CONCURRENCY_DEFAULT)
  const fetchConcurrencyRef = useRef(FETCH_CONCURRENCY_DEFAULT)
  fetchConcurrencyRef.current = fetchConcurrency
  useEffect(() => {
    if (typeof snap?.networkFetchConcurrency !== 'number') return
    const v = clampFetchConcurrency(snap.networkFetchConcurrency)
    setFetchConcurrency(v)
    fetchConcurrencyRef.current = v
  }, [snap?.networkFetchConcurrency])
  const [fetchJobExpanded, setFetchJobExpanded] = useState<Set<string>>(() => new Set())
  const [networkFetchErrors, setNetworkFetchErrors] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [projectDialog, setProjectDialog] = useState<'edit' | null>(null)
  const [tagDialog, setTagDialog] = useState(false)
  const [tagScope, setTagScope] = useState('global')
  const [tagPurposes, setTagPurposes] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [kindsOpen, setKindsOpen] = useState(false)
  const kindsMenuRef = useRef<HTMLDivElement>(null)
  const [suggestDialog, setSuggestDialog] = useState<{
    suggestions: SuggestedPurposeDto[]
    alreadyTagged: number
    noSuggestion: number
  } | null>(null)
  const [projectForm, setProjectForm] = useState({ name: '', rootPath: '', category: t('dialog.otherProject'), id: '' })
  const [removeDialog, setRemoveDialog] = useState<{
    projectId: string
    projectName: string
    fileCount: number
  } | null>(null)
  const [movePreview, setMovePreview] = useState<MoveIntoBackupPreviewDto | null>(null)
  /** 「定制与操作记录」对话框：当前定制 diff + 级别 + oplog 事件 */
  const [opsLog, setOpsLog] = useState<EntryOperationLogDto | null>(null)
  const [scanBuildPreview, setScanBuildPreview] = useState<ScanBuildPreviewState | null>(null)
  const [containerRootEditor, setContainerRootEditor] = useState<{
    id: string
    label: string
    path: string
  } | null>(null)
  const [conflicts, setConflicts] = useState<PathConflictDto[] | null>(null)
  const [conflictOp, setConflictOp] = useState<
    'moveIntoBackup' | 'withdraw' | 'refresh' | 'promoteFromNetwork' | 'clearContainer' | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 网络库存入永久库：冲突决议后继续用的 entryIds */
  const [pendingPromoteIds, setPendingPromoteIds] = useState<string[] | null>(null)
  const [pendingClearProjectIds, setPendingClearProjectIds] = useState<string[] | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [ctx, setCtx] = useState<CtxState>(null)
  /** SplitView 恢复提示（仅 settings / snapshot 写入时更新） */
  const [paneHints, setPaneHints] = useState({
    nav: DEFAULT_NAV,
    list: DEFAULT_LIST,
    detail: DEFAULT_DETAIL,
  })
  const [navVisible, setNavVisible] = useState(true)
  const [detailVisible, setDetailVisible] = useState(true)
  /** 侧栏货架：本地=工作区/项目；网络=按源浏览；筛选=人群短语漏斗 */
  const [navShelf, setNavShelf] = useState<NavShelf>('local')
  const [listSplitHints, setListSplitHints] = useState({
    upper: LIST_UPPER_DEFAULT,
    lower: LIST_LOWER_DEFAULT,
  })
  const [persona, setPersona] = useState<PersonaId | null>(null)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [refinePath, setRefinePath] = useState<RefineStep[]>([])
  const [personaSub, setPersonaSub] = useState<PersonaSubFilter | null>(null)
  const [hideMirrors, setHideMirrorsState] = useState(loadHideMirrors)
  const setHideMirrors = useCallback((on: boolean) => {
    setHideMirrorsState(on)
    saveHideMirrors(on)
  }, [])
  const [includeLocal, setIncludeLocal] = useState(false)
  const [includeNetwork, setIncludeNetwork] = useState(true)
  const [phraseExpanded, setPhraseExpanded] = useState(false)
  const [refineExpanded, setRefineExpanded] = useState<string | null>(null)
  const funnelAnnotateCacheRef = useRef(new Map<string, FunnelListItem>())
  const [funnelPool, setFunnelPool] = useState<FunnelListItem[]>([])
  /** Drop stale nav-only pin IPC responses when user toggles faster or bulk visibility runs. */
  const networkPinSeqRef = useRef(0)
  const projectPinSeqRef = useRef(0)
  /** Drop stale workspace-eye IPC responses when user toggles faster or bulk runs. */
  const workspaceEyeSeqRef = useRef(0)
  /** 勾选类轻操作后置真：阻止页签 effect 用旧正文开错文档（消费后自清）。 */
  const suppressTabOpenRef = useRef(false)
  /** 丢弃过期的 setSelectionLight 响应（连点/全选时只处理最后一次）。 */
  const selectionLightSeqRef = useRef(0)
  /** 齿轮：展开原「备份区域」工具池子叶（与 NavTree 共用） */
  const [workspacePoolOpen, setWorkspacePoolOpen] = useState(false)
  /** 齿轮：展开「隐藏容器」池（关眼项目；与 NavTree 共用） */
  const [projectPoolOpen, setProjectPoolOpen] = useState(false)
  const [networkNavSel, setNetworkNavSel] = useState<NetworkNavSel>(null)
  const [networkNavPickedIds, setNetworkNavPickedIds] = useState<Set<string>>(
    () => new Set(),
  )
  const networkNavAnchorRef = useRef<string | null>(null)
  const [pickedProjectIds, setPickedProjectIds] = useState<Set<string>>(() => new Set())
  const pickedProjectIdsRef = useRef<Set<string>>(new Set())
  const projectAnchorRef = useRef<string | null>(null)
  const [upperAllCollapsed, setUpperAllCollapsed] = useState(false)
  const upperCollapseApiRef = useRef<(() => void) | null>(null)
  const [lowerAllCollapsed, setLowerAllCollapsed] = useState(false)
  const lowerCollapseApiRef = useRef<(() => void) | null>(null)
  const [layoutRestoreKey, setLayoutRestoreKey] = useState('init')
  const layoutTimer = useRef<number | null>(null)
  /** 栏宽/可见性只从 settings 灌入一次，避免后续 snapshot 与 sash 拖拽互相覆盖 */
  const layoutHydrated = useRef(false)
  /** Shift 连续多选的锚点 entryId */
  const selectionAnchorRef = useRef<string | null>(null)
  /** 详情 Markdown 多页签保活 */
  const [openMdTabs, setOpenMdTabs] = useState<MdTab[]>([])
  const [activeMdTabId, setActiveMdTabId] = useState<string | null>(null)
  const [mdDirtyById, setMdDirtyById] = useState<Record<string, boolean>>({})
  const mdDirtyByIdRef = useRef(mdDirtyById)
  mdDirtyByIdRef.current = mdDirtyById
  const openMdTabsRef = useRef(openMdTabs)
  openMdTabsRef.current = openMdTabs
  /** 详情 Markdown 排版/布局/细节（主题画廊） */
  const [mdStyle, setMdStyle] = useState<MdStyleState>(() => loadMdStyleState())
  const [themeGalleryOpen, setThemeGalleryOpen] = useState(false)

  /** B3：网络货架挂载且间隔>0 时仅 checkNetworkUpdates（禁止自动 apply） */
  useEffect(() => {
    if (!isNetworkLikeShelf(navShelf)) return
    const mins = snap?.networkUpdateCheckIntervalMinutes ?? 0
    if (!mins || mins <= 0) return
    const ms = mins * 60 * 1000
    const tick = () => {
      void invoke<{ updateAvailable?: number }>('checkNetworkUpdates')
        .then((res) => {
          if (res.snapshot) mergeSnap(res.snapshot)
          const n =
            (res.data as { updateAvailable?: number } | undefined)?.updateAvailable ??
            (res as { updateAvailable?: number }).updateAvailable
          if (typeof n === 'number' && n > 0) {
            setToast(t('toast.updatesAvailable', { n }))
            window.setTimeout(() => setToast(null), 4000)
          }
        })
        .catch(() => {
          /* 定时检查失败静默 */
        })
    }
    const id = window.setInterval(tick, ms)
    return () => window.clearInterval(id)
  }, [navShelf, snap?.networkUpdateCheckIntervalMinutes])

  const updateMdStyle = useCallback((next: MdStyleState) => {
    setMdStyle(next)
    saveMdStyleState(next)
  }, [])

  const anyMdDirty = Object.values(mdDirtyById).some(Boolean)

  /** 关闭 dirty 页签前确认 */
  const confirmDiscardTab = (tabId: string) => {
    if (!mdDirtyByIdRef.current[tabId]) return true
    return window.confirm(t('toast.discardMd'))
  }

  const setTabDirty = useCallback((tabId: string, dirty: boolean) => {
    setMdDirtyById((prev) => {
      if (Boolean(prev[tabId]) === dirty) return prev
      if (!dirty) {
        const next = { ...prev }
        delete next[tabId]
        return next
      }
      return { ...prev, [tabId]: true }
    })
  }, [])

  const closeMdTab = useCallback((tabId: string) => {
    if (!confirmDiscardTab(tabId)) return
    setOpenMdTabs((prev) => {
      const next = prev.filter((t) => t.tabId !== tabId)
      setActiveMdTabId((cur) => {
        if (cur !== tabId) return cur
        if (next.length === 0) return null
        const sorted = [...next].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        return sorted[0]?.tabId ?? null
      })
      return next
    })
    setMdDirtyById((prev) => {
      if (!(tabId in prev)) return prev
      const next = { ...prev }
      delete next[tabId]
      return next
    })
  }, [])

  /** 批量关闭（按 id 列表）；dirty 逐个确认，取消则跳过该项 */
  const closeMdTabsByIds = useCallback((tabIds: string[]) => {
    const toClose: string[] = []
    for (const id of tabIds) {
      if (!confirmDiscardTab(id)) continue
      toClose.push(id)
    }
    if (toClose.length === 0) return
    const closeSet = new Set(toClose)
    setOpenMdTabs((prev) => {
      const next = prev.filter((t) => !closeSet.has(t.tabId))
      setActiveMdTabId((cur) => {
        if (!cur || !closeSet.has(cur)) return cur
        if (next.length === 0) return null
        const sorted = [...next].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        return sorted[0]?.tabId ?? null
      })
      return next
    })
    setMdDirtyById((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of toClose) {
        if (id in next) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  const resolveMdTabPath = (tab: MdTab): string => {
    if (tab.kind === 'diff') return (tab.compareLeftPath || '').trim()
    return (tab.filePath || '').trim()
  }

  const relativeToRoot = (absPath: string, root: string): string | null => {
    const abs = absPath.replace(/\//g, '\\').replace(/\\+$/, '')
    const base = root.replace(/\//g, '\\').replace(/\\+$/, '')
    if (!abs || !base) return null
    const al = abs.toLowerCase()
    const bl = base.toLowerCase()
    if (al === bl) return '.'
    const prefix = bl + '\\'
    if (!al.startsWith(prefix)) return null
    return abs.slice(base.length).replace(/^\\+/, '')
  }

  const copyText = (text: string, okMsg: string) => {
    void navigator.clipboard.writeText(text).then(
      () => {
        setToast(okMsg)
        window.setTimeout(() => setToast(null), 2500)
      },
      () => {
        setToast(t('toast.copyFail'))
        window.setTimeout(() => setToast(null), 3000)
      },
    )
  }

  const mdTabMenu = (tabId: string): MenuItem[] => {
    const tabs = openMdTabsRef.current
    const idx = tabs.findIndex((t) => t.tabId === tabId)
    const tab = idx >= 0 ? tabs[idx] : undefined
    const pathAbs = tab ? resolveMdTabPath(tab) : ''
    const hasPath = Boolean(pathAbs) && !pathAbs.includes(' ↔ ')
    const others = tabs.filter((t) => t.tabId !== tabId).map((t) => t.tabId)
    const toRight = idx >= 0 ? tabs.slice(idx + 1).map((t) => t.tabId) : []
    const saved = tabs
      .filter((t) => t.kind !== 'edit' || !mdDirtyByIdRef.current[t.tabId])
      .map((t) => t.tabId)
    const allIds = tabs.map((t) => t.tabId)

    const pathRoot =
      tab?.kind === 'diff' || tab?.pathSide === 'library'
        ? snap?.libraryRootDisplay ?? ''
        : snap?.activeContainerPathDisplay ?? ''

    return [
      {
        label: t('menu.close'),
        onClick: () => closeMdTab(tabId),
      },
      {
        label: t('menu.closeOthers'),
        disabled: others.length === 0,
        onClick: () => closeMdTabsByIds(others),
      },
      {
        label: t('menu.closeRight'),
        disabled: toRight.length === 0,
        onClick: () => closeMdTabsByIds(toRight),
      },
      {
        label: t('menu.closeSaved'),
        disabled: saved.length === 0,
        onClick: () => closeMdTabsByIds(saved),
      },
      {
        label: t('menu.closeAll'),
        disabled: allIds.length === 0,
        onClick: () => closeMdTabsByIds(allIds),
      },
      {
        label: t('menu.copyPath'),
        disabled: !hasPath,
        onClick: () => copyText(pathAbs, t('toast.copiedPath')),
      },
      {
        label: t('menu.copyRelPath'),
        disabled: !hasPath,
        onClick: () => {
          const rel = relativeToRoot(pathAbs, pathRoot)
          if (rel) {
            copyText(rel, t('toast.copiedRelPath'))
            return
          }
          copyText(pathAbs, t('toast.copiedAbsFallback'))
        },
      },
      {
        label: t('menu.revealInExplorer'),
        disabled: !hasPath,
        onClick: () => void run('revealInFolder', { path: pathAbs }),
      },
    ]
  }

  const onMdTabContextMenu = (e: ReactMouseEvent, tabId: string) => {
    activateMdTab(tabId)
    showMenu(e, mdTabMenu(tabId))
  }

  const persistLayout = (
    nav: number,
    list: number,
    nextNavVisible = navVisible,
    nextDetailVisible = detailVisible,
  ) => {
    if (layoutTimer.current) window.clearTimeout(layoutTimer.current)
    layoutTimer.current = window.setTimeout(() => {
      void invoke('setUiLayout', {
        navWidth: nav,
        listWidth: list,
        navVisible: nextNavVisible,
        detailVisible: nextDetailVisible,
      })
    }, 300)
  }

  const toggleNavVisible = () => {
    const next = !navVisible
    setNavVisible(next)
    persistLayout(paneHints.nav, paneHints.list, next, detailVisible)
  }

  const toggleDetailVisible = () => {
    const next = !detailVisible
    setDetailVisible(next)
    persistLayout(paneHints.nav, paneHints.list, navVisible, next)
  }

  const apply = useCallback(<T,>(res: Awaited<ReturnType<typeof invoke<T>>>) => {
    if (res.snapshot) {
      setSnap((prev) => mergeNavOnlySnapshot(prev, res.snapshot!))
      if (
        !layoutHydrated.current &&
        (res.snapshot.uiNavWidth != null ||
          res.snapshot.uiListWidth != null ||
          res.snapshot.uiNavVisible != null ||
          res.snapshot.uiDetailVisible != null)
      ) {
        layoutHydrated.current = true
        setPaneHints((prev) => {
          const nav = res.snapshot!.uiNavWidth ?? prev.nav
          const list = res.snapshot!.uiListWidth ?? prev.list
          return { nav, list, detail: prev.detail }
        })
        if (res.snapshot.uiNavVisible != null) setNavVisible(res.snapshot.uiNavVisible !== false)
        if (res.snapshot.uiDetailVisible != null) setDetailVisible(res.snapshot.uiDetailVisible !== false)
        setLayoutRestoreKey('hydrated')
      }
    }
    if (res.message) {
      setToast(res.message)
      window.setTimeout(() => setToast(null), 5000)
    }
    if (!res.ok && !res.message) {
      setToast(t('toast.opFail'))
      window.setTimeout(() => setToast(null), 4000)
    }
    return res
  }, [])

  /** 网络拉取进度/完成事件（不阻塞 UI；按 jobId 更新） */
  useEffect(() => {
    if (isBrowserPreview()) return
    let unlistenProgress: (() => void) | undefined
    let unlistenFinished: (() => void) | undefined
    let cancelled = false

    const toastRefreshFailed = () => {
      setToast(t('toast.refreshFail'))
      window.setTimeout(() => setToast(null), 5000)
    }

    const refreshSnapAfterFetch = (snapshot?: AppSnapshot) => {
      if (snapshot) {
        mergeSnap(snapshot)
        return
      }
      void invoke('getSnapshot')
        .then((res) => {
          if (res.ok && res.snapshot) mergeSnap(res.snapshot)
          else toastRefreshFailed()
        })
        .catch(() => toastRefreshFailed())
    }

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        if (cancelled) return
        unlistenProgress = await listen<NetworkFetchProgressEvent>(
          'network-fetch-progress',
          (ev) => {
            const p = ev.payload
            setNetworkFetch((prev) => {
              const cur = prev.get(p.jobId)
              if (!cur) return prev
              const nextPercent =
                typeof p.percent === 'number' && Number.isFinite(p.percent)
                  ? Math.max(0, Math.min(100, p.percent))
                  : cur.percent
              const next = new Map(prev)
              next.set(p.jobId, {
                ...cur,
                sourceId: (p.sourceId ?? cur.sourceId).trim() || cur.sourceId,
                phase: p.phase || cur.phase,
                detail: p.detail || cur.detail,
                stalled: Boolean(p.stalled),
                percent: nextPercent,
              })
              return next
            })
          },
        )
        unlistenFinished = await listen<NetworkFetchFinishedEvent>(
          'network-fetch-finished',
          (ev) => {
            const p = ev.payload
            const cur = networkFetchRef.current.get(p.jobId)
            setNetworkFetch((prev) => {
              if (!prev.has(p.jobId)) return prev
              const next = new Map(prev)
              next.delete(p.jobId)
              networkFetchRef.current = next
              return next
            })
            const applyFetchError = (sourceId: string, ok: boolean) => {
              const sid = sourceId.trim()
              if (!sid) return
              const cachedNow = Boolean(
                (p.snapshot?.networkPopularNav ?? []).some(
                  (n) => n.id === sid && n.hasCachedSource,
                ),
              )
              if (ok || cachedNow) {
                setNetworkFetchErrors((prev) => {
                  if (!prev.has(sid)) return prev
                  const next = new Map(prev)
                  next.delete(sid)
                  return next
                })
              } else {
                setNetworkFetchErrors((prev) => {
                  const next = new Map(prev)
                  next.set(sid, p.message || t('toast.fetchFail'))
                  return next
                })
              }
            }
            if (!cur) {
              setToast(t('toast.fetchDoneOrphan'))
              window.setTimeout(() => setToast(null), 4000)
              refreshSnapAfterFetch(p.snapshot)
              applyFetchError(p.sourceId || '', p.ok)
              pumpFetchUncachedRef.current()
              return
            }
            refreshSnapAfterFetch(p.snapshot)
            applyFetchError(p.sourceId || cur.sourceId, p.ok)
            if (p.snapshot?.networkIndexError) {
              setToast(p.snapshot.networkIndexError)
              window.setTimeout(() => setToast(null), 6000)
            } else {
              const label = p.sourceId || cur.sourceId
              setToast(
                p.message ||
                  (p.ok ? t('toast.fetchDone', { label }) : t('toast.fetchFailLabel', { label })),
              )
              window.setTimeout(() => setToast(null), p.ok ? 4000 : 6000)
            }
            pumpFetchUncachedRef.current()
          },
        )
      } catch {
        /* 非 Tauri 或 event API 不可用时静默 */
      }
    })()
    return () => {
      cancelled = true
      unlistenProgress?.()
      unlistenFinished?.()
    }
    // mergeSnap 稳定；仅挂载一次监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  const refresh = useCallback(async () => {
    const timeoutMs = 20_000
    const timeoutMsg = t('load.timeout', { s: timeoutMs / 1000 })
    const withTimeout = <T,>(p: Promise<T>, ms: number) => {
      let timer = 0
      const wrapped = Promise.race([
        p,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error(timeoutMsg)), ms)
        }),
      ])
      void p.finally(() => window.clearTimeout(timer))
      return wrapped
    }
    try {
      setLoadError(null)
      let res: Awaited<ReturnType<typeof invoke>>
      try {
        const tSnap = performance.now()
        res = await withTimeout(
          invoke('getSnapshot', { omitNetworkList: true }),
          timeoutMs,
        )
        ccmPerfSpan('firstSnap', tSnap, `ok=${Boolean(res.ok)}`)
      } catch {
        await new Promise((r) => window.setTimeout(r, 400))
        const tSnap = performance.now()
        res = await withTimeout(
          invoke('getSnapshot', { omitNetworkList: true }),
          timeoutMs,
        )
        ccmPerfSpan('firstSnap', tSnap, `ok=${Boolean(res.ok)} retry`)
      }
      apply(res)
      if (!res.snapshot) {
        setLoadError(res.message?.trim() || t('toast.noSnapshot'))
        return
      }
      const tNet = performance.now()
      void invoke('getSnapshot')
        .then((full) => {
          if (!full.ok || !full.snapshot) return
          const net = full.snapshot
          setSnap((prev) => {
            if (!prev) return net
            return {
              ...prev,
              networkLibraryItems: net.networkLibraryItems,
              networkLibrarySummary: net.networkLibrarySummary,
              networkLibraryHeader: net.networkLibraryHeader,
              omitNetworkLibraryList: false,
              networkPopularNav: net.networkPopularNav ?? prev.networkPopularNav,
              networkOfficialNav: net.networkOfficialNav ?? prev.networkOfficialNav,
              networkIndexError: net.networkIndexError,
            }
          })
          ccmPerfSpan(
            'netList',
            tNet,
            `n=${net.networkLibraryItems?.length ?? 0}`,
          )
        })
        .catch(() => undefined)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [apply])

  /** 工具栏/菜单「刷新」：fullSync + 若容器与库内容不同则弹冲突比对（启动加载不走此路径）。 */
  const runRefresh = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(await invoke<{ conflicts?: PathConflictDto[] }>('refresh'))
      const list = res.data?.conflicts ?? []
      if (res.ok && list.length > 0) {
        setConflicts(list)
        setConflictOp('refresh')
      } else if (res.ok) {
        // 无冲突时必须清掉旧窗，否则「磁盘已对齐再刷新」仍显示过期比对
        setConflicts(null)
        setConflictOp(null)
        if (res.message) {
          setToast(res.message)
          window.setTimeout(() => setToast(null), 4000)
        }
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // 仅加载快照；不在打开时扫描（Rust shouldPromptStartupScan 恒为 false）。
    // 扫描由工具栏「扫描建库」触发（全盘/配置根发现 + 入库）。
    void refresh()
  }, [refresh])

  const firstPaintLogged = useRef(false)
  useLayoutEffect(() => {
    if (!snap || firstPaintLogged.current) return
    firstPaintLogged.current = true
    ccmPerfOpen(
      'firstPaint',
      `lib=${snap.inLibraryOtherItems?.length ?? 0} net=${snap.networkLibraryItems?.length ?? 0}`,
    )
  }, [snap])

  useEffect(() => {
    void invoke<{ maximized: boolean }>('windowIsMaximized')
      .then((res) => {
        if (res.ok && res.data) setMaximized(Boolean(res.data.maximized))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    // 仅 click 关闭：选中后详情/编辑器挂载可能触发 window.blur，会误关刚弹出的右键菜单
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [])

  const mergeSnap = useCallback((incoming: AppSnapshot) => {
    setSnap((prev) => mergeNavOnlySnapshot(prev, incoming))
    if (incoming.networkIndexError) {
      setToast(incoming.networkIndexError)
      window.setTimeout(() => setToast(null), 6000)
    }
  }, [])

  const runNetworkPin = useCallback(
    (section: 'popular' | 'official', id: string, pinned: boolean) => {
      const seq = ++networkPinSeqRef.current
      setSnap((prev) => optimisticNetworkPin(prev, section, id, pinned))
      void invoke('setNetworkPin', { section, id, pinned })
        .then((res) => {
          if (seq !== networkPinSeqRef.current) return res
          return apply(res)
        })
        .catch((e) => {
          setToast(e instanceof Error ? e.message : String(e))
        })
    },
    [apply],
  )

  const runNetworkBulkVisibility = useCallback(
    (show: boolean, scope: 'official' | 'community' = 'community') => {
      networkPinSeqRef.current += 1
      setSnap((prev) => optimisticPopularVisibilityAll(prev, show, scope))
      void invoke('setNetworkPopularVisibilityAll', { show, scope })
        .then((res) => apply(res))
        .catch((e) => {
          setToast(e instanceof Error ? e.message : String(e))
        })
    },
    [apply],
  )

  const runTogglePinProject = useCallback(
    async (id: string) => {
      const seq = ++projectPinSeqRef.current
      setSnap((prev) => optimisticToggleProjectPin(prev, id))
      try {
        const res = await invoke('togglePinProject', { id })
        if (seq !== projectPinSeqRef.current) return res
        return apply(res)
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        return undefined
      }
    },
    [apply],
  )

  const run = async (method: IpcMethod, args?: Record<string, unknown>) => {
    try {
      return apply(await invoke(method, args))
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  const setPickedProjects = (next: Set<string>) => {
    pickedProjectIdsRef.current = next
    setPickedProjectIds(next)
  }

  useEffect(() => {
    const id = snap?.selectedProjectId?.trim()
    if (!id) return
    if (pickedProjectIdsRef.current.has(id)) return
    projectAnchorRef.current = id
    setPickedProjects(new Set([id]))
  }, [snap?.selectedProjectId])

  /**
   * H6 点选轻路径：后端只回传选中相关字段（详情正文 / commands 等），
   * 与上一帧快照合并，不再传输整包 AppSnapshot。会话选中集写入与 setSelection 一致。
   */
  const runSelect = async (
    entryIds: string[],
    detailPathSide?: 'container' | 'library',
  ): Promise<SelectionDetailDto | undefined> => {
    try {
      const res = await invoke<SelectionDetailDto>('setSelectionDetail', {
        entryIds,
        ...(detailPathSide ? { detailPathSide } : {}),
      })
      const detail = res.data
      if (res.ok && detail) {
        setSnap((prev) => (prev ? { ...prev, ...detail } : prev))
        return detail
      }
      if (!res.ok) {
        setToast(res.message || t('toast.opFail'))
        window.setTimeout(() => setToast(null), 4000)
      }
      return undefined
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      return undefined
    }
  }

  const activateMdTab = useCallback(
    (tabId: string) => {
      const now = Date.now()
      const tab = openMdTabsRef.current.find((t) => t.tabId === tabId)
      setOpenMdTabs((prev) =>
        prev.map((t) => (t.tabId === tabId ? { ...t, lastActiveAt: now } : t)),
      )
      setActiveMdTabId(tabId)
      if (tab?.kind === 'edit') {
        void runSelect([tab.entryId], tab.pathSide)
      } else if (tab?.kind === 'diff') {
        void runSelect([tab.entryId], 'library')
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  )

  /** 列表单选且 snapshot 带正文时：按「条目+侧」打开或激活编辑页签 */
  useEffect(() => {
    if (suppressTabOpenRef.current) {
      // 勾选类轻操作只改选中集：正文仍是旧文档的，不能拿来开签
      suppressTabOpenRef.current = false
      return
    }
    if (!snap) return
    if (snap.selectedEntryIds.length !== 1) return
    const entryId = snap.selectedEntryIds[0]
    if (snap.detailPaneMode && snap.detailPaneMode !== 'markdown') {
      // 仍允许在其它模式下预开签，不强制
    }
    const text = snap.detailMarkdownText
    if (text == null) return
    const filePath = snap.detailMarkdownFilePath || ''
    const pathSide: MdPathSide = snap.detailPathSide === 'container' ? 'container' : 'library'
    const fileName =
      filePath.replace(/\//g, '\\').split('\\').pop() ||
      entryId.split('-').slice(-1)[0] ||
      entryId
    const title = entryId.startsWith('net:')
      ? t('list.networkSuffix', { title: formatEditTabTitle(fileName, pathSide) })
      : formatEditTabTitle(fileName, pathSide)
    const editable = Boolean(snap.commands.canSaveDetailMarkdown)
    const tabId = makeEditTabId(entryId, pathSide)

    const existing = openMdTabsRef.current.find((t) => t.tabId === tabId)
    if (existing) {
      const now = Date.now()
      setOpenMdTabs((prev) =>
        prev.map((t) => {
          if (t.tabId !== tabId) return t
          const skipEmptyOverwrite = !text.trim() && Boolean(t.initialFullText.trim())
          const contentChanged = filePath !== t.filePath || text !== t.initialFullText
          return {
            ...t,
            lastActiveAt: now,
            filePath,
            title,
            editable,
            // 未脏且路径/正文变了才 remount；空正文不覆盖已有内容（防轻快照抖动）
            ...(mdDirtyByIdRef.current[tabId] || skipEmptyOverwrite
              ? {}
              : contentChanged
                ? { initialFullText: text, remountKey: (t.remountKey ?? 0) + 1 }
                : {}),
          }
        }),
      )
      setActiveMdTabId(tabId)
      return
    }

    const { tabs, blocked } = openOrActivateMdTab(
      openMdTabsRef.current,
      {
        tabId,
        kind: 'edit',
        entryId,
        filePath,
        title,
        initialFullText: text,
        editable,
        pathSide,
      },
      mdDirtyByIdRef.current,
    )
    if (blocked) {
      setToast(t('toast.mdTabMax', { n: MD_TAB_MAX }))
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    setOpenMdTabs(tabs)
    setActiveMdTabId(tabId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap?.selectedEntryIds[0], snap?.selectedEntryIds.length, snap?.detailPathSide, snap?.detailMarkdownFilePath])

  const openDualCompare = useCallback(
    async (entryId: string) => {
      const res = await run('getDualCopyTexts', { entryId })
      if (!res?.ok || !res.data) return
      const data = res.data as {
        entryId: string
        containerPath: string
        libraryPath: string
        containerText: string
        libraryText: string
        sameContent: boolean
      }
      const tabId = makeDiffTabId(entryId)
      const short =
        entryId.length > 28 ? `${entryId.slice(0, 12)}…${entryId.slice(-8)}` : entryId
      const { tabs, blocked } = openOrActivateMdTab(
        openMdTabsRef.current,
        {
          tabId,
          kind: 'diff',
          entryId,
          filePath: `${data.containerPath} ↔ ${data.libraryPath}`,
          title: t('list.compareTitle', { name: short }),
          initialFullText: '',
          editable: false,
          pathSide: 'library',
          compareLeftText: data.libraryText,
          compareRightText: data.containerText,
          compareLeftPath: data.libraryPath,
          compareRightPath: data.containerPath,
        },
        mdDirtyByIdRef.current,
      )
      if (blocked) {
        setToast(t('toast.mdTabMax', { n: MD_TAB_MAX }))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setOpenMdTabs(tabs)
      setActiveMdTabId(tabId)
      if (data.sameContent) {
        setToast(t('toast.sameBothSides'))
        window.setTimeout(() => setToast(null), 3000)
      }
      void run('setDetailMode', { mode: 'markdown' })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  )

  /** 扫描建库：按设置中的工作区容器根 + 项目扫描根预览增量 → 确认 */
  const openScanProjects = () => {
    void runScanPreview()
  }

  const runScanPreview = async () => {
    if (busy) return
    setBusy(true)
    try {
      const scan = apply(
        await invoke<{
          items: DiscoveredItemDto[]
          pendingNewProjectCount?: number
          scanRoots?: string[]
          unchangedCount?: number
          silentRelinkCount?: number
          skippedContentConflict?: number
          deltaCount?: number
        }>('scanAndIngestPreview', {}),
      )
      if (!scan.ok) return
      const items = scan.data?.items ?? []
      const pendingNew = scan.data?.pendingNewProjectCount ?? 0
      const silentRelink = scan.data?.silentRelinkCount ?? 0
      const skippedConflict = scan.data?.skippedContentConflict ?? 0

      if (items.length === 0 && pendingNew === 0) {
        if (silentRelink > 0) {
          await runConfirmScanBuild([])
          return
        }
        let msg = scan.message?.trim() || t('toast.noChange')
        if (skippedConflict > 0 && !msg.includes('刷新')) {
          msg += t('toast.scanRefreshHint', { n: skippedConflict })
        }
        setToast(msg)
        window.setTimeout(() => setToast(null), 5000)
        return
      }

      setScanBuildPreview({
        items,
        pendingNewProjectCount: pendingNew,
        message: scan.message || '',
        skippedContentConflict: skippedConflict,
        silentRelinkCount: silentRelink,
      })
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const runConfirmScanBuild = async (keys: string[]) => {
    setBusy(true)
    try {
      const build = apply(
        await invoke<{
          registered?: number
          projectsAdded?: number
          openAutoClassify?: boolean
          copiedIntoLibrary?: number
          skippedContentConflict?: number
          relinked?: number
        }>('confirmScanBuild', {
          selectedKeys: keys,
          resolutions: [],
        }),
      )
      setScanBuildPreview(null)
      if (build.ok || build.message) {
        const skipped = build.data?.skippedContentConflict ?? 0
        const base = build.message || t('toast.scanDone')
        setToast(
          skipped > 0 && !String(base).includes('刷新')
            ? `${base}${t('toast.scanSkipHint', { n: skipped })}`
            : base,
        )
        window.setTimeout(() => setToast(null), 6000)
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  /** 预览待迁入项 → 确认迁入 → 若有同名冲突再弹决议窗 */
  const openMoveIntoBackup = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(await invoke<MoveIntoBackupPreviewDto>('previewMoveIntoBackup'))
      if (!res.ok || !res.data) return
      if ((res.data.pendingCount ?? 0) === 0) {
        setToast(t('toast.nothingToMove'))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setMovePreview(res.data)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const submitMoveIntoBackup = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }> = [],
    entryIds?: string[],
  ) => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{ conflicts?: PathConflictDto[] }>('moveIntoBackupLibrary', {
          resolutions,
          ...(entryIds?.length ? { entryIds } : {}),
        }),
      )
      const nextConflicts = res.data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setConflictOp('moveIntoBackup')
        setConflicts(nextConflicts)
        setMovePreview(null)
        return
      }
      setMovePreview(null)
      setConflicts(null)
      setConflictOp(null)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  /** 移入永久库（撤回容器副本）：内容相同直接删容器副本；内容不同弹冲突决议窗 */
  const submitWithdraw = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }> = [],
    entryIds?: string[],
  ) => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{ conflicts?: PathConflictDto[] }>('withdraw', {
          resolutions,
          ...(entryIds?.length ? { entryIds } : {}),
        }),
      )
      const nextConflicts = res.data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setConflictOp('withdraw')
        setConflicts(nextConflicts)
        return
      }
      setConflicts(null)
      setConflictOp(null)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const focusProjectIfNeeded = (projectId: string) => {
    if (snap?.selectedNavKind === 'project' && snap.selectedProjectId === projectId) return
    void run('setNav', { kind: 'project', projectId })
  }

  const onSelectProjectNav = (
    projectId: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    const ordered = visibleContainerProjectIds(snap?.navNodes, projectPoolOpen)
    const multi = e.ctrlKey || e.metaKey
    if (e.shiftKey) {
      const anchor =
        projectAnchorRef.current && ordered.includes(projectAnchorRef.current)
          ? projectAnchorRef.current
          : projectId
      const a = ordered.indexOf(anchor)
      const b = ordered.indexOf(projectId)
      const next =
        a >= 0 && b >= 0
          ? new Set(ordered.slice(Math.min(a, b), Math.max(a, b) + 1))
          : new Set([projectId])
      setPickedProjects(next)
      focusProjectIfNeeded(projectId)
      return
    }
    projectAnchorRef.current = projectId
    if (multi) {
      const next = new Set(pickedProjectIdsRef.current)
      if (next.has(projectId)) {
        next.delete(projectId)
        setPickedProjects(next)
        if (snap?.selectedProjectId === projectId) {
          const rest = ordered.filter((id) => next.has(id))
          const fallback = rest[0]
          if (fallback) focusProjectIfNeeded(fallback)
        }
        return
      }
      next.add(projectId)
      setPickedProjects(next)
      focusProjectIfNeeded(projectId)
      return
    }
    setPickedProjects(new Set([projectId]))
    focusProjectIfNeeded(projectId)
  }

  const submitClearProjectSkills = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }> = [],
    projectIds?: string[],
  ) => {
    if (busy) return
    const ids = (
      projectIds?.length
        ? projectIds
        : pendingClearProjectIds?.length
          ? pendingClearProjectIds
          : [...pickedProjectIdsRef.current]
    ).filter((id) => id.trim())
    if (!ids.length) {
      setToast(t('toast.clearSkillsNeedSelect'))
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    setBusy(true)
    try {
      if (resolutions.length === 0) {
        const preview = apply(
          await invoke<{
            skillCount?: number
            ruleCount?: number
            leftover?: number
            projects?: Array<{
              projectId: string
              name: string
              skillCount: number
              ruleCount?: number
            }>
          }>('previewClearProjectSkills', { projectIds: ids }),
        )
        const itemCount =
          (preview.data?.skillCount ?? 0) + (preview.data?.ruleCount ?? 0)
        if (!preview.ok) return
        if (itemCount === 0) {
          setToast(t('toast.clearSkillsNone'))
          window.setTimeout(() => setToast(null), 4000)
          return
        }
        const names = (preview.data?.projects ?? [])
          .filter((p) => (p.skillCount ?? 0) + (p.ruleCount ?? 0) > 0)
          .map((p) => p.name)
          .join('、')
        if (!window.confirm(t('confirm.clearSkills', { n: ids.length, k: itemCount, names }))) {
          return
        }
      }
      const res = apply(
        await invoke<{
          conflicts?: PathConflictDto[]
          moved?: number
          leftover?: number
        }>('clearProjectSkills', { projectIds: ids, resolutions }),
      )
      const nextConflicts = res.data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setPendingClearProjectIds(ids)
        setConflictOp('clearContainer')
        setConflicts(nextConflicts)
        return
      }
      setPendingClearProjectIds(null)
      setConflicts(null)
      setConflictOp(null)
      const moved = res.data?.moved ?? 0
      const leftover = res.data?.leftover ?? 0
      setToast(
        leftover > 0
          ? t('toast.clearSkillsLeftover', { k: moved, r: leftover })
          : t('toast.clearSkillsDone', { k: moved, n: ids.length }),
      )
      window.setTimeout(() => setToast(null), 5000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const submitConflictResolutions = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }>,
  ) => {
    if (conflictOp === 'clearContainer') {
      await submitClearProjectSkills(resolutions, pendingClearProjectIds ?? undefined)
      return
    }
    if (conflictOp === 'promoteFromNetwork') {
      if (busy) return
      const ids = pendingPromoteIds?.length
        ? pendingPromoteIds
        : (snap?.selectedEntryIds ?? []).filter((id) => id.startsWith('net:'))
      if (!ids.length) {
        setConflicts(null)
        setConflictOp(null)
        setPendingPromoteIds(null)
        return
      }
      setBusy(true)
      try {
        const res = apply(
          await invoke<{
            ok: boolean
            message?: string
            conflicts?: PathConflictDto[]
            promoted?: number
          }>('promoteNetworkToLibrary', { entryIds: ids, resolutions }),
        )
        const data = res.data as
          | { conflicts?: PathConflictDto[]; promoted?: number; message?: string }
          | undefined
        const nextConflicts = data?.conflicts ?? []
        if (nextConflicts.length > 0) {
          setConflictOp('promoteFromNetwork')
          setConflicts(nextConflicts)
          setToast(res.message || t('toast.stillConflicts'))
          window.setTimeout(() => setToast(null), 4000)
          return
        }
        setConflicts(null)
        setConflictOp(null)
        setPendingPromoteIds(null)
        setToast(res.message || t('toast.promotedN', { n: data?.promoted ?? 0 }))
        window.setTimeout(() => setToast(null), 4000)
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      } finally {
        setBusy(false)
      }
      return
    }
    if (conflictOp === 'moveIntoBackup') {
      await submitMoveIntoBackup(resolutions)
      return
    }
    if (conflictOp === 'withdraw') {
      await submitWithdraw(resolutions)
      return
    }
    if (conflictOp === 'refresh') {
      if (busy) return
      setBusy(true)
      try {
        const pathByKey = new Map(
          (conflicts ?? []).map((c) => [
            c.key,
            (c.sourceComparePath || c.sourcePath || '').trim(),
          ]),
        )
        const res = apply(
          await invoke<{
            merged?: number
            overwritten?: number
            savedAs?: number
            skipped?: number
            failed?: number
            errors?: string[]
          }>('applyRefreshConflicts', {
            resolutions: resolutions.map((r) => ({
              ...r,
              sourcePath: pathByKey.get(r.key),
            })),
          }),
        )
        const failed = res.data?.failed ?? 0
        if (failed > 0) {
          const detail = (res.data?.errors ?? []).slice(0, 3).join('；')
          setToast(
            detail
              ? t('toast.refreshConflictFailDetail', { n: failed, detail })
              : t('toast.refreshConflictFail', { n: failed }),
          )
          window.setTimeout(() => setToast(null), 8000)
          // 不关窗，避免假成功；快照已刷新，用户可改选后重试
          return
        }
        // 磁盘已按决议同步：强制重载受影响 Markdown 页签（含脏页），避免「保留永久库」后编辑器仍显示旧正文
        const choice = String(resolutions[0]?.choice || '').toLowerCase()
        const winnerSide: MdPathSide | null =
          choice === 'merge' ? 'library' : choice === 'overwrite' ? 'container' : null
        const affected = [
          ...new Set(
            resolutions
              .map((r) => String(r.key || '').replace(/^refresh:/i, '').trim())
              .filter(Boolean),
          ),
        ]
        const activeEntryId =
          openMdTabsRef.current.find((t) => t.tabId === activeMdTabId)?.entryId ??
          snap?.selectedEntryIds?.[0] ??
          null
        const stillOpen = new Set(
          openMdTabsRef.current.filter((t) => t.kind === 'edit').map((t) => t.tabId),
        )
        for (const entryId of affected) {
          const tabs = openMdTabsRef.current.filter(
            (t) => t.entryId === entryId && t.kind === 'edit',
          )
          for (const tab of tabs) {
            try {
              const sel = await runSelect([entryId], tab.pathSide)
              const text = sel?.detailMarkdownText ?? ''
              const filePath = sel?.detailMarkdownFilePath || tab.filePath
              setTabDirty(tab.tabId, false)
              setOpenMdTabs((prev) =>
                prev.map((t) =>
                  t.tabId === tab.tabId
                    ? {
                        ...t,
                        initialFullText: text,
                        filePath,
                        remountKey: (t.remountKey ?? 0) + 1,
                        lastActiveAt: Date.now(),
                      }
                    : t,
                ),
              )
            } catch {
              // 重载失败则关闭该页签，避免脏缓存误导
              stillOpen.delete(tab.tabId)
              setTabDirty(tab.tabId, false)
              setOpenMdTabs((prev) => prev.filter((t) => t.tabId !== tab.tabId))
            }
          }
        }
        // 保留永久库 / 保留容器：若胜者侧页签已打开，激活它（不强制新开）
        if (winnerSide) {
          const winnerTabIds = affected
            .map((id) => makeEditTabId(id, winnerSide))
            .filter((tabId) => stillOpen.has(tabId))
          const preferred =
            (activeEntryId
              ? winnerTabIds.find((tabId) => tabId === makeEditTabId(activeEntryId, winnerSide))
              : undefined) ?? winnerTabIds[0]
          if (preferred) {
            activateMdTab(preferred)
          }
        }
        setConflicts(null)
        setConflictOp(null)
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      } finally {
        setBusy(false)
      }
    }
  }

  /** 左侧栏：选文件夹 → 磁盘建 .cursor → 置顶登记（无名称/分类表单） */
  const openAddContainer = async () => {
    if (busy) return
    setBusy(true)
    try {
      const pick = await invoke<{ path: string | null }>('pickFolder', {
        title: t('dialog.pickProjectRootPin'),
      })
      const rootPath = pick.data?.path?.trim()
      if (!rootPath) return
      apply(
        await invoke('createProjectContainer', {
          rootPath,
          name: rootPath.split(/[/\\]/).filter(Boolean).pop() || '',
        }),
      )
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const openEditProject = (id?: string | null) => {
    const pid = id ?? snap?.selectedProjectId
    const p = snap?.projects.find((x) => x.id === pid)
    if (!p) return
    setProjectForm({ name: p.name, rootPath: p.rootPath, category: p.category, id: p.id })
    setProjectDialog('edit')
  }

  /**
   * 删除项目（与侧栏开眼/隐藏池分组无关）。
   * 无文件：删空标记目录并去登记；有文件：确认强制删除，或打开 .cursor 手动处理。
   * 迁入永久库请用主区空白右键菜单。
   */
  const openRemoveProject = async (projectId: string) => {
    if (busy) return
    setBusy(true)
    try {
      const insp = apply(
        await invoke<{
          projectName: string
          rootPath: string
          cursorPath: string
          cursorExists: boolean
          fileCount: number
          managedCount: number
        }>('inspectProjectForDelete', { id: projectId }),
      )
      if (!insp.ok || !insp.data) return

      const { projectName, fileCount, cursorExists } = insp.data
      if (!cursorExists || fileCount === 0) {
        const ok = window.confirm(
          t('confirm.removeProject', {
            name: projectName,
            cursor: cursorExists ? t('confirm.removeProjectCursor') : '',
          }),
        )
        if (!ok) return
        apply(
          await invoke('removeProject', {
            id: projectId,
            purgeEmptyMarkers: true,
          }),
        )
        return
      }

      setRemoveDialog({
        projectId,
        projectName,
        fileCount,
      })
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const openTags = () => {
    const id = snap?.selectedEntryIds[0]
    const all = snap
      ? [
          ...(snap.visibleContainerSections ?? []).flatMap((s) => [
            ...(s.inContainerItems ?? []),
          ]),
          ...snap.inContainerItems,
          ...snap.inLibraryOtherItems,
          ...snap.missingItems,
        ]
      : []
    const item = id ? all.find((x) => x.entryId === id) : undefined
    setTagScope(item?.scopeKey?.trim() || 'global')
    // purposes 存在 searchText/groupName 中不便反查；打开时留空或从 subtitle 不解析，用当前输入
    setTagPurposes('')
    setTagDialog(true)
  }

  const openSuggestPurposes = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{
          suggestions: SuggestedPurposeDto[]
          alreadyTagged: number
          noSuggestion: number
        }>('previewSuggestedPurposes'),
      )
      if (!res.ok || !res.data) return
      if ((res.data.suggestions?.length ?? 0) === 0) {
        setToast(res.message || t('toast.noSuggestions'))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setSuggestDialog(res.data)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const showMenu = (e: ReactMouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    e.stopPropagation()
    setCtx({ x: e.clientX, y: e.clientY, items })
  }

  // H5 性能：搜索输入即时受控，生效查询防抖后才触发过滤（快速连击只过滤一次）
  useEffect(() => {
    const t = window.setTimeout(() => setSearchQuery(searchInput), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    if (!kindsOpen) return
    const onDoc = (e: MouseEvent) => {
      const node = e.target as Node
      if (!kindsMenuRef.current?.contains(node)) setKindsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setKindsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [kindsOpen])

  // H5 性能：过滤与聚类树裁剪只在快照 / 生效查询 / 网络侧栏选中变化时重算；
  // 其它 state（toast/busy/右键菜单等）变化不再触发全库字符串匹配
  const filteredView = useMemo(() => {
    if (!snap) return null
    const t0 = import.meta.env.DEV ? performance.now() : 0
    const q = searchQuery.trim().toLowerCase()
    const filterItems = (items: LibraryListItemDto[], origin: FunnelOrigin) => {
      if (!q) return items
      const rows = annotateItemsCached(funnelAnnotateCacheRef.current, items, origin)
      const extra = new Map<string, string>()
      for (const row of rows) extra.set(row.entryId, row.funnelSearchHay)
      return filterItemsByQuery(items, q, extra)
    }
    const focusWsName =
      snap.focusWorkspaceDisplayName?.trim() ||
      snap.workspaces?.find((w) => w.id === (snap.selectedGlobalTool ?? 'cursor'))?.displayName ||
      'Cursor'
    const containerSections: WorkspaceContainerSectionDto[] =
      snap.visibleContainerSections && snap.visibleContainerSections.length > 0
        ? snap.visibleContainerSections
        : [
            {
              workspaceId: snap.selectedGlobalTool ?? 'cursor',
              displayName: focusWsName,
              containerRootDisplay: snap.activeContainerPathDisplay || '',
              isFocused: true,
              inContainerItems: snap.inContainerItems,
              inContainerHeader: t('list.inContainer', { name: focusWsName }),
              inContainerSummary: snap.inContainerSummary,
              historyItems: [],
              historyHeader: '',
              historySummary: '0',
            },
          ]
    const filteredSections = containerSections.map((sec) => ({
      ...sec,
      inContainerItems: filterItems(sec.inContainerItems ?? [], 'library'),
    }))
    const filteredMissing = filterItems(snap.missingItems, 'library')
    const filteredOther = filterItems(snap.inLibraryOtherItems, 'library')
    const popularNav = snap.networkPopularNav ?? []
    const openEyeIds = openEyeSourceIds(popularNav)
    const matchNetworkNav = (item: LibraryListItemDto) => {
      const picked =
        networkNavPickedIds.size > 0
          ? networkNavPickedIds
          : networkNavSel
            ? new Set([networkNavSel.id])
            : new Set<string>()
      return itemInStandbyLibrary(item, openEyeIds, picked, popularNav)
    }
    const skipNetScan = navShelf === 'local'
    const filteredNetwork = skipNetScan
      ? []
      : filterItems(snap.networkLibraryItems ?? [], 'network').filter(matchNetworkNav)
    const filteredOtherIds = new Set(filteredOther.map((x) => x.entryId))
    const filteredRoots = filterClusterTreeByIds(snap.permanentLibraryRoots, q, filteredOtherIds)

    if (import.meta.env.DEV) {
      console.debug(`[ccm-perf] filter ${(performance.now() - t0).toFixed(1)}ms`)
    }
    return {
      q,
      focusWsName,
      containerSections,
      filteredSections,
      filteredMissing,
      filteredOther,
      filteredNetwork,
      filteredRoots,
    }
  }, [
    snap,
    searchQuery,
    networkNavSel,
    networkNavPickedIds,
    navShelf,
    locale,
  ])

  useEffect(() => {
    if (navShelf !== 'local') return
    const items = snap?.networkLibraryItems
    if (!items?.length) return
    const cache = funnelAnnotateCacheRef.current
    let i = 0
    let cancelIdle: (() => void) | undefined
    let cancelled = false
    const step = () => {
      if (cancelled) return
      const end = Math.min(i + FUNNEL_PREFETCH_CHUNK, items.length)
      annotateItemsCached(cache, items.slice(i, end), 'network')
      i = end
      if (i < items.length) {
        cancelIdle = scheduleIdle(step)
        return
      }
      const keep = new Set<string>()
      for (const it of items) keep.add(funnelAnnotateKey(it, 'network'))
      pruneAnnotateCache(cache, keep, 'network')
    }
    cancelIdle = scheduleIdle(step)
    return () => {
      cancelled = true
      cancelIdle?.()
    }
  }, [snap?.networkLibraryItems, navShelf])

  useEffect(() => {
    if (!isNetworkLikeShelf(navShelf) || !filteredView) {
      return
    }
    let cancelled = false
    const id = window.requestAnimationFrame(() => {
      if (cancelled) return
      const t0 = import.meta.env.DEV ? performance.now() : 0
      const cache = funnelAnnotateCacheRef.current
      const net = annotateItemsCached(cache, filteredView.filteredNetwork, 'network')
      const netPool = hideMirrors ? hideLocaleMirrors(net) : net
      let pool = netPool
      if (navShelf === 'filter') {
        pool = includeNetwork ? netPool : []
        if (includeLocal) {
          const seen = new Set<string>()
          const locals: LibraryListItemDto[] = []
          const addLocal = (it: LibraryListItemDto) => {
            if (seen.has(it.entryId)) return
            seen.add(it.entryId)
            locals.push(it)
          }
          for (const sec of filteredView.filteredSections) {
            for (const it of sec.inContainerItems ?? []) addLocal(it)
          }
          for (const it of filteredView.filteredOther) addLocal(it)
          pool = [...pool, ...annotateItemsCached(cache, locals, 'library')]
        }
      }
      if (import.meta.env.DEV) {
        ccmPerfSpan(`shelf:${navShelf}`, t0, `n=${pool.length}`)
      }
      setFunnelPool((prev) => {
        if (prev.length === pool.length && prev.every((row, i) => row === pool[i])) {
          return prev
        }
        return pool
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(id)
    }
  }, [navShelf, filteredView, hideMirrors, includeLocal, includeNetwork])

  const personaCounts = useMemo(() => countByPersona(funnelPool), [funnelPool])
  const personaSubCounts = useMemo(() => {
    if (!persona || persona === 'unclassified') {
      return { [OTHER_ID]: 0 } as Record<string, number> & { [OTHER_ID]: number }
    }
    return countByPersonaSub(funnelPool, persona)
  }, [funnelPool, persona])
  const personaCount = persona ? (personaCounts[persona] ?? 0) : 0
  const visibleSubCount =
    persona && persona !== 'unclassified' ? visiblePersonaSubCount(personaSubCounts) : 0
  const skipPersonaSub =
    !persona ||
    persona === 'unclassified' ||
    personaCount <= FUNNEL_LIST_MAX ||
    visibleSubCount === 0
  const showPersonaSubRow = Boolean(
    persona &&
      persona !== 'unclassified' &&
      personaCount > FUNNEL_LIST_MAX &&
      visibleSubCount > 0,
  )
  const subCount = personaSub ? (personaSubCounts[personaSub] ?? 0) : 0
  const showPhraseRow = Boolean(
    persona &&
      persona !== 'unclassified' &&
      (personaSub != null || skipPersonaSub) &&
      personaSub !== OTHER_ID &&
      (personaSub ? subCount > FUNNEL_LIST_MAX : personaCount > FUNNEL_LIST_MAX),
  )

  const funnelFiltered = useMemo(() => {
    const phrasePath = phrase ? [phrase] : []
    return funnelPool.filter((it) =>
      itemMatchesPersonaFilter(it, persona, phrasePath, personaSub),
    )
  }, [funnelPool, persona, personaSub, phrase])

  const [refineVisual, setRefineVisual] = useState<{
    pool: FunnelListItem[]
    persona: PersonaId | null
    personaSub: PersonaSubFilter | null
    phrase: string | null
    pathKey: string
    matched: FunnelListItem[] | null
    nextChips: PartitionChip[]
    nextAssignment: Map<string, string>
    refineRows: RefineRowVisual[]
  }>({
    pool: [],
    persona: null,
    personaSub: null,
    phrase: null,
    pathKey: '',
    matched: null,
    nextChips: [],
    nextAssignment: EMPTY_REFINE_ASSIGN,
    refineRows: [],
  })

  useEffect(() => {
    const pathKey = refinePathKey(refinePath)
    const needRefine = funnelNeedsRefinePass(persona, refinePath.length)
    if (!needRefine) {
      setRefineVisual((prev) =>
        prev.nextChips.length === 0 &&
        prev.refineRows.length === 0 &&
        prev.matched == null &&
        prev.nextAssignment.size === 0
          ? prev
          : {
              pool: funnelPool,
              persona,
              personaSub,
              phrase,
              pathKey,
              matched: null,
              nextChips: [],
              nextAssignment: EMPTY_REFINE_ASSIGN,
              refineRows: [],
            },
      )
      return
    }
    let cancelled = false
    const cancelIdle = scheduleIdle(() => {
      if (cancelled) return
      const t0 = performance.now()
      const phrasePath = phrase ? [phrase] : []
      const exclude = new Set<string>(phrasePath)
      const baseFiltered = funnelPool.filter((it) =>
        itemMatchesPersonaFilter(it, persona, phrasePath, personaSub),
      )
      const sameBase =
        refineVisual.pool === funnelPool &&
        refineVisual.persona === persona &&
        refineVisual.personaSub === personaSub &&
        refineVisual.phrase === phrase
      const visSteps = refineVisual.pathKey ? refineVisual.pathKey.split('\0') : []
      const want = refinePath.map((s) => s.id)
      const canAppend =
        sameBase &&
        want.length === visSteps.length + 1 &&
        visSteps.every((id, i) => id === want[i]) &&
        refineVisual.nextAssignment.size > 0

      let cur: FunnelListItem[]
      let refineRows: RefineRowVisual[]
      if (canAppend) {
        const last = refinePath[refinePath.length - 1]
        cur = filterByAssignment(
          refineVisual.matched ?? baseFiltered,
          refineVisual.nextAssignment,
          last.id,
        )
        refineRows = [
          ...refineVisual.refineRows,
          {
            chips: refineVisual.nextChips,
            selected: last,
            assignment: refineVisual.nextAssignment,
          },
        ]
        for (const step of refinePath) exclude.add(step.id)
      } else {
        cur = baseFiltered
        refineRows = []
        for (const step of refinePath) {
          const part = partitionRefineResult(cur, exclude)
          refineRows.push({ chips: part.chips, selected: step, assignment: part.assignment })
          cur = filterByAssignment(cur, part.assignment, step.id)
          exclude.add(step.id)
        }
      }
      const nextAll = partitionRefineResult(cur, exclude)
      const nextChips = splittingChips(nextAll.chips, cur.length)
      if (import.meta.env.DEV) {
        ccmPerfSpan(
          'partitionRefine',
          t0,
          `n=${cur.length} persona=${persona ?? 'none'} skip=false deferred=1 append=${canAppend ? 1 : 0}`,
        )
      }
      if (!cancelled) {
        setRefineVisual({
          pool: funnelPool,
          persona,
          personaSub,
          phrase,
          pathKey,
          matched: refinePath.length > 0 ? cur : null,
          nextChips,
          nextAssignment: nextAll.assignment,
          refineRows,
        })
      }
    })
    return () => {
      cancelled = true
      cancelIdle()
    }
  }, [funnelPool, persona, personaSub, phrase, refinePath])

  const refineBaseReady =
    refineVisual.pool === funnelPool &&
    refineVisual.persona === persona &&
    refineVisual.personaSub === personaSub &&
    refineVisual.phrase === phrase
  const refineReady = refineBaseReady && refineVisual.pathKey === refinePathKey(refinePath)
  const funnelItems =
    refinePath.length === 0
      ? funnelFiltered
      : refineReady && refineVisual.matched
        ? refineVisual.matched
        : refineBaseReady
          ? applyRefineAssignments(
              funnelFiltered,
              refinePath,
              refineVisual.refineRows,
              refineVisual.nextAssignment,
            )
          : funnelFiltered
  const chipOverlay = refineBaseReady
    ? overlayFunnelChips(refinePath, refineVisual, refineReady)
    : { refineRows: [] as { chips: PartitionChip[]; selected: RefineStep }[], nextChips: [] as PartitionChip[] }
  const funnelMatch = {
    matched: funnelItems,
    pendingCount: funnelItems.length,
    nextChips: chipOverlay.nextChips,
    refineRows: chipOverlay.refineRows,
  }

  const phraseRanked = useMemo(
    () =>
      persona && persona !== 'unclassified'
        ? countPhrases(
            funnelPool,
            persona as ClassifiedPersona,
            skipPersonaSub && !personaSub ? null : personaSub,
          )
        : [],
    [funnelPool, persona, personaSub, skipPersonaSub],
  )

  // H7 性能：选中集 memo 化 + 稳定引用回调（ref 转发到每帧最新实现），
  // 使 memo 化的 ItemSection/ClusterSection 在无关 state 变化（搜索键入、toast、tick 等）时跳过重渲。
  const selected = useMemo(
    () => new Set(snap?.selectedEntryIds ?? []),
    [snap?.selectedEntryIds],
  )
  const toggleSelectRef = useRef<
    (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') => void
  >(() => {})
  const onSelectEntry = useCallback(
    (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') =>
      toggleSelectRef.current(id, multi, shift, pathSide),
    [],
  )
  const openEntryMenuRef = useRef<
    (e: ReactMouseEvent, id: string, zone: 'container' | 'library' | 'missing') => void
  >(() => {})
  const onContextMissing = useCallback(
    (e: ReactMouseEvent, id: string) => openEntryMenuRef.current(e, id, 'missing'),
    [],
  )
  const onContextLibrary = useCallback(
    (e: ReactMouseEvent, id: string) => openEntryMenuRef.current(e, id, 'library'),
    [],
  )
  const runRef = useRef(run)
  runRef.current = run
  const moveRegionRef = useRef<(regionKey: string, entryIds: string[]) => Promise<void>>(
    async () => {},
  )
  const onDropRegionStable = useCallback((regionKey: string, entryIds: string[]) => {
    void moveRegionRef.current(regionKey, entryIds)
  }, [])
  const onDropLevelStable = useCallback((level: string, entryIds: string[]) => {
    void runRef.current('setEntryLevel', { level, entryIds })
  }, [])
  const onReorderEntryStable = useCallback(
    (entryId: string, regionKey: string, toIndex: number) => {
      void runRef.current('reorderLibraryEntry', { entryId, regionKey, toIndex })
    },
    [],
  )
  const onOpenPathStable = useCallback((path: string) => {
    void runRef.current('openPath', { path })
  }, [])
  const purgeMissingRef = useRef<(entryIds?: string[]) => Promise<void>>(async () => {})
  const missingEmpty = (filteredView?.filteredMissing.length ?? 0) === 0
  const missingHeaderExtra = useMemo(
    () => (
      <button
        type="button"
        className="section-header-btn"
        disabled={busy || missingEmpty}
        title={t('list.purgeMissingTitle')}
        onClick={(e) => {
          e.stopPropagation()
          void purgeMissingRef.current()
        }}
      >
        {t('menu.purgeMissing')}
      </button>
    ),
    [busy, missingEmpty, locale],
  )

  const localUpperItems = useMemo(() => {
    if (navShelf !== 'local' || !filteredView) return [] as FunnelListItem[]
    return annotateItemsCached(
      funnelAnnotateCacheRef.current,
      filteredView.filteredSections.flatMap((s) => s.inContainerItems ?? []),
      'library',
    )
  }, [navShelf, filteredView])

  const libraryAnnotated = useMemo(() => {
    if (!filteredView) return [] as FunnelListItem[]
    return annotateItemsCached(
      funnelAnnotateCacheRef.current,
      filteredView.filteredOther,
      'library',
    )
  }, [filteredView])

  const networkCount = useMemo(() => {
    const items = snap?.networkLibraryItems ?? []
    if (!hideMirrors) return items.length
    const t0 = import.meta.env.DEV ? performance.now() : 0
    const n = hideLocaleMirrors(items).length
    if (import.meta.env.DEV) {
      ccmPerfSpan('hideMirrors:status', t0, `n=${items.length}`)
    }
    return n
  }, [snap?.networkLibraryItems, hideMirrors])

  const networkBrowseItems = useMemo(
    () => funnelPool.filter((it) => it.funnelOrigin === 'network'),
    [funnelPool],
  )

  const funnelOriginById = useMemo(() => {
    const m = new Map<string, FunnelOrigin>()
    for (const it of funnelPool) m.set(it.entryId, it.funnelOrigin)
    return m
  }, [funnelPool])

  if (loadError) {
    return (
      <div className="app">
        <div className="toolbar" data-tauri-drag-region>
          <span className="spacer" />
          <WindowControls maximized={maximized} setMaximized={setMaximized} />
        </div>
        <div className="empty" style={{ padding: 24 }}>
          <p>{loadError}</p>
          <button type="button" onClick={() => void refresh()}>
            {t('load.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (!snap) {
    return (
      <div className="app">
        <div className="toolbar" data-tauri-drag-region>
          <span className="spacer" />
          <WindowControls maximized={maximized} setMaximized={setMaximized} />
        </div>
        <div className="empty">{t('toolbar.processing')}</div>
      </div>
    )
  }

  const promoteSelectedFromNetwork = async (
    forceSecurityOverride = false,
    entryIdsOverride?: string[],
  ) => {
    if (busy || !snap) return
    const ids = (entryIdsOverride ?? snap.selectedEntryIds).filter((id) =>
      id.startsWith('net:'),
    )
    if (ids.length === 0) {
      setToast(t('toast.pickNetworkItems'))
      window.setTimeout(() => setToast(null), 3000)
      return
    }
    setBusy(true)
    try {
      await run('ensureDefaultNetworkLibrary')
      const res = apply(
        await invoke<{
          ok: boolean
          message?: string
          conflicts?: PathConflictDto[]
          promoted?: number
          blocked?: boolean
        }>('promoteNetworkToLibrary', {
          entryIds: ids,
          resolutions: [],
          forceSecurityOverride,
        }),
      )
      const data = res.data as
        | { conflicts?: PathConflictDto[]; promoted?: number; blocked?: boolean }
        | undefined
      if (data?.blocked && !forceSecurityOverride) {
        const ok = window.confirm(
          t('confirm.forcePromote', { msg: res.message || t('toast.securityBlock') }),
        )
        if (ok) {
          setBusy(false)
          await promoteSelectedFromNetwork(true, ids)
          return
        }
        setToast(res.message || t('toast.promoteBlocked'))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      const nextConflicts = data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setPendingPromoteIds(ids)
        setConflictOp('promoteFromNetwork')
        setConflicts(nextConflicts)
        setToast(res.message || t('toast.nameConflict'))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setToast(res.message || t('toast.promotedLocalN', { n: data?.promoted ?? 0 }))
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const beginNetworkFetch = async (args: NetworkFetchRequest) => {
    const presumedSourceId = presumedFetchSourceId(args)
    if (presumedSourceId && networkFetchHasSource(networkFetchRef.current, presumedSourceId)) {
      setToast(t('toast.sourceFetching', { id: presumedSourceId }))
      window.setTimeout(() => setToast(null), 3000)
      setFetchModalOpen(true)
      return
    }
    try {
      await run('ensureDefaultNetworkLibrary')
      const res = await invoke<StartNetworkFetchResult>('startNetworkFetch', {
        kind: args.kind,
        id: args.id,
        urlOrBaselineId: args.urlOrBaselineId,
        label: args.label,
      })
      if (!res.ok) {
        setToast(res.message || t('toast.cannotStartFetch'))
        window.setTimeout(() => setToast(null), 6000)
        return
      }
      const data = res.data as StartNetworkFetchResult | undefined
      const jobId = String(data?.jobId ?? '').trim()
      const sourceId = String(data?.sourceId ?? presumedSourceId).trim()
      if (!jobId) {
        setToast(t('toast.noJobId'))
        window.setTimeout(() => setToast(null), 6000)
        return
      }
      if (!sourceId) {
        setToast(t('toast.noSourceId'))
        window.setTimeout(() => setToast(null), 6000)
        return
      }
      if (networkFetchHasSource(networkFetchRef.current, sourceId)) {
        setToast(t('toast.sourceFetching', { id: sourceId }))
        window.setTimeout(() => setToast(null), 3000)
        return
      }
      setNetworkFetchErrors((prev) => {
        if (!prev.has(sourceId)) return prev
        const next = new Map(prev)
        next.delete(sourceId)
        return next
      })
      setNetworkFetch((prev) => {
        const next = new Map(prev)
        next.set(jobId, {
          jobId,
          sourceId,
          phase: 'prepare',
          detail: t('toast.fetchStarted', { id: sourceId }),
          stalled: false,
          startedAt: Date.now(),
          modalOpen: true,
          cancelling: false,
        })
        networkFetchRef.current = next
        return next
      })
      setFetchModalOpen(true)
      if (isBrowserPreview()) {
        setToast(res.message || t('toast.previewNoFetch'))
        window.setTimeout(() => setToast(null), 4000)
        setNetworkFetch((prev) => {
          const next = new Map(prev)
          next.delete(jobId)
          return next
        })
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 6000)
    }
  }

  const cancelNetworkFetchJob = async (jobId: string) => {
    const job = networkFetchRef.current.get(jobId)
    if (!job) return
    setNetworkFetch((prev) => {
      const cur = prev.get(jobId)
      if (!cur) return prev
      const next = new Map(prev)
      next.set(jobId, { ...cur, cancelling: true })
      return next
    })
    try {
      await invoke('cancelNetworkFetch', { jobId })
      setToast(t('toast.stoppingFetch', { id: job.sourceId }))
      window.setTimeout(() => setToast(null), 3000)
    } catch (e) {
      setNetworkFetch((prev) => {
        const cur = prev.get(jobId)
        if (!cur) return prev
        const next = new Map(prev)
        next.set(jobId, { ...cur, cancelling: false })
        return next
      })
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    }
  }

  const handleReapplyHints = async (
    hints: Array<{
      entryId?: string
      networkEntryId?: string
      message?: string
      skillName?: string
    }>,
  ) => {
    for (const h of hints) {
      const entryId = String(h.entryId ?? '')
      const networkEntryId = String(h.networkEntryId ?? '')
      if (!entryId || !networkEntryId) continue
      const choice = window.prompt(
        t('confirm.reapplyPrompt', { head: h.message || h.skillName || entryId }),
        'skip',
      )
      const mode = (choice || 'skip').trim().toLowerCase()
      if (mode !== 'reapply' && mode !== 'overwrite' && mode !== 'skip') continue
      try {
        const res = apply(
          await invoke('reapplyNetworkCustomization', {
            entryId,
            networkEntryId,
            mode,
          }),
        )
        setToast(res.message || t('toast.handled', { id: entryId }))
        window.setTimeout(() => setToast(null), 3000)
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      }
    }
  }

  const applyNetworkCacheUpdates = async () => {
    if (busy) return
    const ok = window.confirm(
      t('confirm.overwriteNetCache'),
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{
          reapplyHints?: Array<{
            entryId?: string
            networkEntryId?: string
            message?: string
            skillName?: string
          }>
        }>('applyNetworkCacheUpdate', { sourceIds: [] }),
      )
      setToast(res.message || t('toast.cacheUpdated'))
      window.setTimeout(() => setToast(null), 4000)
      const hints = (res.data as { reapplyHints?: Array<{ entryId?: string }> } | undefined)
        ?.reapplyHints
      if (Array.isArray(hints) && hints.length > 0) {
        setBusy(false)
        await handleReapplyHints(hints)
        return
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  /** 只更新单个源的网络缓存；更新后如有定制 diff 走重放提示 */
  const applyNetworkCacheUpdateForSource = async (sourceId: string) => {
    if (busy || !sourceId) return
    const ok = window.confirm(
      t('confirm.updateSourceCache', { id: sourceId }),
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{
          reapplyHints?: Array<{
            entryId?: string
            networkEntryId?: string
            message?: string
            skillName?: string
          }>
        }>('applyNetworkCacheUpdate', { sourceIds: [sourceId] }),
      )
      setToast(res.message || t('toast.sourceCacheUpdated', { id: sourceId }))
      window.setTimeout(() => setToast(null), 4000)
      const hints = (res.data as { reapplyHints?: Array<{ entryId?: string }> } | undefined)
        ?.reapplyHints
      if (Array.isArray(hints) && hints.length > 0) {
        setBusy(false)
        await handleReapplyHints(hints)
        return
      }
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  /** 打开「定制与操作记录」对话框（接受本地条目 id 或 net: 网络条目 id） */
  const openEntryOpsLog = async (entryId: string) => {
    if (!entryId.trim()) return
    try {
      const res = apply(await invoke<EntryOperationLogDto>('getEntryOperationLog', { entryId }))
      if (res.ok === false) {
        setToast(res.message || t('toast.cannotReadOps'))
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setOpsLog((res.data as EntryOperationLogDto) ?? null)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    }
  }

  const commitFetchQueue = (next: NetworkFetchRequest[]) => {
    fetchQueueRef.current = next
    setFetchQueue(next)
  }

  const enqueueNetworkFetch = (args: NetworkFetchRequest) => {
    const key = fetchRequestKey(args)
    if (key && networkFetchHasSource(networkFetchRef.current, presumedFetchSourceId(args) || key)) {
      setToast(t('toast.sourceFetching', { id: presumedFetchSourceId(args) || key }))
      window.setTimeout(() => setToast(null), 3000)
      setFetchModalOpen(true)
      pumpFetchUncachedRef.current()
      return
    }
    if (key && fetchQueueHasKey(fetchQueueRef.current, key)) {
      setFetchModalOpen(true)
      pumpFetchUncachedRef.current()
      return
    }
    commitFetchQueue([...fetchQueueRef.current, args])
    setFetchModalOpen(true)
    pumpFetchUncachedRef.current()
  }

  const dequeueNetworkFetch = (key: string) => {
    const k = key.trim().toLowerCase()
    if (!k) return
    commitFetchQueue(fetchQueueRef.current.filter((q) => fetchRequestKey(q) !== k))
  }

  const pumpFetchUncachedQueue = async () => {
    if (fetchPumpingRef.current) return
    fetchPumpingRef.current = true
    try {
      while (fetchQueueRef.current.length > 0) {
        if (networkFetchRef.current.size >= fetchConcurrencyRef.current) return
        const item = fetchQueueRef.current[0]
        if (!item) break
        commitFetchQueue(fetchQueueRef.current.slice(1))
        const sid = presumedFetchSourceId(item)
        if (sid && networkFetchHasSource(networkFetchRef.current, sid)) continue
        await beginNetworkFetch(item)
      }
    } finally {
      fetchPumpingRef.current = false
    }
  }
  pumpFetchUncachedRef.current = () => {
    void pumpFetchUncachedQueue()
  }

  const persistFetchConcurrency = (n: number) => {
    const v = clampFetchConcurrency(n)
    fetchConcurrencyRef.current = v
    setFetchConcurrency(v)
    setSnap((prev) =>
      prev && prev.networkFetchConcurrency !== v
        ? { ...prev, networkFetchConcurrency: v }
        : prev,
    )
    pumpFetchUncachedRef.current()
    void invoke('updateAppSettings', { networkFetchConcurrency: v })
      .then((res) => {
        if (res && res.ok === false) {
          setToast(res.message || t('toast.cannotSaveConcurrency'))
          window.setTimeout(() => setToast(null), 4000)
        }
      })
      .catch((e) => {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      })
  }

  const fetchNetworkGitUrl = async (url?: string) => {
    const raw = (url ?? window.prompt(t('prompt.gitUrl')) ?? '').trim()
    if (!raw) return
    enqueueNetworkFetch({ urlOrBaselineId: raw })
  }

  const fetchNetworkNavSource = async (id: string) => {
    enqueueNetworkFetch({ kind: 'popular', id })
  }

  const fetchPickedUncached = () => {
    const nav = snap?.networkPopularNav ?? []
    const picked = [...networkNavPickedIds]
    const targets = picked.filter((id) => {
      const n = nav.find((x) => x.id === id)
      return Boolean(
        n &&
          navSourceNeedsFetch(n) &&
          !networkFetchHasSource(networkFetchRef.current, id) &&
          !fetchQueueHasKey(fetchQueueRef.current, id),
      )
    })
    if (targets.length === 0) {
      setToast(t('toast.allCachedOrNoRepo'))
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    const next = [...fetchQueueRef.current]
    for (const id of targets) {
      if (!fetchQueueHasKey(next, id)) next.push({ kind: 'popular', id })
    }
    commitFetchQueue(next)
    setFetchModalOpen(true)
    void pumpFetchUncachedQueue()
    setToast(
      t('toast.queuedN', { n: targets.length, max: fetchConcurrencyRef.current }),
    )
    window.setTimeout(() => setToast(null), 4000)
  }

  const refreshNetworkSection = (scope: 'official' | 'community') => {
    const nav = snap?.networkPopularNav ?? []
    const ids = networkNavSectionRefreshIds(nav, scope)
    const targets = ids.filter(
      (id) =>
        !networkFetchHasSource(networkFetchRef.current, id) &&
        !fetchQueueHasKey(fetchQueueRef.current, id),
    )
    if (ids.length === 0) {
      setToast(
        scope === 'official' ? t('toast.noOfficialRefresh') : t('toast.noCommunityRefresh'),
      )
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    if (targets.length === 0) {
      setFetchModalOpen(true)
      pumpFetchUncachedRef.current()
      setToast(t('toast.sectionAlreadyQueued'))
      window.setTimeout(() => setToast(null), 3000)
      return
    }
    const next = [...fetchQueueRef.current]
    for (const id of targets) {
      if (!fetchQueueHasKey(next, id)) next.push({ kind: 'popular', id })
    }
    commitFetchQueue(next)
    setFetchModalOpen(true)
    void pumpFetchUncachedQueue()
    setToast(
      t('toast.queuedN', { n: targets.length, max: fetchConcurrencyRef.current }),
    )
    window.setTimeout(() => setToast(null), 4000)
  }

  const onSelectNetworkNav = (id: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const multi = e.ctrlKey || e.metaKey
    if (!multi && !e.shiftKey && networkNavSel?.id === id) {
      setNetworkNavSel(null)
      setNetworkNavPickedIds(new Set())
      networkNavAnchorRef.current = null
      return
    }
    setNetworkNavSel({ kind: 'popular', id })
    const ordered = networkNavVisibleIds(
      snap?.networkPopularNav ?? [],
      Number(snap?.networkPopularVisibleLimit ?? 10),
    )
    if (e.shiftKey) {
      const anchor =
        networkNavAnchorRef.current && ordered.includes(networkNavAnchorRef.current)
          ? networkNavAnchorRef.current
          : id
      const a = ordered.indexOf(anchor)
      const b = ordered.indexOf(id)
      if (a >= 0 && b >= 0) {
        setNetworkNavPickedIds(new Set(ordered.slice(Math.min(a, b), Math.max(a, b) + 1)))
      } else {
        setNetworkNavPickedIds(new Set([id]))
      }
      return
    }
    networkNavAnchorRef.current = id
    if (multi) {
      setNetworkNavPickedIds((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setNetworkNavPickedIds(new Set([id]))
    }
  }

  const ensureNetworkLibrary = () => {
    if (snap?.isNetworkLibraryConfigured) return
    void (async () => {
      try {
        apply(await invoke('ensureDefaultNetworkLibrary'))
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      }
    })()
  }

  const cleanupNetworkCache = async () => {
    if (busy) return
    if (!window.confirm(t('confirm.cleanupCache'))) return
    setBusy(true)
    try {
      const res = apply(await invoke('cleanupNetworkCache', { unusedOnly: true }))
      setToast(res.message || t('toast.cleanupDone'))
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const setNetworkIntendedLevel = async (
    level: '' | 'L0' | 'L1' | 'L2',
    explicitIds?: string[],
  ) => {
    if (busy || !snap) return
    const base = explicitIds?.length ? explicitIds : snap.selectedEntryIds
    const ids = base.filter((id) => id.startsWith('net:'))
    if (!ids.length) return
    setBusy(true)
    try {
      const res = apply(await invoke('setNetworkIntendedLevel', { entryIds: ids, level }))
      setToast(res.message || t('toast.levelWritten'))
      window.setTimeout(() => setToast(null), 3000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const cmd = snap.commands

  // snap 非空时 filteredView 必非空（同一渲染帧内 useMemo 依赖同一个 snap）
  const {
    q,
    focusWsName,
    containerSections,
    filteredSections,
    filteredMissing,
    filteredOther,
    filteredNetwork,
    filteredRoots,
  } = filteredView!
  const phraseVisible = visiblePhraseChips(phraseRanked, phrase, phraseExpanded)
  const upperVisibleCount =
    navShelf === 'network'
      ? networkBrowseItems.length
      : navShelf === 'filter'
        ? funnelItems.length
        : localUpperItems.length
  const upperNetItems =
    navShelf === 'filter'
      ? funnelItems
      : navShelf === 'network'
        ? networkBrowseItems
        : localUpperItems
  const focusedContainerSec =
    filteredSections.find((s) => s.isFocused) ?? filteredSections[0]
  const focusedContainerPath = focusedContainerSec?.containerRootDisplay ?? ''
  const containerCount = containerSections.reduce(
    (n, s) => n + (s.inContainerItems?.length ?? 0),
    0,
  )
  const libraryCount = snap.inLibraryOtherItems.length
  const uniqueLocalIds = new Set<string>()
  for (const sec of containerSections) {
    for (const it of sec.inContainerItems ?? []) uniqueLocalIds.add(it.entryId)
  }
  for (const it of snap.inLibraryOtherItems) uniqueLocalIds.add(it.entryId)
  const uniqueLocalCount = uniqueLocalIds.size
  const funnelOriginOf = (id: string): FunnelOrigin =>
    funnelOriginById.get(id) ?? (id.startsWith('net:') ? 'network' : 'library')
  let selHasLib = false
  let selHasNet = false
  for (const id of snap.selectedEntryIds) {
    if (funnelOriginOf(id) === 'network') selHasNet = true
    else selHasLib = true
  }
  const mixedSel = selHasLib && selHasNet
  const netOnlySel = selHasNet && !selHasLib
  const openEyeCount = openEyeSourceIds(snap.networkPopularNav ?? []).size
  const funnelEmptyHint =
    !includeLocal && !includeNetwork
    ? t('funnel.openLocal')
    : q || persona || personaSub || phrase || refinePath.length > 0
      ? t('funnel.noMatch')
      : openEyeCount === 0
        ? t('net.openEyeFirst')
        : t('funnel.noIndexed')
  /** 列表面板可见顺序（上部随货架 + 下部缺失→永久库），供 Shift 范围选 */
  const panelEntryOrder = (() => {
    const libraryById = new Map(filteredOther.map((x) => [x.entryId, x]))
    const fromTree = (nodes: ClusterNodeDto[]): string[] => {
      const out: string[] = []
      for (const n of orderClusterChildren(nodes, libraryById)) {
        if (n.isGroup) out.push(...fromTree(n.children || []))
        else if (n.entryId) out.push(n.entryId)
      }
      return out
    }
    const libraryIds = [
      ...filteredMissing.map((i) => i.entryId),
      ...fromTree(filteredRoots),
    ]
    const upperIds = sortItemsByLevelBucket(
      navShelf === 'network'
        ? networkBrowseItems
        : navShelf === 'filter'
          ? funnelItems
          : localUpperItems,
    ).map((i) => i.entryId)
    return [...upperIds, ...libraryIds]
  })()

  const toggleSelect = (
    entryId: string,
    multi: boolean,
    shift = false,
    pathSide: 'container' | 'library' = 'library',
  ) => {
    const ordered = panelEntryOrder
    if (shift) {
      const anchor =
        selectionAnchorRef.current && ordered.includes(selectionAnchorRef.current)
          ? selectionAnchorRef.current
          : snap.selectedEntryIds.find((id) => ordered.includes(id)) ?? entryId
      const a = ordered.indexOf(anchor)
      const b = ordered.indexOf(entryId)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const range = ordered.slice(lo, hi + 1)
        const next = multi
          ? [...new Set([...snap.selectedEntryIds, ...range])]
          : range
        const same =
          next.length === snap.selectedEntryIds.length &&
          next.every((id, i) => id === snap.selectedEntryIds[i]) &&
          snap.detailPathSide === pathSide
        if (same) return
        void runSelect(next, pathSide)
        return
      }
    }

    const next = multi
      ? selected.has(entryId)
        ? snap.selectedEntryIds.filter((id) => id !== entryId)
        : [...snap.selectedEntryIds, entryId]
      : [entryId]
    const same =
      next.length === snap.selectedEntryIds.length &&
      next.every((id, i) => id === snap.selectedEntryIds[i]) &&
      (multi || snap.detailPathSide === pathSide)
    if (same) {
      // 页签已关但选中未变：用当前 snapshot 正文重新打开对应侧
      if (!multi && next.length === 1 && snap.detailMarkdownText != null) {
        const entryId = next[0]
        const filePath = snap.detailMarkdownFilePath || ''
        const fileName =
          filePath.replace(/\//g, '\\').split('\\').pop() ||
          entryId.split('-').slice(-1)[0] ||
          entryId
        const tabId = makeEditTabId(entryId, pathSide)
        if (!openMdTabsRef.current.some((t) => t.tabId === tabId)) {
          const { tabs, blocked } = openOrActivateMdTab(
            openMdTabsRef.current,
            {
              tabId,
              kind: 'edit',
              entryId,
              filePath,
              title: formatEditTabTitle(fileName, pathSide),
              initialFullText: snap.detailMarkdownText,
              editable: Boolean(snap.commands.canSaveDetailMarkdown),
              pathSide,
            },
            mdDirtyByIdRef.current,
          )
          if (blocked) {
            setToast(t('toast.mdTabMax', { n: MD_TAB_MAX }))
            window.setTimeout(() => setToast(null), 4000)
          } else {
            setOpenMdTabs(tabs)
            setActiveMdTabId(tabId)
          }
        } else {
          setActiveMdTabId(tabId)
        }
      }
      return
    }
    selectionAnchorRef.current = entryId
    void runSelect(next, pathSide)
  }
  toggleSelectRef.current = toggleSelect

  /** 本地乐观选中 + setSelectionLight 会话同步：不构建快照、不动右侧面板。 */
  const applyLocalSelection = (next: string[]) => {
    suppressTabOpenRef.current = true
    setSnap((prev) =>
      prev
        ? {
            ...prev,
            selectedEntryIds: next,
            selectionSummary:
              next.length === 0 ? '' : next.length === 1 ? next[0] : t('status.selected', { n: next.length }),
          }
        : prev,
    )
    const seq = ++selectionLightSeqRef.current
    void invoke('setSelectionLight', { entryIds: next }).catch((e) => {
      if (seq !== selectionLightSeqRef.current) return
      setToast(e instanceof Error ? e.message : String(e))
    })
  }

  /** 网络列表点行/勾选框：只勾选（轻路径），打开文档走 openNetworkDoc。 */
  const toggleNetworkCheck = (entryId: string, multi: boolean, shift = false) => {
    const ordered = panelEntryOrder
    let next: string[]
    if (shift) {
      const anchor =
        selectionAnchorRef.current && ordered.includes(selectionAnchorRef.current)
          ? selectionAnchorRef.current
          : snap.selectedEntryIds.find((id) => ordered.includes(id)) ?? entryId
      const a = ordered.indexOf(anchor)
      const b = ordered.indexOf(entryId)
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        const range = ordered.slice(lo, hi + 1)
        next = multi ? [...new Set([...snap.selectedEntryIds, ...range])] : range
      } else {
        next = [entryId]
      }
    } else {
      next = multi
        ? selected.has(entryId)
          ? snap.selectedEntryIds.filter((id) => id !== entryId)
          : [...snap.selectedEntryIds, entryId]
        : [entryId]
      selectionAnchorRef.current = entryId
    }
    const same =
      next.length === snap.selectedEntryIds.length &&
      next.every((id, i) => id === snap.selectedEntryIds[i])
    if (same) return
    if (next.some((id) => funnelOriginOf(id) === 'library') && next.some((id) => funnelOriginOf(id) === 'network')) {
      setToast(t('menu.mixedDeploy'))
      window.setTimeout(() => setToast(null), 4000)
    }
    applyLocalSelection(next)
  }

  /** 网络列表点名称：单选并在右侧以只读 Markdown 打开（不可保存）。 */
  const openNetworkDoc = async (entryId: string) => {
    selectionAnchorRef.current = entryId
    const res = await runSelect([entryId], 'library')
    if (!res) return
    if (res.detailPaneMode !== 'markdown') {
      const modeRes = await run('setDetailMode', { mode: 'markdown' })
      if (!modeRes?.ok) {
        setSnap((prev) => (prev ? { ...prev, detailPaneMode: 'markdown' } : prev))
      }
    }
  }

  const openFunnelDoc = (entryId: string) => {
    const it = funnelItems.find((x) => x.entryId === entryId)
    if (it?.funnelOrigin === 'network' || (!it && entryId.startsWith('net:'))) {
      void openNetworkDoc(entryId)
      return
    }
    toggleSelect(entryId, false, false, it?.isInContainerList ? 'container' : 'library')
  }

  const saveDetailMarkdown = async (
    tabId: string,
    entryId: string,
    fullContent: string,
  ): Promise<boolean> => {
    if (!entryId) return false
    const tab = openMdTabsRef.current.find((t) => t.tabId === tabId)
    if (tab?.pathSide === 'container' || tab?.pathSide === 'library') {
      await runSelect([entryId], tab.pathSide)
    }
    const res = await run('saveDetailMarkdown', { entryId, content: fullContent })
    if (res?.ok) setTabDirty(tabId, false)
    return Boolean(res?.ok)
  }

  const findListItem = (id: string) =>
    containerSections.flatMap((s) => s.inContainerItems).find((x) => x.entryId === id) ||
    snap.inContainerItems.find((x) => x.entryId === id) ||
    snap.inLibraryOtherItems.find((x) => x.entryId === id) ||
    snap.missingItems.find((x) => x.entryId === id) ||
    (snap.networkLibraryItems ?? []).find((x) => x.entryId === id)

  const selectionMeta = (ids: string[]) => {
    const items = ids.map(findListItem).filter(Boolean) as NonNullable<ReturnType<typeof findListItem>>[]
    const levels = new Set(items.map((x) => x.levelKey).filter(Boolean))
    const scopes = new Set(items.map((x) => (x.scopeKey || 'global').trim() || 'global'))
    return {
      level: levels.size === 1 ? ([...levels][0] as 'L0' | 'L1' | 'L2') : null,
      scope: scopes.size === 1 ? [...scopes][0] : null,
    }
  }

  const deployCandidateIds = (): string[] => {
    if ((snap.selectedNavKind || 'global') === 'project') {
      const p = snap.projects.find((x) => x.id === snap.selectedProjectId)
      const tools = p?.visibleTools?.length ? p.visibleTools : ['cursor']
      return tools
    }
    return (snap.visibleWorkspaceIds?.length ? snap.visibleWorkspaceIds : [snap.selectedGlobalTool ?? 'cursor']).slice()
  }

  const runDeploy = (workspaceIds?: string[], entryIds?: string[]) => {
    const ids =
      workspaceIds && workspaceIds.length > 0
        ? workspaceIds
        : [snap.selectedGlobalTool ?? 'cursor']
    void run('deploy', {
      workspaceIds: ids,
      ...(entryIds?.length ? { entryIds } : {}),
    })
  }

  /**
   * 路径契约（防回归）：
   * - openActiveContainer → 活动容器根目录（菜单「打开容器根」）
   * - openPermanentLibrary → 永久库根目录
   * - openLibraryEntry → 台账 libraryPath（永久库「打开台账路径」）
   * - openCurrentDirectory → 容器侧条目目录（技能文件夹 / 规则所在目录；菜单「打开条目目录」）
   */
  type EntryMenuZone = 'container' | 'library' | 'missing'

  /**
   * 右键菜单灰显：按 zone + 目标 ids 本地推导，不依赖「session 已 setSelection」。
   * 避免首次右键 await IPC 前用空选 commands 导致全灰。
   */
  const menuCommandsFor = (zone: EntryMenuZone, ids: string[]): typeof cmd => {
    const configured = Boolean(snap.isLibraryConfigured)
    const ctr = (snap.activeContainerPathDisplay || '').trim()
    const hasContainer = Boolean(ctr) && ctr !== '—' && !ctr.includes('未配置')
    const any = ids.length > 0
    const single = ids.length === 1
    const anyMissing = ids.some((id) => snap.missingItems.some((m) => m.entryId === id))
    return {
      ...cmd,
      canDeploy: configured && hasContainer && any && zone === 'library' && !anyMissing,
      canWithdraw: configured && hasContainer && any && zone === 'container',
      canEditTags: configured && single && zone === 'library',
      canPurgeMissing: configured && (zone === 'missing' || anyMissing),
      canOpenLibraryEntry: configured && single && (zone === 'library' || zone === 'missing'),
      canOpenPermanentLibrary: configured,
      canSetScope: configured && any && zone === 'library',
      canOpenCurrentDirectory: single && zone === 'container',
      canOpenOriginalDirectory: single,
    }
  }

  const containerEntryMenu = (
    entryId: string,
    commands: typeof cmd,
    selectedIds: string[],
  ): MenuItem[] => {
    const ids = selectedIds.length ? selectedIds : [entryId]
    return [
      {
        label: t('menu.withdraw'),
        title: t('menu.withdrawHint'),
        disabled: !commands.canWithdraw,
        onClick: () => void submitWithdraw([], ids),
      },
      {
        label: t('menu.openDir'),
        title: t('menu.openContainerEntryHint'),
        disabled: !entryId,
        onClick: () => void run('openCurrentDirectory', { entryId }),
      },
      {
        label: t('menu.compare'),
        disabled: ids.length !== 1,
        onClick: () => void openDualCompare(entryId),
      },
    ]
  }

  const moveLibraryEntriesToRegion = async (regionKey: string, entryIds: string[]) => {
    const key = regionKey.trim()
    if (!key || entryIds.length === 0) return
    const top = key === 'uncategorized' || key === '未分类' ? '未分类' : key
    if (top === 'L0' || top === 'L1' || top === 'L2' || top === '未分类') {
      await run('setEntryLevel', { level: top, entryIds })
    } else if (key.startsWith('L1/')) {
      const purpose = key.slice('L1/'.length).trim() || '未分类'
      await runSelect(entryIds, 'library')
      await run('setEntryLevel', { level: 'L1', entryIds })
      await run('editTags', { scope: 'global', purposes: [purpose] })
    } else if (key.startsWith('L2/')) {
      await run('setEntryLevel', { level: 'L2', entryIds })
    } else if (key === 'global' || key === 'library') {
      await runSelect(entryIds, 'library')
      await run('setScopeGlobal')
    } else if (key.startsWith('project:')) {
      const projectId = key.slice('project:'.length)
      await runSelect(entryIds, 'library')
      await run('setScopeProject', { projectId })
    }
    const peers = libraryPeersInRegion(key)
    const last = entryIds[entryIds.length - 1]!
    await run('reorderLibraryEntry', {
      entryId: last,
      regionKey: key,
      toIndex: Math.max(0, peers.length - 1),
    })
  }
  moveRegionRef.current = moveLibraryEntriesToRegion

  const findLibraryRegionKey = (
    roots: ClusterNodeDto[],
    entryId: string,
    parentKey = '__flat__',
  ): string | null => {
    for (const n of roots) {
      if (n.isGroup) {
        const key = (n.scopeKey || n.name || parentKey).trim() || parentKey
        const found = findLibraryRegionKey(n.children || [], entryId, key)
        if (found) return found
      } else if (n.entryId === entryId) {
        return parentKey
      }
    }
    return null
  }

  const libraryPeersInRegion = (regionKey: string): string[] => {
    const roots = snap.permanentLibraryRoots ?? []
    if (roots.length === 0) {
      return (snap.inLibraryOtherItems ?? []).map((x) => x.entryId)
    }
    const out: string[] = []
    const walk = (nodes: ClusterNodeDto[], parentKey: string) => {
      for (const n of nodes) {
        if (n.isGroup) {
          walk(n.children || [], (n.scopeKey || n.name || parentKey).trim() || parentKey)
        } else if (n.entryId && parentKey === regionKey) {
          out.push(n.entryId)
        }
      }
    }
    walk(roots, '__flat__')
    return out
  }

  const libraryEntryMenu = (
    entryId: string,
    commands: typeof cmd,
    selectedIds: string[],
  ): MenuItem[] => {
    const ids = selectedIds.length ? selectedIds : [entryId]
    const meta = selectionMeta(ids)
    const canRetag = Boolean(commands.canSetScope)
    const candidates = deployCandidateIds()
    const ensureLibSelection = () => runSelect(ids, 'library')
    const pinnedProjects = snap.projects.filter((p) => p.pinned)
    const anyMissing = ids.some((id) => snap.missingItems.some((m) => m.entryId === id))
    const onSinglePinnedFocus =
      pinnedProjects.length === 1 &&
      (snap.selectedNavKind || 'global') === 'project' &&
      snap.selectedProjectId === pinnedProjects[0]?.id
    const canDeployOpenEye =
      Boolean(snap.isLibraryConfigured) &&
      ids.length > 0 &&
      !anyMissing &&
      !mixedSel &&
      !netOnlySel &&
      pinnedProjects.length > 0 &&
      !onSinglePinnedFocus
    const deployOpenEyeTitle = mixedSel
      ? t('menu.mixedDeploy')
      : netOnlySel
        ? t('menu.netNoDirectDeploy')
        : t('menu.deployOpenEyeHint')
    return [
      {
        label: t('menu.deploy'),
        disabled: !commands.canDeploy || mixedSel || netOnlySel,
        title: mixedSel
          ? t('menu.mixedDeploy')
          : netOnlySel
            ? t('menu.netNoDirectDeploy')
            : undefined,
        onClick: () => runDeploy([snap.selectedGlobalTool ?? 'cursor'], ids),
      },
      {
        label: t('menu.deployOpenEye'),
        title: deployOpenEyeTitle,
        disabled: !canDeployOpenEye,
        onClick: () =>
          void run('deploy', {
            entryIds: ids,
            projectIds: pinnedProjects.map((p) => p.id),
            workspaceIds: [snap.selectedGlobalTool ?? 'cursor'],
          }),
      },
      {
        label: t('menu.deployAll'),
        title: mixedSel
          ? t('menu.mixedDeploy')
          : t('menu.deployAllHint'),
        disabled: !commands.canDeploy || mixedSel || netOnlySel || candidates.length <= 1,
        onClick: () => runDeploy(candidates, ids),
      },
      {
        label: t('menu.compare'),
        disabled: ids.length !== 1,
        onClick: () => void openDualCompare(entryId),
      },
      {
        label: t('menu.setLevel'),
        disabled: !canRetag,
        children: [
          ...(['L0', 'L1', 'L2'] as const).map((level) => ({
            label: level,
            checked: meta.level === level,
            onClick: () => void run('setEntryLevel', { level, entryIds: ids }),
          })),
          {
            label: t('menu.clearLevel'),
            checked: meta.level == null,
            onClick: () => void run('setEntryLevel', { level: '未分类', entryIds: ids }),
          },
        ],
      },
      {
        label: t('menu.setProject'),
        disabled: !canRetag,
        children: [
          {
            label: t('menu.userLevel'),
            checked: meta.scope === 'global' || meta.scope?.toLowerCase() === 'user-global',
            onClick: () => void ensureLibSelection().then(() => run('setScopeGlobal')),
          },
          ...snap.projects.map((p) => ({
            label: p.name,
            checked: meta.scope === `project:${p.id}`,
            onClick: () =>
              void ensureLibSelection().then(() => run('setScopeProject', { projectId: p.id })),
          })),
        ],
      },
      {
        label: t('menu.editTags'),
        disabled: !commands.canEditTags,
        onClick: () => {
          void ensureLibSelection().then(() => openTags())
        },
      },
      {
        label: t('menu.openDir'),
        title: t('menu.openLibraryEntryHint'),
        disabled: !commands.canOpenLibraryEntry,
        onClick: () => void run('openLibraryEntry', { entryId }),
      },
      {
        label: t('menu.purgeMissing'),
        disabled: !commands.canPurgeMissing,
        danger: true,
        onClick: () => void purgeMissingRecords(ids),
      },
    ]
  }

  const missingEntryMenu = (
    entryId: string,
    commands: typeof cmd,
    selectedIds: string[],
  ): MenuItem[] => {
    const ids = selectedIds.length ? selectedIds : [entryId]
    return [
      {
        label: t('menu.openDir'),
        title: t('menu.openLibraryEntryHint'),
        disabled: !commands.canOpenLibraryEntry,
        onClick: () => void run('openLibraryEntry', { entryId }),
      },
      {
        label: t('menu.purgeMissing'),
        disabled: !commands.canPurgeMissing,
        danger: true,
        onClick: () => void purgeMissingRecords(ids),
      },
    ]
  }

  const entryMenuForZone = (
    zone: EntryMenuZone,
    entryId: string,
    commands: typeof cmd,
    selectedIds: string[],
  ): MenuItem[] => {
    if (zone === 'container') return containerEntryMenu(entryId, commands, selectedIds)
    if (zone === 'missing') return missingEntryMenu(entryId, commands, selectedIds)
    return libraryEntryMenu(entryId, commands, selectedIds)
  }

  /** 从台账删除缺失记录（不恢复文件）。未传 ids 时：有选中则清选中缺失，否则清本节全部缺失。 */
  const purgeMissingRecords = async (entryIds?: string[]) => {
    const selectedMissing = snap.selectedEntryIds.filter((id) =>
      snap.missingItems.some((m) => m.entryId === id),
    )
    const ids =
      entryIds?.filter((id) => snap.missingItems.some((m) => m.entryId === id)) ??
      (selectedMissing.length > 0 ? selectedMissing : filteredMissing.map((m) => m.entryId))
    if (ids.length === 0) {
      setToast(t('toast.noMissing'))
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    const ok = window.confirm(
      t('confirm.purgeMissing', { n: ids.length }),
    )
    if (!ok) return
    await run('purgeMissing', { entryIds: ids })
  }
  purgeMissingRef.current = purgeMissingRecords

  /** 同步弹出分区菜单；setSelection 后台同步，灰显用 menuCommandsFor（不 await IPC） */
  const openEntryMenu = (
    e: ReactMouseEvent,
    entryId: string,
    zone: EntryMenuZone = 'library',
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX: x, clientY: y } = e
    const pathSide: 'container' | 'library' = zone === 'container' ? 'container' : 'library'
    // 已在多选内：保留多选；否则改为单选该行（与资源管理器一致）
    const nextIds = selected.has(entryId) ? snap.selectedEntryIds : [entryId]
    const sameSelection =
      nextIds.length === snap.selectedEntryIds.length &&
      nextIds.every((id, i) => id === snap.selectedEntryIds[i]) &&
      snap.detailPathSide === pathSide
    if (!sameSelection) {
      void runSelect(nextIds, pathSide)
    }
    setCtx({
      x,
      y,
      items: entryMenuForZone(zone, entryId, menuCommandsFor(zone, nextIds), nextIds),
    })
  }
  openEntryMenuRef.current = openEntryMenu

  /** 网络侧栏热门源右键：拉取 / 显示隐藏 / 打开仓库 / 筛选 / 开缓存 / 移除用户源 */
  const networkSourceMenu = (id: string, node: NetworkNavNodeDto): MenuItem[] => {
    const canFetch = Boolean(node.hasDefaultRepo && node.primaryRepoUrl?.trim())
    const repoUrl = node.primaryRepoUrl?.trim() || ''
    const isUser = node.kind === 'user'
    const sourceFetching = networkFetchHasSource(networkFetch, id)
    const picked = networkNavPickedIds
    const inPick = picked.has(id)
    const multiPick = inPick && picked.size > 1
    const uncachedTargets = (multiPick ? [...picked] : [id]).filter((sid) => {
      const n = (snap.networkPopularNav ?? []).find((x) => x.id === sid)
      return Boolean(n && navSourceNeedsFetch(n))
    })
    return [
      multiPick && uncachedTargets.length > 0
        ? {
            label: t('menu.fetchUncachedN', { n: uncachedTargets.length }),
            disabled: busy,
            title: t('menu.fetchUncachedHint'),
            onClick: () => {
              setNetworkNavSel({ kind: 'popular', id })
              fetchPickedUncached()
            },
          }
        : {
            label: sourceFetching ? t('menu.fetching') : t('menu.fetchCurrent'),
            disabled: busy || sourceFetching || !canFetch,
            title: sourceFetching
              ? t('menu.fetchingHint')
              : canFetch
                ? t('menu.fetchUrl', { url: repoUrl })
                : t('menu.noDefaultRepo'),
            onClick: () => {
              setNetworkNavSel({ kind: 'popular', id })
              void fetchNetworkNavSource(id)
            },
          },
      {
        label: node.pinned ? t('menu.hide') : t('menu.show'),
        onClick: () => {
          runNetworkPin('popular', id, !node.pinned)
        },
      },
      {
        label: t('menu.openSourceCache'),
        disabled: !snap.isNetworkLibraryConfigured || !node.hasCachedSource,
        title: node.hasCachedSource
          ? t('menu.openCachePath', { id })
          : t('menu.fetchFirst'),
        onClick: () => {
          void run('openNetworkSourceCacheDir', { sourceId: id }).then((res) => {
            if (res && res.ok === false) {
              setToast(res.message || t('toast.cannotOpenSourceCache'))
              window.setTimeout(() => setToast(null), 4000)
            }
          })
        },
      },
      {
        label: t('menu.openRepoBrowser'),
        disabled: !repoUrl,
        title: repoUrl || t('menu.noRepoUrl'),
        onClick: () => {
          // Tauri WebView 内 window.open 常被拦截；走系统 shell（http(s) 已由 open_path 支持）
          void run('openPath', { path: repoUrl }).then((res) => {
            if (res && res.ok === false) {
              setToast(res.message || t('toast.cannotOpenRepo'))
              window.setTimeout(() => setToast(null), 4000)
            }
          })
        },
      },
      {
        label: t('menu.filterThisSource'),
        onClick: () => {
          setNetworkNavSel({ kind: 'popular', id })
          setNetworkNavPickedIds(new Set([id]))
          networkNavAnchorRef.current = id
        },
      },
      ...(isUser
        ? [
            {
              label: t('menu.removeSource'),
              danger: true,
              title: t('menu.removeSourceHint'),
              onClick: () => {
                if (
                  !window.confirm(
                    t('confirm.removeUserSource', { name: node.displayName || id }),
                  )
                ) {
                  return
                }
                void run('removeNetworkUserSource', { sourceId: id }).then((res) => {
                  setNetworkNavSel((prev) => (prev?.id === id ? null : prev))
                  setNetworkNavPickedIds((prev) => {
                    if (!prev.has(id)) return prev
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                  })
                  if (res && res.ok === false) {
                    setToast(res.message || t('toast.removeFail'))
                    window.setTimeout(() => setToast(null), 5000)
                    return
                  }
                  const warnings = (res?.data as NetworkOpResultDto | undefined)?.warnings
                  if (Array.isArray(warnings) && warnings.length > 0) {
                    setToast(warnings.join('；'))
                    window.setTimeout(() => setToast(null), 6000)
                  } else {
                    setToast(res?.message || t('toast.sourceRemoved'))
                    window.setTimeout(() => setToast(null), 3000)
                  }
                })
              },
            } satisfies MenuItem,
          ]
        : []),
    ]
  }

  /** 网络工作台条目右键（按操作动线：转入 → 级别 → 本地条目 → 更新 → 目录/仓库） */
  const networkItemMenu = (
    item: (typeof filteredNetwork)[number],
  ): MenuItem[] => {
    const hasCache = Boolean(item.libraryPathRel?.trim())
    const repoUrl = item.sourceUrl?.trim() || ''
    const promotedId = item.promotedEntryId?.trim() || ''
    const inSel = selected.has(item.entryId)
    const ids = inSel ? snap.selectedEntryIds : [item.entryId]
    const netIds = ids.filter((id) => funnelOriginOf(id) === 'network')
    const hasLib = ids.some((id) => funnelOriginOf(id) === 'library')
    return [
      {
        label: t('menu.promoteLocal'),
        disabled: busy || netIds.length === 0,
        title: t('menu.promoteHint'),
        onClick: () => {
          if (inSel && hasLib) {
            setToast(t('toast.mixedPromote'))
            window.setTimeout(() => setToast(null), 4000)
            return
          }
          void runSelect(netIds).then(() => {
            void promoteSelectedFromNetwork(false, netIds)
          })
        },
      },
      {
        label: t('menu.putAllUncategorized'),
        disabled: busy,
        title: t('menu.putAllUncategorizedHint'),
        onClick: () => {
          const ids = upperNetItems
            .filter((x) => x.funnelOrigin === 'network')
            .map((x) => x.entryId)
          if (ids.length === 0) return
          void setNetworkIntendedLevel('', ids)
        },
      },
      ...(promotedId
        ? ([
            {
              label: t('menu.openLocalEntry'),
              disabled: busy,
              title: t('menu.openLocalEntryHint', { id: promotedId }),
              onClick: () => {
                setNavShelf('local')
                void runSelect([promotedId])
              },
            },
            {
              label: t('menu.viewOpsLog'),
              disabled: busy,
              title: t('menu.viewOpsLogHint'),
              onClick: () => void openEntryOpsLog(item.entryId),
            },
          ] satisfies MenuItem[])
        : []),
      ...(item.updateAvailable
        ? ([
            {
              label: t('menu.updateReplay'),
              disabled: busy || !item.sourceId,
              title: item.hasCustomization
                ? t('menu.updateReplayHasDiff')
                : t('menu.updateReplayMaybe'),
              onClick: () => void applyNetworkCacheUpdateForSource(item.sourceId || ''),
            },
          ] satisfies MenuItem[])
        : []),
      {
        label: t('menu.openLocalStore'),
        disabled: !snap.isNetworkLibraryConfigured || !hasCache,
        title: hasCache ? item.libraryPathRel || '' : t('menu.noLocalCachePath'),
        onClick: () => {
          void run('openNetworkEntryDir', { entryId: item.entryId }).then((res) => {
            if (res && res.ok === false) {
              setToast(res.message || t('toast.cannotOpenLocalDir'))
              window.setTimeout(() => setToast(null), 4000)
            }
          })
        },
      },
      {
        label: t('menu.openSourceRepo'),
        disabled: !repoUrl,
        title: repoUrl || t('menu.noSourceUrl'),
        onClick: () => {
          void run('openPath', { path: repoUrl }).then((res) => {
            if (res && res.ok === false) {
              setToast(res.message || t('toast.cannotOpenRepo'))
              window.setTimeout(() => setToast(null), 4000)
            }
          })
        },
      },
    ]
  }

  const projectMenu = (projectId: string): MenuItem[] => {
    const p = snap.projects.find((x) => x.id === projectId)
    const visible = new Set(p?.visibleTools?.length ? p.visibleTools : ['cursor'])
    const toolChoices = ['cursor', 'claude', 'codex', 'gemini', 'opencode', 'windsurf', 'continue']
    return [
      {
        label: p?.pinned ? t('menu.hide') : t('menu.show'),
        onClick: () => void runTogglePinProject(projectId),
      },
      {
        label: t('menu.projectTools'),
        children: toolChoices.map((id) => {
          const name = snap.workspaces?.find((w) => w.id === id)?.displayName || id
          return {
            label: name,
            checked: visible.has(id),
            onClick: () => {
              const next = new Set(visible)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              if (next.size === 0) next.add('cursor')
              void run('updateProjectTools', { id: projectId, visibleTools: [...next] })
            },
          }
        }),
      },
      {
        label: t('menu.edit'),
        onClick: () => openEditProject(projectId),
      },
      {
        label: t('menu.openDir'),
        onClick: () => void run('openProjectCursor', { id: projectId }),
      },
      {
        label: t('menu.clearSkills'),
        title: t('nav.clearSkillsHint'),
        onClick: () => void submitClearProjectSkills([], [...pickedProjectIdsRef.current]),
      },
      {
        label: t('menu.delete'),
        danger: true,
        onClick: () => void openRemoveProject(projectId),
      },
    ]
  }

  const globalMenu = (tool: string): MenuItem[] => {
    return [
      {
        label: t('menu.openDir'),
        onClick: () => void run('openGlobalContainer', { tool }),
      },
    ]
  }

  return (
    <div className="app">
      <div className="toolbar toolbar-main" data-tauri-drag-region>
        <div className="toolbar-left">
          <button
            className="primary"
            disabled={busy}
            title={t('toolbar.scanBuildHint')}
            onClick={() => void openScanProjects()}
          >
            {busy ? t('toolbar.processing') : t('toolbar.scanBuild')}
          </button>
          <button type="button" title={t('toolbar.refreshHint')} onClick={() => void runRefresh()}>
            {t('toolbar.refresh')}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            {t('toolbar.settings')}
          </button>
          {isBrowserPreview() ? <span className="preview-badge">{t('toolbar.preview')}</span> : null}
        </div>
        <div className="toolbar-center">
          <input
            className="toolbar-search"
            type="search"
            aria-label={t('toolbar.search')}
            placeholder={t('toolbar.searchPlaceholder')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <div className="toolbar-kinds" ref={kindsMenuRef}>
            <button
              type="button"
              className={kindsOpen ? 'is-open' : undefined}
              title={t('toolbar.kindsTitle')}
              aria-label={t('toolbar.kindsTitle')}
              aria-haspopup="menu"
              aria-expanded={kindsOpen}
              onClick={() => setKindsOpen((o) => !o)}
            >
              {t('toolbar.kinds')}
            </button>
            {kindsOpen ? (
              <div className="toolbar-kinds-menu" role="menu" aria-label={t('toolbar.kindsTitle')}>
                {(
                  [
                    ['FilterShowSkills', t('kind.skill'), snap.filterShowSkills],
                    ['FilterShowRules', t('kind.rule'), snap.filterShowRules],
                    ['FilterShowAgents', t('kind.agent'), snap.filterShowAgents],
                    ['FilterShowCommands', t('kind.command'), snap.filterShowCommands],
                    ['FilterShowHooks', t('kind.hook'), snap.filterShowHooks],
                  ] as const
                ).map(([key, label, checked]) => (
                  <label key={key} className="toolbar-kinds-item" role="menuitemcheckbox" aria-checked={checked}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => void run('setFilters', { [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="toolbar-linkish"
            disabled={busy}
            onClick={() => void openSuggestPurposes()}
          >
            {t('toolbar.autoClassify')}
          </button>
        </div>
        <div className="toolbar-right">
          <div className="layout-toggles" role="group" aria-label={t('toolbar.layout')}>
            <button
              type="button"
              className={`layout-toggle${navVisible ? ' is-active' : ''}`}
              title={t('toolbar.toggleNav')}
              aria-label={t('toolbar.toggleNav')}
              aria-pressed={navVisible}
              onClick={toggleNavVisible}
            >
              <IconPanelLeft />
            </button>
            <button
              type="button"
              className={`layout-toggle${detailVisible ? ' is-active' : ''}`}
              title={t('toolbar.toggleDetail')}
              aria-label={t('toolbar.toggleDetail')}
              aria-pressed={detailVisible}
              onClick={toggleDetailVisible}
            >
              <IconPanelRight />
            </button>
          </div>
          <WindowControls maximized={maximized} setMaximized={setMaximized} />
        </div>
      </div>

      <WorkbenchSplit
        className="main"
        restoreKey={layoutRestoreKey}
        onSashChangeEnd={(sizes) => {
          let i = 0
          const next = { ...paneHints }
          if (navVisible) next.nav = Math.max(NAV_MIN, sizes[i++] ?? next.nav)
          next.list = Math.max(LIST_MIN, sizes[i++] ?? next.list)
          if (detailVisible) next.detail = Math.max(DETAIL_MIN, sizes[i++] ?? next.detail)
          setPaneHints(next)
          persistLayout(next.nav, next.list)
        }}
        panes={[
          ...(navVisible
            ? [
                {
                  key: 'nav',
                  min: NAV_MIN,
                  priority: LayoutPriority.Low,
                  size: paneHints.nav,
                  node: (
                    <aside
                      className="panel"
                    >
                      <div className="nav-shelf-toggle" role="tablist" aria-label={t('shelf.aria')}>
                        <button
                          type="button"
                          role="tab"
                          className={navShelf === 'local' ? 'active' : ''}
                          aria-selected={navShelf === 'local'}
                          onClick={() => {
                            startTransition(() => setNavShelf('local'))
                          }}
                        >
                          {t('shelf.local')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          className={navShelf === 'network' ? 'active' : ''}
                          aria-selected={navShelf === 'network'}
                          onClick={() => {
                            startTransition(() => setNavShelf('network'))
                            if (!snap.isNetworkLibraryConfigured) {
                              ensureNetworkLibrary()
                            }
                          }}
                        >
                          {t('shelf.network')}
                        </button>
                        <button
                          type="button"
                          role="tab"
                          className={navShelf === 'filter' ? 'active' : ''}
                          aria-selected={navShelf === 'filter'}
                          onClick={() => {
                            startTransition(() => setNavShelf('filter'))
                            if (!snap.isNetworkLibraryConfigured) {
                              ensureNetworkLibrary()
                            }
                          }}
                        >
                          {t('shelf.filter')}
                        </button>
                      </div>
                      {navShelf === 'local' ? (
                        <NavTree
                          nodes={snap.navNodes}
                          projects={snap.projects}
                          workspaces={snap.workspaces ?? []}
                          selectedKind={snap.selectedNavKind}
                          selectedProjectId={snap.selectedProjectId}
                          pickedProjectIds={pickedProjectIds}
                          selectedGlobalTool={snap.selectedGlobalTool ?? 'cursor'}
                          onSelect={(kind, projectId, tool) =>
                            void run('setNav', { kind, projectId, tool })
                          }
                          onSelectProject={onSelectProjectNav}
                          onClearProjectSkills={() =>
                            void submitClearProjectSkills([], [...pickedProjectIdsRef.current])
                          }
                          clearSkillsDisabled={busy || pickedProjectIds.size === 0}
                          onToggleInWorkArea={(id, inWorkArea) => {
                            const seq = ++workspaceEyeSeqRef.current
                            setSnap((prev) => optimisticWorkspaceEye(prev, id, inWorkArea))
                            void invoke('updateWorkspaceConfig', {
                              id,
                              inWorkArea,
                              enabled: inWorkArea ? true : undefined,
                            })
                              .then((res) => {
                                if (seq !== workspaceEyeSeqRef.current) return
                                if (!res.ok) {
                                  setToast(res.message || t('toast.cannotUpdateWorkArea'))
                                  window.setTimeout(() => setToast(null), 4000)
                                  void invoke('getSnapshot').then((full) => {
                                    if (full.snapshot) {
                                      setSnap((prev) =>
                                        mergeOmitNetworkSnapshot(prev, full.snapshot!),
                                      )
                                    }
                                  })
                                  return
                                }
                                if (res.snapshot) {
                                  setSnap((prev) =>
                                    mergeOmitNetworkSnapshot(prev, res.snapshot!),
                                  )
                                }
                              })
                              .catch((e) => {
                                setToast(e instanceof Error ? e.message : String(e))
                              })
                          }}
                          onSetDefaultWorkspace={(id) => {
                            void (async () => {
                              const w = (snap.workspaces ?? []).find((x) => x.id === id)
                              if (w && !w.inWorkArea) {
                                const promoted = apply(
                                  await invoke('updateWorkspaceConfig', {
                                    id,
                                    inWorkArea: true,
                                    enabled: true,
                                  }),
                                )
                                if (!promoted.ok) {
                                  setToast(promoted.message || t('toast.cannotPromoteWorkArea'))
                                  window.setTimeout(() => setToast(null), 4000)
                                  return
                                }
                              }
                              const res = apply(await invoke('setDefaultWorkspace', { id }))
                              if (!res.ok) {
                                setToast(res.message || t('toast.cannotSetDefaultWs'))
                                window.setTimeout(() => setToast(null), 4000)
                              }
                            })()
                          }}
                          onEditContainerRoot={(id) => {
                            const w = (snap.workspaces ?? []).find((x) => x.id === id)
                            setContainerRootEditor({
                              id,
                              label: w?.displayName || id,
                              path: (w?.containerRoot || '').trim(),
                            })
                          }}
                          onContextGlobal={(e, tool) => showMenu(e, globalMenu(tool))}
                          onContextProject={(e, id) => {
                            if (!pickedProjectIdsRef.current.has(id)) {
                              projectAnchorRef.current = id
                              setPickedProjects(new Set([id]))
                              if (snap.selectedProjectId !== id) {
                                void run('setNav', { kind: 'project', projectId: id })
                              }
                            }
                            showMenu(e, projectMenu(id))
                          }}
                          onReorderProject={(id, opts) =>
                            run('reorderProject', {
                              id,
                              direction: opts.direction,
                              toIndex: opts.toIndex,
                            })
                          }
                          onReorderWorkspace={(id, opts) =>
                            run('reorderWorkspace', {
                              id,
                              direction: opts.direction,
                              toIndex: opts.toIndex,
                              peerIds: opts.peerIds,
                            })
                          }
                          workspacePoolOpen={workspacePoolOpen}
                          onWorkspacePoolOpenChange={setWorkspacePoolOpen}
                          projectPoolOpen={projectPoolOpen}
                          onProjectPoolOpenChange={setProjectPoolOpen}
                          onTogglePinProject={(id) => runTogglePinProject(id)}
                          onBulkSetWorkArea={(show) => {
                            const list = snap.workspaces ?? []
                            const keepId =
                              list.find((w) => w.isDefault)?.id ||
                              list.find((w) => w.inWorkArea)?.id ||
                              list[0]?.id
                            const ids = show
                              ? list.filter((w) => !w.inWorkArea).map((w) => w.id)
                              : list
                                  .filter((w) => w.inWorkArea && w.id !== keepId)
                                  .map((w) => w.id)
                            if (ids.length === 0) {
                              if (show) setWorkspacePoolOpen(false)
                              else setWorkspacePoolOpen(true)
                              return
                            }
                            workspaceEyeSeqRef.current += 1
                            setSnap((prev) => optimisticWorkspaceEyeAll(prev, show))
                            if (show) setWorkspacePoolOpen(false)
                            else setWorkspacePoolOpen(true)
                            void invoke('setWorkspacesInWorkArea', {
                              ids,
                              inWorkArea: show,
                            })
                              .then((res) => {
                                if (!res.ok) {
                                  setToast(
                                    res.message ||
                                      (show ? t('toast.cannotOpenAllWs') : t('toast.cannotCloseAllWs')),
                                  )
                                  window.setTimeout(() => setToast(null), 4000)
                                  void invoke('getSnapshot').then((full) => {
                                    if (full.snapshot) {
                                      setSnap((prev) =>
                                        mergeOmitNetworkSnapshot(prev, full.snapshot!),
                                      )
                                    }
                                  })
                                  return
                                }
                                if (res.snapshot) {
                                  setSnap((prev) =>
                                    mergeOmitNetworkSnapshot(prev, res.snapshot!),
                                  )
                                }
                              })
                              .catch((e) => {
                                setToast(e instanceof Error ? e.message : String(e))
                              })
                          }}
                          onBulkSetProjectsVisible={(show) => {
                            void (async () => {
                              projectPinSeqRef.current += 1
                              const targets = snap.projects.filter((p) => p.pinned !== show)
                              for (const p of targets) {
                                const res = await runTogglePinProject(p.id)
                                if (res && res.ok === false) {
                                  setToast(res.message || t('toast.cannotBulkContainers'))
                                  window.setTimeout(() => setToast(null), 4000)
                                  return
                                }
                              }
                              if (show) setProjectPoolOpen(false)
                              else setProjectPoolOpen(true)
                            })()
                          }}
                          onAddContainer={() => void openAddContainer()}
                        />
                      ) : navShelf === 'filter' ? (
                        <div className="funnel-nav" role="navigation" aria-label={t('funnel.aria')}>
                  <div className="funnel-row" role="group" aria-label={t('funnel.personaAria')}>
                    <span className="funnel-label">{t('funnel.persona')}</span>
                    {PERSONA_CHIPS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`funnel-chip${persona === c.id ? ' is-active' : ''}`}
                          aria-pressed={persona === c.id}
                          onClick={() => {
                            startTransition(() => {
                              if (persona === c.id) {
                                setPersona(null)
                                setPersonaSub(null)
                                setPhrase(null)
                                setRefinePath([])
                              } else {
                                setPersona(c.id)
                                setPersonaSub(null)
                                setPhrase(null)
                                setRefinePath([])
                              }
                              setPhraseExpanded(false)
                              setRefineExpanded(null)
                            })
                          }}
                        >
                          <span className="funnel-chip-text" title={chipText(c.label)}>
                            {chipText(c.label)}
                          </span>
                          <span className="funnel-chip-n">{personaCounts[c.id]}</span>
                        </button>
                    ))}
                  </div>
                  <div className="funnel-row" role="group" aria-label={t('funnel.toggles')}>
                    <label className="funnel-mirror">
                      <input
                        type="checkbox"
                        checked={includeLocal}
                        onChange={(e) => setIncludeLocal(e.target.checked)}
                      />
                      {t('funnel.local')}
                    </label>
                    <label className="funnel-mirror">
                      <input
                        type="checkbox"
                        checked={includeNetwork}
                        onChange={(e) => setIncludeNetwork(e.target.checked)}
                      />
                      {t('funnel.network')}
                    </label>
                  </div>
                  {showPersonaSubRow && persona && persona !== 'unclassified' ? (
                    <div className="funnel-row" role="group" aria-label={t('funnel.softwareSubAria')}>
                      <span className="funnel-label">{t('funnel.softwareSub')}</span>
                      {personaSubDefs(persona).map((s) =>
                        (personaSubCounts[s.id] ?? 0) > 0 ? (
                          <button
                            key={s.id}
                            type="button"
                            className={`funnel-chip${personaSub === s.id ? ' is-active' : ''}`}
                            aria-pressed={personaSub === s.id}
                            onClick={() => {
                              startTransition(() => {
                                setPersonaSub((prev) => (prev === s.id ? null : s.id))
                                setPhrase(null)
                                setRefinePath([])
                                setPhraseExpanded(false)
                                setRefineExpanded(null)
                              })
                            }}
                          >
                            <span className="funnel-chip-text" title={chipText(s.label)}>
                              {chipText(s.label)}
                            </span>
                            <span className="funnel-chip-n">{personaSubCounts[s.id]}</span>
                          </button>
                        ) : null,
                      )}
                      {(personaSubCounts[OTHER_ID] ?? 0) > 0 ? (
                        <button
                          key={OTHER_ID}
                          type="button"
                          className={`funnel-chip${personaSub === OTHER_ID ? ' is-active' : ''}`}
                          aria-pressed={personaSub === OTHER_ID}
                          onClick={() => {
                            startTransition(() => {
                              setPersonaSub((prev) => (prev === OTHER_ID ? null : OTHER_ID))
                              setPhrase(null)
                              setRefinePath([])
                              setPhraseExpanded(false)
                              setRefineExpanded(null)
                            })
                          }}
                        >
                          <span className="funnel-chip-text" title={t('funnel.other')}>
                            {t('funnel.other')}
                          </span>
                          <span className="funnel-chip-n">{personaSubCounts[OTHER_ID]}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {showPhraseRow ? (
                    <div className="funnel-row" role="group" aria-label={t('funnel.phrase')}>
                      <span className="funnel-label">{t('funnel.phrase')}</span>
                      {phraseVisible.map((x) => (
                        <button
                          key={x.phrase}
                          type="button"
                          className={`funnel-chip${phrase === x.phrase ? ' is-active' : ''}`}
                          aria-pressed={phrase === x.phrase}
                          onClick={() => {
                            startTransition(() => {
                              setPhrase((prev) => (prev === x.phrase ? null : x.phrase))
                              setRefinePath([])
                              setRefineExpanded(null)
                            })
                          }}
                        >
                          <span className="funnel-chip-text" title={chipLabel(x.phrase, locale)}>
                            {chipLabel(x.phrase, locale)}
                          </span>
                          <span className="funnel-chip-n">{x.count}</span>
                        </button>
                      ))}
                      {phraseRanked.length > PHRASE_CHIP_MAX ? (
                        <button
                          type="button"
                          className={`funnel-chip${phraseExpanded ? ' is-active' : ''}`}
                          aria-expanded={phraseExpanded}
                          onClick={() => setPhraseExpanded((v) => !v)}
                        >
                          <span
                            className="funnel-chip-text"
                            title={phraseExpanded ? t('funnel.collapse') : t('funnel.more')}
                          >
                            {phraseExpanded ? t('funnel.collapse') : t('funnel.more')}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {funnelMatch.refineRows.map((row, i) => {
                    const vis = visiblePartitionChips(
                      row.chips,
                      row.selected.id,
                      refineExpanded === `r${i}`,
                    )
                    const layerKey = funnelRefineLabelKey(row.chips)
                    return (
                      <div
                        key={`r${i}`}
                        className={funnelRefineRowClass(row.chips)}
                        role="group"
                        aria-label={t(layerKey)}
                      >
                        <span className="funnel-label">{t(layerKey)}</span>
                        {vis.map((chip) => {
                          const on = row.selected.id === chip.id
                          return (
                            <button
                              key={chip.id}
                              type="button"
                              className={`funnel-chip${on ? ' is-active' : ''}`}
                              aria-pressed={on}
                              onClick={() => {
                                startTransition(() => {
                                  setRefinePath((prev) => {
                                    const cur = prev[i]
                                    if (cur && cur.id === chip.id) return prev.slice(0, i)
                                    return [...prev.slice(0, i), { id: chip.id }]
                                  })
                                  setRefineExpanded(null)
                                })
                              }}
                            >
                              <span className="funnel-chip-text" title={chipText(chip.label)}>
                                {chipText(chip.label)}
                              </span>
                              <span className="funnel-chip-n">{chip.count}</span>
                            </button>
                          )
                        })}
                        {row.chips.length > PHRASE_CHIP_MAX ? (
                          <button
                            type="button"
                            className={`funnel-chip${refineExpanded === `r${i}` ? ' is-active' : ''}`}
                            aria-expanded={refineExpanded === `r${i}`}
                            onClick={() =>
                              setRefineExpanded((k) => (k === `r${i}` ? null : `r${i}`))
                            }
                          >
                            <span
                              className="funnel-chip-text"
                              title={refineExpanded === `r${i}` ? t('funnel.collapse') : t('funnel.more')}
                            >
                              {refineExpanded === `r${i}` ? t('funnel.collapse') : t('funnel.more')}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                  {funnelMatch.nextChips.length > 0 ? (
                    <div
                      className={funnelRefineRowClass(funnelMatch.nextChips)}
                      role="group"
                      aria-label={t(funnelRefineLabelKey(funnelMatch.nextChips))}
                    >
                      <span className="funnel-label">
                        {t(funnelRefineLabelKey(funnelMatch.nextChips))}
                      </span>
                      {visiblePartitionChips(
                        funnelMatch.nextChips,
                        null,
                        refineExpanded === 'next',
                      ).map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          className="funnel-chip"
                          aria-pressed={false}
                          onClick={() => {
                            startTransition(() => {
                              setRefinePath((prev) => [...prev, { id: chip.id }])
                              setRefineExpanded(null)
                            })
                          }}
                        >
                          <span className="funnel-chip-text" title={chipText(chip.label)}>
                            {chipText(chip.label)}
                          </span>
                          <span className="funnel-chip-n">{chip.count}</span>
                        </button>
                      ))}
                      {funnelMatch.nextChips.length > PHRASE_CHIP_MAX ? (
                        <button
                          type="button"
                          className={`funnel-chip${refineExpanded === 'next' ? ' is-active' : ''}`}
                          aria-expanded={refineExpanded === 'next'}
                          onClick={() =>
                            setRefineExpanded((k) => (k === 'next' ? null : 'next'))
                          }
                        >
                          <span
                            className="funnel-chip-text"
                            title={refineExpanded === 'next' ? t('funnel.collapse') : t('funnel.more')}
                          >
                            {refineExpanded === 'next' ? t('funnel.collapse') : t('funnel.more')}
                          </span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                        </div>
                      ) : (
                        <NetworkNav
                          busy={busy}
                          configured={Boolean(snap.isNetworkLibraryConfigured)}
                          popular={snap.networkPopularNav ?? []}
                          selected={networkNavSel}
                          pickedIds={networkNavPickedIds}
                          visibleLimit={Number(snap.networkPopularVisibleLimit ?? 10)}
                          onPickRoot={() => void run('chooseNetworkLibraryRoot')}
                          onSelectNode={(id, e) => onSelectNetworkNav(id, e)}
                          onTogglePin={(id, pinned) => runNetworkPin('popular', id, pinned)}
                          onBulkVisibility={runNetworkBulkVisibility}
                          onSetVisibleLimit={(limit) =>
                            void run('setNetworkPopularVisibleLimit', { limit })
                          }
                          onPasteGitUrl={(url) => void fetchNetworkGitUrl(url)}
                          popularSort={String(snap.networkPopularSort ?? 'stars')}
                          onSetPopularSort={(mode) =>
                            void run('setNetworkPopularSort', { mode })
                          }
                          onRefreshSection={refreshNetworkSection}
                          onFetchNode={(id) => void fetchNetworkNavSource(id)}
                          onFetchUncached={fetchPickedUncached}
                          onContextNode={(e, id, node) =>
                            showMenu(e, networkSourceMenu(id, node))
                          }
                          onReorderNav={(id, opts) => {
                            void run('reorderNetworkNav', {
                              section: 'popular',
                              id,
                              direction: opts.direction,
                              toIndex: opts.toIndex,
                              targetPinned: opts.targetPinned,
                            })
                          }}
                        />
                      )}
                    </aside>
                  ),
                },
              ]
            : []),
          {
            key: 'list',
            min: LIST_MIN,
            priority: LayoutPriority.High,
            size: paneHints.list,
            node: (
              <section className="panel list-split">
                <WorkbenchSplit
                  className="list-split-view"
                  orientation="vertical"
                  restoreKey={navShelf}
                  panes={[
                    {
                      key: 'upper',
                      min: LIST_UPPER_MIN,
                      priority: isNetworkLikeShelf(navShelf)
                        ? LayoutPriority.High
                        : LayoutPriority.Low,
                      size: isNetworkLikeShelf(navShelf)
                        ? Math.max(listSplitHints.upper, LIST_UPPER_NET_DEFAULT)
                        : listSplitHints.upper,
                      node: (
                        <div className="list-pane list-pane-upper">
                <div className="panel-title">
                  <ListMetaHeadings
                    lead={
                      navShelf === 'local' ? (
                    <button
                      type="button"
                      className="panel-title-main panel-title-path"
                      disabled={busy || !focusedContainerPath}
                      title={
                        focusedContainerPath
                          ? t('list.openActiveContainer', { path: focusedContainerPath })
                          : t('list.noActiveContainer')
                      }
                      onClick={() => {
                        if (!focusedContainerPath) return
                        void run('openPath', { path: focusedContainerPath })
                      }}
                    >
                      {t('list.upperTitle', {
                        path: focusedContainerPath || t('list.noActiveContainer'),
                        n: upperVisibleCount,
                      })}
                    </button>
                    ) : (
                    <button
                      type="button"
                      className="panel-title-main panel-title-path"
                      disabled={busy}
                      title={
                        snap.isNetworkLibraryConfigured
                          ? t('list.openNetRoot', { path: snap.networkLibraryRootDisplay })
                          : t('list.configureNetRoot')
                      }
                      onClick={() =>
                        snap.isNetworkLibraryConfigured
                          ? void run('openPath', {
                              path: snap.networkLibraryRootDisplay,
                            })
                          : void run('chooseNetworkLibraryRoot')
                      }
                    >
                      {t('list.upperTitle', {
                        path: snap.isNetworkLibraryConfigured
                          ? snap.networkLibraryRootDisplay
                          : t('list.netUnconfigured'),
                        n: upperVisibleCount,
                      })}
                    </button>
                    )
                    }
                    showCollapse={navShelf === 'local'}
                    collapsed={upperAllCollapsed}
                    onToggleCollapse={() => upperCollapseApiRef.current?.()}
                  />
                </div>
                <div
                  className="list-pane-body is-funnel"
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest('.list-item')) {
                      e.stopPropagation()
                      return
                    }
                    e.preventDefault()
                  }}
                >
                {navShelf === 'local' && !snap.isLibraryConfigured ? (
                  <div className="empty">{t('empty.setLibrary')}</div>
                ) : (
                  <>
                {navShelf === 'local' &&
                snap.showUserRulesSettingsHint &&
                focusedContainerSec?.workspaceId === 'cursor' &&
                focusedContainerSec.isFocused &&
                focusedContainerSec.inContainerItems.some(isCursorRuleListItem) ? (
                  <div className="section-hint">{t('hint.userRules')}</div>
                ) : null}
                  <NetworkWorkbench
                  busy={busy}
                  fetchInProgress={Boolean(
                    networkNavSel && networkFetchHasSource(networkFetch, networkNavSel.id),
                  )}
                  items={upperNetItems}
                  levelGroups={navShelf === 'local'}
                  onCollapseChange={setUpperAllCollapsed}
                  collapseApiRef={upperCollapseApiRef}
                  selectedIds={selected}
                  onToggle={(id, e) =>
                    toggleNetworkCheck(id, e.ctrlKey || e.metaKey, e.shiftKey)
                  }
                  onOpenDoc={(id) => {
                    if (navShelf === 'local') {
                      toggleSelect(id, false, false, 'container')
                      return
                    }
                    openFunnelDoc(id)
                  }}
                  openEntryId={
                    openMdTabs.find((t) => t.tabId === activeMdTabId)?.entryId ?? null
                  }
                  onToggleSelectAll={() => {
                    const ids = upperNetItems.map((x) => x.entryId)
                    const allOn =
                      ids.length > 0 && ids.every((id) => selected.has(id))
                    applyLocalSelection(allOn ? [] : ids)
                  }}
                  emptyHint={
                    navShelf === 'filter'
                      ? funnelEmptyHint
                      : navShelf === 'local'
                        ? q
                          ? t('empty.noSearchMatch')
                          : t('empty.paren')
                        : openEyeCount === 0
                          ? t('net.openEyeFirst')
                          : null
                  }
                  onFetchCurrent={() => {
                    if (!networkNavSel) {
                      setToast(t('toast.pickPopularFirst'))
                      window.setTimeout(() => setToast(null), 3000)
                      return
                    }
                    void fetchNetworkNavSource(networkNavSel.id)
                  }}
                  hasNavFilter={
                    navShelf === 'local' ||
                    networkNavSel != null ||
                    networkNavPickedIds.size > 0
                  }
                  selectedHasCachedSource={Boolean(
                    networkNavSel &&
                      (snap.networkPopularNav ?? []).find((n) => n.id === networkNavSel.id)
                        ?.hasCachedSource,
                  )}
                  lastFetchError={
                    navShelf === 'local'
                      ? null
                      : networkNavSel
                        ? (networkFetchErrors.get(networkNavSel.id) ?? null)
                        : null
                  }
                  onReorderItem={
                    navShelf === 'network'
                      ? (entryId, opts) => {
                          void run('reorderNetworkListItem', {
                            entryId,
                            direction: opts.direction,
                            toIndex: opts.toIndex,
                            visibleIds: upperNetItems.map((x) => x.entryId),
                          })
                        }
                      : undefined
                  }
                  onItemContext={(e, item) => {
                    if (item.funnelOrigin === 'network') {
                      showMenu(e, networkItemMenu(item))
                      return
                    }
                    if (navShelf === 'local') {
                      openEntryMenu(e, item.entryId, 'container')
                      return
                    }
                    const zone: EntryMenuZone = item.isInContainerList
                      ? 'container'
                      : snap.missingItems.some((m) => m.entryId === item.entryId)
                        ? 'missing'
                        : 'library'
                    openEntryMenu(e, item.entryId, zone)
                  }}
                />
                  </>
                )}
                </div>
                        </div>
                      ),
                    },
                    {
                      key: 'lower',
                      min: LIST_LOWER_MIN,
                      priority: isNetworkLikeShelf(navShelf)
                        ? LayoutPriority.Low
                        : LayoutPriority.High,
                      size: listSplitHints.lower,
                      node: (
                        <div
                          className="list-pane list-pane-lower"
                          onContextMenu={(e) => {
                            if ((e.target as HTMLElement).closest('.list-item')) {
                              e.stopPropagation()
                              return
                            }
                            e.preventDefault()
                            showMenu(e, [
                              {
                                label: t('menu.promoteToLibrary'),
                                disabled: busy,
                                onClick: () => void openMoveIntoBackup(),
                              },
                            ])
                          }}
                        >
                          {snap.isLibraryConfigured ? (
                            <div className="panel-title panel-title-library">
                              <ListMetaHeadings
                                lead={
                                  <>
                                    <span className="section-header-label">
                                      {translateLibraryHeader(snap.inLibraryOtherHeader)}
                                    </span>
                                    {snap.libraryRootDisplay ? (
                                      <SectionHeaderPath
                                        path={snap.libraryRootDisplay}
                                        openTitle={t('list.openLibrary', {
                                          path: snap.libraryRootDisplay,
                                        })}
                                        onOpen={onOpenPathStable}
                                      />
                                    ) : null}
                                  </>
                                }
                                showCollapse={filteredRoots.some((n) => n.isGroup)}
                                collapsed={lowerAllCollapsed}
                                onToggleCollapse={() => lowerCollapseApiRef.current?.()}
                              />
                            </div>
                          ) : null}
                          <div className="list-pane-body">
                            {!snap.isLibraryConfigured ? (
                              <div className="empty">{t('empty.setLibrary')}</div>
                            ) : (
                              <>
                    {snap.missingSectionVisible && (
                      <ItemSection
                        tone="missing"
                        title={snap.missingSummary}
                        libraryRoot={snap.libraryRootDisplay}
                        headerExtra={missingHeaderExtra}
                        hintText={t('list.missingHint')}
                        hintTone="missing"
                        items={filteredMissing}
                        selected={selected}
                        onSelect={onSelectEntry}
                        onContext={onContextMissing}
                      />
                    )}
                      <ClusterSection
                        tone="library"
                        libraryRoot={snap.libraryRootDisplay}
                        roots={filteredRoots}
                        flatFallback={libraryAnnotated}
                        selected={selected}
                        onSelect={onSelectEntry}
                        onContext={onContextLibrary}
                        onDropLevel={onDropLevelStable}
                        onDropRegion={onDropRegionStable}
                        onReorderEntry={onReorderEntryStable}
                        onSetLevel={(entryId, level) =>
                          void run('setEntryLevel', { level, entryIds: [entryId] })
                        }
                        onCollapseChange={setLowerAllCollapsed}
                        collapseApiRef={lowerCollapseApiRef}
                      />
                              </>
                            )}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                  onSashChangeEnd={(sizes) => {
                    setListSplitHints({
                      upper: Math.max(LIST_UPPER_MIN, sizes[0] ?? LIST_UPPER_DEFAULT),
                      lower: Math.max(LIST_LOWER_MIN, sizes[1] ?? LIST_LOWER_DEFAULT),
                    })
                  }}
                />
              </section>
            ),
          },
          ...(detailVisible
            ? [
                {
                  key: 'detail',
                  min: DETAIL_MIN,
                  priority: LayoutPriority.Low,
                  size: paneHints.detail,
                  node: (
                    <aside className="panel panel-detail" onContextMenu={(e) => e.stopPropagation()}>
                      <div className="tabs">
                        {(['markdown', 'raw'] as const).map((mode) => (
                          <button
                            key={mode}
                            className={snap.detailPaneMode === mode ? 'active' : ''}
                            onClick={() => void run('setDetailMode', { mode })}
                          >
                            {mode === 'markdown'
                              ? anyMdDirty
                                ? t('detail.markdownDirty')
                                : t('detail.markdown')
                              : t('detail.code')}
                          </button>
                        ))}
                        <div className="tabs-spacer" />
                        {(() => {
                          // 已转入本地的网络条目：详情头部露出「记录」入口
                          const singleSel =
                            snap.selectedEntryIds.length === 1 ? snap.selectedEntryIds[0] : ''
                          const promotedId = singleSel.startsWith('net:')
                            ? (snap.networkLibraryItems ?? []).find(
                                (x) => x.entryId === singleSel,
                              )?.promotedEntryId || ''
                            : ''
                          return promotedId ? (
                            <button
                              type="button"
                              className="tabs-action"
                              title={t('detail.recordHint', { id: promotedId })}
                              onClick={() => void openEntryOpsLog(singleSel)}
                            >
                              {t('detail.record')}
                            </button>
                          ) : null
                        })()}
                        <button
                          type="button"
                          className={`tabs-action${themeGalleryOpen ? ' active' : ''}`}
                          title={t('detail.styleHint')}
                          onClick={() => setThemeGalleryOpen((v) => !v)}
                        >
                          {t('detail.style')}
                        </button>
                      </div>
                      <div className="detail-body-wrap">
                        <div
                          className={
                            snap.detailPaneMode === 'markdown'
                              ? 'detail detail-markdown detail-mode-markdown'
                              : snap.detailPaneMode === 'raw'
                                ? 'detail detail-raw detail-mode-raw'
                                : 'detail detail-mode-summary'
                          }
                        >
                          {snap.detailPaneMode === 'raw' ? (
                            <pre className="detail-mode-panel detail-raw-pre">
                              {snap.detailMarkdownText || t('empty.noContent')}
                            </pre>
                          ) : null}
                          {openMdTabs.length > 0 ? (
                            <div
                              className="detail-md-host"
                              hidden={snap.detailPaneMode !== 'markdown'}
                            >
                              <DetailMarkdownTabHost
                                tabs={openMdTabs}
                                activeId={activeMdTabId}
                                dirtyById={mdDirtyById}
                                mdStyle={mdStyle}
                                paneActive={snap.detailPaneMode === 'markdown'}
                                onActivate={activateMdTab}
                                onClose={closeMdTab}
                                onDirtyChange={setTabDirty}
                                onSave={saveDetailMarkdown}
                                onTabContextMenu={onMdTabContextMenu}
                              />
                            </div>
                          ) : snap.detailPaneMode === 'markdown' ? (
                            <div className="detail-md-empty">
                              {snap.selectedEntryIds.length === 0
                                ? t('empty.pickMd')
                                : snap.selectedEntryIds.length > 1
                                  ? t('empty.multiSelectMd')
                                  : snap.selectedEntryIds[0]?.startsWith('net:')
                                    ? t('empty.netNoBody')
                                    : t('empty.noContent')}
                            </div>
                          ) : null}
                        </div>
                        {themeGalleryOpen ? (
                          <div className="theme-gallery-drawer" role="dialog" aria-label={t('detail.galleryAria')}>
                            <div className="theme-gallery-drawer-bar">
                              <span>{t('detail.gallery')}</span>
                              <button
                                type="button"
                                className="theme-gallery-close"
                                onClick={() => setThemeGalleryOpen(false)}
                              >
                                {t('dialog.close')}
                              </button>
                            </div>
                            <ThemeGalleryPanel state={mdStyle} onChange={updateMdStyle} />
                          </div>
                        ) : null}
                      </div>
                    </aside>
                  ),
                },
              ]
            : []),
        ]}
      />

      {(() => {
        const jobs = [...networkFetch.values()]
        const queued = fetchQueue
        const fetchCount = jobs.length
        const queueCount = queued.length
        const fetchStalled = jobs.some((j) => j.stalled)
        const showFetchPanel =
          fetchModalOpen && (fetchCount > 0 || queueCount > 0)
        const statusFetchLabel =
          queueCount > 0
            ? t('status.fetchQueue', { active: fetchCount, queued: queueCount })
            : t('status.fetchingN', { n: fetchCount })
        const statusRaw = (snap.statusText || '').trim()
        const statusIsError =
          statusRaw === '尚未配置永久库目录。' ||
          statusRaw.startsWith('台账加载失败')
        const shownCount =
          navShelf === 'filter' ? funnelItems.length : networkBrowseItems.length
        const leftText = toast
          ? toast
          : statusIsError
            ? translateStatusText(snap.statusText)
            : navShelf === 'local'
              ? t('status.containerN', { n: containerCount })
              : navShelf === 'filter'
                ? t('status.filterShownN', { n: shownCount })
                : t('status.shownN', { n: shownCount })
        const leftTitle = toast
          ? toast
          : statusIsError
            ? leftText
            : navShelf === 'local'
              ? t('status.containerTitle')
              : navShelf === 'filter'
                ? t('status.filterShownTitle')
                : t('status.shownTitle')
        const showCounts = !statusIsError
        const selectedIds = snap.selectedEntryIds ?? []
        const selectedItem =
          selectedIds.length === 1
            ? findListItem(selectedIds[0]) ||
              funnelPool.find((x) => x.entryId === selectedIds[0])
            : undefined
        const centerDocName =
          selectedIds.length > 1
            ? t('status.selected', { n: selectedIds.length })
            : selectedIds.length === 1
              ? statusCurrentDocName(selectedItem?.displayName, selectedIds[0])
              : ''
        const showLibraryCount = showCounts && navShelf === 'local'
        const showNetworkCount = showCounts && navShelf === 'network'
        const showFilterPoolOfAll = showCounts && navShelf === 'filter'
        const filterAllCount = uniqueLocalCount + networkCount
        return (
          <>
            <div className="status-bar">
              <div className="status-bar-left" title={leftTitle}>
                {leftText}
              </div>
              {centerDocName ? (
                <div className="status-bar-center" title={centerDocName}>
                  {centerDocName}
                </div>
              ) : null}
              <div className="status-bar-right">
                {showFilterPoolOfAll ? (
                  <span
                    className="status-bar-item"
                    title={t('status.filterPoolOfAllTitle')}
                  >
                    {t('status.filterPoolOfAll', {
                      pool: funnelPool.length,
                      total: filterAllCount,
                    })}
                  </span>
                ) : null}
                {showLibraryCount ? (
                  <span className="status-bar-item" title={t('status.libraryTitle')}>
                    {t('status.libraryN', { n: libraryCount })}
                  </span>
                ) : null}
                {showNetworkCount ? (
                  <button
                    type="button"
                    className="status-bar-item"
                    title={
                      navShelf === 'network' &&
                      (networkNavSel || networkNavPickedIds.size > 0)
                        ? t('status.showAllCached')
                        : t('status.networkTitle')
                    }
                    onClick={() => {
                      if (navShelf !== 'network') return
                      setNetworkNavSel(null)
                      setNetworkNavPickedIds(new Set())
                      networkNavAnchorRef.current = null
                    }}
                  >
                    {t('status.networkN', { n: networkCount })}
                  </button>
                ) : null}
                {busy ? (
                  <span className="status-bar-item status-bar-item-busy">{t('toolbar.processing')}</span>
                ) : null}
                {fetchCount > 0 || queueCount > 0 ? (
                  <button
                    type="button"
                    className="status-bar-item status-bar-item-fetch"
                    title={t('status.openFetch')}
                    onClick={() => setFetchModalOpen(true)}
                  >
                    {statusFetchLabel}
                    {fetchStalled ? t('status.stalled') : ''}
                  </button>
                ) : null}
              </div>
            </div>

            {showFetchPanel ? (
              <div className="modal-backdrop" onClick={() => undefined}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>
                    {t('fetch.title', { active: fetchCount, queued: queueCount })}
                  </h3>
                  <div className="modal-scroll">
                    <ul className="fetch-job-list">
                      {jobs.map((job) => (
                        <FetchJobCard
                          key={job.jobId}
                          job={job}
                          expanded={fetchJobExpanded.has(job.jobId)}
                          onToggleExpand={() =>
                            setFetchJobExpanded((prev) => {
                              const next = new Set(prev)
                              if (next.has(job.jobId)) next.delete(job.jobId)
                              else next.add(job.jobId)
                              return next
                            })
                          }
                          onCancel={() => void cancelNetworkFetchJob(job.jobId)}
                        />
                      ))}
                      {queued.map((item) => {
                        const key = fetchRequestKey(item)
                        const label =
                          presumedFetchSourceId(item) ||
                          item.label ||
                          item.urlOrBaselineId ||
                          t('fetch.pending')
                        return (
                          <li key={`q-${key}`} className="fetch-job-item fetch-job-queued">
                            <div className="fetch-job-row">
                              <div className="fetch-job-toggle">
                                <span className="fetch-job-id">{label}</span>
                                <span className="fetch-job-meta">{t('fetch.queued')}</span>
                              </div>
                              <button type="button" onClick={() => dequeueNetworkFetch(key)}>
                                {t('fetch.cancelQueue')}
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <div className="actions fetch-modal-actions">
                    <div
                      className="fetch-concurrency"
                      title={t('fetch.concurrencyHint')}
                    >
                      {t('fetch.simultaneous')}
                      <button
                        type="button"
                        className="fetch-concurrency-step"
                        disabled={fetchConcurrency <= FETCH_CONCURRENCY_MIN}
                        aria-label={t('fetch.lessParallel')}
                        onClick={() => persistFetchConcurrency(fetchConcurrency - 1)}
                      >
                        −
                      </button>
                      <span className="fetch-concurrency-value">{fetchConcurrency}</span>
                      <button
                        type="button"
                        className="fetch-concurrency-step"
                        disabled={fetchConcurrency >= FETCH_CONCURRENCY_MAX}
                        aria-label={t('fetch.moreParallel')}
                        onClick={() => persistFetchConcurrency(fetchConcurrency + 1)}
                      >
                        +
                      </button>
                      {t('fetch.roads')}
                      {fetchConcurrency === FETCH_CONCURRENCY_DEFAULT ? (
                        <span className="fetch-concurrency-hint">{t('fetch.recommended')}</span>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => setFetchModalOpen(false)}>
                      {t('fetch.backgroundAll')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )
      })()}
      {firstTip ? (
        <div className="tip-banner" role="status">
          {t('tip.firstRun')}
          <button
            type="button"
            style={{ marginLeft: 12 }}
            onClick={() => {
              try {
                localStorage.setItem('ccm.firstTip', '0')
              } catch {
                /* ignore */
              }
              setFirstTip(false)
            }}
          >
            {t('tip.gotIt')}
          </button>
        </div>
      ) : null}
      {ctx && <ContextMenu state={ctx} onClose={() => setCtx(null)} />}

      {projectDialog && (
        <div className="modal-backdrop" onClick={() => setProjectDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('dialog.editProject')}</h3>
            <div className="form-grid">
              <label>
                {t('dialog.name')}
                <input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                {t('dialog.rootPath')}
                <div className="row">
                  <input
                    style={{ flex: 1 }}
                    value={projectForm.rootPath}
                    onChange={(e) => setProjectForm((f) => ({ ...f, rootPath: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await invoke<{ path: string | null }>('pickFolder', {
                        title: t('dialog.pickProjectRoot'),
                      })
                      if (res.data?.path) {
                        setProjectForm((f) => ({
                          ...f,
                          rootPath: res.data!.path!,
                          name: f.name || res.data!.path!.split(/[/\\]/).pop() || '',
                        }))
                      }
                    }}
                  >
                    {t('dialog.browse')}
                  </button>
                </div>
              </label>
              <label>
                {t('dialog.category')}
                <input
                  value={projectForm.category}
                  onChange={(e) => setProjectForm((f) => ({ ...f, category: e.target.value }))}
                />
              </label>
            </div>
            <div className="actions">
              <button onClick={() => setProjectDialog(null)}>{t('dialog.cancel')}</button>
              <button
                className="primary"
                onClick={async () => {
                  apply(await invoke('editProject', projectForm))
                  setProjectDialog(null)
                }}
              >
                {t('dialog.ok')}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeDialog && (
        <div className="modal-backdrop" onClick={() => !busy && setRemoveDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('dialog.deleteProject')}</h3>
            <p className="sub">
              {t('dialog.deleteProjectBody', {
                name: removeDialog.projectName,
                n: removeDialog.fileCount,
              })}
            </p>
            <div className="actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <button
                className="danger"
                disabled={busy}
                onClick={async () => {
                  if (busy) return
                  setBusy(true)
                  try {
                    apply(
                      await invoke('removeProject', {
                        id: removeDialog.projectId,
                        forceDeleteMarkers: true,
                      }),
                    )
                    setRemoveDialog(null)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {t('dialog.forceDeleteCursor')}
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  void run('openProjectCursor', { id: removeDialog.projectId })
                }}
              >
                {t('dialog.openCurrentDir')}
              </button>
              <button disabled={busy} onClick={() => setRemoveDialog(null)}>
                {t('dialog.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {movePreview && (
        <MoveIntoBackupModal
          preview={movePreview}
          busy={busy}
          onClose={() => !busy && setMovePreview(null)}
          onConfirm={(entryIds) => void submitMoveIntoBackup([], entryIds)}
        />
      )}

      {containerRootEditor && (
        <ContainerRootEditorModal
          editor={containerRootEditor}
          busy={busy}
          onClose={() => !busy && setContainerRootEditor(null)}
          onPathChange={(path) =>
            setContainerRootEditor((prev) => (prev ? { ...prev, path } : prev))
          }
          onPickFolder={async () => {
            const pick = await invoke<{ path: string | null }>('pickFolder', {
              title: t('dialog.pickContainerRoot', { label: containerRootEditor.label }),
            })
            return pick.data?.path?.trim() || null
          }}
          onSave={async () => {
            const { id, path } = containerRootEditor
            setBusy(true)
            try {
              const res = apply(
                await invoke('updateWorkspaceConfig', {
                  id,
                  containerRoot: path.trim().replace(/\//g, '\\'),
                }),
              )
              if (!res.ok) {
                setToast(res.message || t('toast.cannotUpdateRoot'))
                window.setTimeout(() => setToast(null), 4000)
                return
              }
              setContainerRootEditor(null)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
            } finally {
              setBusy(false)
            }
          }}
          onRestoreDefault={async () => {
            const { id } = containerRootEditor
            setBusy(true)
            try {
              const res = apply(
                await invoke('updateWorkspaceConfig', {
                  id,
                  containerRoot: '',
                }),
              )
              if (!res.ok) {
                setToast(res.message || t('toast.cannotRestoreRoot'))
                window.setTimeout(() => setToast(null), 4000)
                return
              }
              const next = (res.snapshot?.workspaces ?? []).find((w) => w.id === id)
              if (next) {
                setContainerRootEditor({
                  id,
                  label: next.displayName || id,
                  path: (next.containerRoot || '').trim(),
                })
              } else {
                setContainerRootEditor(null)
              }
              setToast(t('toast.restoredRoot'))
              window.setTimeout(() => setToast(null), 3000)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}

      {scanBuildPreview && (
        <ScanBuildPreviewModal
          preview={scanBuildPreview}
          busy={busy}
          onClose={() => !busy && setScanBuildPreview(null)}
          onConfirm={(keys) => void runConfirmScanBuild(keys)}
        />
      )}

      {opsLog && <EntryOpsLogModal log={opsLog} onClose={() => setOpsLog(null)} />}

      {conflicts && conflictOp && (
        <ConflictCompareModal
          conflicts={conflicts}
          operation={conflictOp}
          busy={busy}
          onClose={() => {
            if (busy) return
            setConflicts(null)
            setConflictOp(null)
            setPendingPromoteIds(null)
            setPendingClearProjectIds(null)
          }}
          onConfirm={(resolutions) => void submitConflictResolutions(resolutions)}
        />
      )}

      {settingsOpen && snap ? (
        <SettingsModal
          snap={snap}
          busy={busy}
          onClose={() => !busy && setSettingsOpen(false)}
          onPickLibrary={async () => {
            await run('chooseLibraryRoot', { forcePrompt: true })
          }}
          onPickNetworkLibrary={async () => {
            await run('chooseNetworkLibraryRoot')
          }}
          onPickFolder={async (title) => {
            const pick = await invoke<{ path: string | null }>('pickFolder', { title })
            return pick.data?.path?.trim() || null
          }}
          onOpenPath={async (path) => {
            try {
              apply(await invoke('openPath', { path }))
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
            }
          }}
          onSave={async (patch) => {
            setBusy(true)
            try {
              const res = apply(await invoke('updateAppSettings', { ...patch }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onCleanupNetworkCache={async () => {
            await cleanupNetworkCache()
          }}
          hideMirrors={hideMirrors}
          onHideMirrorsChange={setHideMirrors}
          onReorderScanRoot={async (path, opts) => {
            const res = apply(
              await invoke('reorderProjectScanRoots', {
                path,
                direction: opts.direction,
                toIndex: opts.toIndex,
              }),
            )
            return Boolean(res.ok)
          }}
          onResetCatalog={async (deleteNetworkCache) => {
            setBusy(true)
            try {
              const res = apply(await invoke('resetCatalog', { deleteNetworkCache }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onExportCatalog={async () => {
            const now = new Date()
            const y = now.getFullYear()
            const m = String(now.getMonth() + 1).padStart(2, '0')
            const d = String(now.getDate()).padStart(2, '0')
            const defaultName = `catalog-${y}${m}${d}.json`
            try {
              const pick = await invoke<{ path: string | null }>('saveFile', {
                title: t('settings.exportTitle'),
                defaultName,
                filterName: 'JSON',
                filterExt: 'json',
              })
              const path = pick.data?.path?.trim()
              if (!path) return false
              const res = apply(await invoke('exportCatalog', { path }))
              if (res.ok) {
                setToast(res.message || t('toast.catalogSaved', { path }))
                window.setTimeout(() => setToast(null), 4000)
              }
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            }
          }}
          onImportCatalog={async () => {
            const okConfirm = window.confirm(
              t('settings.importConfirm'),
            )
            if (!okConfirm) return false
            try {
              const pick = await invoke<{ path: string | null }>('pickFile', {
                title: t('settings.importTitle'),
                filterName: 'JSON',
                filterExt: 'json',
              })
              const path = pick.data?.path?.trim()
              if (!path) return false
              setBusy(true)
              const res = apply(await invoke('importCatalog', { path }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : null}

      {tagDialog && (
        <div className="modal-backdrop" onClick={() => setTagDialog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{t('dialog.editTags')}</h3>
            <div className="form-grid">
              <label>
                {t('dialog.scope')}
                <input value={tagScope} onChange={(e) => setTagScope(e.target.value)} />
              </label>
              <label>
                {t('dialog.purposes')}
                <input value={tagPurposes} onChange={(e) => setTagPurposes(e.target.value)} />
              </label>
              <div className="taxonomy-chips">
                {(
                  [
                    'engineering.building',
                    'engineering.review',
                    'code.csharp',
                    'code.cursor',
                    'learning.method',
                    'meta.docs',
                  ]
                ).map((key) => {
                  const selectedKeys = new Set(
                    tagPurposes
                      .split(/[,，]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                  const on = selectedKeys.has(key)
                  return (
                    <button
                      type="button"
                      key={key}
                      className={on ? 'chip active' : 'chip'}
                      onClick={() => {
                        const next = new Set(selectedKeys)
                        if (on) next.delete(key)
                        else next.add(key)
                        setTagPurposes([...next].join(', '))
                      }}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="actions">
              <button onClick={() => setTagDialog(false)}>{t('dialog.cancel')}</button>
              <button
                className="primary"
                onClick={async () => {
                  apply(
                    await invoke('editTags', {
                      scope: tagScope.trim() || 'global',
                      purposes: tagPurposes
                        .split(/[,，]/)
                        .map((s) => s.trim())
                        .filter(Boolean),
                    }),
                  )
                  setTagDialog(false)
                }}
              >
                {t('dialog.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {suggestDialog && (
        <SuggestPurposesModal
          data={suggestDialog}
          busy={busy}
          onClose={() => setSuggestDialog(null)}
          onToggle={(entryId, selectedFlag) => {
            setSuggestDialog((d) =>
              d
                ? {
                    ...d,
                    suggestions: d.suggestions.map((s) =>
                      s.entryId === entryId ? { ...s, selected: selectedFlag } : s,
                    ),
                  }
                : d,
            )
          }}
          onSelectAll={(selectedFlag) => {
            setSuggestDialog((d) =>
              d
                ? {
                    ...d,
                    suggestions: d.suggestions.map((s) => ({ ...s, selected: selectedFlag })),
                  }
                : d,
            )
          }}
          onSelectKind={(kind, selectedFlag) => {
            setSuggestDialog((d) =>
              d
                ? {
                    ...d,
                    suggestions: d.suggestions.map((s) =>
                      s.kind === kind ? { ...s, selected: selectedFlag } : s,
                    ),
                  }
                : d,
            )
          }}
          onConfirm={async () => {
            const items = suggestDialog.suggestions
              .filter((s) => s.selected)
              .map((s) => ({
                entryId: s.entryId,
                purpose: s.suggestedPurpose || undefined,
                level: s.suggestedLevel,
              }))
            setBusy(true)
            try {
              apply(await invoke('applySuggestedPurposes', { items }))
              setSuggestDialog(null)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
            } finally {
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

function ContextMenu({ state, onClose }: { state: NonNullable<CtxState>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: state.x, top: state.y })
  const [openSub, setOpenSub] = useState<string | null>(null)
  const [subOpenLeft, setSubOpenLeft] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const pad = 6
    const { width, height } = el.getBoundingClientRect()
    let left = state.x
    let top = state.y
    if (left + width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - width - pad)
    }
    if (top + height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - height - pad)
    }
    if (left < pad) left = pad
    if (top < pad) top = pad
    setPos({ left, top })
    // 主菜单右侧空间不足时，子菜单向左展开
    setSubOpenLeft(left + width + 160 > window.innerWidth - pad)
  }, [state.x, state.y, state.items])

  useEffect(() => {
    setOpenSub(null)
  }, [state.x, state.y, state.items])

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {state.items.map((item) => {
        const hasChildren = Boolean(item.children?.length)
        const subOpen = openSub === item.label
        return (
          <div
            key={item.label}
            className="context-menu-item-wrap"
            onMouseEnter={() => {
              if (hasChildren && !item.disabled) setOpenSub(item.label)
              else setOpenSub(null)
            }}
          >
            <button
              type="button"
              className={item.danger ? 'danger' : undefined}
              disabled={item.disabled}
              title={item.title}
              onClick={(e) => {
                e.stopPropagation()
                if (hasChildren) {
                  setOpenSub(subOpen ? null : item.label)
                  return
                }
                onClose()
                item.onClick?.()
              }}
            >
              <span className="context-menu-label">{item.label}</span>
              {hasChildren ? <span className="context-menu-caret">▸</span> : null}
            </button>
            {hasChildren && subOpen ? (
              <div
                className={`context-menu context-menu-sub${subOpenLeft ? ' open-left' : ''}`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {item.children!.map((child) => (
                  <button
                    key={child.label}
                    type="button"
                    className={child.danger ? 'danger' : undefined}
                    disabled={child.disabled}
                    title={child.title}
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose()
                      child.onClick?.()
                    }}
                  >
                    <span className="context-menu-check">{child.checked ? '✓' : ''}</span>
                    <span className="context-menu-label">{child.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

/** VS Code / Windows 标题栏同款细线图标 */
function WinIconMinimize() {
  return (
    <svg className="win-icon" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" />
    </svg>
  )
}

function WinIconMaximize() {
  return (
    <svg className="win-icon" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 1.5h7v7h-7z" />
    </svg>
  )
}

function WinIconRestore() {
  return (
    <svg className="win-icon" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M3 1.5h5.5v5.5" />
      <path d="M1.5 3h5.5v5.5h-5.5z" />
    </svg>
  )
}

function WinIconClose() {
  return (
    <svg className="win-icon" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
    </svg>
  )
}

function WindowControls({
  maximized,
  setMaximized,
}: {
  maximized: boolean
  setMaximized: (v: boolean) => void
}) {
  const { t } = useI18n()
  return (
    <div className="window-controls">
      <button type="button" title={t('win.minimize')} onClick={() => void invoke('windowMinimize')}>
        <WinIconMinimize />
      </button>
      <button
        type="button"
        title={maximized ? t('win.restore') : t('win.maximize')}
        onClick={async () => {
          const res = await invoke<{ maximized: boolean }>('windowMaximizeToggle')
          if (res.ok && res.data) setMaximized(Boolean(res.data.maximized))
        }}
      >
        {maximized ? <WinIconRestore /> : <WinIconMaximize />}
      </button>
      <button type="button" className="win-close" title={t('win.close')} onClick={() => void invoke('windowClose')}>
        <WinIconClose />
      </button>
    </div>
  )
}

type NavReorderSection = 'pinned' | 'unpinned'
type NavDropSection = NavReorderSection | 'ws:visible' | 'ws:pool' | 'ws:all'
type NavProjectDragPayload = { projectId: string; section: NavDropSection; label: string }
type NavProjectOpResult =
  | { ok?: boolean; message?: string; snapshot?: AppSnapshot }
  | undefined
type NavDropTarget =
  | {
      kind: 'project'
      projectId: string
      section: NavDropSection
      insert: 'before' | 'after'
    }
  | { kind: 'section'; section: NavReorderSection }
type NavDragOver =
  | { kind: 'project'; projectId: string; insert: 'before' | 'after' }
  | { kind: 'section'; section: NavReorderSection }

function navSectionFromParentPath(parentPath: string): NavReorderSection | null {
  // 「隐藏容器」池 = 关眼；主区「容器」下直挂开眼叶
  if (parentPath.includes('隐藏容器')) return 'unpinned'
  if (parentPath === '容器' || parentPath.startsWith('容器/')) return 'pinned'
  return null
}

function peersInNavSection(
  projects: ProjectItemDto[],
  section: NavReorderSection,
): string[] {
  const pinned = section === 'pinned'
  return projects.filter((p) => p.pinned === pinned).map((p) => p.id)
}

type NavReorderFn = (
  id: string,
  opts: { direction?: ReorderDirection; toIndex?: number; peerIds?: string[] },
) => Promise<NavProjectOpResult>

/** 侧栏工作区拖/右键 peers：齿轮展开=睁眼叶+池叶显示序；收起=仅可见叶。 */
function workspaceNavPeerIds(workspaces: WorkspaceDto[], poolOpen: boolean): string[] {
  const visible = workspaces
    .filter((w) => w.inWorkArea && w.isVisible)
    .map((w) => w.id)
  if (!poolOpen) return visible
  const pool = workspaces.filter((w) => !w.inWorkArea).map((w) => w.id)
  return [...visible, ...pool]
}

async function ensureSectionThenReorderToward(
  projectId: string,
  targetSection: NavReorderSection,
  sourceSection: NavReorderSection,
  projects: ProjectItemDto[],
  onReorder: NavReorderFn,
  onTogglePin: (id: string) => Promise<NavProjectOpResult>,
  /** 目标 peer 下标；缺省=移到该组末尾 */
  targetPeerIndex?: number,
) {
  let catalog = projects
  if (sourceSection !== targetSection) {
    const toggled = await onTogglePin(projectId)
    if (toggled?.snapshot?.projects) catalog = toggled.snapshot.projects
  }
  const peers = peersInNavSection(catalog, targetSection)
  const from = peers.indexOf(projectId)
  if (from < 0) return
  const to =
    targetPeerIndex == null
      ? peers.length - 1
      : Math.max(0, Math.min(targetPeerIndex, peers.length - 1))
  if (from === to) return
  await onReorder(projectId, { toIndex: to })
}

async function moveNavProjectToTarget(
  projectId: string,
  target: NavDropTarget,
  sourceSection: NavReorderSection,
  projects: ProjectItemDto[],
  onReorder: NavReorderFn,
  onTogglePin: (id: string) => Promise<NavProjectOpResult>,
) {
  if (target.kind === 'section') {
    await ensureSectionThenReorderToward(
      projectId,
      target.section,
      sourceSection,
      projects,
      onReorder,
      onTogglePin,
    )
    return
  }
  if (
    target.section === 'ws:visible' ||
    target.section === 'ws:pool' ||
    target.section === 'ws:all'
  ) {
    return
  }
  if (projectId === target.projectId) return
  const targetSection = target.section
  let catalog = projects
  if (sourceSection !== targetSection) {
    const toggled = await onTogglePin(projectId)
    if (toggled?.snapshot?.projects) catalog = toggled.snapshot.projects
  }
  const peers = peersInNavSection(catalog, targetSection)
  const from = peers.indexOf(projectId)
  const to = peers.indexOf(target.projectId)
  if (from < 0 || to < 0) return
  const dest = destIndexFromInsert(from, to, target.insert, peers.length)
  await ensureSectionThenReorderToward(
    projectId,
    targetSection,
    targetSection,
    catalog,
    onReorder,
    onTogglePin,
    dest,
  )
}

function hitTestNavDrop(clientX: number, clientY: number): NavDropTarget | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (!el || !(el instanceof Element)) return null
  const node = el.closest('[data-nav-drop]')
  if (!node) return null
  const raw = node.getAttribute('data-nav-drop') || ''
  if (raw === 'section:pinned') return { kind: 'section', section: 'pinned' }
  if (raw === 'section:unpinned') return { kind: 'section', section: 'unpinned' }
  if (raw.startsWith('wsitem:')) {
    // wsitem:{all|visible|pool}:{toolId}
    const rest = raw.slice('wsitem:'.length)
    const idx = rest.indexOf(':')
    if (idx <= 0) return null
    const wsSection = rest.slice(0, idx)
    const toolId = rest.slice(idx + 1)
    if (
      (wsSection !== 'all' && wsSection !== 'visible' && wsSection !== 'pool') ||
      !toolId
    ) {
      return null
    }
    const rect = node.getBoundingClientRect()
    const insert: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    const section =
      wsSection === 'all' ? 'ws:all' : wsSection === 'pool' ? 'ws:pool' : 'ws:visible'
    return {
      kind: 'project',
      projectId: toolId,
      section,
      insert,
    }
  }
  if (raw.startsWith('project:')) {
    const rest = raw.slice('project:'.length)
    const idx = rest.lastIndexOf(':')
    if (idx <= 0) return null
    const projectId = rest.slice(0, idx)
    const section = rest.slice(idx + 1)
    if (section !== 'pinned' && section !== 'unpinned') return null
    const rect = node.getBoundingClientRect()
    const insert: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return { kind: 'project', projectId, section, insert }
  }
  return null
}

function navDropToOver(hit: NavDropTarget): NavDragOver {
  if (hit.kind === 'section') return { kind: 'section', section: hit.section }
  return { kind: 'project', projectId: hit.projectId, insert: hit.insert }
}

const PRIMARY_WORK_AREA_IDS = new Set(['cursor', 'claude', 'codex'])

function NavTree({
  nodes,
  projects,
  workspaces,
  selectedKind,
  selectedProjectId,
  pickedProjectIds,
  selectedGlobalTool,
  onSelect,
  onSelectProject,
  onClearProjectSkills,
  clearSkillsDisabled,
  onToggleInWorkArea,
  onSetDefaultWorkspace,
  onEditContainerRoot,
  onContextGlobal,
  onContextProject,
  onReorderProject,
  onTogglePinProject,
  onReorderWorkspace,
  workspacePoolOpen,
  onWorkspacePoolOpenChange,
  projectPoolOpen,
  onProjectPoolOpenChange,
  onBulkSetWorkArea,
  onBulkSetProjectsVisible,
  onAddContainer,
}: {
  nodes: NavNodeDto[]
  projects: ProjectItemDto[]
  workspaces: WorkspaceDto[]
  selectedKind: string
  selectedProjectId?: string | null
  pickedProjectIds: Set<string>
  selectedGlobalTool: string
  onSelect: (kind: string, projectId?: string | null, tool?: string | null) => void
  onSelectProject: (
    projectId: string,
    e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => void
  onClearProjectSkills: () => void
  clearSkillsDisabled: boolean
  onToggleInWorkArea: (id: string, inWorkArea: boolean) => void
  onSetDefaultWorkspace: (id: string) => void
  onEditContainerRoot: (id: string) => void
  onContextGlobal: (e: ReactMouseEvent, tool: string) => void
  onContextProject: (e: ReactMouseEvent, id: string) => void
  onReorderProject: NavReorderFn
  onTogglePinProject: (id: string) => Promise<NavProjectOpResult>
  onReorderWorkspace: NavReorderFn
  workspacePoolOpen: boolean
  onWorkspacePoolOpenChange: (open: boolean | ((prev: boolean) => boolean)) => void
  projectPoolOpen: boolean
  onProjectPoolOpenChange: (open: boolean | ((prev: boolean) => boolean)) => void
  onBulkSetWorkArea: (show: boolean) => void
  onBulkSetProjectsVisible: (show: boolean) => void
  onAddContainer: () => void
}) {
  const { t } = useI18n()
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [dragState, setDragState] = useState<NavProjectDragPayload | null>(null)
  const [dragOver, setDragOver] = useState<NavDragOver | null>(null)
  const [pointerPos, setPointerPos] = useState({ x: 0, y: 0 })
  const projectsRef = useRef(projects)
  projectsRef.current = projects
  const workspacesRef = useRef(workspaces)
  workspacesRef.current = workspaces
  const workspacePoolOpenRef = useRef(workspacePoolOpen)
  workspacePoolOpenRef.current = workspacePoolOpen
  const projectPoolOpenRef = useRef(projectPoolOpen)
  projectPoolOpenRef.current = projectPoolOpen
  const onProjectPoolOpenChangeRef = useRef(onProjectPoolOpenChange)
  onProjectPoolOpenChangeRef.current = onProjectPoolOpenChange
  const reorderRef = useRef(onReorderProject)
  reorderRef.current = onReorderProject
  const reorderWsRef = useRef(onReorderWorkspace)
  reorderWsRef.current = onReorderWorkspace
  const togglePinRef = useRef(onTogglePinProject)
  togglePinRef.current = onTogglePinProject
  const reorderingRef = useRef(false)
  const suppressClickRef = useRef(false)
  /** 指针拖（不用 HTML5 DnD：WebView2 上 DataTransfer/drop 不可靠） */
  const pointerSession = useRef<{
    projectId: string
    section: NavReorderSection
    label: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  const wsPointerSession = useRef<{
    tool: string
    label: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)

  useEffect(() => {
    const clearDragUi = () => {
      pointerSession.current = null
      setDragState(null)
      setDragOver(null)
      document.body.classList.remove('nav-project-dragging')
    }

    const onMove = (e: PointerEvent) => {
      const wsSession = wsPointerSession.current
      if (wsSession) {
        const dx = e.clientX - wsSession.startX
        const dy = e.clientY - wsSession.startY
        if (!wsSession.active) {
          if (dx * dx + dy * dy < LIST_DRAG_THRESHOLD_PX * LIST_DRAG_THRESHOLD_PX) return
          wsSession.active = true
          suppressClickRef.current = true
          document.body.classList.add('nav-project-dragging')
          setDragState({
            projectId: `ws:${wsSession.tool}`,
            section: workspacePoolOpenRef.current ? 'ws:all' : 'ws:visible',
            label: wsSession.label,
          })
        }
        e.preventDefault()
        setPointerPos({ x: e.clientX, y: e.clientY })
        const hit = hitTestNavDrop(e.clientX, e.clientY)
        if (
          !hit ||
          hit.kind !== 'project' ||
          hit.projectId === wsSession.tool ||
          (hit.section !== 'ws:all' &&
            hit.section !== 'ws:visible' &&
            hit.section !== 'ws:pool')
        ) {
          setDragOver(null)
          return
        }
        setDragOver(navDropToOver(hit))
        return
      }
      const session = pointerSession.current
      if (!session) return
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (!session.active) {
        if (dx * dx + dy * dy < LIST_DRAG_THRESHOLD_PX * LIST_DRAG_THRESHOLD_PX) return
        session.active = true
        suppressClickRef.current = true
        document.body.classList.add('nav-project-dragging')
        setDragState({
          projectId: session.projectId,
          section: session.section,
          label: session.label,
        })
        // 拖项目时展开隐藏池，便于跨区落到关眼叶
        onProjectPoolOpenChangeRef.current(true)
      }
      e.preventDefault()
      setPointerPos({ x: e.clientX, y: e.clientY })
      const hit = hitTestNavDrop(e.clientX, e.clientY)
      if (!hit || (hit.kind === 'project' && hit.projectId === session.projectId)) {
        setDragOver(null)
        return
      }
      setDragOver(navDropToOver(hit))
    }

    const onUp = (e: PointerEvent) => {
      const wsSession = wsPointerSession.current
      if (wsSession) {
        const wasActive = wsSession.active
        const tool = wsSession.tool
        wsPointerSession.current = null
        setDragState(null)
        setDragOver(null)
        document.body.classList.remove('nav-project-dragging')
        if (!wasActive || reorderingRef.current) return
        const hit = hitTestNavDrop(e.clientX, e.clientY)
        if (!hit || hit.kind !== 'project') return
        if (
          hit.section !== 'ws:all' &&
          hit.section !== 'ws:visible' &&
          hit.section !== 'ws:pool'
        ) {
          return
        }
        const peerIds = workspaceNavPeerIds(
          workspacesRef.current,
          workspacePoolOpenRef.current,
        )
        const from = peerIds.findIndex(
          (id) => id === tool || id.toLowerCase() === tool.toLowerCase(),
        )
        const to = peerIds.findIndex(
          (id) =>
            id === hit.projectId || id.toLowerCase() === hit.projectId.toLowerCase(),
        )
        if (from < 0 || to < 0 || tool === hit.projectId) return
        const dest = destIndexFromInsert(from, to, hit.insert, peerIds.length)
        reorderingRef.current = true
        void reorderWsRef.current(tool, { toIndex: dest, peerIds }).finally(() => {
          reorderingRef.current = false
        })
        return
      }
      const session = pointerSession.current
      if (!session) return
      const wasActive = session.active
      const source = {
        projectId: session.projectId,
        section: session.section,
        label: session.label,
      }
      clearDragUi()
      if (!wasActive || reorderingRef.current) return
      const hit = hitTestNavDrop(e.clientX, e.clientY)
      if (!hit) return
      if (hit.kind === 'project' && hit.projectId === source.projectId) return
      reorderingRef.current = true
      void moveNavProjectToTarget(
        source.projectId,
        hit,
        source.section,
        projectsRef.current,
        (id, opts) => reorderRef.current(id, opts),
        (id) => togglePinRef.current(id),
      ).finally(() => {
        reorderingRef.current = false
      })
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('nav-project-dragging')
    }
  }, [nodes])

  const render = (list: NavNodeDto[], depth = 0, parentPath = ''): ReactNode =>
    list.map((n, index) => {
      if (n.kind === 'global') {
        const tool = n.tool || 'cursor'
        const active = selectedKind === 'global' && selectedGlobalTool === tool
        const meta = workspaces.find((w) => w.id === tool)
        const inWorkArea = meta?.inWorkArea ?? PRIMARY_WORK_AREA_IDS.has(tool)
        const isDefault = meta?.isDefault ?? tool === 'cursor'
        const inPool = parentPath.includes('备份区域') || !inWorkArea
        const wsDropSection = workspacePoolOpen ? 'all' : inPool ? 'pool' : 'visible'
        const inWorkAreaCount = workspaces.filter((w) => w.inWorkArea && w.enabled).length
        /** 眼睛＝显示到工作区域；可全关，但至少保留最后一个 */
        const isLastShown = inWorkArea && inWorkAreaCount <= 1
        const isWsDragging = dragState?.projectId === `ws:${tool}`
        const dropInsert =
          dragOver?.kind === 'project' &&
          dragOver.projectId === tool &&
          (dragState?.projectId?.startsWith('ws:') || Boolean(wsPointerSession.current))
            ? dragOver.insert
            : null
        return (
          <div
            key={`global-${parentPath}-${tool}`}
            className={`nav-item project ws-nav ws-${tool} nav-item-draggable${
              inPool ? ' ws-nav-pool' : ''
            }${active ? ' active' : ''}${isWsDragging ? ' is-dragging' : ''}${
              dropInsert === 'before' ? ' is-drop-before' : ''
            }${dropInsert === 'after' ? ' is-drop-after' : ''}`}
            data-nav-drop={`wsitem:${wsDropSection}:${tool}`}
            title={t('nav.dragToReorder')}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false
                return
              }
              onSelect('global', null, tool)
            }}
            onContextMenu={(e) => onContextGlobal(e, tool)}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const t = e.target
              if (t instanceof Element && t.closest('button, .nav-ws-checks')) return
              e.preventDefault()
              wsPointerSession.current = {
                tool,
                label: n.name,
                startX: e.clientX,
                startY: e.clientY,
                active: false,
              }
            }}
          >
            <WorkspaceToolIcon id={tool} />
            <span className="nav-ws-label">{n.name}</span>
            <span
              className="nav-ws-checks"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`nav-ws-icon-btn${inWorkArea ? ' is-on' : ''}`}
                title={
                  isLastShown
                    ? t('nav.keepOneWorkspace')
                    : t('nav.showInWorkArea')
                }
                aria-label={t('nav.showInWorkAreaNamed', { name: n.name })}
                aria-pressed={inWorkArea}
                disabled={isLastShown}
                onClick={() => {
                  if (isLastShown) return
                  onToggleInWorkArea(tool, !inWorkArea)
                }}
              >
                <EyeGlyph off={!inWorkArea} />
              </button>
              <button
                type="button"
                className="nav-ws-icon-btn"
                title={
                  meta?.containerRoot
                    ? t('nav.editContainerRootPath', { path: meta.containerRoot })
                    : t('nav.editContainerRoot')
                }
                aria-label={t('nav.editContainerRootNamed', { name: n.name })}
                onClick={(e) => {
                  e.stopPropagation()
                  onEditContainerRoot(tool)
                }}
              >
                <PenGlyph />
              </button>
              <button
                type="button"
                className={`nav-ws-icon-btn nav-ws-star${isDefault ? ' is-on' : ''}`}
                title={t('nav.setDefaultWs')}
                aria-label={t('nav.setDefaultWsNamed', { name: n.name })}
                aria-pressed={isDefault}
                disabled={isDefault}
                onClick={() => {
                  if (!isDefault) onSetDefaultWorkspace(tool)
                }}
              >
                <StarGlyph filled={isDefault} />
              </button>
            </span>
          </div>
        )
      }
      if (n.kind === 'category') {
        // 「备份区域」「隐藏容器」标题行不渲染；子叶由对应齿轮展开时内联插入
        if (n.name === '备份区域' || n.name === '隐藏容器') return null
        const path = parentPath ? `${parentPath}/${n.name}` : n.name
        const section = navSectionFromParentPath(path)
        const isGlobalWorkspaceHeader = depth === 0 && n.name === '工作区'
        const isContainerHeader = depth === 0 && n.name === '容器'
        // 子分组且服务端默认折叠 → 可点击展开；容器/工作区标题常开
        const collapsible = depth > 0 && !n.isExpanded
        const isOpen = collapsible
          ? (path in expandedMap ? expandedMap[path]! : n.isExpanded)
          : true
        const dropKey = section ? `section:${section}` : null
        const isDropSection =
          Boolean(dragState) &&
          dragOver?.kind === 'section' &&
          section != null &&
          dragOver.section === section
        const withSep = depth > 0 || index > 0
        const poolCat = isGlobalWorkspaceHeader
          ? n.children.find((c) => c.kind === 'category' && c.name === '备份区域')
          : isContainerHeader
            ? n.children.find((c) => c.kind === 'category' && c.name === '隐藏容器')
            : undefined
        const mainChildren =
          isGlobalWorkspaceHeader || isContainerHeader
            ? n.children.filter(
                (c) =>
                  !(
                    c.kind === 'category' &&
                    (c.name === '备份区域' || c.name === '隐藏容器')
                  ),
              )
            : n.children
        const headerPoolOpen = isGlobalWorkspaceHeader
          ? workspacePoolOpen
          : isContainerHeader
            ? projectPoolOpen
            : false
        return (
          <div key={`cat-${path}`} className={withSep ? 'nav-block-sep' : undefined}>
            <div
              className={`nav-item cat${depth > 0 ? ' cat-sub' : ''}${
                collapsible || isGlobalWorkspaceHeader || isContainerHeader
                  ? ' cat-toggle'
                  : ''
              }${isDropSection ? ' is-drop-section' : ''}${
                headerPoolOpen ? ' is-ws-setup-open' : ''
              }`}
              data-nav-drop={dropKey ?? undefined}
              title={
                section
                  ? section === 'pinned'
                    ? t('nav.dropShowEnd')
                    : t('nav.dropHideEnd')
                  : undefined
              }
              onClick={
                collapsible
                  ? () => setExpandedMap((m) => ({ ...m, [path]: !isOpen }))
                  : undefined
              }
            >
              <span className="nav-cat-label">{navCategoryLabel(n.name)}</span>
              {isGlobalWorkspaceHeader || isContainerHeader ? (
                <span
                  className="nav-ws-checks nav-cat-checks"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.stopPropagation()}
                >
                  {isContainerHeader ? (
                    <>
                      <button
                        type="button"
                        className="nav-ws-icon-btn"
                        title={t('nav.addContainer')}
                        aria-label={t('nav.addContainer')}
                        onClick={onAddContainer}
                      >
                        <PlusGlyph />
                      </button>
                      <button
                        type="button"
                        className="nav-ws-icon-btn"
                        title={t('nav.clearSkillsHint')}
                        aria-label={t('nav.clearSkills')}
                        disabled={clearSkillsDisabled}
                        onClick={onClearProjectSkills}
                      >
                        <ClearSkillsGlyph />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="nav-ws-icon-btn is-on"
                    title={t('nav.showAllEyes')}
                    aria-label={
                      isGlobalWorkspaceHeader
                        ? t('nav.showAllWorkspaces')
                        : t('nav.showAllContainers')
                    }
                    onClick={() => {
                      if (isGlobalWorkspaceHeader) onBulkSetWorkArea(true)
                      else onBulkSetProjectsVisible(true)
                    }}
                  >
                    <EyeShowAllGlyph />
                  </button>
                  <button
                    type="button"
                    className="nav-ws-icon-btn"
                    title={
                      isGlobalWorkspaceHeader
                        ? t('nav.hideAllKeepDefault')
                        : t('nav.hideAllToPool')
                    }
                    aria-label={
                      isGlobalWorkspaceHeader
                        ? t('nav.hideAllWorkspaces')
                        : t('nav.hideAllContainers')
                    }
                    onClick={() => {
                      if (isGlobalWorkspaceHeader) onBulkSetWorkArea(false)
                      else onBulkSetProjectsVisible(false)
                    }}
                  >
                    <EyeHideAllGlyph />
                  </button>
                  {isGlobalWorkspaceHeader ? (
                    <button
                      type="button"
                      className={`nav-ws-icon-btn nav-ws-pool-toggle${
                        workspacePoolOpen ? ' is-on' : ''
                      }`}
                      title={
                        workspacePoolOpen
                          ? t('nav.collapseWsPool')
                          : t('nav.expandWsPool')
                      }
                      aria-label={t('nav.wsPoolToggle')}
                      aria-pressed={workspacePoolOpen}
                      onClick={() => onWorkspacePoolOpenChange((open) => !open)}
                    >
                      <PoolToggleGlyph open={workspacePoolOpen} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`nav-ws-icon-btn nav-ws-pool-toggle${
                        projectPoolOpen ? ' is-on' : ''
                      }`}
                      title={
                        projectPoolOpen
                          ? t('nav.collapseHiddenPool')
                          : t('nav.expandHiddenPool')
                      }
                      aria-label={t('nav.hiddenPoolToggle')}
                      aria-pressed={projectPoolOpen}
                      onClick={() => onProjectPoolOpenChange((open) => !open)}
                    >
                      <PoolToggleGlyph open={projectPoolOpen} />
                    </button>
                  )}
                </span>
              ) : null}
              {collapsible ? (
                <span className="nav-cat-action">{isOpen ? t('nav.collapse') : t('nav.open')}</span>
              ) : null}
            </div>
            {isOpen ? (
              <>
                {render(mainChildren, depth + 1, path)}
                {isGlobalWorkspaceHeader && workspacePoolOpen && poolCat
                  ? render(poolCat.children, depth + 1, `${path}/备份区域`)
                  : null}
                {isContainerHeader && projectPoolOpen && poolCat
                  ? render(poolCat.children, depth + 1, `${path}/隐藏容器`)
                  : null}
              </>
            ) : null}
          </div>
        )
      }
      const section = navSectionFromParentPath(parentPath)
      const canDrag = Boolean(n.projectId && section)
      const isDragging = canDrag && dragState?.projectId === n.projectId
      const dropInsert =
        dragOver?.kind === 'project' &&
        dragOver.projectId === n.projectId &&
        dragState?.projectId !== n.projectId
          ? dragOver.insert
          : null
      const projMeta = projects.find((p) => p.id === n.projectId)
      const isShown = projMeta?.pinned ?? section === 'pinned'
      const inProjPool = parentPath.includes('隐藏容器') || !isShown
      return (
        <div
          key={n.projectId ?? n.name}
          className={`nav-item project project-nav${depth > 1 ? ' project-nested' : ''} ${
            selectedKind === 'project' && selectedProjectId === n.projectId ? 'active' : ''
          }${n.projectId && pickedProjectIds.has(n.projectId) ? ' is-picked' : ''}${canDrag ? ' nav-item-draggable' : ''}${isDragging ? ' is-dragging' : ''}${
            dropInsert === 'before' ? ' is-drop-before' : ''
          }${dropInsert === 'after' ? ' is-drop-after' : ''}${
            inProjPool ? ' ws-nav-pool' : ''
          }`}
          draggable={false}
          data-nav-drop={
            canDrag ? `project:${n.projectId}:${section}` : undefined
          }
          title={
            canDrag
              ? t('nav.dragProjectHint')
              : undefined
          }
          onPointerDown={
            canDrag
              ? (e) => {
                  if (e.button !== 0) return
                  if (e.ctrlKey || e.metaKey || e.shiftKey) return
                  const t = e.target
                  if (t instanceof Element && t.closest('button, .nav-ws-checks')) return
                  e.preventDefault()
                  pointerSession.current = {
                    projectId: n.projectId!,
                    section: section!,
                    label: n.name,
                    startX: e.clientX,
                    startY: e.clientY,
                    active: false,
                  }
                }
              : undefined
          }
          onClick={(e) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false
              return
            }
            if (n.projectId) {
              onSelectProject(n.projectId, {
                ctrlKey: e.ctrlKey,
                metaKey: e.metaKey,
                shiftKey: e.shiftKey,
              })
              return
            }
            onSelect('project', n.projectId)
          }}
          onContextMenu={(e) => n.projectId && onContextProject(e, n.projectId)}
        >
          <span className="nav-ws-label">{n.name}</span>
          {n.projectId ? (
            <span
              className="nav-ws-checks"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className={`nav-ws-icon-btn${isShown ? ' is-on' : ''}`}
                title={isShown ? t('nav.hideToPool') : t('nav.showSidebar')}
                aria-label={isShown ? t('nav.hideNamed', { name: n.name }) : t('nav.showNamed', { name: n.name })}
                aria-pressed={isShown}
                onClick={() => {
                  void onTogglePinProject(n.projectId!)
                }}
              >
                <EyeGlyph off={!isShown} />
              </button>
            </span>
          ) : null}
        </div>
      )
    })

  return (
    <div className="nav-tree">
      {render(nodes)}
      {dragState
        ? createPortal(
            <div
              className="nav-drag-ghost"
              style={{ left: pointerPos.x + 12, top: pointerPos.y + 8 }}
            >
              {dragState.label}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

/**
 * H8 性能：拉取耗时秒数自带每秒 tick，只重渲本组件；
 * 原先由 App 顶层 fetchTick state 驱动，拉取期间每秒整树重渲。
 */
function FetchElapsedSeconds({ startedAt }: { startedAt: number }) {
  const [, forceTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <>{Math.max(0, Math.floor((Date.now() - startedAt) / 1000))}</>
}

function FetchJobCard({
  job,
  expanded,
  onToggleExpand,
  onCancel,
}: {
  job: NetworkFetchUi
  expanded: boolean
  onToggleExpand: () => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const pct = job.percent
  const checkingOut = pct === 100 && !job.cancelling
  const cmd = (job.detail || job.phase || '').replace(/\s+/g, ' ').trim()
  return (
    <li className="fetch-job-item">
      <div className="fetch-job-row">
        <button
          type="button"
          className="fetch-job-toggle"
          aria-expanded={expanded}
          title={expanded ? t('fetch.collapseCmd') : t('fetch.expandCmd')}
          onClick={onToggleExpand}
        >
          <span className="fetch-job-id">{job.sourceId}</span>
          <span className="fetch-job-meta">
            {t('fetch.elapsedLabel')} <FetchElapsedSeconds startedAt={job.startedAt} />s
            {typeof pct === 'number' ? ` · ${pct}%` : ''}
            {checkingOut ? t('fetch.checkingOut') : ''}
            {job.cancelling ? t('fetch.stopping') : ''}
          </span>
        </button>
        <button type="button" disabled={job.cancelling} onClick={onCancel}>
          {t('fetch.stop')}
        </button>
      </div>
      {typeof pct === 'number' ? (
        <div
          className="fetch-progress-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="fetch-progress-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {expanded ? (
        <p className="fetch-progress-detail">{job.detail || job.phase}</p>
      ) : (
        <p className="fetch-job-cmd" title={cmd} onClick={onToggleExpand}>
          {cmd}
        </p>
      )}
      {job.stalled ? (
        <p className="fetch-stall-warn" role="alert">
          {t('fetch.stalledWarn')}
        </p>
      ) : null}
    </li>
  )
}

type SectionTone = 'container' | 'library' | 'missing'

function pathLooksConfigured(path: string): boolean {
  const s = path.trim()
  return Boolean(s) && s !== '—' && !s.includes('未配置')
}

function SectionHeaderPath({
  path,
  openTitle,
  onOpen,
}: {
  path: string
  openTitle: string
  onOpen: (path: string) => void
}) {
  const { t } = useI18n()
  const shown = displayUnconfigured(path, t('list.unconfigured'))
  const ok = pathLooksConfigured(path)
  return (
    <button
      type="button"
      className="section-header-path"
      disabled={!ok}
      title={ok ? openTitle : t('list.unconfigured')}
      onClick={(e) => {
        e.stopPropagation()
        if (ok) onOpen(path)
      }}
    >
      {shown}
    </button>
  )
}

function libraryInContainer(item: Pick<LibraryListItemDto, 'isInActiveUse'> | undefined): boolean {
  return Boolean(item?.isInActiveUse)
}

function sortLibraryItemsByContainer(items: readonly LibraryListItemDto[]): LibraryListItemDto[] {
  return [...items].sort((a, b) => {
    const kind = compareKindThenName(a, b)
    if (kind !== 0) return kind
    return Number(libraryInContainer(b)) - Number(libraryInContainer(a))
  })
}

function orderClusterChildren(
  nodes: ClusterNodeDto[],
  byId: Map<string, LibraryListItemDto>,
): ClusterNodeDto[] {
  const leaves = nodes.filter((n) => !n.isGroup)
  if (leaves.length <= 1) return nodes
  const groups = nodes.filter((n) => n.isGroup)
  const sortedLeaves = [...leaves].sort((a, b) => {
    const ia = a.entryId ? byId.get(a.entryId) : undefined
    const ib = b.entryId ? byId.get(b.entryId) : undefined
    const kind = compareKindThenName(
      { kindLabel: ia?.kindLabel, displayName: ia?.displayName ?? a.name },
      { kindLabel: ib?.kindLabel, displayName: ib?.displayName ?? b.name },
    )
    if (kind !== 0) return kind
    return Number(libraryInContainer(ib)) - Number(libraryInContainer(ia))
  })
  if (groups.length === 0) return sortedLeaves
  const out: ClusterNodeDto[] = []
  let leavesPlaced = false
  for (const n of nodes) {
    if (n.isGroup) out.push(n)
    else if (!leavesPlaced) {
      out.push(...sortedLeaves)
      leavesPlaced = true
    }
  }
  return out
}

function listItemSubText(item: LibraryListItemDto | undefined): string {
  if (!item) return ''
  if (item.subtitle) return translatePlaceSubtitle(item.subtitle)
  if (item.sourceLabel) return item.sourceLabel
  return translateKindLabel(item.groupName || '')
}

/** 列表项是否为 Cursor Rule（kindLabel 中英兼容；用于用户级容器提示）。 */
function isCursorRuleListItem(item: LibraryListItemDto): boolean {
  const label = (item.kindLabel || '').trim().toLowerCase()
  if (label === '规则' || label === 'rule' || label === 'rules') return true
  return (item.displayName || '').startsWith('[规则]')
}

/** H7 性能：memo 化，配合 App 侧稳定引用 props，在无关重渲（搜索键入等）时跳过整段列表 DOM diff */
const ItemSection = memo(function ItemSection({
  title,
  items,
  selected,
  onSelect,
  onContext,
  headerExtra,
  hintText,
  hintTone = 'default',
  tone = 'library',
  libraryRoot = '',
  pathHint = '',
  onOpenPath,
  workspaceId = '',
  focused = false,
}: {
  title: string
  items: LibraryListItemDto[]
  selected: Set<string>
  onSelect: (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') => void
  onContext: (e: ReactMouseEvent, id: string) => void
  headerExtra?: ReactNode
  /** 节标题下的说明文案（如用户级 Rule 需粘贴到 Cursor Settings）；字符串按值比较，memo 友好 */
  hintText?: string
  hintTone?: 'default' | 'missing'
  tone?: SectionTone
  /** 永久库根目录，用于拖拽文案拼完整路径 */
  libraryRoot?: string
  /** 容器根 / 永久库根，写在分区标题后面 */
  pathHint?: string
  onOpenPath?: (path: string) => void
  workspaceId?: string
  focused?: boolean
}) {
  const { t } = useI18n()
  const pathSide: 'container' | 'library' = tone === 'container' ? 'container' : 'library'
  const canFileDrag = tone !== 'missing'
  const shown = tone === 'library' ? sortLibraryItemsByContainer(items) : items
  const byId = new Map(items.map((x) => [x.entryId, x]))
  const wsClass = workspaceId ? ` ws-${workspaceId}` : ''
  const pathOpenTitle =
    tone === 'container'
      ? t('list.openActiveContainer', { path: pathHint })
      : t('list.openLibrary', { path: pathHint })
  return (
    <div
      className={`section section-${tone}${wsClass}${focused ? ' section-focused' : ''}`}
    >
      <div className="section-header">
        <span className="section-header-main">
          {workspaceId ? <span className={`ws-dot ws-${workspaceId}`} aria-hidden /> : null}
          <span className="section-header-label">{title}</span>
          {pathHint && onOpenPath ? (
            <SectionHeaderPath path={pathHint} openTitle={pathOpenTitle} onOpen={onOpenPath} />
          ) : null}
        </span>
        {headerExtra ? (
          <span className="section-header-right">{headerExtra}</span>
        ) : null}
      </div>
      {hintText ? (
        <div
          className={`section-hint${hintTone === 'missing' ? ' section-hint-missing' : ''}`}
          role="note"
        >
          {hintText}
        </div>
      ) : null}
      {shown.length === 0 ? (
        <div className="empty" style={{ padding: '8px 10px' }}>
          {t('empty.paren')}
        </div>
      ) : (
        shown.map((item) => (
          <div
            key={item.entryId + item.groupName}
            className={`list-item ${selected.has(item.entryId) ? 'selected' : ''}${item.isInActiveUse ? ' list-item-in-use' : ''}${canFileDrag ? ' list-item-file-drag' : ''}`}
            draggable={canFileDrag}
            title={
              tone === 'library'
                ? [item.libraryPathRel, canFileDrag ? t('list.dragHint') : '']
                    .filter(Boolean)
                    .join('\n') || undefined
                : canFileDrag
                  ? t('list.dragHint')
                  : undefined
            }
            onDragStart={
              canFileDrag
                ? (e) =>
                    beginEntryFileDrag(e, item.entryId, selected, pathSide, (id) => byId.get(id), libraryRoot)
                : undefined
            }
            onClick={(e) => {
              if (e.shiftKey) e.preventDefault()
              onSelect(item.entryId, e.ctrlKey || e.metaKey, e.shiftKey, pathSide)
            }}
            onContextMenu={(e) => onContext(e, item.entryId)}
          >
            <ListEntryBody
              title={item.displayName}
              sub={tone === 'library' ? undefined : listItemSubText(item)}
              libraryLayout={tone === 'library'}
              kindText={translateKindLabel(item.kindLabel)}
              inUseMark={
                item.isInActiveUse && tone === 'library' ? t('list.inContainerBare') : undefined
              }
              originTools={tone === 'library' ? item.originTools : undefined}
            />
          </div>
        ))
      )}
    </div>
  )
})

const LEVEL_DROP_TARGETS = new Set(['L0', 'L1', 'L2', 'uncategorized', '未分类'])
/** Electron/Chromium 常丢弃自定义 MIME；自定义类型 + text/plain 尾标双通道 */
const CCM_ENTRIES_MIME = 'application/x-ccm-entries'
const CCM_ENTRIES_PLAIN_PREFIX = 'ccm-entries:'

function tryParseEntryIdArray(text: string): string[] {
  const raw = text.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
  } catch {
    return []
  }
}

function parseDragEntryIds(dt: DataTransfer): string[] {
  // 1) 自定义 MIME（若未被 Electron 丢弃）
  const fromMime = tryParseEntryIdArray(dt.getData(CCM_ENTRIES_MIME) || '')
  if (fromMime.length > 0) return fromMime

  const plain = (dt.getData('text/plain') || '').trim()
  if (!plain) return []

  // 2) 可读文案末行：ccm-entries:["id",...]
  for (const line of plain.split(/\r?\n/).reverse()) {
    const t = line.trim()
    if (!t.startsWith(CCM_ENTRIES_PLAIN_PREFIX)) continue
    const ids = tryParseEntryIdArray(t.slice(CCM_ENTRIES_PLAIN_PREFIX.length))
    if (ids.length > 0) return ids
  }

  // 3) 兼容旧载荷：整段纯 JSON 数组
  return tryParseEntryIdArray(plain)
}

/** 永久库绝对路径：库根 + 相对路径（保留完整文件名） */
function dragFullLibraryPath(
  libraryRoot: string,
  libraryPathRel?: string | null,
  fallbackId?: string,
): string {
  const root = libraryRoot.trim().replace(/[/\\]+$/, '')
  const rel = (libraryPathRel || '').trim().replace(/\\/g, '/')
  if (!rel) {
    return root || fallbackId || '（无路径）'
  }
  if (!root || root === '（未配置）') {
    return rel.replace(/\//g, '\\')
  }
  return `${root}\\${rel.replace(/\//g, '\\')}`
}

function formatDragPlainLabel(
  item: Pick<LibraryListItemDto, 'entryId' | 'levelKey' | 'libraryPathRel'>,
  libraryRoot: string,
): string {
  const level = item.levelKey?.trim() || '未分类'
  const full = dragFullLibraryPath(libraryRoot, item.libraryPathRel, item.entryId)
  return `${level} · ${full}`
}

/**
 * 同一次拖动装入两类数据：
 * - text/plain：级别·永久库完整路径（Cursor 可读）+ ccm-entries 尾标（应用内定级）
 */
function beginEntryFileDrag(
  e: ReactDragEvent,
  entryId: string,
  selected: Set<string>,
  pathSide: 'container' | 'library',
  resolveItem: (id: string) => LibraryListItemDto | undefined,
  libraryRoot: string,
) {
  const ids = selected.has(entryId) && selected.size > 0 ? [...selected] : [entryId]
  const payload = JSON.stringify(ids)
  const labelLines = ids.map((id) => {
    const item = resolveItem(id)
    return formatDragPlainLabel(
      item ?? { entryId: id, levelKey: null, libraryPathRel: null },
      libraryRoot,
    )
  })
  const plainText = [...labelLines, `${CCM_ENTRIES_PLAIN_PREFIX}${payload}`].join('\n')
  e.dataTransfer.setData('text/plain', plainText)
  e.dataTransfer.setData(CCM_ENTRIES_MIME, payload)
  e.dataTransfer.effectAllowed = 'copyMove'
}

/** H7 性能：memo 化（配合稳定引用 props），无关重渲时跳过聚类树 DOM diff */
const ClusterSection = memo(function ClusterSection({
  roots,
  flatFallback,
  selected,
  onSelect,
  onContext,
  onDropLevel,
  onDropRegion,
  onReorderEntry,
  onSetLevel,
  tone = 'library',
  libraryRoot = '',
  onCollapseChange,
  collapseApiRef,
}: {
  roots: ClusterNodeDto[]
  flatFallback: FunnelListItem[]
  selected: Set<string>
  onSelect: (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') => void
  onContext: (e: ReactMouseEvent, id: string) => void
  onDropLevel?: (level: string, entryIds: string[]) => void
  onDropRegion?: (regionKey: string, entryIds: string[]) => void
  onReorderEntry?: (entryId: string, regionKey: string, toIndex: number) => void
  onSetLevel?: (entryId: string, level: string) => void
  tone?: SectionTone
  libraryRoot?: string
  onCollapseChange?: (allCollapsed: boolean) => void
  collapseApiRef?: MutableRefObject<(() => void) | null>
}) {
  const { t, locale } = useI18n()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [libDragOver, setLibDragOver] = useState<{
    id: string
    insert: 'before' | 'after'
  } | null>(null)
  const libPointer = useRef<{
    entryId: string
    regionKey: string
    startX: number
    startY: number
    active: boolean
  } | null>(null)
  const byId = new Map(flatFallback.map((x) => [x.entryId, x]))
  const leafCount = (nodes: ClusterNodeDto[]): number =>
    nodes.reduce(
      (n, node) => n + (node.isGroup ? leafCount(node.children || []) : node.entryId ? 1 : 0),
      0,
    )
  const total = leafCount(roots)

  const collectGroupKeys = (nodes: ClusterNodeDto[], depth = 0): string[] => {
    const keys: string[] = []
    for (const n of nodes) {
      if (!n.isGroup) continue
      keys.push(`${depth}:${n.name}:${n.scopeKey || ''}`)
      keys.push(...collectGroupKeys(n.children || [], depth + 1))
    }
    return keys
  }
  const groupKeys = collectGroupKeys(roots)
  const allCollapsed =
    groupKeys.length > 0 && groupKeys.every((k) => collapsed[k] === true)
  const collapseOrExpandAll = useCallback(() => {
    setCollapsed((c) => {
      const keys: string[] = []
      const walk = (nodes: ClusterNodeDto[], depth = 0) => {
        for (const n of nodes) {
          if (!n.isGroup) continue
          keys.push(`${depth}:${n.name}:${n.scopeKey || ''}`)
          walk(n.children || [], depth + 1)
        }
      }
      walk(roots)
      if (keys.length === 0) return c
      const every = keys.every((k) => c[k] === true)
      return every ? {} : Object.fromEntries(keys.map((k) => [k, true]))
    })
  }, [roots])

  useEffect(() => {
    onCollapseChange?.(allCollapsed)
  }, [allCollapsed, onCollapseChange])

  useEffect(() => {
    if (!collapseApiRef) return
    collapseApiRef.current = groupKeys.length > 0 ? collapseOrExpandAll : null
    return () => {
      collapseApiRef.current = null
    }
  }, [collapseApiRef, collapseOrExpandAll, groupKeys.length])

  const isLevelDropTarget = (node: ClusterNodeDto, depth: number) => {
    if (depth !== 0 || !node.isGroup) return false
    const key = (node.scopeKey || node.name || '').trim()
    return LEVEL_DROP_TARGETS.has(key) || LEVEL_DROP_TARGETS.has(node.name)
  }

  const dropLevelValue = (node: ClusterNodeDto) => {
    const key = (node.scopeKey || node.name || '').trim()
    if (key === 'uncategorized' || node.name === '未分类') return '未分类'
    return key
  }

  const renderNodes = (nodes: ClusterNodeDto[], depth = 0, parentRegion = '__flat__'): ReactNode =>
    orderClusterChildren(nodes, byId).map((node) => {
      if (node.isGroup) {
        const key = `${depth}:${node.name}:${node.scopeKey || ''}`
        const regionKey = (node.scopeKey || node.name || parentRegion).trim() || parentRegion
        const isCollapsed = collapsed[key] === true
        const count = leafCount(node.children || [])
        const levelDrop = Boolean(onDropLevel) && isLevelDropTarget(node, depth)
        const regionDrop = Boolean(onDropRegion) && node.isGroup
        const canDrop = levelDrop || regionDrop
        const isDragOver = dragOverKey === key
        return (
          <div key={key} className="cluster-group">
            <div
              className={`cluster-group-header${canDrop ? ' cluster-drop-target' : ''}${
                isDragOver ? ' is-drag-over' : ''
              }`}
              style={{ paddingLeft: 12 + depth * 10 }}
              title={canDrop ? t('list.dropHere') : undefined}
              onClick={() => setCollapsed((c) => ({ ...c, [key]: !isCollapsed }))}
              onDragOver={
                canDrop
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      e.dataTransfer.dropEffect = 'move'
                      setDragOverKey(key)
                    }
                  : undefined
              }
              onDragLeave={
                canDrop
                  ? (e) => {
                      const related = e.relatedTarget as Node | null
                      if (related && e.currentTarget.contains(related)) return
                      setDragOverKey((k) => (k === key ? null : k))
                    }
                  : undefined
              }
              onDrop={
                canDrop
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDragOverKey(null)
                      const ids = parseDragEntryIds(e.dataTransfer)
                      if (ids.length === 0) return
                      if (levelDrop) onDropLevel?.(dropLevelValue(node), ids)
                      else onDropRegion?.(regionKey, ids)
                    }
                  : undefined
              }
            >
              <span className="cluster-caret">
                <PoolToggleGlyph open={!isCollapsed} />
              </span>
              <span>
                {translateClusterGroupName(node.name)} ({count})
              </span>
            </div>
            {!isCollapsed ? renderNodes(node.children || [], depth + 1, regionKey) : null}
          </div>
        )
      }
      const item = node.entryId ? byId.get(node.entryId) : undefined
      const entryId = node.entryId || node.name
      const inUse = item?.isInActiveUse
      const pathSide: 'container' | 'library' = tone === 'container' ? 'container' : 'library'
      const dropInsert =
        libDragOver?.id === entryId ? libDragOver.insert : null
      return (
        <div
          key={entryId}
          className={`list-item list-item-cluster-leaf nav-item-draggable ${selected.has(entryId) ? 'selected' : ''}${
            inUse ? ' list-item-in-use' : ''
          }${dropInsert === 'before' ? ' is-drop-before' : ''}${
            dropInsert === 'after' ? ' is-drop-after' : ''
          }`}
          draggable
          data-list-drop={`item:${entryId}:${parentRegion}`}
          title={
            [item?.libraryPathRel, t('list.dragSortCluster')].filter(Boolean).join('\n') ||
            undefined
          }
          onDragStart={(e) => {
            // Keep HTML5 for region/level drop targets; also encode entry ids.
            beginEntryFileDrag(e, entryId, selected, pathSide, (id) => byId.get(id), libraryRoot)
          }}
          onDragEnd={() => {
            setDragOverKey(null)
            setLibDragOver(null)
          }}
          onPointerDown={(e) => {
            if (e.button !== 0 || !onReorderEntry) return
            libPointer.current = {
              entryId,
              regionKey: parentRegion,
              startX: e.clientX,
              startY: e.clientY,
              active: false,
            }
          }}
          onPointerMove={(e) => {
            const s = libPointer.current
            if (!s || s.entryId !== entryId) return
            const dx = e.clientX - s.startX
            const dy = e.clientY - s.startY
            if (!s.active) {
              if (dx * dx + dy * dy < LIST_DRAG_THRESHOLD_PX * LIST_DRAG_THRESHOLD_PX) return
              s.active = true
            }
            const el = document.elementFromPoint(e.clientX, e.clientY)
            const nodeEl = el?.closest?.('[data-list-drop]') as HTMLElement | null
            const raw = nodeEl?.getAttribute('data-list-drop') || ''
            if (!raw.startsWith('item:')) {
              setLibDragOver(null)
              return
            }
            const rest = raw.slice('item:'.length)
            const idx = rest.lastIndexOf(':')
            const tid = rest.slice(0, idx)
            const region = rest.slice(idx + 1)
            if (region !== s.regionKey || tid === s.entryId) {
              setLibDragOver(null)
              return
            }
            const rect = nodeEl!.getBoundingClientRect()
            setLibDragOver({
              id: tid,
              insert: e.clientY < rect.top + rect.height / 2 ? 'before' : 'after',
            })
          }}
          onPointerUp={(e) => {
            const s = libPointer.current
            libPointer.current = null
            if (!s?.active || !onReorderEntry || !libDragOver) {
              setLibDragOver(null)
              return
            }
            // Collect peers in region from roots walk
            const peers: string[] = []
            const walk = (nodes: ClusterNodeDto[], region: string) => {
              for (const n of nodes) {
                if (n.isGroup) {
                  walk(n.children || [], (n.scopeKey || n.name || region).trim() || region)
                } else if (n.entryId && region === s.regionKey) {
                  peers.push(n.entryId)
                }
              }
            }
            walk(roots, '__flat__')
            const from = peers.indexOf(s.entryId)
            const to = peers.indexOf(libDragOver.id)
            if (from >= 0 && to >= 0) {
              const dest = destIndexFromInsert(from, to, libDragOver.insert, peers.length)
              onReorderEntry(s.entryId, s.regionKey, dest)
            }
            setLibDragOver(null)
            e.preventDefault()
          }}
          onClick={(e) => {
            if (e.shiftKey) e.preventDefault()
            onSelect(entryId, e.ctrlKey || e.metaKey, e.shiftKey, pathSide)
          }}
          onContextMenu={(e) => onContext(e, entryId)}
        >
          <ListEntryBody
            title={item?.displayName || node.name}
            sub={tone === 'library' ? undefined : listItemSubText(item)}
            libraryLayout={tone === 'library'}
            inContainer={tone === 'library' ? libraryInContainer(item) : undefined}
            kindText={item ? translateKindLabel(item.kindLabel) : undefined}
            metaParts={
              item
                ? taxonomySourceParts(item, locale, t('net.colLocal'))
                : undefined
            }
            levelText={
              item ? displayLevelLabel(item, t('kind.uncategorized')) : undefined
            }
            levelEditable={tone === 'library' && Boolean(onSetLevel)}
            onLevelChange={
              onSetLevel && item
                ? (level) => onSetLevel(item.entryId, level || '未分类')
                : undefined
            }
            inUseMark={inUse && tone === 'library' ? t('list.inContainerBare') : undefined}
            originTools={tone === 'library' ? item?.originTools : undefined}
          />
        </div>
      )
    })

  return (
    <div className={`section section-${tone}`}>
      {total === 0 ? (
        <div className="empty" style={{ padding: '8px 10px' }}>
          {t('empty.paren')}
        </div>
      ) : (
        renderNodes(roots)
      )}
    </div>
  )
})

const SUGGEST_KIND_ORDER = ['skill', 'rule', 'agent', 'command', 'hook'] as const

function SuggestPurposesModal({
  data,
  busy,
  onClose,
  onToggle,
  onSelectAll,
  onSelectKind,
  onConfirm,
}: {
  data: {
    suggestions: SuggestedPurposeDto[]
    alreadyTagged: number
    noSuggestion: number
  }
  busy: boolean
  onClose: () => void
  onToggle: (entryId: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onSelectKind: (kind: string, selected: boolean) => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const selectedCount = data.suggestions.filter((s) => s.selected).length
  const groups: Array<{ kind: string; label: string; items: SuggestedPurposeDto[] }> =
    SUGGEST_KIND_ORDER.map((kind) => ({
      kind,
      label: translateKindLabel(kind),
      items: data.suggestions.filter((s) => s.kind === kind),
    })).filter((g) => g.items.length > 0)
  const known = new Set<string>(SUGGEST_KIND_ORDER)
  const extras = [...new Set(data.suggestions.map((s) => s.kind).filter((k) => !known.has(k)))]
  for (const kind of extras) {
    groups.push({
      kind,
      label: translateKindLabel(kind),
      items: data.suggestions.filter((s) => s.kind === kind),
    })
  }

  const kindStats = SUGGEST_KIND_ORDER.map((kind) => {
    const items = data.suggestions.filter((s) => s.kind === kind)
    const selected = items.filter((s) => s.selected).length
    return {
      kind,
      label: translateKindLabel(kind),
      total: items.length,
      selected,
      checked: items.length > 0 && selected === items.length,
      indeterminate: selected > 0 && selected < items.length,
      disabled: items.length === 0,
    }
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide suggest-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('suggest.title')}</h3>
        <p className="sub suggest-modal-desc">
          {t('suggest.body', {
            summary: t('suggest.summary', {
              tagged: data.alreadyTagged,
              none: data.noSuggestion,
            }),
          })}
        </p>

        <div className="suggest-toolbar">
          <div className="suggest-kind-filters" role="group" aria-label={t('suggest.kindFilter')}>
            {kindStats.map((k) => (
              <label
                key={k.kind}
                className={`suggest-kind-filter${k.checked || k.indeterminate ? ' is-active' : ''}${
                  k.disabled ? ' is-disabled' : ''
                }`}
              >
                <input
                  type="checkbox"
                  disabled={busy || k.disabled}
                  checked={k.checked}
                  ref={(el) => {
                    if (el) el.indeterminate = k.indeterminate
                  }}
                  onChange={(e) => onSelectKind(k.kind, e.target.checked)}
                />
                <span>
                  {k.label}
                  {k.total > 0 ? ` ${k.selected}/${k.total}` : ''}
                </span>
              </label>
            ))}
          </div>
          <div className="suggest-toolbar-actions">
            <button type="button" className="linkish" disabled={busy} onClick={() => onSelectAll(true)}>
              {t('suggest.selectAll')}
            </button>
            <button type="button" className="linkish" disabled={busy} onClick={() => onSelectAll(false)}>
              {t('suggest.clearAll')}
            </button>
          </div>
        </div>

        <div className="suggest-list">
          <div className="suggest-colhead" aria-hidden>
            <span />
            <span>{t('suggest.name')}</span>
            <span>{t('suggest.level')}</span>
            <span>{t('suggest.purpose')}</span>
            <span>{t('suggest.source')}</span>
          </div>
          {groups.map((g) => (
            <div key={g.kind} className="suggest-group">
              <div className="suggest-group-title">
                {g.label}
                <span className="suggest-group-count">{g.items.length}</span>
              </div>
              {g.items.map((s) => (
                <label key={s.entryId} className={`suggest-row${s.selected ? ' is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={s.selected}
                    onChange={(e) => onToggle(s.entryId, e.target.checked)}
                  />
                  <span className="suggest-id" title={s.displayName}>
                    {s.displayName}
                  </span>
                  <span className="suggest-level" title={s.levelReason}>
                    {s.levelLabel}
                  </span>
                  <span className="suggest-purpose" title={s.suggestedPurpose || undefined}>
                    {s.purposeLabel}
                  </span>
                  <span
                    className={`suggest-source${s.isUserDocument ? ' suggest-source-user' : ''}`}
                    title={
                      s.isUserDocument
                        ? t('suggest.userDoc', { summary: s.sourceSummary })
                        : s.sourceSummary
                    }
                  >
                    {s.sourceSummary}
                  </span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="actions">
          <button
            disabled={busy}
            title={t('suggest.laterHint')}
            onClick={onClose}
          >
            {t('suggest.later')}
          </button>
          <button className="primary" disabled={busy || selectedCount === 0} onClick={onConfirm}>
            {t('suggest.writeN', { n: selectedCount })}
          </button>
        </div>
      </div>
    </div>
  )
}

function ContainerRootEditorModal({
  editor,
  busy,
  onClose,
  onPathChange,
  onPickFolder,
  onSave,
  onRestoreDefault,
}: {
  editor: { id: string; label: string; path: string }
  busy: boolean
  onClose: () => void
  onPathChange: (path: string) => void
  onPickFolder: () => Promise<string | null>
  onSave: () => void | Promise<void>
  onRestoreDefault: () => void | Promise<void>
}) {
  const { t } = useI18n()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('dialog.editRootTitle', { label: editor.label })}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {t('dialog.editRootBody')}
        </p>
        <label className="form-grid" style={{ display: 'block' }}>
          <span className="sub">{t('dialog.path')}</span>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            <input
              style={{ flex: 1, minWidth: 0 }}
              value={editor.path}
              disabled={busy}
              spellCheck={false}
              onChange={(e) => onPathChange(e.target.value)}
              placeholder={t('dialog.pathPlaceholder')}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  const path = await onPickFolder()
                  if (path) onPathChange(path.replace(/\//g, '\\'))
                })()
              }}
            >
              {t('dialog.browse')}
            </button>
          </div>
        </label>
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <button type="button" disabled={busy} onClick={() => void onRestoreDefault()}>
            {t('dialog.restoreDefault')}
          </button>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" disabled={busy} onClick={onClose}>
              {t('dialog.cancel')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !editor.path.trim()}
              onClick={() => void onSave()}
            >
              {t('dialog.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** oplog 操作类型 → 中文标签 */
function opLabel(op: string): string {
  if (op === 'promote') return t('ops.promote')
  if (op === 'setIntendedLevel') return t('ops.setLevel')
  if (op === 'recordDiff') return t('ops.recordDiff')
  if (op === 'cacheUpdate') return t('ops.cacheUpdate')
  if (op === 'reapply') return t('ops.reapply')
  return op
}

function formatOpTs(ts: string): string {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return ts || '—'
  return new Date(n * 1000).toLocaleString()
}

/** 定制与操作记录：上半区当前级别与定制 diff，下半区按时间列操作事件 */
function EntryOpsLogModal({
  log,
  onClose,
}: {
  log: EntryOperationLogDto
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('ops.title')}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {log.entryId ? t('ops.localEntry', { id: log.entryId }) : t('ops.notPromoted')}
          {log.networkEntryId ? t('ops.netEntry', { id: log.networkEntryId }) : ''}
          {log.sourceId ? t('ops.source', { id: log.sourceId }) : ''}
        </p>
        <p className="sub">
          {t('ops.level', { level: log.level || '—' })}
          {log.updatedAt ? t('ops.updated', { ts: formatOpTs(log.updatedAt) }) : ''}
        </p>
        {log.hasCustomization ? (
          <>
            <p className="sub">{t('ops.diffIntro')}</p>
            <pre className="ops-log-diff">{log.unifiedDiff}</pre>
          </>
        ) : (
          <p className="sub">{t('ops.noDiff')}</p>
        )}
        <p className="sub">{t('ops.eventsN', { n: log.events.length })}</p>
        {log.events.length === 0 ? (
          <p className="sub">{t('ops.none')}</p>
        ) : (
          <div className="ops-log-events">
            <table>
              <thead>
                <tr>
                  <th>{t('ops.time')}</th>
                  <th>{t('ops.action')}</th>
                  <th>{t('ops.note')}</th>
                </tr>
              </thead>
              <tbody>
                {log.events
                  .slice()
                  .reverse()
                  .map((ev, i) => (
                    <tr key={`${ev.ts}-${i}`}>
                      <td>{formatOpTs(ev.ts)}</td>
                      <td>
                        {opLabel(ev.op)}
                        {ev.level ? ` (${ev.level})` : ''}
                      </td>
                      <td>{ev.note || '—'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onClose}>
            {t('dialog.close')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ScanBuildPreviewModal({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: ScanBuildPreviewState
  busy: boolean
  onClose: () => void
  onConfirm: (keys: string[]) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(preview.items.map((i) => [i.key, true])),
  )
  const selectedKeys = preview.items.filter((i) => selected[i.key] !== false).map((i) => i.key)
  const allChecked = preview.items.length > 0 && selectedKeys.length === preview.items.length
  const canConfirm =
    selectedKeys.length > 0 ||
    preview.pendingNewProjectCount > 0 ||
    preview.silentRelinkCount > 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('scan.title')}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {t('scan.body')}
          {preview.pendingNewProjectCount > 0
            ? t('scan.newProjects', { n: preview.pendingNewProjectCount })
            : ''}
          {preview.silentRelinkCount > 0
            ? t('scan.silentRelink', { n: preview.silentRelinkCount })
            : ''}
          {preview.skippedContentConflict > 0
            ? t('scan.hashConflict', { n: preview.skippedContentConflict })
            : ''}
        </p>
        {preview.message ? <p className="sub">{preview.message}</p> : null}
        {preview.items.length > 0 ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>
              <input
                type="checkbox"
                checked={allChecked}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked
                  setSelected(Object.fromEntries(preview.items.map((i) => [i.key, on])))
                }}
              />
              {t('scan.selectAll')}
            </label>
            <span className="sub">
              {t('scan.selectedOf', { n: selectedKeys.length, total: preview.items.length })}
            </span>
          </div>
        ) : null}
        <div className="modal-scroll">
          {preview.items.length === 0 ? (
            <div className="empty">
              {preview.pendingNewProjectCount > 0
                ? t('scan.noAssetsNewProjects')
                : t('scan.noDelta')}
            </div>
          ) : (
            preview.items.map((item) => (
              <label className="scan-row" key={item.key}>
                <input
                  type="checkbox"
                  checked={selected[item.key] !== false}
                  disabled={busy}
                  onChange={(e) =>
                    setSelected((m) => ({ ...m, [item.key]: e.target.checked }))
                  }
                />
                <div>
                  <div>
                    [{item.kind}] {item.suggestedId}{' '}
                    <span className="sub">{t('scan.new')}</span>
                  </div>
                  <div className="sub" title={item.sourcePath}>
                    {item.sourcePath}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || !canConfirm}
            onClick={() => onConfirm(selectedKeys)}
          >
            {preview.pendingNewProjectCount > 0
              ? t('scan.confirmProjects', {
                  n: selectedKeys.length,
                  p: preview.pendingNewProjectCount,
                })
              : t('scan.confirm', { n: selectedKeys.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

function MoveIntoBackupModal({
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  preview: MoveIntoBackupPreviewDto
  busy: boolean
  onClose: () => void
  onConfirm: (entryIds: string[]) => void
}) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(preview.items.map((i) => [i.entryId, true])),
  )
  const selectedIds = preview.items.filter((i) => selected[i.entryId] !== false).map((i) => i.entryId)
  const allChecked = preview.items.length > 0 && selectedIds.length === preview.items.length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('move.title')}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {t('move.body', { n: preview.pendingCount })}
        </p>
        {preview.items.length > 0 ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label>
              <input
                type="checkbox"
                checked={allChecked}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked
                  setSelected(Object.fromEntries(preview.items.map((i) => [i.entryId, on])))
                }}
              />
              {t('scan.selectAll')}
            </label>
            <span className="sub">{t('scan.selectedOf', { n: selectedIds.length, total: preview.items.length })}</span>
          </div>
        ) : null}
        <div className="modal-scroll">
          {preview.items.length === 0 ? (
            <div className="empty">{t('move.empty')}</div>
          ) : (
            preview.items.map((item) => (
              <label className="scan-row" key={item.entryId}>
                <input
                  type="checkbox"
                  checked={selected[item.entryId] !== false}
                  disabled={busy}
                  onChange={(e) =>
                    setSelected((m) => ({ ...m, [item.entryId]: e.target.checked }))
                  }
                />
                <div>
                  <div>{item.displayName}</div>
                  <div className="sub" title={item.currentPath}>
                    {item.currentPath}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="actions">
          <button disabled={busy} onClick={onClose}>
            {t('dialog.cancel')}
          </button>
          <button
            className="primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => onConfirm(selectedIds)}
          >
            {t('move.confirm', { n: selectedIds.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConflictCompareModal({
  conflicts,
  operation,
  busy,
  onClose,
  onConfirm,
}: {
  conflicts: PathConflictDto[]
  operation: 'moveIntoBackup' | 'withdraw' | 'refresh' | 'promoteFromNetwork' | 'clearContainer'
  busy: boolean
  onClose: () => void
  onConfirm: (resolutions: Array<{ key: string; choice: ConflictChoice }>) => void
}) {
  const { t } = useI18n()
  const opTitle =
    operation === 'refresh'
      ? t('conflict.refresh')
      : operation === 'moveIntoBackup'
        ? t('conflict.move')
        : operation === 'promoteFromNetwork'
          ? t('conflict.promote')
          : operation === 'clearContainer'
            ? t('conflict.clearContainer')
            : t('conflict.withdraw')

  /** 同一技能只保留一条冲突卡（防止 C:\ 与 \\?\C:\ 双窗）；清空多容器用 key 区分同名技能 */
  const uniqueConflicts = (() => {
    const seen = new Set<string>()
    const out: PathConflictDto[] = []
    for (const c of conflicts) {
      const id =
        operation === 'clearContainer'
          ? c.key.toLowerCase()
          : (c.suggestedId || c.key).toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      out.push(c)
    }
    return out
  })()

  const [picked, setPicked] = useState<Record<string, ConflictChoice>>({})

  const idOf = (c: PathConflictDto) =>
    operation === 'clearContainer'
      ? c.key.toLowerCase()
      : (c.suggestedId || c.key).toLowerCase()

  const setChoiceForId = (uid: string, choice: ConflictChoice) => {
    setPicked((prev) => ({ ...prev, [uid]: choice }))
  }

  const applyBatch = (choice: ConflictChoice) => {
    onConfirm(conflicts.map((c) => ({ key: c.key, choice })))
  }

  const applyPickedOrBatch = () => {
    const allPicked = uniqueConflicts.every((c) => picked[idOf(c)])
    if (!allPicked) {
      return
    }
    onConfirm(
      conflicts.map((c) => ({
        key: c.key,
        choice: picked[idOf(c)] ?? 'skip',
      })),
    )
  }

  const overwriteLabel =
    operation === 'promoteFromNetwork' ? t('conflict.useNetwork') : t('conflict.keepContainer')
  const mergeLabel = t('conflict.keepLibrary')
  const readyCount = uniqueConflicts.filter((c) => picked[idOf(c)]).length
  const allReady = uniqueConflicts.length > 0 && readyCount === uniqueConflicts.length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t('conflict.title', { op: opTitle })}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {t('conflict.count', { n: uniqueConflicts.length })}
          {conflicts.length > uniqueConflicts.length
            ? t('conflict.merged', { n: conflicts.length - uniqueConflicts.length })
            : ''}
          {t('conflict.picked', { ready: readyCount, total: uniqueConflicts.length })}
          {operation === 'promoteFromNetwork' ? t('conflict.promoteHint') : t('conflict.defaultHint')}
        </p>

        <div className="modal-scroll">
          <div className="conflict-list">
            {uniqueConflicts.map((c) => {
              const uid = idOf(c)
              const cur = picked[uid]
              return (
              <div className="conflict-card" key={c.key}>
                <div className="name">
                  [{c.kind}] {c.suggestedId}
                  <span className="conflict-meta-inline">
                    {' '}
                    {t('conflict.hash', {
                      a: c.sourceHash.slice(0, 8),
                      b: c.targetHash.slice(0, 8),
                    })}
                    {cur
                      ? t('conflict.pickedAs', {
                          label:
                            cur === 'overwrite'
                              ? overwriteLabel
                              : cur === 'merge'
                                ? mergeLabel
                                : t('conflict.saveAs'),
                        })
                      : ''}
                  </span>
                </div>

                <SideBySideDiff
                  leftLabel={t('diff.leftSource')}
                  rightLabel={t('diff.rightTarget')}
                  leftPath={c.sourcePath.replace(/^\\\\\?\\/, '')}
                  rightPath={c.targetPath.replace(/^\\\\\?\\/, '')}
                  leftComparePath={c.sourceComparePath?.replace(/^\\\\\?\\/, '')}
                  rightComparePath={c.targetComparePath?.replace(/^\\\\\?\\/, '')}
                  leftText={c.sourcePreview}
                  rightText={c.targetPreview}
                  leftHint={
                    c.sourcePreviewLines != null
                      ? t('diff.previewLines', { n: c.sourcePreviewLines })
                      : undefined
                  }
                  rightHint={
                    c.targetPreviewLines != null
                      ? t('diff.previewLines', { n: c.targetPreviewLines })
                      : undefined
                  }
                  fileMeta={{
                    leftModified: c.sourceModified,
                    rightModified: c.targetModified,
                    leftCreated: c.sourceCreated,
                    rightCreated: c.targetCreated,
                    leftSize: c.sourceSize,
                    rightSize: c.targetSize,
                  }}
                />

                <div className="conflict-pane-actions" role="group" aria-label={t('conflict.itemStrategy', { id: c.suggestedId })}>
                  <button
                    type="button"
                    className={cur === 'overwrite' ? 'primary' : undefined}
                    disabled={busy}
                    onClick={() => setChoiceForId(uid, 'overwrite')}
                  >
                    {overwriteLabel}
                  </button>
                  <button
                    type="button"
                    className={cur === 'saveAs' ? 'primary' : undefined}
                    disabled={busy}
                    onClick={() => setChoiceForId(uid, 'saveAs')}
                  >
                    {t('conflict.saveAs')}
                  </button>
                  <button
                    type="button"
                    className={cur === 'merge' ? 'primary' : undefined}
                    disabled={busy}
                    onClick={() => setChoiceForId(uid, 'merge')}
                  >
                    {mergeLabel}
                  </button>
                </div>
              </div>
              )
            })}
          </div>
        </div>

        <div className="actions actions-conflict">
          <div className="actions-conflict-strategies" role="group" aria-label={t('conflict.allSame')}>
            <button
              type="button"
              className="primary"
              disabled={busy || uniqueConflicts.length === 0}
              onClick={() => applyBatch('overwrite')}
            >
              {t('conflict.allUse', { label: overwriteLabel })}
            </button>
            <button
              type="button"
              disabled={busy || uniqueConflicts.length === 0}
              onClick={() => applyBatch('saveAs')}
            >
              {t('conflict.allSaveAs')}
            </button>
            <button
              type="button"
              disabled={busy || uniqueConflicts.length === 0}
              onClick={() => applyBatch('merge')}
            >
              {t('conflict.allUse', { label: mergeLabel })}
            </button>
          </div>
          <div className="actions-conflict-cancel">
            <button type="button" disabled={busy || !allReady} onClick={() => applyPickedOrBatch()}>
              {t('conflict.apply', { ready: readyCount, total: uniqueConflicts.length })}
            </button>
            <button type="button" disabled={busy} onClick={onClose}>
              {t('dialog.cancel')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
