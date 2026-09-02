/**
 * Tauri 2 产品桥：日常 IPC 全部走 Rust。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type {
  AppSnapshot,
  IpcEnvelope,
  IpcMethod,
  SelectionDetailDto,
  StartNetworkFetchResult,
} from '../../shared/ipc'
import { t } from '../i18n'

type Json = Record<string, unknown>

function fail(message: string, snapshot?: AppSnapshot): IpcEnvelope {
  return { ok: false, message, snapshot }
}

function okSnap(snapshot: AppSnapshot, message?: string, data?: unknown): IpcEnvelope {
  return { ok: true, snapshot, message, data }
}

/** 打开文件夹类 IPC：DEV 打点是否拉了全量快照 */
const OPEN_FOLDER_METHODS = new Set<IpcMethod>([
  'openPath',
  'openLibraryRoot',
  'openActiveContainer',
  'openCurrentDirectory',
  'openLibraryEntry',
  'revealInFolder',
  'openNetworkEntryDir',
  'openNetworkSourceCacheDir',
  'openProjectCursor',
])

function stubUnimplemented(method: IpcMethod): IpcEnvelope {
  return fail(t('bridge.unimplemented', { method }))
}

async function handleWindow(method: IpcMethod): Promise<IpcEnvelope> {
  const win = getCurrentWindow()
  switch (method) {
    case 'windowMinimize':
      await win.minimize()
      return { ok: true }
    case 'windowMaximizeToggle':
      await win.toggleMaximize()
      return { ok: true, data: { maximized: await win.isMaximized() } }
    case 'windowClose':
      await win.close()
      return { ok: true }
    case 'windowIsMaximized':
      return { ok: true, data: { maximized: await win.isMaximized() } }
    default:
      return fail(t('bridge.unknownWindow', { method }))
  }
}

async function rustSnapshot(omitNetworkList = false): Promise<AppSnapshot> {
  if (omitNetworkList) {
    return tauriInvoke<AppSnapshot>('get_snapshot', { omitNetworkList: true })
  }
  return tauriInvoke<AppSnapshot>('get_snapshot')
}

async function rustEnsure(): Promise<AppSnapshot> {
  return tauriInvoke<AppSnapshot>('ensure_default_library')
}

async function dispatch(method: IpcMethod, args: Json = {}): Promise<IpcEnvelope> {
  try {
    switch (method) {
      case 'windowMinimize':
      case 'windowMaximizeToggle':
      case 'windowClose':
      case 'windowIsMaximized':
        return handleWindow(method)

      case 'getSnapshot':
        return okSnap(await rustSnapshot(Boolean(args.omitNetworkList)))

      case 'ensureDefaultLibrary':
        return okSnap(await rustEnsure(), t('bridge.ensuredLibrary'))

      case 'pickFolder': {
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: typeof args.title === 'string' ? args.title : t('dialog.pickFolder'),
        })
        return { ok: true, data: { path } }
      }

      case 'pickFile': {
        const path = await tauriInvoke<string | null>('pick_file', {
          title: typeof args.title === 'string' ? args.title : t('dialog.pickFile'),
          filterName: typeof args.filterName === 'string' ? args.filterName : 'JSON',
          filterExt: typeof args.filterExt === 'string' ? args.filterExt : 'json',
        })
        return { ok: true, data: { path } }
      }

      case 'saveFile': {
        const path = await tauriInvoke<string | null>('save_file', {
          title: typeof args.title === 'string' ? args.title : t('dialog.saveFile'),
          defaultName: typeof args.defaultName === 'string' ? args.defaultName : null,
          filterName: typeof args.filterName === 'string' ? args.filterName : 'JSON',
          filterExt: typeof args.filterExt === 'string' ? args.filterExt : 'json',
        })
        return { ok: true, data: { path } }
      }

      case 'openPath': {
        const target = typeof args.path === 'string' ? args.path.trim() : ''
        if (!target) return fail(t('bridge.emptyPath'))
        await tauriInvoke('open_path', { target })
        return { ok: true }
      }

      case 'chooseLibraryRoot': {
        const force = Boolean(args.forcePrompt)
        if (!force) {
          const snap = await rustSnapshot()
          if (snap.isLibraryConfigured) return okSnap(snap)
        }
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: t('dialog.pickLibrary'),
        })
        if (!path) return fail(t('bridge.cancelled'))
        const snapshot = await tauriInvoke<AppSnapshot>('choose_library_root', {
          selectedPath: path,
        })
        return okSnap(snapshot, t('bridge.librarySet', { path }))
      }

      case 'ensureDefaultNetworkLibrary': {
        const snapshot = await tauriInvoke<AppSnapshot>('ensure_default_network_library')
        return okSnap(snapshot, t('bridge.netReady'))
      }

      case 'chooseNetworkLibraryRoot': {
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: t('dialog.pickNetwork'),
        })
        if (!path) return fail(t('bridge.cancelled'))
        const snapshot = await tauriInvoke<AppSnapshot>('choose_network_library_root', {
          selectedPath: path,
        })
        return okSnap(snapshot, t('bridge.netSet', { path }))
      }

      case 'fetchNetworkSource': {
        const urlOrBaselineId = String(args.urlOrBaselineId ?? args.url ?? '').trim()
        if (!urlOrBaselineId) return fail(t('bridge.needGit'))
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('fetch_network_source', {
          urlOrBaselineId,
          label: typeof args.label === 'string' ? args.label : null,
        })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'checkNetworkUpdates': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('check_network_updates')
        return okSnap(result.snapshot, result.message, result)
      }

      case 'applyNetworkCacheUpdate': {
        const sourceIds = Array.isArray(args.sourceIds)
          ? (args.sourceIds as unknown[]).map((x) => String(x))
          : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('apply_network_cache_update', { sourceIds })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'promoteNetworkToLibrary': {
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as unknown[]).map((x) => String(x))
          : []
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
          conflicts?: unknown[]
          promoted?: number
          blocked?: boolean
          security?: unknown
        }>('promote_network_to_library', {
          entryIds,
          resolutions,
          forceSecurityOverride: Boolean(args.forceSecurityOverride),
        })
        return {
          ok: result.ok,
          message: result.message,
          snapshot: result.snapshot,
          data: result,
        }
      }

      case 'setNetworkPin': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_network_pin', {
          section: String(args.section ?? ''),
          id: String(args.id ?? ''),
          pinned: Boolean(args.pinned),
        })
        return okSnap(snapshot, t('bridge.visibilityUpdated'))
      }

      case 'setNetworkPopularVisibleLimit': {
        const snapshot = await tauriInvoke<AppSnapshot>(
          'set_network_popular_visible_limit',
          { limit: Number(args.limit ?? 10) },
        )
        return okSnap(snapshot, t('bridge.limitUpdated'))
      }

      case 'setNetworkPopularSort': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_network_popular_sort', {
          mode: String(args.mode ?? 'stars'),
        })
        return okSnap(snapshot, t('bridge.sortUpdated'))
      }

      case 'setNetworkPopularVisibilityAll': {
        const snapshot = await tauriInvoke<AppSnapshot>(
          'set_network_popular_visibility_all',
          {
            show: Boolean(args.show),
            scope: typeof args.scope === 'string' ? args.scope : undefined,
          },
        )
        return okSnap(snapshot, args.show ? t('bridge.allShown') : t('bridge.allHidden'))
      }

      case 'setNetworkIntendedLevel': {
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as unknown[]).map((x) => String(x))
          : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('set_network_intended_level', {
          entryIds,
          level: String(args.level ?? ''),
        })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'startNetworkFetch': {
        const result = await tauriInvoke<StartNetworkFetchResult>('start_network_fetch', {
          kind: typeof args.kind === 'string' ? args.kind : null,
          id: typeof args.id === 'string' ? args.id : null,
          urlOrBaselineId:
            typeof args.urlOrBaselineId === 'string'
              ? args.urlOrBaselineId
              : typeof args.url === 'string'
                ? args.url
                : null,
          label: typeof args.label === 'string' ? args.label : null,
        })
        return {
          ok: true,
          data: {
            jobId: result.jobId,
            sourceId: result.sourceId,
          } satisfies StartNetworkFetchResult,
        }
      }

      case 'cancelNetworkFetch': {
        const jobId = String(args.jobId ?? '').trim()
        if (!jobId) return fail(t('bridge.needJobId'))
        await tauriInvoke('cancel_network_fetch', { jobId })
        return { ok: true, message: t('bridge.stopRequested') }
      }

      case 'openNetworkEntryDir': {
        await tauriInvoke('open_network_entry_dir', {
          entryId: String(args.entryId ?? ''),
        })
        return { ok: true }
      }

      case 'openNetworkSourceCacheDir': {
        await tauriInvoke('open_network_source_cache_dir', {
          sourceId: String(args.sourceId ?? ''),
        })
        return { ok: true }
      }

      case 'removeNetworkUserSource': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('remove_network_user_source', {
          sourceId: String(args.sourceId ?? ''),
        })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'reapplyNetworkCustomization': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('reapply_network_customization', {
          entryId: String(args.entryId ?? ''),
          networkEntryId: String(args.networkEntryId ?? ''),
          mode: String(args.mode ?? 'skip'),
        })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'getEntryOperationLog': {
        const entryId = String(args.entryId ?? '').trim()
        if (!entryId) return fail(t('bridge.needEntryId'))
        const result = await tauriInvoke<unknown>('get_entry_operation_log', { entryId })
        return { ok: true, data: result }
      }

      case 'cleanupNetworkCache': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('cleanup_network_cache', {
          unusedOnly: args.unusedOnly === undefined ? true : Boolean(args.unusedOnly),
        })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'updateAppSettings': {
        const roots = Array.isArray(args.projectScanRoots)
          ? (args.projectScanRoots as unknown[]).map((x) => String(x))
          : undefined
        const snapshot = await tauriInvoke<AppSnapshot>('update_app_settings', {
          backupRoot: typeof args.backupRoot === 'string' ? args.backupRoot : null,
          projectScanRoots: roots ?? null,
          projectScanMaxDepth:
            typeof args.projectScanMaxDepth === 'number' ? args.projectScanMaxDepth : null,
          autoScanProjectsOnStartup:
            typeof args.autoScanProjectsOnStartup === 'boolean'
              ? args.autoScanProjectsOnStartup
              : null,
          networkUpdateCheckIntervalMinutes:
            typeof args.networkUpdateCheckIntervalMinutes === 'number'
              ? args.networkUpdateCheckIntervalMinutes
              : null,
          networkGitHttpProxy:
            typeof args.networkGitHttpProxy === 'string' ? args.networkGitHttpProxy : null,
          networkFetchConcurrency:
            typeof args.networkFetchConcurrency === 'number'
              ? args.networkFetchConcurrency
              : null,
          scanSkipWorkspaceIds: Array.isArray(args.scanSkipWorkspaceIds)
            ? (args.scanSkipWorkspaceIds as unknown[]).map((x) => String(x))
            : null,
          scanExtraRoots: Array.isArray(args.scanExtraRoots)
            ? (args.scanExtraRoots as unknown[])
                .map((x) => {
                  const o = x as { path?: unknown; tool?: unknown }
                  return {
                    path: String(o.path ?? ''),
                    tool: String(o.tool ?? ''),
                  }
                })
                .filter((r) => r.path.trim())
            : null,
        })
        return okSnap(snapshot, t('bridge.settingsSaved'))
      }

      case 'resetCatalog': {
        const snapshot = await tauriInvoke<AppSnapshot>('reset_catalog', {
          deleteNetworkCache:
            args.deleteNetworkCache === undefined ? true : Boolean(args.deleteNetworkCache),
        })
        return okSnap(
          snapshot,
          args.deleteNetworkCache === false
            ? t('bridge.resetKept')
            : t('bridge.resetCleared'),
        )
      }

      case 'exportCatalog': {
        const path = typeof args.path === 'string' ? args.path.trim() : ''
        if (!path) return fail(t('bridge.needSavePath'))
        await tauriInvoke('export_catalog', { path })
        return { ok: true, message: t('bridge.catalogExported', { path }) }
      }

      case 'importCatalog': {
        const path = typeof args.path === 'string' ? args.path.trim() : ''
        if (!path) return fail(t('bridge.needReadPath'))
        const snapshot = await tauriInvoke<AppSnapshot>('import_catalog', { path })
        return okSnap(snapshot, t('bridge.catalogImported', { path }))
      }

      case 'listCatalogBackups': {
        const list = await tauriInvoke<unknown[]>('list_catalog_backups')
        return { ok: true, data: { backups: list ?? [] } }
      }

      case 'restoreCatalogBackup': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail(t('bridge.needBackup'))
        const snapshot = await tauriInvoke<AppSnapshot>('restore_catalog_backup', { id })
        return okSnap(snapshot, t('bridge.backupRestored'))
      }

      case 'setNav': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_nav', {
          kind: String(args.kind ?? 'global'),
          projectId: args.projectId == null || args.projectId === '' ? null : String(args.projectId),
          tool: args.tool == null ? null : String(args.tool),
        })
        return okSnap(snapshot)
      }

      case 'setDefaultWorkspace': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail(t('bridge.needWorkspace'))
        const snapshot = await tauriInvoke<AppSnapshot>('set_default_workspace', { id })
        return okSnap(snapshot, t('bridge.defaultWsUpdated'))
      }

      case 'updateWorkspaceConfig': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail(t('bridge.needWorkspace'))
        const snapshot = await tauriInvoke<AppSnapshot>('update_workspace_config', {
          id,
          enabled: typeof args.enabled === 'boolean' ? args.enabled : null,
          displayName: typeof args.displayName === 'string' ? args.displayName : null,
          containerRoot: typeof args.containerRoot === 'string' ? args.containerRoot : null,
          inWorkArea: typeof args.inWorkArea === 'boolean' ? args.inWorkArea : null,
        })
        return okSnap(snapshot, t('bridge.wsSaved'))
      }

      case 'setWorkspacesInWorkArea': {
        const ids = Array.isArray(args.ids)
          ? (args.ids as unknown[]).map((x) => String(x))
          : []
        if (ids.length === 0) return fail(t('bridge.needWorkspace'))
        const inWorkArea = args.inWorkArea !== false
        const snapshot = await tauriInvoke<AppSnapshot>('set_workspaces_in_work_area', {
          ids,
          inWorkArea,
        })
        return okSnap(snapshot, inWorkArea ? t('bridge.wsOpened') : t('bridge.wsClosed'))
      }

      case 'setFilters': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_filters', { args })
        return okSnap(snapshot)
      }

      case 'setSelectionDetail': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
        const detail = await tauriInvoke<SelectionDetailDto>('set_selection_detail', {
          entryIds,
          detailPathSide:
            args.detailPathSide === 'container' || args.detailPathSide === 'library'
              ? args.detailPathSide
              : null,
        })
        return { ok: true, data: detail }
      }

      case 'setSelectionLight': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
        await tauriInvoke('set_selection_light', {
          entryIds,
          detailPathSide:
            args.detailPathSide === 'container' || args.detailPathSide === 'library'
              ? args.detailPathSide
              : null,
        })
        return { ok: true }
      }

      case 'setDetailMode': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_detail_mode', {
          mode: String(args.mode ?? 'summary'),
        })
        return okSnap(snapshot)
      }

      case 'setClusterMode': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_cluster_mode', {
          index: Number(args.index) || 0,
        })
        return okSnap(snapshot)
      }

      case 'setUiLayout': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_ui_layout', { args })
        return okSnap(snapshot)
      }

      // 路径契约：openLibraryRoot = 永久库根；openActiveContainer = 活动容器根；
      // openLibraryEntry = 台账 libraryPath；openCurrentDirectory = 容器侧条目目录（含 probe）。
      // 打开类不回全量快照，避免 apply 整树重渲。
      case 'openLibraryRoot': {
        const root = typeof args.path === 'string' ? args.path.trim() : ''
        if (!root || root.includes('未配置')) return fail(t('bridge.noLibrary'))
        await tauriInvoke('open_path', { target: root })
        return { ok: true }
      }

      case 'openActiveContainer': {
        await tauriInvoke('open_active_container_dir')
        return { ok: true }
      }

      case 'openGlobalContainer': {
        const tool = typeof args.tool === 'string' ? args.tool : undefined
        try {
          await tauriInvoke<string>('open_global_container', { tool })
          return okSnap(await rustSnapshot(), t('bridge.openedGlobal'))
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e), await rustSnapshot())
        }
      }

      case 'openCurrentDirectory': {
        const id = String(args.entryId ?? '').trim()
        if (!id) return fail(t('bridge.noEntry'))
        await tauriInvoke('open_entry_side', { entryId: id, side: 'current' })
        return { ok: true }
      }

      case 'openLibraryEntry': {
        const id = String(args.entryId ?? '').trim()
        if (!id) return fail(t('bridge.noEntry'))
        await tauriInvoke('open_entry_side', { entryId: id, side: 'library' })
        return { ok: true }
      }

      case 'revealInFolder': {
        if (typeof args.path === 'string' && args.path.trim()) {
          await tauriInvoke('reveal_in_folder', { target: args.path })
          return { ok: true }
        }
        const id = String(args.entryId ?? '').trim()
        if (!id) return fail(t('bridge.needPathOrEntry'))
        await tauriInvoke('open_entry_side', { entryId: id, side: 'reveal' })
        return { ok: true }
      }

      case 'saveDetailMarkdown': {
        const entryId = String(args.entryId ?? '')
        const content = String(args.content ?? '')
        if (!entryId) return fail(t('bridge.needEntry'))
        const snap0 = await rustSnapshot()
        const side = String(
          args.detailPathSide ?? args.side ?? snap0.detailPathSide ?? 'library',
        )
        const result = await tauriInvoke<{
          ok: boolean
          unchanged: boolean
          path: string
          message: string
        }>('save_detail_markdown', { entryId, content, side })
        const snapshot = await tauriInvoke<AppSnapshot>('set_selection', {
          entryIds: [entryId],
          detailPathSide: side === 'container' ? 'container' : 'library',
        })
        return okSnap(snapshot, result.message, result)
      }

      case 'deploy': {
        const snap = await rustSnapshot()
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as string[])
          : snap.selectedEntryIds ?? []
        const workspaceIds = Array.isArray(args.workspaceIds)
          ? (args.workspaceIds as unknown[]).map((x) => String(x))
          : undefined
        const projectIds = Array.isArray(args.projectIds)
          ? (args.projectIds as unknown[])
              .map((x) => String(x).trim())
              .filter((s) => s.length > 0)
          : undefined
        const result = await tauriInvoke<{
          ok: boolean
          succeeded: number
          failed: number
          errors: string[]
          message: string
          snapshot: AppSnapshot
        }>('deploy', {
          entryIds,
          workspaceIds: workspaceIds && workspaceIds.length > 0 ? workspaceIds : null,
          projectIds: projectIds && projectIds.length > 0 ? projectIds : null,
        })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            succeeded: result.succeeded,
            failed: result.failed,
            errors: result.errors,
          },
          snapshot: result.snapshot,
        }
      }

      case 'updateProjectTools': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail(t('bridge.needProject'))
        const visibleTools = Array.isArray(args.visibleTools)
          ? (args.visibleTools as unknown[]).map((x) => String(x))
          : ['cursor']
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('update_project_tools', {
          id,
          visibleTools,
          toolContainerRoots: args.toolContainerRoots ?? null,
        })
        return okSnap(result.snapshot, result.message)
      }

      case 'withdraw': {
        const snap = await rustSnapshot()
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as string[])
          : snap.selectedEntryIds ?? []
        if (entryIds.length === 0) {
          return okSnap(snap, t('bridge.noneSelected'), { conflicts: [] })
        }
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          moved: number
          skipped: number
          failed: number
          conflicts: unknown[]
          message: string
          snapshot: AppSnapshot
        }>('withdraw_batch', { entryIds, resolutions })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
            conflicts: result.conflicts,
          },
          snapshot: result.snapshot,
        }
      }

      case 'previewClearProjectSkills': {
        const projectIds = Array.isArray(args.projectIds)
          ? (args.projectIds as string[])
          : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          skillCount: number
          ruleCount: number
          leftover: number
          projects: Array<{
            projectId: string
            name: string
            skillCount: number
            skillIds: string[]
            ruleCount: number
            ruleIds: string[]
          }>
          snapshot: AppSnapshot
        }>('preview_clear_project_skills', { projectIds })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            skillCount: result.skillCount,
            ruleCount: result.ruleCount,
            leftover: result.leftover,
            projects: result.projects,
          },
          snapshot: result.snapshot,
        }
      }

      case 'clearProjectSkills': {
        const projectIds = Array.isArray(args.projectIds)
          ? (args.projectIds as string[])
          : []
        if (projectIds.length === 0) {
          const snap = await rustSnapshot()
          return okSnap(snap, t('toast.clearSkillsNeedSelect'), { conflicts: [] })
        }
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          moved: number
          skipped: number
          failed: number
          leftover: number
          conflicts: unknown[]
          message: string
          snapshot: AppSnapshot
        }>('clear_project_skills', { projectIds, resolutions })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
            leftover: result.leftover,
            conflicts: result.conflicts,
          },
          snapshot: result.snapshot,
        }
      }

      case 'purgeMissing': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
        const result = await tauriInvoke<{
          ok: boolean
          count: number
          message: string
          snapshot: AppSnapshot
        }>('purge_missing_entries', { entryIds })
        return {
          ok: result.ok,
          message: result.message,
          data: { count: result.count },
          snapshot: result.snapshot,
        }
      }

      case 'scanAndIngestPreview': {
        const roots = Array.isArray(args.roots) ? args.roots : undefined
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          items: unknown[]
          pendingNewProjectCount: number
          scanRoots: string[]
          conflicts: unknown[]
          unchangedCount: number
          silentRelinkCount: number
          skippedContentConflict: number
          deltaCount: number
          snapshot: AppSnapshot
        }>('scan_and_ingest_preview', { roots })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            items: result.items,
            pendingNewProjectCount: result.pendingNewProjectCount,
            scanRoots: result.scanRoots,
            conflicts: result.conflicts,
            unchangedCount: result.unchangedCount,
            silentRelinkCount: result.silentRelinkCount,
            skippedContentConflict: result.skippedContentConflict,
            deltaCount: result.deltaCount,
          },
          snapshot: result.snapshot,
        }
      }

      case 'confirmScanBuild': {
        const selectedKeys = Array.isArray(args.selectedKeys)
          ? (args.selectedKeys as string[])
          : []
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          registered: number
          originsAppended: number
          skipped: number
          skippedContentConflict: number
          relinked: number
          failed: number
          errors: string[]
          projectsAdded: number
          conflicts: unknown[]
          openAutoClassify: boolean
          copiedIntoLibrary: number
          snapshot: AppSnapshot
        }>('confirm_scan_build', { selectedKeys, resolutions })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            registered: result.registered,
            originsAppended: result.originsAppended,
            skipped: result.skipped,
            skippedContentConflict: result.skippedContentConflict,
            relinked: result.relinked,
            failed: result.failed,
            errors: result.errors,
            projectsAdded: result.projectsAdded,
            conflicts: result.conflicts,
            openAutoClassify: result.openAutoClassify,
            copiedIntoLibrary: result.copiedIntoLibrary,
          },
          snapshot: result.snapshot,
        }
      }

      case 'createProjectContainer': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          data?: unknown
          snapshot: AppSnapshot
        }>('create_project_container', {
          name: args.name,
          rootPath: args.rootPath,
          category: args.category,
        })
        return {
          ok: result.ok,
          message: result.message,
          data: result.data,
          snapshot: result.snapshot,
        }
      }

      case 'editProject': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('edit_project', {
          id: args.id,
          name: args.name,
          rootPath: args.rootPath,
          category: args.category,
        })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'togglePinProject': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('toggle_pin_project', { id: args.id })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'reorderProject': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('reorder_project', {
          id: args.id,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
        })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'reorderWorkspace': {
        const snapshot = await tauriInvoke<AppSnapshot>('reorder_workspace', {
          id: args.id,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
          peerIds: Array.isArray(args.peerIds) ? args.peerIds : null,
        })
        return okSnap(snapshot, t('bridge.wsOrder'))
      }

      case 'reorderLibraryEntry': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('reorder_library_entry', {
          entryId: args.entryId,
          regionKey: args.regionKey,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
        })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'reorderNetworkNav': {
        const snapshot = await tauriInvoke<AppSnapshot>('reorder_network_nav', {
          section: args.section,
          id: args.id,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
          targetPinned: typeof args.targetPinned === 'boolean' ? args.targetPinned : null,
        })
        return okSnap(snapshot, t('bridge.netNavOrder'))
      }

      case 'reorderNetworkListItem': {
        const result = await tauriInvoke<{
          ok: boolean
          order: string[]
          snapshot: AppSnapshot
        }>('reorder_network_list_item', {
          entryId: args.entryId,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
          visibleIds: args.visibleIds ?? null,
        })
        return {
          ok: result.ok,
          message: t('bridge.netListOrder'),
          data: { order: result.order },
          snapshot: result.snapshot,
        }
      }

      case 'reorderProjectScanRoots': {
        const snapshot = await tauriInvoke<AppSnapshot>('reorder_project_scan_roots', {
          path: args.path,
          direction: args.direction ?? null,
          toIndex: typeof args.toIndex === 'number' ? args.toIndex : null,
        })
        return okSnap(snapshot, t('bridge.scanOrder'))
      }

      case 'inspectProjectForDelete': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          data?: unknown
          snapshot: AppSnapshot
        }>('inspect_project_for_delete', { id: args.id })
        return {
          ok: result.ok,
          message: result.message,
          data: result.data,
          snapshot: result.snapshot,
        }
      }

      case 'removeProject': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('remove_project', {
          id: args.id,
          forceDeleteMarkers: args.forceDeleteMarkers,
          purgeEmptyMarkers: args.purgeEmptyMarkers,
        })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'openProjectCursor': {
        await tauriInvoke('open_project_cursor', { id: args.id })
        return { ok: true }
      }

      case 'editTags': {
        const purposes = Array.isArray(args.purposes) ? (args.purposes as string[]) : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('edit_tags', { scope: args.scope ?? 'global', purposes })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'setEntryLevel': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : undefined
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('set_entry_level', { level: args.level ?? '', entryIds })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'setScopeGlobal': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('set_scope_global')
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'setScopeProject': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('set_scope_project', { projectId: args.projectId })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'previewSuggestedPurposes': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          data?: unknown
          snapshot: AppSnapshot
        }>('preview_suggested_purposes')
        return {
          ok: result.ok,
          message: result.message,
          data: result.data,
          snapshot: result.snapshot,
        }
      }

      case 'applySuggestedPurposes': {
        const items = Array.isArray(args.items) ? args.items : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('apply_suggested_purposes', { items })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'refresh': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          conflicts: unknown[]
          snapshot: AppSnapshot
        }>('refresh')
        return {
          ok: result.ok,
          message: result.message,
          data: { conflicts: result.conflicts },
          snapshot: result.snapshot,
        }
      }

      case 'applyRefreshConflicts': {
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          conflicts: unknown[]
          merged?: number
          overwritten?: number
          savedAs?: number
          skipped?: number
          failed?: number
          errors?: string[]
          snapshot: AppSnapshot
        }>('apply_refresh_conflicts', { resolutions })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            conflicts: result.conflicts,
            merged: result.merged,
            overwritten: result.overwritten,
            savedAs: result.savedAs,
            skipped: result.skipped,
            failed: result.failed,
            errors: result.errors,
          },
          snapshot: result.snapshot,
        }
      }

      case 'previewMoveIntoBackup': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          pendingCount: number
          items: unknown[]
          snapshot: AppSnapshot
        }>('preview_move_into_backup')
        return {
          ok: result.ok,
          message: result.message,
          data: { pendingCount: result.pendingCount, items: result.items },
          snapshot: result.snapshot,
        }
      }

      case 'moveIntoBackupLibrary': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : undefined
        const resolutions = Array.isArray(args.resolutions) ? args.resolutions : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          moved: number
          skipped: number
          failed: number
          pendingCount: number
          conflicts: unknown[]
          messages: string[]
          snapshot: AppSnapshot
        }>('move_into_backup_library', { entryIds, resolutions })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            moved: result.moved,
            skipped: result.skipped,
            failed: result.failed,
            pendingCount: result.pendingCount,
            conflicts: result.conflicts,
            messages: result.messages,
          },
          snapshot: result.snapshot,
        }
      }

      case 'getDualCopyTexts': {
        const entryId = typeof args.entryId === 'string' ? args.entryId : ''
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          entryId: string
          containerPath: string
          libraryPath: string
          containerText: string
          libraryText: string
          sameContent: boolean
          snapshot: AppSnapshot
        }>('get_dual_copy_texts', { entryId })
        return {
          ok: result.ok,
          message: result.message,
          data: {
            entryId: result.entryId,
            containerPath: result.containerPath,
            libraryPath: result.libraryPath,
            containerText: result.containerText,
            libraryText: result.libraryText,
            sameContent: result.sameContent,
          },
          snapshot: result.snapshot,
        }
      }

      default:
        return stubUnimplemented(method)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return fail(message)
  }
}

/** dev-only 性能打点：记录每次 IPC 往返耗时（方法名 + 毫秒），生产构建不输出 */
function dispatchTimed(method: IpcMethod, args: Json): Promise<IpcEnvelope> {
  if (!import.meta.env.DEV) return dispatch(method, args)
  const t0 = performance.now()
  const p = dispatch(method, args)
  void p.then(
    (res) => {
      const ms = (performance.now() - t0).toFixed(1)
      console.debug(`[ccm-ipc] ${method} ${ms}ms`)
      if (OPEN_FOLDER_METHODS.has(method)) {
        console.debug(
          `[ccm-perf] openFolder ${method} ${ms}ms snapshot=${Boolean(res.snapshot)}`,
        )
      }
    },
    () => {
      console.debug(`[ccm-ipc] ${method} ${(performance.now() - t0).toFixed(1)}ms`)
    },
  )
  return p
}

export function installTauriCcmBridge(): void {
  window.ccm = {
    invoke: <T = unknown>(method: IpcMethod, args?: Record<string, unknown>) =>
      dispatchTimed(method, args ?? {}) as Promise<IpcEnvelope<T>>,
  }
}
