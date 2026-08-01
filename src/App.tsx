import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type {
  AppSnapshot,
  CatalogBackupInfo,
  ClusterNodeDto,
  DiscoveredItemDto,
  IpcMethod,
  LibraryListItemDto,
  MoveIntoBackupPreviewDto,
  NavNodeDto,
  PathConflictDto,
  SuggestedPurposeDto,
  WorkspaceContainerSectionDto,
} from '../shared/ipc'
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
import { ThemeGalleryPanel } from './components/ThemeGalleryPanel'
import { loadMdStyleState, saveMdStyleState, type MdStyleState } from './lib/mdStylePrefs'
import { LayoutPriority, WorkbenchSplit } from './layout/WorkbenchSplit'

async function invoke<T = unknown>(method: IpcMethod, args?: Record<string, unknown>) {
  if (!window.ccm?.invoke) {
    throw new Error(
      '未注入 window.ccm。Tauri 请用 npm run tauri:dev；浏览器预览 npm run dev:web；Electron 对照 npm run dev:electron。',
    )
  }
  return window.ccm.invoke<T>(method, args)
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

/** 扫描建库：全盘/配置根发现项目 + 容器资产入库（可能较慢） */
const SCAN_BUILD_HINT = '扫描可读盘符或已配置扫描根上的项目，并纳入台账（可能较慢）'

type CtxState = { x: number; y: number; items: MenuItem[] } | null

type ConflictChoice = 'merge' | 'overwrite' | 'saveAs' | 'skip'

/** VS Code SplitView 视图约束（与 workbench sidebar / editor / auxiliary 对齐） */
const NAV_MIN = 180
const LIST_MIN = 280
const DETAIL_MIN = 180
const DEFAULT_NAV = 220
const DEFAULT_LIST = 480
const DEFAULT_DETAIL = 260

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

export default function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [projectDialog, setProjectDialog] = useState<'edit' | null>(null)
  const [tagDialog, setTagDialog] = useState(false)
  const [tagScope, setTagScope] = useState('global')
  const [tagPurposes, setTagPurposes] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestDialog, setSuggestDialog] = useState<{
    suggestions: SuggestedPurposeDto[]
    alreadyTagged: number
    noSuggestion: number
  } | null>(null)
  const [projectForm, setProjectForm] = useState({ name: '', rootPath: '', category: '其它项目', id: '' })
  const [removeDialog, setRemoveDialog] = useState<{
    projectId: string
    projectName: string
    fileCount: number
  } | null>(null)
  const [movePreview, setMovePreview] = useState<MoveIntoBackupPreviewDto | null>(null)
  const [conflicts, setConflicts] = useState<PathConflictDto[] | null>(null)
  const [conflictOp, setConflictOp] = useState<
    'moveIntoBackup' | 'withdraw' | 'scanBuild' | 'refresh' | 'promoteFromNetwork' | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 扫描建库：冲突决议后继续 confirm 用的已选 keys */
  const [pendingScanBuildKeys, setPendingScanBuildKeys] = useState<string[] | null>(null)
  /** 网络库存入永久库：冲突决议后继续用的 entryIds */
  const [pendingPromoteIds, setPendingPromoteIds] = useState<string[] | null>(null)
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

  const updateMdStyle = useCallback((next: MdStyleState) => {
    setMdStyle(next)
    saveMdStyleState(next)
  }, [])

  const anyMdDirty = Object.values(mdDirtyById).some(Boolean)

  /** 关闭 dirty 页签前确认 */
  const confirmDiscardTab = (tabId: string) => {
    if (!mdDirtyByIdRef.current[tabId]) return true
    return window.confirm('该 Markdown 有未保存更改，确定关闭并丢弃？')
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
        setToast('复制失败')
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
        label: '关闭',
        onClick: () => closeMdTab(tabId),
      },
      {
        label: '关闭其他',
        disabled: others.length === 0,
        onClick: () => closeMdTabsByIds(others),
      },
      {
        label: '关闭右侧',
        disabled: toRight.length === 0,
        onClick: () => closeMdTabsByIds(toRight),
      },
      {
        label: '关闭已保存',
        disabled: saved.length === 0,
        onClick: () => closeMdTabsByIds(saved),
      },
      {
        label: '全部关闭',
        disabled: allIds.length === 0,
        onClick: () => closeMdTabsByIds(allIds),
      },
      {
        label: '复制路径',
        disabled: !hasPath,
        onClick: () => copyText(pathAbs, '已复制路径'),
      },
      {
        label: '复制相对路径',
        disabled: !hasPath,
        onClick: () => {
          const rel = relativeToRoot(pathAbs, pathRoot)
          if (rel) {
            copyText(rel, '已复制相对路径')
            return
          }
          copyText(pathAbs, '无法相对化，已复制绝对路径')
        },
      },
      {
        label: '在资源管理器中显示',
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
      setSnap(res.snapshot)
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
      setToast('操作失败')
      window.setTimeout(() => setToast(null), 4000)
    }
    return res
  }, [])

  const refresh = useCallback(async () => {
    try {
      setLoadError(null)
      apply(await invoke('getSnapshot'))
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

  useEffect(() => {
    void invoke<{ maximized: boolean }>('windowIsMaximized')
      .then((res) => {
        if (res.ok && res.data) setMaximized(Boolean(res.data.maximized))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const close = () => setCtx(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [])

  const run = async (method: IpcMethod, args?: Record<string, unknown>) => {
    try {
      return apply(await invoke(method, args))
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
        void run('setSelection', {
          entryIds: [tab.entryId],
          detailPathSide: tab.pathSide,
        })
      } else if (tab?.kind === 'diff') {
        void run('setSelection', {
          entryIds: [tab.entryId],
          detailPathSide: 'library',
        })
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  )

  /** 列表单选且 snapshot 带正文时：按「条目+侧」打开或激活编辑页签 */
  useEffect(() => {
    if (!snap) return
    if (snap.selectedEntryIds.length !== 1) return
    if (snap.detailPaneMode && snap.detailPaneMode !== 'markdown') {
      // 仍允许在其它模式下预开签，不强制
    }
    const entryId = snap.selectedEntryIds[0]
    const text = snap.detailMarkdownText
    if (text == null) return
    const filePath = snap.detailMarkdownFilePath || ''
    const pathSide: MdPathSide = snap.detailPathSide === 'container' ? 'container' : 'library'
    const fileName =
      filePath.replace(/\//g, '\\').split('\\').pop() ||
      entryId.split('-').slice(-1)[0] ||
      entryId
    const title = formatEditTabTitle(fileName, pathSide)
    const editable = Boolean(snap.commands.canSaveDetailMarkdown)
    const tabId = makeEditTabId(entryId, pathSide)

    const existing = openMdTabsRef.current.find((t) => t.tabId === tabId)
    if (existing) {
      const now = Date.now()
      setOpenMdTabs((prev) =>
        prev.map((t) =>
          t.tabId === tabId
            ? {
                ...t,
                lastActiveAt: now,
                filePath,
                title,
                editable,
                // 未脏且路径/正文变了才 remount
                ...(mdDirtyByIdRef.current[tabId]
                  ? {}
                  : filePath !== t.filePath || text !== t.initialFullText
                    ? { initialFullText: text, remountKey: (t.remountKey ?? 0) + 1 }
                    : {}),
              }
            : t,
        ),
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
      setToast(`最多打开 ${MD_TAB_MAX} 个 Markdown 页签，请先关闭或保存其它未保存页签`)
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
          title: `对比 · ${short}`,
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
        setToast(`最多打开 ${MD_TAB_MAX} 个 Markdown 页签，请先关闭或保存其它未保存页签`)
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setOpenMdTabs(tabs)
      setActiveMdTabId(tabId)
      if (data.sameContent) {
        setToast('两侧正文相同')
        window.setTimeout(() => setToast(null), 3000)
      }
      void run('setDetailMode', { mode: 'markdown' })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply],
  )

  /** 一键扫描建库：发现 → 同名冲突先决议 → 登记 + 缺库则复制入库 */
  const openScanProjects = async () => {
    if (busy) return
    setBusy(true)
    try {
      const scan = apply(
        await invoke<{
          items: DiscoveredItemDto[]
          pendingNewProjectCount?: number
          scanRoots?: string[]
          conflicts?: PathConflictDto[]
        }>('scanAndIngestPreview'),
      )
      if (!scan.ok) return
      const items = scan.data?.items ?? []
      const keys = items.map((i) => i.key)
      const previewConflicts = scan.data?.conflicts ?? []
      if (previewConflicts.length > 0) {
        setPendingScanBuildKeys(keys)
        setConflictOp('scanBuild')
        setConflicts(previewConflicts)
        return
      }
      await runConfirmScanBuild(keys, [])
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const runConfirmScanBuild = async (
    keys: string[],
    resolutions: Array<{ key: string; choice: ConflictChoice }>,
  ) => {
    let shouldOpenClassify = false
    try {
      const build = apply(
        await invoke<{
          registered?: number
          projectsAdded?: number
          openAutoClassify?: boolean
          conflicts?: PathConflictDto[]
          copiedIntoLibrary?: number
        }>('confirmScanBuild', {
          selectedKeys: keys,
          resolutions,
        }),
      )
      const nextConflicts = build.data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setPendingScanBuildKeys(keys)
        setConflictOp('scanBuild')
        setConflicts(nextConflicts)
        return
      }
      setPendingScanBuildKeys(null)
      setConflicts(null)
      setConflictOp(null)
      if (build.ok) {
        const added = build.data?.projectsAdded ?? 0
        const registered = build.data?.registered
        const copied = build.data?.copiedIntoLibrary
        setToast(
          build.message ||
            `扫描建库完成：新项目 ${added}` +
              (typeof registered === 'number' ? `，登记资产 ${registered}` : '') +
              (typeof copied === 'number' && copied > 0 ? `，复制入库 ${copied}` : ''),
        )
        window.setTimeout(() => setToast(null), 6000)
        shouldOpenClassify = Boolean(build.data?.openAutoClassify)
      }
    } finally {
      if (shouldOpenClassify) {
        window.setTimeout(() => {
          void openSuggestPurposes({ skipBusyGuard: true })
        }, 0)
      }
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
        setToast('无待迁项（文件可能已在永久库）')
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

  /** 移出到永久库：内容相同直接删容器副本；内容不同弹冲突决议窗 */
  const submitWithdraw = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }> = [],
  ) => {
    if (busy) return
    setBusy(true)
    try {
      const res = apply(
        await invoke<{ conflicts?: PathConflictDto[] }>('withdraw', { resolutions }),
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

  const submitConflictResolutions = async (
    resolutions: Array<{ key: string; choice: ConflictChoice }>,
  ) => {
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
          setToast(res.message || '仍有冲突待决议')
          window.setTimeout(() => setToast(null), 4000)
          return
        }
        setConflicts(null)
        setConflictOp(null)
        setPendingPromoteIds(null)
        setToast(res.message || `已存入永久库 ${data?.promoted ?? 0} 项`)
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
    if (conflictOp === 'scanBuild') {
      const keys = pendingScanBuildKeys
      if (!keys?.length) {
        setConflicts(null)
        setConflictOp(null)
        return
      }
      if (busy) return
      setBusy(true)
      try {
        await runConfirmScanBuild(keys, resolutions)
      } catch (e) {
        setToast(e instanceof Error ? e.message : String(e))
        window.setTimeout(() => setToast(null), 5000)
      } finally {
        setBusy(false)
      }
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
              ? `刷新冲突处理失败 ${failed} 项：${detail}`
              : `刷新冲突处理失败 ${failed} 项`,
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
              const sel = apply(
                await invoke('setSelection', {
                  entryIds: [entryId],
                  detailPathSide: tab.pathSide,
                }),
              )
              const text = sel.snapshot?.detailMarkdownText ?? ''
              const filePath = sel.snapshot?.detailMarkdownFilePath || tab.filePath
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
        title: '选择项目根目录（将创建 .cursor 并置顶）',
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
   * 删除项目（与「置顶容器/容器」分组无关）。
   * 无文件：删空标记目录并去登记；有文件：确认强制删除，或打开 .cursor 手动处理。
   * 迁入永久库请用空白区/全局容器右键菜单。
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
          `将从台账移除项目「${projectName}」` +
            (cursorExists ? '，并删除空的 .cursor（等）标记目录' : '') +
            '。\n确定删除？',
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
            ...(s.historyItems ?? []),
          ]),
          ...snap.inContainerItems,
          ...snap.inLibraryItems,
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

  const openSuggestPurposes = async (opts?: { skipBusyGuard?: boolean }) => {
    if (busy && !opts?.skipBusyGuard) return
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
        setToast(res.message || '无待建议项')
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

  if (loadError) {
    return (
      <div className="app">
        <div className="toolbar" data-tauri-drag-region>
          <span className="spacer" />
          <WindowControls maximized={maximized} setMaximized={setMaximized} />
        </div>
        <div className="empty" style={{ padding: 24 }}>
          <p>启动失败：{loadError}</p>
          <button type="button" onClick={() => void refresh()}>
            重试
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
        <div className="empty">加载中…</div>
      </div>
    )
  }

  const promoteSelectedFromNetwork = async () => {
    if (busy || !snap) return
    const ids = snap.selectedEntryIds.filter((id) => id.startsWith('net:'))
    if (ids.length === 0) {
      setToast('请先在网络库分区选择条目')
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
        }>('promoteNetworkToLibrary', { entryIds: ids, resolutions: [] }),
      )
      const data = res.data as
        | { conflicts?: PathConflictDto[]; promoted?: number }
        | undefined
      const nextConflicts = data?.conflicts ?? []
      if (nextConflicts.length > 0) {
        setPendingPromoteIds(ids)
        setConflictOp('promoteFromNetwork')
        setConflicts(nextConflicts)
        setToast(res.message || '同名冲突需决议（来自网络库）')
        window.setTimeout(() => setToast(null), 4000)
        return
      }
      setToast(res.message || `已存入永久库 ${data?.promoted ?? 0} 项`)
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const fetchNetworkBaseline = async (baselineId: string) => {
    if (busy) return
    setBusy(true)
    try {
      await run('ensureDefaultNetworkLibrary')
      const res = apply(await invoke('fetchNetworkSource', { urlOrBaselineId: baselineId }))
      setToast(res.message || '已拉取基线')
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 6000)
    } finally {
      setBusy(false)
    }
  }

  const fetchNetworkGitUrl = async () => {
    if (busy) return
    const url = window.prompt('粘贴 Git URL（https://… 或 git@…）')
    if (!url?.trim()) return
    setBusy(true)
    try {
      await run('ensureDefaultNetworkLibrary')
      const res = apply(
        await invoke('fetchNetworkSource', { urlOrBaselineId: url.trim() }),
      )
      setToast(res.message || '已拉取')
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 6000)
    } finally {
      setBusy(false)
    }
  }

  const checkNetworkUpdates = async () => {
    if (busy) return
    setBusy(true)
    try {
      await run('ensureDefaultNetworkLibrary')
      const res = apply(await invoke('checkNetworkUpdates'))
      setToast(res.message || '检查完成')
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const applyNetworkCacheUpdates = async () => {
    if (busy) return
    const ok = window.confirm(
      '确认覆盖网络库缓存？\n\n只会更新本机网络库副本，不会改永久库。有更新标记的源将被重新浅克隆。',
    )
    if (!ok) return
    setBusy(true)
    try {
      const res = apply(await invoke('applyNetworkCacheUpdate', { sourceIds: [] }))
      setToast(res.message || '缓存已更新')
      window.setTimeout(() => setToast(null), 4000)
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e))
      window.setTimeout(() => setToast(null), 5000)
    } finally {
      setBusy(false)
    }
  }

  const selected = new Set(snap.selectedEntryIds)
  const cmd = snap.commands

  const q = searchQuery.trim().toLowerCase()
  const matchItem = (item: LibraryListItemDto) => {
    if (!q) return true
    const hay =
      `${item.searchText || ''} ${item.entryId} ${item.displayName} ${item.subtitle} ${item.groupName} ${item.sourceLabel || ''}`.toLowerCase()
    return hay.includes(q)
  }
  const filterItems = (items: LibraryListItemDto[]) => items.filter(matchItem)
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
            inContainerHeader: `容器中 · ${focusWsName}`,
            inContainerSummary: snap.inContainerSummary,
            historyItems: snap.inLibraryItems,
            historyHeader: snap.inLibraryOwnHeader || `曾用于 · ${focusWsName}`,
            historySummary: snap.inLibraryOwnSummary,
          },
        ]
  const filteredSections = containerSections.map((sec) => ({
    ...sec,
    inContainerItems: filterItems(sec.inContainerItems ?? []),
    historyItems: filterItems(sec.historyItems ?? []),
  }))
  const filteredMissing = filterItems(snap.missingItems)
  const filteredOther = filterItems(snap.inLibraryOtherItems)
  const filteredNetwork = filterItems(snap.networkLibraryItems ?? [])
  const filteredOtherIds = new Set(filteredOther.map((x) => x.entryId))
  const filterClusterTree = (nodes: ClusterNodeDto[]): ClusterNodeDto[] => {
    if (!q) return nodes
    const walk = (ns: ClusterNodeDto[]): ClusterNodeDto[] => {
      const out: ClusterNodeDto[] = []
      for (const n of ns) {
        if (n.isGroup) {
          const children = walk(n.children || [])
          if (children.length > 0) out.push({ ...n, children, isExpanded: true })
        } else if (n.entryId && filteredOtherIds.has(n.entryId)) {
          out.push(n)
        }
      }
      return out
    }
    return walk(nodes)
  }
  const filteredRoots = filterClusterTree(snap.permanentLibraryRoots)
  const sectionContainerCount = filteredSections.reduce((n, s) => n + s.inContainerItems.length, 0)
  const sectionHistoryCount = filteredSections.reduce((n, s) => n + s.historyItems.length, 0)
  const totalVisible =
    sectionContainerCount +
    sectionHistoryCount +
    filteredMissing.length +
    filteredOther.length +
    filteredNetwork.length
  const totalAll =
    containerSections.reduce(
      (n, s) => n + (s.inContainerItems?.length ?? 0) + (s.historyItems?.length ?? 0),
      0,
    ) +
    snap.inLibraryOtherItems.length +
    snap.missingItems.length +
    (snap.networkLibraryItems?.length ?? 0)
  const isFlatGroup = snap.clusterModeIndex === 2

  /** 列表面板可见顺序（各工作区容器 → 曾用于 → 缺失 → 永久库），供 Shift 范围选 */
  const panelEntryOrder = (() => {
    const fromTree = (nodes: ClusterNodeDto[]): string[] => {
      const out: string[] = []
      for (const n of nodes) {
        if (n.isGroup) out.push(...fromTree(n.children || []))
        else if (n.entryId) out.push(n.entryId)
      }
      return out
    }
    return [
      ...filteredSections.flatMap((s) => s.inContainerItems.map((i) => i.entryId)),
      ...filteredSections.flatMap((s) => s.historyItems.map((i) => i.entryId)),
      ...filteredMissing.map((i) => i.entryId),
      ...(isFlatGroup
        ? filteredOther.map((i) => i.entryId)
        : fromTree(filteredRoots)),
      ...filteredNetwork.map((i) => i.entryId),
    ]
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
        void run('setSelection', { entryIds: next, detailPathSide: pathSide })
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
            setToast(`最多打开 ${MD_TAB_MAX} 个 Markdown 页签，请先关闭或保存其它未保存页签`)
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
    void run('setSelection', { entryIds: next, detailPathSide: pathSide })
  }

  const saveDetailMarkdown = async (
    tabId: string,
    entryId: string,
    fullContent: string,
  ): Promise<boolean> => {
    if (!entryId) return false
    const tab = openMdTabsRef.current.find((t) => t.tabId === tabId)
    if (tab?.pathSide === 'container' || tab?.pathSide === 'library') {
      await run('setSelection', { entryIds: [entryId], detailPathSide: tab.pathSide })
    }
    const res = await run('saveDetailMarkdown', { entryId, content: fullContent })
    if (res?.ok) setTabDirty(tabId, false)
    return Boolean(res?.ok)
  }

  const findListItem = (id: string) =>
    containerSections.flatMap((s) => s.inContainerItems).find((x) => x.entryId === id) ||
    containerSections.flatMap((s) => s.historyItems).find((x) => x.entryId === id) ||
    snap.inContainerItems.find((x) => x.entryId === id) ||
    snap.inLibraryItems.find((x) => x.entryId === id) ||
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

  const entryMenu = (entryId: string, commands: typeof cmd, selectedIds: string[]): MenuItem[] => {
    const meta = selectionMeta(selectedIds.length ? selectedIds : [entryId])
    const canRetag = Boolean(commands.canSetScope)
    return [
      {
        label: `部署 → ${focusWsName}`,
        disabled: !commands.canDeploy,
        onClick: () => void run('deploy'),
      },
      {
        label: '移入永久库',
        disabled: !commands.canWithdraw,
        onClick: () => void submitWithdraw(),
      },
      {
        label: '对比代码与容器',
        disabled: selectedIds.length !== 1,
        onClick: () => void openDualCompare(entryId),
      },
      {
        label: '设为层级',
        disabled: !canRetag,
        children: [
          ...(['L0', 'L1', 'L2'] as const).map((level) => ({
            label: level,
            checked: meta.level === level,
            onClick: () => void run('setEntryLevel', { level }),
          })),
          {
            label: '未分类（清除层级）',
            checked: meta.level == null,
            onClick: () => void run('setEntryLevel', { level: '未分类' }),
          },
        ],
      },
      {
        label: '设为项目',
        disabled: !canRetag,
        children: [
          {
            label: '用户级',
            checked: meta.scope === 'global' || meta.scope?.toLowerCase() === 'user-global',
            onClick: () => void run('setScopeGlobal'),
          },
          ...snap.projects.map((p) => ({
            label: p.name,
            checked: meta.scope === `project:${p.id}`,
            onClick: () => void run('setScopeProject', { projectId: p.id }),
          })),
        ],
      },
      {
        label: '编辑标签',
        disabled: !commands.canEditTags,
        onClick: () => {
          void run('setSelection', { entryIds: [entryId] }).then(() => openTags())
        },
      },
      {
        label: '打开库',
        disabled: !commands.canOpenLibraryEntry,
        onClick: () => void run('openLibraryEntry'),
      },
      {
        label: '打开永久库',
        disabled: !commands.canOpenPermanentLibrary,
        onClick: () => void run('openPermanentLibrary'),
      },
      {
        label: '打开曾用路径',
        disabled: !commands.canOpenCurrentDirectory,
        onClick: () => void run('openCurrentDirectory'),
      },
      {
        label: '清理缺失',
        disabled: !commands.canPurgeMissing,
        danger: true,
        onClick: () => void purgeMissingRecords(selectedIds.length ? selectedIds : [entryId]),
      },
      { label: '刷新', onClick: () => void runRefresh() },
    ]
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
      setToast('没有可清理的缺失项')
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    const ok = window.confirm(
      `将从台账删除 ${ids.length} 条缺失记录，列表不再显示。\n不会恢复已删文件。若仍可能找回文件，请先取消并用「打开曾用路径」。\n\n确定清理？`,
    )
    if (!ok) return
    await run('purgeMissing', { entryIds: ids })
  }

  /** 右键先选中（换库后 selection 为空），再用更新后的 commands 弹出菜单 */
  const openEntryMenu = async (
    e: ReactMouseEvent,
    entryId: string,
    pathSide: 'container' | 'library' = 'library',
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const { clientX: x, clientY: y } = e
    // 已在多选内：保留多选；否则改为单选该行（与资源管理器一致）
    const nextIds = selected.has(entryId) ? snap.selectedEntryIds : [entryId]
    let commands = cmd
    let selectedIds = nextIds
    const sameSelection =
      nextIds.length === snap.selectedEntryIds.length &&
      nextIds.every((id, i) => id === snap.selectedEntryIds[i]) &&
      snap.detailPathSide === pathSide
    if (!sameSelection) {
      const res = await run('setSelection', { entryIds: nextIds, detailPathSide: pathSide })
      if (res?.snapshot) {
        commands = res.snapshot.commands
        selectedIds = res.snapshot.selectedEntryIds
      }
    }
    setCtx({ x, y, items: entryMenu(entryId, commands, selectedIds) })
  }

  const blankMenu = (): MenuItem[] => [
    {
      label: '扫描建库',
      title: SCAN_BUILD_HINT,
      onClick: () => void openScanProjects(),
    },
    { label: '迁入永久库', onClick: () => void openMoveIntoBackup() },
    { label: '自动归类建议', onClick: () => void openSuggestPurposes() },
    { label: '刷新', onClick: () => void runRefresh() },
  ]

  /** 最左侧导航栏空白处右键 */
  const navBlankMenu = (): MenuItem[] => [
    { label: '添加容器', onClick: () => void openAddContainer() },
    { label: '扫描建库', title: SCAN_BUILD_HINT, onClick: () => void openScanProjects() },
    { label: '刷新', onClick: () => void runRefresh() },
  ]

  const projectMenu = (projectId: string): MenuItem[] => {
    // 菜单与删除逻辑不区分「置顶容器/容器」；pinned 只影响「移入置顶容器/移入容器」标签
    const p = snap.projects.find((x) => x.id === projectId)
    return [
      {
        label: p?.pinned ? '移入容器' : '移入置顶容器',
        onClick: () => void run('togglePinProject', { id: projectId }),
      },
      { label: '上移', onClick: () => void run('reorderProject', { id: projectId, direction: 'up' }) },
      { label: '下移', onClick: () => void run('reorderProject', { id: projectId, direction: 'down' }) },
      {
        label: '编辑',
        onClick: () => openEditProject(projectId),
      },
      {
        label: '删除',
        danger: true,
        onClick: () => void openRemoveProject(projectId),
      },
      {
        label: '打开目录',
        onClick: () => void run('openProjectCursor', { id: projectId }),
      },
    ]
  }

  const globalMenu = (tool: string): MenuItem[] => [
    {
      label: '打开目录',
      onClick: () => void run('openGlobalContainer', { tool }),
    },
    { label: '扫描建库', title: SCAN_BUILD_HINT, onClick: () => void openScanProjects() },
    { label: '迁入永久库', onClick: () => void openMoveIntoBackup() },
    { label: '刷新', onClick: () => void runRefresh() },
  ]

  return (
    <div className="app" onContextMenu={(e) => showMenu(e, blankMenu())}>
      <div className="toolbar" data-tauri-drag-region>
        <button
          className="primary"
          disabled={busy}
          title={SCAN_BUILD_HINT}
          onClick={() => void openScanProjects()}
        >
          {busy ? '处理中…' : '扫描建库'}
        </button>
        <button onClick={() => void run('chooseLibraryRoot', { forcePrompt: true })}>设置永久库</button>
        <button
          type="button"
          disabled={busy}
          title="拉取官方示例仓到网络库（只读橱窗）"
          onClick={() => void fetchNetworkBaseline('anthropics-skills')}
        >
          拉取 Anthropic 基线
        </button>
        <button
          type="button"
          disabled={busy}
          title="拉取 Vercel agent-skills 到网络库"
          onClick={() => void fetchNetworkBaseline('vercel-agent-skills')}
        >
          拉取 Vercel 基线
        </button>
        <button type="button" disabled={busy} onClick={() => void fetchNetworkGitUrl()}>
          粘贴 Git URL
        </button>
        <button type="button" disabled={busy} onClick={() => void checkNetworkUpdates()}>
          检查网络更新
        </button>
        <button type="button" disabled={busy} onClick={() => void applyNetworkCacheUpdates()}>
          更新网络缓存
        </button>
        <button
          type="button"
          disabled={busy}
          title="将选中的网络库条目复制进永久库（可经冲突窗）"
          onClick={() => void promoteSelectedFromNetwork()}
        >
          存入永久库
        </button>
        <button onClick={() => void runRefresh()}>刷新</button>
        <button type="button" onClick={() => setSettingsOpen(true)}>
          设置
        </button>
        <span
          className="deploy-target-label"
          title={`部署 / 撤回 / 刷新默认针对焦点工作区「${focusWsName}」`}
        >
          部署 → <em className={`ws-accent ws-${snap.selectedGlobalTool ?? 'cursor'}`}>{focusWsName}</em>
        </span>
        {isBrowserPreview() ? <span className="preview-badge">设计预览</span> : null}
        <span className="spacer" />
        <div className="layout-toggles" role="group" aria-label="布局">
          <button
            type="button"
            className={`layout-toggle${navVisible ? ' is-active' : ''}`}
            title="切换左侧栏"
            aria-label="切换左侧栏"
            aria-pressed={navVisible}
            onClick={toggleNavVisible}
          >
            <IconPanelLeft />
          </button>
          <button
            type="button"
            className={`layout-toggle${detailVisible ? ' is-active' : ''}`}
            title="切换右侧栏"
            aria-label="切换右侧栏"
            aria-pressed={detailVisible}
            onClick={toggleDetailVisible}
          >
            <IconPanelRight />
          </button>
        </div>
        <WindowControls maximized={maximized} setMaximized={setMaximized} />
      </div>

      <div className="filters">
        <label className="search-label">
          搜索
          <input
            className="search-input"
            type="search"
            placeholder="名称 / 备注 / 路径…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        {(
          [
            ['FilterShowSkills', '技能', snap.filterShowSkills],
            ['FilterShowRules', '规则', snap.filterShowRules],
            ['FilterShowAgents', '代理', snap.filterShowAgents],
            ['FilterShowCommands', '命令', snap.filterShowCommands],
            ['FilterShowHooks', '钩子', snap.filterShowHooks],
          ] as const
        ).map(([key, label, checked]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => void run('setFilters', { [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
        <button type="button" className="linkish" disabled={busy} onClick={() => void openSuggestPurposes()}>
          自动归类
        </button>
        <span className="filter-count">
          显示 {totalVisible} / 共 {totalAll}
        </span>
        <span>{snap.selectionSummary}</span>
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
                      onContextMenu={(e) => {
                        e.stopPropagation()
                        showMenu(e, navBlankMenu())
                      }}
                    >
                      <NavTree
                        nodes={snap.navNodes}
                        selectedKind={snap.selectedNavKind}
                        selectedProjectId={snap.selectedProjectId}
                        selectedGlobalTool={snap.selectedGlobalTool ?? 'cursor'}
                        onSelect={(kind, projectId, tool) => void run('setNav', { kind, projectId, tool })}
                        onContextGlobal={(e, tool) => showMenu(e, globalMenu(tool))}
                        onContextProject={(e, id) => showMenu(e, projectMenu(id))}
                      />
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
              <section
                className="panel"
                onContextMenu={(e) => {
                  if ((e.target as HTMLElement).closest('.list-item')) return
                  showMenu(e, blankMenu())
                }}
              >
                <div className="panel-title">
                  <button
                    type="button"
                    className="panel-title-main panel-title-path"
                    disabled={
                      busy ||
                      !snap.activeContainerPathDisplay ||
                      snap.activeContainerPathDisplay === '—'
                    }
                    title={
                      snap.activeContainerPathDisplay && snap.activeContainerPathDisplay !== '—'
                        ? `打开库目录：${snap.activeContainerPathDisplay}`
                        : '无活动容器'
                    }
                    onClick={() => void run('openActiveContainer')}
                  >
                    {snap.activeContainerPathDisplay}
                  </button>
                  <button
                    type="button"
                    className="panel-title-sub panel-title-path"
                    disabled={busy || !snap.isLibraryConfigured}
                    title={
                      snap.isLibraryConfigured
                        ? `打开永久库目录：${snap.libraryRootDisplay}`
                        : '请先设置永久库目录'
                    }
                    onClick={() => void run('openLibraryRoot')}
                  >
                    {snap.libraryRootDisplay}
                  </button>
                </div>
                {!snap.isLibraryConfigured ? (
                  <div className="empty">请先设置永久库目录</div>
                ) : totalVisible === 0 ? (
                  <div className="empty" style={{ padding: '12px 10px' }}>
                    {q ? '无匹配项，请调整搜索或类型筛选' : '（空）'}
                  </div>
                ) : (
                  <>
                    {filteredSections.map((sec) => (
                      <div
                        key={`ws-block-${sec.workspaceId}`}
                        className={`workspace-block ws-${sec.workspaceId}${sec.isFocused ? ' is-focused' : ''}`}
                      >
                        <ItemSection
                          tone="container"
                          title={`${sec.inContainerHeader} · ${sec.inContainerSummary}`}
                          pathHint={sec.containerRootDisplay}
                          workspaceId={sec.workspaceId}
                          focused={sec.isFocused}
                          libraryRoot={snap.libraryRootDisplay}
                          hint={
                            snap.showUserRulesSettingsHint &&
                            sec.workspaceId === 'cursor' &&
                            sec.isFocused &&
                            sec.inContainerItems.some(isCursorRuleListItem) ? (
                              <div className="section-hint" role="note">
                                {snap.userRulesSettingsHintText}
                              </div>
                            ) : null
                          }
                          items={sec.inContainerItems}
                          selected={selected}
                          onSelect={toggleSelect}
                          onContext={(e, id) => void openEntryMenu(e, id, 'container')}
                        />
                        <ItemSection
                          tone="history"
                          title={`${sec.historyHeader} · ${sec.historySummary}`}
                          workspaceId={sec.workspaceId}
                          focused={sec.isFocused}
                          libraryRoot={snap.libraryRootDisplay}
                          items={sec.historyItems}
                          selected={selected}
                          onSelect={toggleSelect}
                          onContext={(e, id) => void openEntryMenu(e, id, 'library')}
                        />
                      </div>
                    ))}
                    {snap.missingSectionVisible && (
                      <ItemSection
                        tone="missing"
                        title={snap.missingSummary}
                        libraryRoot={snap.libraryRootDisplay}
                        headerExtra={
                          <button
                            type="button"
                            className="section-header-btn"
                            disabled={busy || filteredMissing.length === 0}
                            title="从台账删除缺失记录，不再显示"
                            onClick={(e) => {
                              e.stopPropagation()
                              void purgeMissingRecords()
                            }}
                          >
                            清理缺失
                          </button>
                        }
                        hint={
                          <div className="section-hint section-hint-missing" role="note">
                            一般为文件被删除（误删或有意）。可右键「打开曾用路径」到上级目录，查询回收站恢复后点「刷新」。若确认不再需要，选中后点「清理缺失」删除台账记录，不再显示。
                          </div>
                        }
                        items={filteredMissing}
                        selected={selected}
                        onSelect={toggleSelect}
                        onContext={(e, id) => void openEntryMenu(e, id, 'library')}
                      />
                    )}
                    {isFlatGroup ? (
                      <ItemSection
                        tone="library"
                        title={snap.inLibraryOtherHeader}
                        libraryRoot={snap.libraryRootDisplay}
                        headerExtra={
                          <GroupModeSelect
                            index={snap.clusterModeIndex}
                            options={snap.clusterModeOptions}
                            onChange={(index) => void run('setClusterMode', { index })}
                          />
                        }
                        items={filteredOther}
                        selected={selected}
                        onSelect={toggleSelect}
                        onContext={(e, id) => void openEntryMenu(e, id, 'library')}
                      />
                    ) : (
                      <ClusterSection
                        tone="library"
                        title={snap.inLibraryOtherHeader}
                        libraryRoot={snap.libraryRootDisplay}
                        roots={filteredRoots}
                        flatFallback={filteredOther}
                        headerExtra={
                          <GroupModeSelect
                            index={snap.clusterModeIndex}
                            options={snap.clusterModeOptions}
                            onChange={(index) => void run('setClusterMode', { index })}
                          />
                        }
                        selected={selected}
                        onSelect={toggleSelect}
                        onContext={(e, id) => void openEntryMenu(e, id, 'library')}
                        onDropLevel={(level, entryIds) =>
                          void run('setEntryLevel', { level, entryIds })
                        }
                      />
                    )}
                    <ItemSection
                      tone="library"
                      title={snap.networkLibraryHeader || '网络库（开源橱窗）'}
                      libraryRoot={snap.networkLibraryRootDisplay || ''}
                      headerExtra={
                        <span className="section-count" title="只读；存入永久库后才可编辑/部署">
                          {snap.networkLibrarySummary || '0'}
                          {!snap.isNetworkLibraryConfigured ? ' · 未配置' : ''}
                        </span>
                      }
                      hint={
                        <div className="section-hint" role="note">
                          检疫橱窗：只读浏览开源 skills/rules。主操作：「存入永久库」「检查更新」。不可直接部署到容器。规范说明见{' '}
                          <a href="https://agentskills.io" target="_blank" rel="noreferrer">
                            agentskills.io
                          </a>
                          。
                        </div>
                      }
                      items={filteredNetwork}
                      selected={selected}
                      onSelect={toggleSelect}
                      onContext={(e, id) => void openEntryMenu(e, id, 'library')}
                    />
                  </>
                )}
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
                        {(['summary', 'markdown', 'raw'] as const).map((mode) => (
                          <button
                            key={mode}
                            className={snap.detailPaneMode === mode ? 'active' : ''}
                            onClick={() => void run('setDetailMode', { mode })}
                          >
                            {mode === 'summary'
                              ? '摘要'
                              : mode === 'markdown'
                                ? anyMdDirty
                                  ? 'Markdown •'
                                  : 'Markdown'
                                : '代码'}
                          </button>
                        ))}
                        <div className="tabs-spacer" />
                        <button
                          type="button"
                          className={`tabs-action${themeGalleryOpen ? ' active' : ''}`}
                          title="排版与布局（主题画廊）"
                          onClick={() => setThemeGalleryOpen((v) => !v)}
                        >
                          样式
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
                          {snap.detailPaneMode === 'summary' ? (
                            <div className="detail-mode-panel">
                              {snap.detailSummaryText}
                              {snap.detailSourcePathDisplay ? (
                                <>
                                  {'\n\n'}路径: {snap.detailSourcePathDisplay}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          {snap.detailPaneMode === 'raw' ? (
                            <pre className="detail-mode-panel detail-raw-pre">
                              {snap.detailMarkdownText || '（无内容）'}
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
                                onOpenCompare={(entryId) => void openDualCompare(entryId)}
                                onTabContextMenu={onMdTabContextMenu}
                              />
                            </div>
                          ) : snap.detailPaneMode === 'markdown' ? (
                            <div className="detail-md-empty">
                              {snap.selectedEntryIds.length === 0
                                ? '选择左侧条目查看 Markdown'
                                : snap.selectedEntryIds.length > 1
                                  ? '多选时请点开单个条目，或从已有页签切换'
                                  : '（无内容）'}
                            </div>
                          ) : null}
                        </div>
                        {themeGalleryOpen ? (
                          <div className="theme-gallery-drawer" role="dialog" aria-label="主题画廊">
                            <div className="theme-gallery-drawer-bar">
                              <span>主题画廊</span>
                              <button
                                type="button"
                                className="theme-gallery-close"
                                onClick={() => setThemeGalleryOpen(false)}
                              >
                                关闭
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

      <div className="status-bar" title={snap.statusText}>
        {snap.statusText}
      </div>

      {toast && <div className="toast">{toast}</div>}
      {ctx && <ContextMenu state={ctx} onClose={() => setCtx(null)} />}

      {projectDialog && (
        <div className="modal-backdrop" onClick={() => setProjectDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>编辑项目</h3>
            <div className="form-grid">
              <label>
                名称
                <input
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label>
                根路径
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
                        title: '选择项目根目录',
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
                    浏览…
                  </button>
                </div>
              </label>
              <label>
                分类
                <input
                  value={projectForm.category}
                  onChange={(e) => setProjectForm((f) => ({ ...f, category: e.target.value }))}
                />
              </label>
            </div>
            <div className="actions">
              <button onClick={() => setProjectDialog(null)}>取消</button>
              <button
                className="primary"
                onClick={async () => {
                  apply(await invoke('editProject', projectForm))
                  setProjectDialog(null)
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {removeDialog && (
        <div className="modal-backdrop" onClick={() => !busy && setRemoveDialog(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>删除项目</h3>
            <p className="sub">
              「{removeDialog.projectName}」的 .cursor 内有 {removeDialog.fileCount}{' '}
              个文件。可先「打开当前目录」手动清理；需要迁入永久库请用空白区或全局容器右键「迁入永久库」。
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
                直接删除 .cursor（含其它文件）
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  void run('openProjectCursor', { id: removeDialog.projectId })
                }}
              >
                打开当前目录
              </button>
              <button disabled={busy} onClick={() => setRemoveDialog(null)}>
                取消
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

      {conflicts && conflictOp && (
        <ConflictCompareModal
          conflicts={conflicts}
          operation={conflictOp}
          busy={busy}
          onClose={() => {
            if (busy) return
            setConflicts(null)
            setConflictOp(null)
            setPendingScanBuildKeys(null)
            setPendingPromoteIds(null)
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
          onSetWorkspaceVisibility={async (ids) => {
            setBusy(true)
            try {
              const res = apply(await invoke('setWorkspaceVisibility', { ids }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onSetDefaultWorkspace={async (id) => {
            setBusy(true)
            try {
              const res = apply(await invoke('setDefaultWorkspace', { id }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onUpdateWorkspaceConfig={async (patch) => {
            setBusy(true)
            try {
              const res = apply(await invoke('updateWorkspaceConfig', { ...patch }))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onResetCatalog={async () => {
            setBusy(true)
            try {
              const res = apply(await invoke('resetCatalog'))
              return Boolean(res.ok)
            } catch (e) {
              setToast(e instanceof Error ? e.message : String(e))
              window.setTimeout(() => setToast(null), 5000)
              return false
            } finally {
              setBusy(false)
            }
          }}
          onListCatalogBackups={async () => {
            try {
              const res = await invoke<{ backups: CatalogBackupInfo[] }>('listCatalogBackups')
              if (!res.ok) return []
              return Array.isArray(res.data?.backups) ? res.data.backups : []
            } catch {
              return []
            }
          }}
          onRestoreCatalogBackup={async (id) => {
            setBusy(true)
            try {
              const res = apply(await invoke('restoreCatalogBackup', { id }))
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
            <h3>编辑标签</h3>
            <div className="form-grid">
              <label>
                Scope（global 或 project:id）
                <input value={tagScope} onChange={(e) => setTagScope(e.target.value)} />
              </label>
              <label>
                用途（逗号分隔，或点选下方）
                <input value={tagPurposes} onChange={(e) => setTagPurposes(e.target.value)} />
              </label>
              <div className="taxonomy-chips">
                {(snap.purposeTaxonomy.length > 0
                  ? snap.purposeTaxonomy
                  : [
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
              <button onClick={() => setTagDialog(false)}>取消</button>
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
                保存
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
  return (
    <div className="window-controls">
      <button type="button" title="最小化" onClick={() => void invoke('windowMinimize')}>
        <WinIconMinimize />
      </button>
      <button
        type="button"
        title={maximized ? '还原' : '最大化'}
        onClick={async () => {
          const res = await invoke<{ maximized: boolean }>('windowMaximizeToggle')
          if (res.ok && res.data) setMaximized(Boolean(res.data.maximized))
        }}
      >
        {maximized ? <WinIconRestore /> : <WinIconMaximize />}
      </button>
      <button type="button" className="win-close" title="关闭" onClick={() => void invoke('windowClose')}>
        <WinIconClose />
      </button>
    </div>
  )
}

function NavTree({
  nodes,
  selectedKind,
  selectedProjectId,
  selectedGlobalTool,
  onSelect,
  onContextGlobal,
  onContextProject,
}: {
  nodes: NavNodeDto[]
  selectedKind: string
  selectedProjectId?: string | null
  selectedGlobalTool: string
  onSelect: (kind: string, projectId?: string | null, tool?: string | null) => void
  onContextGlobal: (e: ReactMouseEvent, tool: string) => void
  onContextProject: (e: ReactMouseEvent, id: string) => void
}) {
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})

  const render = (list: NavNodeDto[], depth = 0, parentPath = ''): ReactNode =>
    list.map((n) => {
      if (n.kind === 'global') {
        const tool = n.tool || 'cursor'
        const active = selectedKind === 'global' && selectedGlobalTool === tool
        return (
          <div
            key={`global-${tool}`}
            className={`nav-item project ws-nav ws-${tool}${active ? ' active' : ''}`}
            onClick={() => onSelect('global', null, tool)}
            onContextMenu={(e) => onContextGlobal(e, tool)}
          >
            <span className={`ws-dot ws-${tool}`} aria-hidden />
            <span className="nav-ws-label">{n.name}</span>
          </div>
        )
      }
      if (n.kind === 'category') {
        const path = parentPath ? `${parentPath}/${n.name}` : n.name
        // 子分组且服务端默认折叠 → 可点击展开（如「容器」）；「置顶容器」等保持常开
        const collapsible = depth > 0 && !n.isExpanded
        const isOpen = collapsible
          ? (path in expandedMap ? expandedMap[path]! : n.isExpanded)
          : true
        return (
          <div key={`cat-${path}`}>
            <div
              className={`nav-item cat${depth > 0 ? ' cat-sub' : ''}${collapsible ? ' cat-toggle' : ''}`}
              onClick={
                collapsible
                  ? () => setExpandedMap((m) => ({ ...m, [path]: !isOpen }))
                  : undefined
              }
            >
              <span className="nav-cat-label">{n.name}</span>
              {collapsible ? (
                <span className="nav-cat-action">{isOpen ? '收起' : '打开'}</span>
              ) : null}
            </div>
            {isOpen ? render(n.children, depth + 1, path) : null}
          </div>
        )
      }
      return (
        <div
          key={n.projectId ?? n.name}
          className={`nav-item project${depth > 1 ? ' project-nested' : ''} ${
            selectedKind === 'project' && selectedProjectId === n.projectId ? 'active' : ''
          }`}
          onClick={() => onSelect('project', n.projectId)}
          onContextMenu={(e) => n.projectId && onContextProject(e, n.projectId)}
        >
          {n.name}
        </div>
      )
    })

  return <div>{render(nodes)}</div>
}

function GroupModeSelect({
  index,
  options,
  onChange,
}: {
  index: number
  options: string[]
  onChange: (index: number) => void
}) {
  return (
    <label className="group-mode" onClick={(e) => e.stopPropagation()}>
      分组
      <select value={index} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o, i) => (
          <option key={o} value={i}>
            {o}
          </option>
        ))}
      </select>
    </label>
  )
}

type SectionTone = 'container' | 'history' | 'library' | 'missing'

/** 列表项是否为 Cursor Rule（kindLabel 中英兼容；用于用户级容器提示）。 */
function isCursorRuleListItem(item: LibraryListItemDto): boolean {
  const label = (item.kindLabel || '').trim().toLowerCase()
  if (label === '规则' || label === 'rule' || label === 'rules') return true
  return (item.displayName || '').startsWith('[规则]')
}

function ItemSection({
  title,
  items,
  selected,
  onSelect,
  onContext,
  headerExtra,
  hint,
  tone = 'library',
  libraryRoot = '',
  pathHint = '',
  workspaceId = '',
  focused = false,
}: {
  title: string
  items: LibraryListItemDto[]
  selected: Set<string>
  onSelect: (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') => void
  onContext: (e: ReactMouseEvent, id: string) => void
  headerExtra?: ReactNode
  /** 节标题下的说明（如用户级 Rule 需粘贴到 Cursor Settings） */
  hint?: ReactNode
  tone?: SectionTone
  /** 永久库根目录，用于拖拽文案拼完整路径 */
  libraryRoot?: string
  /** 容器根缩写路径（分区副标题） */
  pathHint?: string
  workspaceId?: string
  focused?: boolean
}) {
  const pathSide: 'container' | 'library' = tone === 'container' ? 'container' : 'library'
  const canFileDrag = tone !== 'missing'
  const byId = new Map(items.map((x) => [x.entryId, x]))
  const wsClass = workspaceId ? ` ws-${workspaceId}` : ''
  return (
    <div
      className={`section section-${tone}${wsClass}${focused ? ' section-focused' : ''}`}
    >
      <div className="section-header">
        <span className="section-header-main">
          {workspaceId ? <span className={`ws-dot ws-${workspaceId}`} aria-hidden /> : null}
          <span>{title}</span>
        </span>
        {headerExtra ? (
          <span className="section-header-right">{headerExtra}</span>
        ) : null}
      </div>
      {pathHint ? (
        <div className="section-path-hint" title={pathHint}>
          {pathHint}
        </div>
      ) : null}
      {hint}
      {items.length === 0 ? (
        <div className="empty" style={{ padding: '8px 10px' }}>
          （空）
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.entryId + item.groupName}
            className={`list-item ${selected.has(item.entryId) ? 'selected' : ''}${item.isInActiveUse ? ' list-item-in-use' : ''}${canFileDrag ? ' list-item-file-drag' : ''}`}
            draggable={canFileDrag}
            title={
              canFileDrag
                ? '可拖到 Cursor 附加主文档；也可在永久库内拖到 L0/L1/L2 定级'
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
            <div className="name">{item.displayName}</div>
            <div className="sub">{item.subtitle || item.sourceLabel || item.groupName}</div>
          </div>
        ))
      )}
    </div>
  )
}

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
 * - startDrag：操作系统原生文件拖出（本地路径；SMB 可能失败）
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
  window.ccm?.startDrag?.(ids, pathSide)
}

function ClusterSection({
  title,
  roots,
  flatFallback,
  headerExtra,
  selected,
  onSelect,
  onContext,
  onDropLevel,
  tone = 'library',
  libraryRoot = '',
}: {
  title: string
  roots: ClusterNodeDto[]
  flatFallback: LibraryListItemDto[]
  headerExtra?: ReactNode
  selected: Set<string>
  onSelect: (id: string, multi: boolean, shift?: boolean, pathSide?: 'container' | 'library') => void
  onContext: (e: ReactMouseEvent, id: string) => void
  onDropLevel?: (level: string, entryIds: string[]) => void
  tone?: SectionTone
  libraryRoot?: string
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
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
  const collapseOrExpandAll = () => {
    if (allCollapsed) {
      setCollapsed({})
      return
    }
    setCollapsed(Object.fromEntries(groupKeys.map((k) => [k, true])))
  }

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

  const renderNodes = (nodes: ClusterNodeDto[], depth = 0): ReactNode =>
    nodes.map((node) => {
      if (node.isGroup) {
        const key = `${depth}:${node.name}:${node.scopeKey || ''}`
        const isCollapsed = collapsed[key] === true
        const count = leafCount(node.children || [])
        const canDrop = Boolean(onDropLevel) && isLevelDropTarget(node, depth)
        const isDragOver = dragOverKey === key
        return (
          <div key={key} className="cluster-group">
            <div
              className={`cluster-group-header${canDrop ? ' cluster-drop-target' : ''}${
                isDragOver ? ' is-drag-over' : ''
              }`}
              style={{ paddingLeft: 12 + depth * 10 }}
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
                      // 仅在真正离开 header（而非进入其子节点）时清除高亮
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
                      onDropLevel?.(dropLevelValue(node), ids)
                    }
                  : undefined
              }
            >
              <span className="cluster-caret">{isCollapsed ? '▸' : '▾'}</span>
              <span>
                {node.name} ({count})
              </span>
              {canDrop ? <span className="cluster-drop-hint">拖入定级</span> : null}
            </div>
            {!isCollapsed ? renderNodes(node.children || [], depth + 1) : null}
          </div>
        )
      }
      const item = node.entryId ? byId.get(node.entryId) : undefined
      const entryId = node.entryId || node.name
      const inUse = item?.isInActiveUse
      const pathSide: 'container' | 'library' = tone === 'container' ? 'container' : 'library'
      return (
        <div
          key={entryId}
          className={`list-item ${selected.has(entryId) ? 'selected' : ''}${inUse ? ' list-item-in-use' : ''} list-item-file-drag`}
          style={{ paddingLeft: 12 + (depth + 1) * 10 }}
          draggable
          title="可拖到 Cursor 附加主文档；拖到上方 L0/L1/L2 可定级"
          onDragStart={(e) =>
            beginEntryFileDrag(e, entryId, selected, pathSide, (id) => byId.get(id), libraryRoot)
          }
          onDragEnd={() => setDragOverKey(null)}
          onClick={(e) => {
            if (e.shiftKey) e.preventDefault()
            onSelect(entryId, e.ctrlKey || e.metaKey, e.shiftKey, pathSide)
          }}
          onContextMenu={(e) => onContext(e, entryId)}
        >
          <div className="name">{item?.displayName || node.name}</div>
          <div className="sub">{item?.subtitle || item?.groupName || ''}</div>
        </div>
      )
    })

  return (
    <div className={`section section-${tone}`}>
      <div className="section-header">
        <span>{title}</span>
        <span className="section-header-right">
          {groupKeys.length > 0 ? (
            <button
              type="button"
              className="section-collapse-all"
              title={allCollapsed ? '展开全部分组' : '折叠全部分组'}
              onClick={(e) => {
                e.stopPropagation()
                collapseOrExpandAll()
              }}
            >
              {allCollapsed ? '展开' : '折叠'}
            </button>
          ) : null}
          {headerExtra}
        </span>
      </div>
      {total === 0 ? (
        <div className="empty" style={{ padding: '8px 10px' }}>
          （空）
        </div>
      ) : (
        renderNodes(roots)
      )}
    </div>
  )
}

const SUGGEST_KIND_ORDER = ['skill', 'rule', 'agent', 'command', 'hook'] as const

const SUGGEST_KIND_LABEL: Record<(typeof SUGGEST_KIND_ORDER)[number], string> = {
  skill: '技能',
  rule: '规则',
  agent: '代理',
  command: '命令',
  hook: '钩子',
}

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
  const selectedCount = data.suggestions.filter((s) => s.selected).length
  const groups: Array<{ kind: string; label: string; items: SuggestedPurposeDto[] }> =
    SUGGEST_KIND_ORDER.map((kind) => ({
      kind,
      label: data.suggestions.find((s) => s.kind === kind)?.kindLabel ?? SUGGEST_KIND_LABEL[kind],
      items: data.suggestions.filter((s) => s.kind === kind),
    })).filter((g) => g.items.length > 0)
  const known = new Set<string>(SUGGEST_KIND_ORDER)
  const extras = [...new Set(data.suggestions.map((s) => s.kind).filter((k) => !known.has(k)))]
  for (const kind of extras) {
    groups.push({
      kind,
      label: data.suggestions.find((s) => s.kind === kind)?.kindLabel ?? kind,
      items: data.suggestions.filter((s) => s.kind === kind),
    })
  }

  const kindStats = SUGGEST_KIND_ORDER.map((kind) => {
    const items = data.suggestions.filter((s) => s.kind === kind)
    const selected = items.filter((s) => s.selected).length
    return {
      kind,
      label: SUGGEST_KIND_LABEL[kind],
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
        <h3>自动归类建议</h3>
        <p className="sub suggest-modal-desc">
          扫描建库已完成，台账（catalog.json）已写入永久库。本窗只处理层级/用途建议，不撤销建库。仅按明确来源建议：项目容器→L2，用户级
          Cursor 规则→L0；其余为未分类（待你拖拽定级）。可同时补用途标签。仅未分类且无用途建议的项不再列出，请到永久库树拖拽定级。已完备{' '}
          {data.alreadyTagged}，用途未命中 {data.noSuggestion}。
        </p>

        <div className="suggest-toolbar">
          <div className="suggest-kind-filters" role="group" aria-label="按类型选择归类内容">
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
              全部勾选
            </button>
            <button type="button" className="linkish" disabled={busy} onClick={() => onSelectAll(false)}>
              全部取消
            </button>
          </div>
        </div>

        <div className="suggest-list">
          <div className="suggest-colhead" aria-hidden>
            <span />
            <span>名称</span>
            <span>层级</span>
            <span>用途</span>
            <span>来源</span>
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
                        ? `用户文档（用户级容器）· ${s.sourceSummary}`
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
            title="不写入层级/用途标签，保留已建台账"
            onClick={onClose}
          >
            稍后归类
          </button>
          <button className="primary" disabled={busy || selectedCount === 0} onClick={onConfirm}>
            写入选中 {selectedCount} 项
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
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(preview.items.map((i) => [i.entryId, true])),
  )
  const selectedIds = preview.items.filter((i) => selected[i.entryId] !== false).map((i) => i.entryId)
  const allChecked = preview.items.length > 0 && selectedIds.length === preview.items.length

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>迁入永久库</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          勾选要迁入的项（共 {preview.pendingCount} 项待迁）。确认后收进永久库；内容相同则只删容器副本，不同则弹出比对窗。
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
              全选
            </label>
            <span className="sub">已选 {selectedIds.length} / {preview.items.length}</span>
          </div>
        ) : null}
        <div className="modal-scroll">
          {preview.items.length === 0 ? (
            <div className="empty">没有待迁入项（文件可能已在永久库）。</div>
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
            取消
          </button>
          <button
            className="primary"
            disabled={busy || selectedIds.length === 0}
            onClick={() => onConfirm(selectedIds)}
          >
            确认迁入（{selectedIds.length}）
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
  operation: 'moveIntoBackup' | 'withdraw' | 'scanBuild' | 'refresh' | 'promoteFromNetwork'
  busy: boolean
  onClose: () => void
  onConfirm: (resolutions: Array<{ key: string; choice: ConflictChoice }>) => void
}) {
  const opLabel =
    operation === 'scanBuild'
      ? '扫描建库 · 同名内容不同'
      : operation === 'refresh'
        ? '刷新 · 容器与永久库内容不同'
        : operation === 'moveIntoBackup'
          ? '迁入永久库'
          : operation === 'promoteFromNetwork'
            ? '网络库存入永久库 · 同名内容不同'
            : '移出到永久库'

  /** 同一技能只保留一条冲突卡（防止 C:\ 与 \\?\C:\ 双窗） */
  const uniqueConflicts = (() => {
    const seen = new Set<string>()
    const out: PathConflictDto[] = []
    for (const c of conflicts) {
      const id = (c.suggestedId || c.key).toLowerCase()
      if (seen.has(id)) continue
      seen.add(id)
      out.push(c)
    }
    return out
  })()

  const confirmAll = (choice: ConflictChoice) => {
    // 决议仍覆盖原始全部 key（含路径重复项），避免后端仍拦未决议冲突
    onConfirm(conflicts.map((c) => ({ key: c.key, choice })))
  }

  const formatBytes = (bytes?: number): string => {
    if (bytes == null) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>同名冲突比对 · {opLabel}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          共 {uniqueConflicts.length} 项同名冲突
          {conflicts.length > uniqueConflicts.length
            ? `（已合并 ${conflicts.length - uniqueConflicts.length} 条重复）`
            : ''}
          。
          {operation === 'promoteFromNetwork'
            ? '左侧=网络库缓存、右侧=永久库；「保留永久库」= 不覆盖库；「采用网络库」= 用网络缓存覆盖永久库。'
            : '左侧=容器、右侧=永久库；在对比区下方点对应策略（取消可退出）。「保留永久库」= 用库覆盖容器（两边对齐到库）；「保留容器」= 用容器覆盖库。'}
        </p>

        <div className="modal-scroll">
          <div className="conflict-list">
            {uniqueConflicts.map((c) => (
              <div className="conflict-card" key={c.key}>
                <div className="name">
                  [{c.kind}] {c.suggestedId}
                  <span className="conflict-meta-inline">
                    {' '}
                    · 哈希 {c.sourceHash.slice(0, 8)}… / {c.targetHash.slice(0, 8)}…
                    {c.sourceSize != null
                      ? ` · ${formatBytes(c.sourceSize)} / ${formatBytes(c.targetSize)}`
                      : ''}
                  </span>
                </div>

                <SideBySideDiff
                  leftLabel="来源（容器）"
                  rightLabel="目标（永久库）"
                  leftPath={c.sourcePath.replace(/^\\\\\?\\/, '')}
                  rightPath={c.targetPath.replace(/^\\\\\?\\/, '')}
                  leftComparePath={c.sourceComparePath?.replace(/^\\\\\?\\/, '')}
                  rightComparePath={c.targetComparePath?.replace(/^\\\\\?\\/, '')}
                  leftText={c.sourcePreview}
                  rightText={c.targetPreview}
                  leftHint={
                    c.sourcePreviewLines != null
                      ? `（预览 ${c.sourcePreviewLines} 行）`
                      : undefined
                  }
                  rightHint={
                    c.targetPreviewLines != null
                      ? `（预览 ${c.targetPreviewLines} 行）`
                      : undefined
                  }
                />

                <div className="conflict-pane-actions" role="group" aria-label="冲突处理策略">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => confirmAll('overwrite')}
                  >
                    {operation === 'promoteFromNetwork' ? '采用网络库' : '保留容器'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => confirmAll('saveAs')}>
                    另存为
                  </button>
                  <button type="button" disabled={busy} onClick={() => confirmAll('merge')}>
                    保留永久库
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="actions actions-conflict">
          <div className="actions-conflict-cancel">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
