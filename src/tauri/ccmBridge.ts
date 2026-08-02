/**
 * Tauri 2 产品桥：日常 IPC 全部走 Rust。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppSnapshot, IpcEnvelope, IpcMethod } from '../../shared/ipc'

type Json = Record<string, unknown>

function fail(message: string, snapshot?: AppSnapshot): IpcEnvelope {
  return { ok: false, message, snapshot }
}

function okSnap(snapshot: AppSnapshot, message?: string, data?: unknown): IpcEnvelope {
  return { ok: true, snapshot, message, data }
}

function stubUnimplemented(method: IpcMethod): IpcEnvelope {
  if (method === 'confirmIngest') {
    return fail('confirmIngest 已废弃，请使用 confirmScanBuild（含冲突决议）')
  }
  return fail(`未迁移/未实现: ${method}`)
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
      return fail(`未知窗口方法: ${method}`)
  }
}

async function rustSnapshot(): Promise<AppSnapshot> {
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
        return okSnap(await rustSnapshot())

      case 'ensureDefaultLibrary':
        return okSnap(await rustEnsure(), '已确保默认永久库')

      case 'pickFolder': {
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: typeof args.title === 'string' ? args.title : '选择文件夹',
        })
        return { ok: true, data: { path } }
      }

      case 'openPath': {
        const target = typeof args.path === 'string' ? args.path.trim() : ''
        if (!target) return fail('路径为空')
        await tauriInvoke('open_path', { target })
        return { ok: true, message: '已打开目录' }
      }

      case 'chooseLibraryRoot': {
        const force = Boolean(args.forcePrompt)
        if (!force) {
          const snap = await rustSnapshot()
          if (snap.isLibraryConfigured) return okSnap(snap)
        }
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: '选择永久库目录',
        })
        if (!path) return fail('已取消')
        const snapshot = await tauriInvoke<AppSnapshot>('choose_library_root', {
          selectedPath: path,
        })
        return okSnap(snapshot, `永久库目录已设置为：${path}`)
      }

      case 'ensureDefaultNetworkLibrary': {
        const snapshot = await tauriInvoke<AppSnapshot>('ensure_default_network_library')
        return okSnap(snapshot, '网络库已就绪')
      }

      case 'chooseNetworkLibraryRoot': {
        const path = await tauriInvoke<string | null>('pick_folder', {
          title: '选择网络库目录（开源橱窗缓存）',
        })
        if (!path) return fail('已取消')
        const snapshot = await tauriInvoke<AppSnapshot>('choose_network_library_root', {
          selectedPath: path,
        })
        return okSnap(snapshot, `网络库目录已设置为：${path}`)
      }

      case 'listNetworkBaselineSources': {
        const list = await tauriInvoke<unknown[]>('list_network_baseline_sources')
        return { ok: true, data: { sources: list ?? [] } }
      }

      case 'fetchNetworkSource': {
        const urlOrBaselineId = String(args.urlOrBaselineId ?? args.url ?? '').trim()
        if (!urlOrBaselineId) return fail('请提供 Git URL 或基线 id')
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
        return okSnap(snapshot, '置顶已更新')
      }

      case 'setNetworkAgentRepoOverride': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_network_agent_repo_override', {
          agentKey: String(args.agentKey ?? ''),
          url: String(args.url ?? ''),
        })
        return okSnap(snapshot, '官方仓覆盖已更新')
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

      case 'evaluateNetworkSecurity': {
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as unknown[]).map((x) => String(x))
          : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('evaluate_network_security', { entryIds })
        return okSnap(result.snapshot, result.message, result)
      }

      case 'fetchNetworkNavSource': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('fetch_network_nav_source', {
          kind: String(args.kind ?? ''),
          id: String(args.id ?? ''),
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

      case 'refreshNetworkHeat': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('refresh_network_heat')
        return okSnap(result.snapshot, result.message, result)
      }

      case 'searchSkillsSh': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
          searchItems?: { name: string; url: string; repo: string }[]
        }>('search_skills_sh', { q: String(args.q ?? '') })
        return okSnap(result.snapshot, result.message, result)
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
          skillsShApiToken:
            typeof args.skillsShApiToken === 'string' ? args.skillsShApiToken : null,
        })
        return okSnap(snapshot, '设置已保存')
      }

      case 'resetCatalog': {
        const snapshot = await tauriInvoke<AppSnapshot>('reset_catalog')
        return okSnap(snapshot, '台账已重置（已写入 catalog-backups）')
      }

      case 'listCatalogBackups': {
        const list = await tauriInvoke<unknown[]>('list_catalog_backups')
        return { ok: true, data: { backups: list ?? [] } }
      }

      case 'restoreCatalogBackup': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail('未指定备份')
        const snapshot = await tauriInvoke<AppSnapshot>('restore_catalog_backup', { id })
        return okSnap(snapshot, '已调入所选台账备份')
      }

      case 'setNav': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_nav', {
          kind: String(args.kind ?? 'global'),
          projectId: args.projectId == null || args.projectId === '' ? null : String(args.projectId),
          tool: args.tool == null ? null : String(args.tool),
        })
        return okSnap(snapshot)
      }

      case 'setWorkspaceVisibility': {
        const ids = Array.isArray(args.ids)
          ? (args.ids as unknown[]).map((x) => String(x))
          : []
        const snapshot = await tauriInvoke<AppSnapshot>('set_workspace_visibility', { ids })
        return okSnap(snapshot, '工作区可见性已更新')
      }

      case 'setDefaultWorkspace': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail('未指定工作区')
        const snapshot = await tauriInvoke<AppSnapshot>('set_default_workspace', { id })
        return okSnap(snapshot, '默认工作区已更新')
      }

      case 'updateWorkspaceConfig': {
        const id = String(args.id ?? '')
        if (!id.trim()) return fail('未指定工作区')
        const snapshot = await tauriInvoke<AppSnapshot>('update_workspace_config', {
          id,
          enabled: typeof args.enabled === 'boolean' ? args.enabled : null,
          displayName: typeof args.displayName === 'string' ? args.displayName : null,
          containerRoot: typeof args.containerRoot === 'string' ? args.containerRoot : null,
        })
        return okSnap(snapshot, '工作区配置已保存')
      }

      case 'setFilters': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_filters', { args })
        return okSnap(snapshot)
      }

      case 'setSelection': {
        const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
        const snapshot = await tauriInvoke<AppSnapshot>('set_selection', {
          entryIds,
          detailPathSide:
            args.detailPathSide === 'container' || args.detailPathSide === 'library'
              ? args.detailPathSide
              : null,
        })
        return okSnap(snapshot)
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

      case 'setPurposeDomainFilter': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_purpose_domain_filter', {
          index: Number(args.index) || 0,
        })
        return okSnap(snapshot)
      }

      case 'setUiLayout': {
        const snapshot = await tauriInvoke<AppSnapshot>('set_ui_layout', { args })
        return okSnap(snapshot)
      }

      case 'openLibraryRoot':
      case 'openPermanentLibrary': {
        const snap = await rustSnapshot()
        const root = snap.libraryRootDisplay?.trim()
        if (!root || root.includes('未配置')) return fail('尚未配置永久库', snap)
        await tauriInvoke('open_path', { target: root })
        return okSnap(snap, '已打开永久库')
      }

      case 'openActiveContainer': {
        await tauriInvoke('open_active_container_dir')
        return okSnap(await rustSnapshot(), '已打开活动容器')
      }

      case 'openGlobalContainer': {
        const tool = typeof args.tool === 'string' ? args.tool : undefined
        try {
          await tauriInvoke<string>('open_global_container', { tool })
          return okSnap(await rustSnapshot(), '已打开全局容器')
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e), await rustSnapshot())
        }
      }

      case 'openOriginalDirectory': {
        const id = String(args.entryId ?? (args.entryIds as string[] | undefined)?.[0] ?? '')
        if (!id) {
          const snap = await rustSnapshot()
          const sid = snap.selectedEntryIds?.[0]
          if (!sid) return fail('未选择条目', snap)
          await tauriInvoke('open_entry_side', { entryId: sid, side: 'original' })
          return okSnap(snap)
        }
        await tauriInvoke('open_entry_side', { entryId: id, side: 'original' })
        return okSnap(await rustSnapshot())
      }

      case 'openCurrentDirectory': {
        const snap = await rustSnapshot()
        const id = String(args.entryId ?? snap.selectedEntryIds?.[0] ?? '')
        if (!id) return fail('未选择条目', snap)
        await tauriInvoke('open_entry_side', { entryId: id, side: 'current' })
        return okSnap(snap)
      }

      case 'openLibraryEntry': {
        const snap = await rustSnapshot()
        const id = String(args.entryId ?? snap.selectedEntryIds?.[0] ?? '')
        if (!id) return fail('未选择条目', snap)
        await tauriInvoke('open_entry_side', { entryId: id, side: 'library' })
        return okSnap(snap)
      }

      case 'revealInFolder': {
        if (typeof args.path === 'string' && args.path.trim()) {
          await tauriInvoke('reveal_in_folder', { target: args.path })
          return { ok: true, message: '已在文件夹中显示' }
        }
        const snap = await rustSnapshot()
        const id = String(args.entryId ?? snap.selectedEntryIds?.[0] ?? '')
        if (!id) return fail('未指定路径或条目', snap)
        await tauriInvoke('open_entry_side', { entryId: id, side: 'reveal' })
        return okSnap(snap, '已在文件夹中显示')
      }

      case 'saveDetailMarkdown': {
        const entryId = String(args.entryId ?? '')
        const content = String(args.content ?? '')
        if (!entryId) return fail('未指定条目')
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
        const result = await tauriInvoke<{
          ok: boolean
          succeeded: number
          failed: number
          errors: string[]
          message: string
          snapshot: AppSnapshot
        }>('deploy', { entryIds })
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

      case 'previewLibraryDrift': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          items: Array<{ entryId: string; workspaceId: string; reason: string }>
        }>('preview_library_drift')
        return { ok: result.ok, message: result.message, data: result }
      }

      case 'listDeployRecipes': {
        const recipes = await tauriInvoke<
          Array<{ id: string; name: string; entryIds: string[]; workspaceId: string }>
        >('list_deploy_recipes')
        return { ok: true, data: { recipes } }
      }

      case 'saveDeployRecipe': {
        const recipe = {
          id: String(args.id ?? ''),
          name: String(args.name ?? ''),
          entryIds: Array.isArray(args.entryIds)
            ? (args.entryIds as unknown[]).map((x) => String(x))
            : [],
          workspaceId: String(args.workspaceId ?? ''),
        }
        const recipes = await tauriInvoke<
          Array<{ id: string; name: string; entryIds: string[]; workspaceId: string }>
        >('save_deploy_recipe', { recipe })
        return { ok: true, message: '配方已保存', data: { recipes } }
      }

      case 'deleteDeployRecipe': {
        const recipes = await tauriInvoke<
          Array<{ id: string; name: string; entryIds: string[]; workspaceId: string }>
        >('delete_deploy_recipe', { recipeId: String(args.recipeId ?? '') })
        return { ok: true, message: '配方已删除', data: { recipes } }
      }

      case 'applyDeployRecipe': {
        const result = await tauriInvoke<{
          ok: boolean
          succeeded: number
          failed: number
          errors: string[]
          message: string
          snapshot: AppSnapshot
        }>('apply_deploy_recipe', { recipeId: String(args.recipeId ?? '') })
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

      case 'withdraw': {
        const snap = await rustSnapshot()
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as string[])
          : snap.selectedEntryIds ?? []
        if (entryIds.length === 0) {
          return okSnap(snap, '未选择任何项', { conflicts: [] })
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

      case 'unmanage': {
        const snap = await rustSnapshot()
        const entryIds = Array.isArray(args.entryIds)
          ? (args.entryIds as string[])
          : snap.selectedEntryIds ?? []
        const result = await tauriInvoke<{
          ok: boolean
          count: number
          message: string
          snapshot: AppSnapshot
        }>('unmanage', { entryIds })
        return {
          ok: result.ok,
          message: result.message,
          data: { count: result.count },
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
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          items: unknown[]
          pendingNewProjectCount: number
          scanRoots: string[]
          conflicts: unknown[]
          snapshot: AppSnapshot
        }>('scan_and_ingest_preview')
        return {
          ok: result.ok,
          message: result.message,
          data: {
            items: result.items,
            pendingNewProjectCount: result.pendingNewProjectCount,
            scanRoots: result.scanRoots,
            conflicts: result.conflicts,
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

      case 'scanProjectsPreview': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          projects: unknown[]
          snapshot: AppSnapshot
        }>('scan_projects_preview')
        return {
          ok: result.ok,
          message: result.message,
          data: { projects: result.projects },
          snapshot: result.snapshot,
        }
      }

      case 'confirmScanProjects': {
        const selectedRootPaths = Array.isArray(args.selectedRootPaths)
          ? (args.selectedRootPaths as string[])
          : Array.isArray(args.roots)
            ? (args.roots as string[])
            : []
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('confirm_scan_projects', { selectedRootPaths })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'createProjectContainer':
      case 'addProject': {
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
        }>('reorder_project', { id: args.id, direction: args.direction })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
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
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('open_project_cursor', { id: args.id })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
      }

      case 'openProjectRoot': {
        const result = await tauriInvoke<{
          ok: boolean
          message: string
          snapshot: AppSnapshot
        }>('open_project_root', { id: args.id })
        return { ok: result.ok, message: result.message, snapshot: result.snapshot }
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

      case 'confirmIngest':
        return stubUnimplemented(method)

      case 'setDirectoryMode':
      case 'toggleConfigItem':
      case 'enableAllConfig':
      case 'disableAllConfig':
      case 'refreshConfig': {
        // Config legacy：与主仓一致无 UI；空操作不依赖 sidecar
        const snap = await tauriInvoke<AppSnapshot>('get_snapshot').catch(() => undefined)
        return okSnap(snap as AppSnapshot, 'Config 已废弃（legacy 空操作）')
      }

      default:
        return stubUnimplemented(method)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return fail(message)
  }
}

export function installTauriCcmBridge(): void {
  window.ccm = {
    invoke: <T = unknown>(method: IpcMethod, args?: Record<string, unknown>) =>
      dispatch(method, args ?? {}) as Promise<IpcEnvelope<T>>,
    startDrag: (entryIds: string[], pathSide: 'container' | 'library' = 'library') => {
      // 异步解析路径后发起 OS 拖出；失败静默（text/plain 路径仍可用）
      void (async () => {
        try {
          const resolved = await tauriInvoke<{
            ok: boolean
            message: string
            paths: string[]
          }>('resolve_drag_file_paths', {
            entryIds,
            pathSide,
          })
          const paths = resolved.paths?.filter((p) => typeof p === 'string' && p.trim()) ?? []
          if (paths.length === 0) return
          const { startDrag } = await import('@crabnebula/tauri-plugin-drag')
          await startDrag({ item: paths, icon: '' })
        } catch {
          /* SMB/插件不可用时保留剪贴路径兜底 */
        }
      })()
    },
  }
}
