import type { AppSnapshot, CatalogBackupInfo, IpcEnvelope, IpcMethod } from '../../shared/ipc'

function createFixtureSnapshot(): AppSnapshot {
  return {
    isLibraryConfigured: true,
    libraryRootDisplay: 'C:\\CursorSkills',
    disabledStorageDisplay: 'C:\\CursorSkills',
    statusText: '浏览器设计预览 | 假数据 | 永久库根：C:\\CursorSkills | catalog 4',
    activeContainerPathDisplay: 'C:\\Users\\Demo\\.cursor',
    navNodes: [
      {
        name: '全局工作区',
        kind: 'category',
        isExpanded: true,
        children: [
          { name: 'Cursor', kind: 'global', tool: 'cursor', isExpanded: false, children: [] },
        ],
      },
      {
        name: '项目',
        kind: 'category',
        isExpanded: true,
        children: [
          {
            name: '置顶容器',
            kind: 'category',
            isExpanded: true,
            children: [
              {
                name: 'Demo App',
                kind: 'project',
                projectId: 'proj-demo',
                isExpanded: false,
                children: [],
              },
            ],
          },
          {
            name: '容器',
            kind: 'category',
            isExpanded: false,
            children: [
              {
                name: 'Research Lab',
                kind: 'project',
                projectId: 'proj-lab',
                isExpanded: false,
                children: [],
              },
            ],
          },
        ],
      },
    ],
    selectedNavKind: 'global',
    selectedProjectId: null,
    selectedGlobalTool: 'cursor',
    focusWorkspaceDisplayName: 'Cursor',
    defaultWorkspaceId: 'cursor',
    visibleWorkspaceIds: ['cursor'],
    workspaces: [
      {
        id: 'cursor',
        enabled: true,
        displayName: 'Cursor',
        containerRoot: 'C:\\Users\\Demo\\.cursor',
        isDefault: true,
        isVisible: true,
        isFocused: true,
      },
      {
        id: 'claude',
        enabled: true,
        displayName: 'Claude',
        containerRoot: 'C:\\Users\\Demo\\.claude',
        isDefault: false,
        isVisible: false,
        isFocused: false,
      },
      {
        id: 'codex',
        enabled: true,
        displayName: 'Codex',
        containerRoot: 'C:\\Users\\Demo\\.codex',
        isDefault: false,
        isVisible: false,
        isFocused: false,
      },
    ],
    projects: [
      {
        id: 'proj-demo',
        name: 'Demo App',
        rootPath: 'E:\\demo-app',
        category: '其它项目',
        pinned: true,
      },
      {
        id: 'proj-lab',
        name: 'Research Lab',
        rootPath: 'E:\\research-lab',
        category: '研究',
        pinned: false,
      },
    ],
    filterShowSkills: true,
    filterShowRules: true,
    filterShowAgents: true,
    filterShowCommands: true,
    filterShowHooks: true,
    purposeDomainFilterIndex: 0,
    purposeTaxonomy: [
      'engineering.building',
      'engineering.review',
      'code.csharp',
      'code.cursor',
      'learning.method',
      'meta.docs',
    ],
    clusterModeIndex: 0,
    clusterModeOptions: ['按层级用途', '按项目归属', '扁平'],
    directoryModeOptions: ['系统目录', '文件目录'],
    showUserRulesSettingsHint: true,
    userRulesSettingsHintText:
      '用户级规则放入 ~/.cursor/rules 后，Cursor 不会当作全局 Rule 加载。跨项目请复制正文到 Cursor → Settings → Rules（Customize → Rules）。项目内生效请放入该项目的 .cursor/rules。',
    inContainerItems: [
      {
        entryId: 'skill-create-rule',
        displayName: 'create-rule',
        groupName: 'Skills',
        kindLabel: 'Skill',
        subtitle: '编写 Cursor Rule',
        sourceLabel: 'Cursor',
        isInContainerList: true,
        libraryPathRel: 'skills/create-rule/SKILL.md',
      },
      {
        entryId: 'rule-commit',
        displayName: 'git-commit',
        groupName: 'Rules',
        kindLabel: 'Rule',
        subtitle: '提交信息约定',
        sourceLabel: 'Cursor',
        isInContainerList: true,
        libraryPathRel: 'rules/git-commit.mdc',
      },
    ],
    inLibraryItems: [
      {
        entryId: 'skill-canvas',
        displayName: 'canvas',
        groupName: 'Skills',
        kindLabel: 'Skill',
        subtitle: '可视化画布',
        sourceLabel: '曾用',
        isInContainerList: false,
        levelKey: 'L1',
        libraryPathRel: 'skills/canvas/SKILL.md',
      },
    ],
    inLibraryOtherItems: [
      {
        entryId: 'skill-canvas',
        displayName: 'canvas',
        groupName: 'Skills',
        kindLabel: 'Skill',
        subtitle: '可视化画布',
        sourceLabel: 'Skills',
        isInContainerList: false,
        levelKey: 'L1',
        libraryPathRel: 'skills/canvas/SKILL.md',
      },
      {
        entryId: 'skill-create-rule',
        displayName: 'create-rule',
        groupName: 'Skills',
        kindLabel: 'Skill',
        subtitle: '编写 Cursor Rule',
        sourceLabel: 'Skills',
        isInContainerList: false,
        isInActiveUse: true,
        libraryPathRel: 'skills/create-rule/SKILL.md',
      },
      {
        entryId: 'rule-commit',
        displayName: 'git-commit',
        groupName: 'Rules',
        kindLabel: 'Rule',
        subtitle: '提交信息约定',
        sourceLabel: 'Rules',
        isInContainerList: false,
        isInActiveUse: true,
        libraryPathRel: 'rules/git-commit.mdc',
      },
      {
        entryId: 'agent-review',
        displayName: '[代理] code-review',
        groupName: '代码 / 审查',
        kindLabel: '代理',
        subtitle: '[代码/审查] 代码审查助手',
        sourceLabel: '代码 / 审查',
        isInContainerList: false,
        searchText: 'agent-review 代码审查助手 code.review',
        libraryPathRel: 'agents/code-review',
      },
      {
        entryId: 'L1T20-web-electron',
        displayName: '[规则] L1T20-web-electron',
        groupName: '规则包 / 技术栈',
        kindLabel: '规则',
        subtitle: '[L1·技术栈] Web / Electron 约定',
        sourceLabel: '规则包 / 技术栈',
        isInContainerList: false,
        levelKey: 'L1',
        searchText: 'L1T20-web-electron Web Electron',
        libraryPathRel: 'rules/L1T20-web-electron.mdc',
      },
    ],
    missingItems: [],
    permanentLibraryRoots: [
      {
        name: 'L0',
        isGroup: true,
        isExpanded: true,
        scopeKey: 'L0',
        children: [],
      },
      {
        name: 'L1',
        isGroup: true,
        isExpanded: true,
        scopeKey: 'L1',
        children: [
          {
            name: 'Skills',
            isGroup: true,
            isExpanded: true,
            children: [
              {
                name: 'canvas',
                isGroup: false,
                entryId: 'skill-canvas',
                isExpanded: false,
                children: [],
              },
              {
                name: 'create-rule',
                isGroup: false,
                entryId: 'skill-create-rule',
                isExpanded: false,
                children: [],
              },
            ],
          },
          {
            name: 'Rules',
            isGroup: true,
            isExpanded: true,
            children: [
              {
                name: 'git-commit',
                isGroup: false,
                entryId: 'rule-commit',
                isExpanded: false,
                children: [],
              },
            ],
          },
          {
            name: '规则包 / 技术栈',
            isGroup: true,
            isExpanded: true,
            children: [
              {
                name: '[规则] L1T20-web-electron',
                isGroup: false,
                entryId: 'L1T20-web-electron',
                isExpanded: false,
                children: [],
              },
            ],
          },
          {
            name: '代码 / 审查',
            isGroup: true,
            isExpanded: true,
            children: [
              {
                name: '[代理] code-review',
                isGroup: false,
                entryId: 'agent-review',
                isExpanded: false,
                children: [],
              },
            ],
          },
        ],
      },
      {
        name: 'L2',
        isGroup: true,
        isExpanded: true,
        scopeKey: 'L2',
        children: [],
      },
    ],
    networkLibraryItems: [],
    networkLibrarySummary: '0',
    networkLibraryHeader: '网络库（开源橱窗）',
    isNetworkLibraryConfigured: true,
    networkLibraryRootDisplay: 'C:\\Users\\Demo\\CCM-NetworkLibrary',
    inContainerSummary: '容器中 2 项',
    inLibrarySummary: '曾用于本容器 1 项',
    inLibraryOwnSummary: '曾用于本容器 1',
    inLibraryOtherSummary: '永久库 5',
    inLibraryOwnHeader: '曾用于本容器（可再次放入）· 1',
    inLibraryOtherHeader: '永久库 · 5',
    missingSummary: '缺失 0 项',
    missingSectionVisible: false,
    selectedEntryIds: ['skill-create-rule'],
    selectionSummary: '已选：skill-create-rule',
    detailPaneMode: 'summary',
    detailSummaryText: [
      'Id: skill-create-rule',
      '类型: Skill',
      '范围: global',
      '用途: 工程',
      '备注: 编写 Cursor Rule',
      '在库: 否',
    ].join('\n'),
    detailMarkdownText: '# create-rule\n\n用于生成项目级 Cursor rules。',
    detailRenderedMarkdown: '# create-rule\n\n用于生成项目级 Cursor rules。',
    detailSourcePathDisplay: 'C:\\Users\\Demo\\.cursor\\skills\\create-rule',
    detailMarkdownFilePath: 'C:\\Users\\Demo\\.cursor\\skills\\create-rule\\SKILL.md',
    detailPathSide: 'library',
    isScanningProjects: false,
    cancelOrRestoreButtonText: '取消/恢复',
    cancelOrRestoreButtonToolTip: '取消当前扫描或恢复选中项',
    autoScanProjectsOnStartup: false,
    projectScanRoots: ['E:\\Code'],
    projectScanMaxDepth: 5,
    defaultProjectScanRoots: ['C:\\', 'D:\\', 'E:\\'],
    appSettingsDirDisplay: 'C:\\Users\\Demo\\AppData\\Roaming\\CCM-Tauri2',
    selectedDirectoryModeIndex: 0,
    isCustomDirectoryMode: false,
    customBaseDirectory: '',
    selectedDirectoryDisplay: '系统目录',
    configItems: [
      {
        id: 'cfg-skills',
        name: 'Skills',
        originalPath: '',
        backupPath: '',
        category: 'Skills',
        remarkZh: '',
        triggerWord: '',
        isFolder: true,
        isCategoryNode: true,
        isEnabled: true,
        children: [
          {
            id: 'cfg-create-rule',
            name: 'create-rule',
            originalPath: 'C:\\Users\\Demo\\.cursor\\skills\\create-rule',
            backupPath: 'C:\\CursorSkills\\skills\\create-rule',
            category: 'Skills',
            remarkZh: '编写 Cursor Rule',
            triggerWord: '',
            isFolder: true,
            isCategoryNode: false,
            isEnabled: true,
            isChecked: true,
            children: [],
          },
        ],
      },
    ],
    commands: {
      canDeploy: true,
      canWithdraw: true,
      canUnmanage: true,
      canEditTags: true,
      canPurgeMissing: false,
      canScanProjects: true,
      canCancelOrRestore: true,
      canOpenOriginalDirectory: true,
      canOpenCurrentDirectory: true,
      canOpenLibraryEntry: true,
      canOpenPermanentLibrary: true,
      canSetScope: true,
      canAddProject: true,
      canEditProject: true,
      canRemoveProject: true,
      canTogglePinProject: true,
      canSaveDetailMarkdown: true,
    },
    uiNavWidth: 220,
    uiListWidth: 480,
    uiNavVisible: true,
    uiDetailVisible: true,
    shouldPromptStartupScan: false,
  }
}

const PREVIEW_MSG = '浏览器预览：未执行真实操作'

function findItemName(snap: AppSnapshot, entryId: string): string {
  const all = [
    ...snap.inContainerItems,
    ...snap.inLibraryItems,
    ...snap.inLibraryOtherItems,
    ...snap.missingItems,
  ]
  return all.find((x) => x.entryId === entryId)?.displayName ?? entryId
}

function applyUiMutation(snap: AppSnapshot, method: IpcMethod, args: Record<string, unknown>): AppSnapshot {
  const next = { ...snap }

  switch (method) {
    case 'setNav': {
      if (typeof args.kind === 'string') next.selectedNavKind = args.kind
      if ('projectId' in args) next.selectedProjectId = (args.projectId as string | null) ?? null
      if (typeof args.tool === 'string') next.selectedGlobalTool = args.tool
      next.showUserRulesSettingsHint = next.selectedNavKind === 'global'
      if (next.selectedNavKind === 'global') {
        const tool = (next.selectedGlobalTool ?? 'cursor').toLowerCase()
        next.userRulesSettingsHintText =
          tool === 'claude'
            ? '通用 · Claude 对应 %USERPROFILE%\\.claude'
            : tool === 'codex'
              ? '通用 · Codex 对应 %USERPROFILE%\\.codex（skills 亦扫描 .agents）'
              : '用户级规则放入 ~/.cursor/rules 后，Cursor 不会当作全局 Rule 加载。跨项目请复制正文到 Cursor → Settings → Rules（Customize → Rules）。项目内生效请放入该项目的 .cursor/rules。'
      }
      break
    }
    case 'setFilters': {
      if (typeof args.filterShowSkills === 'boolean') next.filterShowSkills = args.filterShowSkills
      if (typeof args.filterShowRules === 'boolean') next.filterShowRules = args.filterShowRules
      if (typeof args.filterShowAgents === 'boolean') next.filterShowAgents = args.filterShowAgents
      if (typeof args.filterShowCommands === 'boolean') next.filterShowCommands = args.filterShowCommands
      if (typeof args.filterShowHooks === 'boolean') next.filterShowHooks = args.filterShowHooks
      break
    }
    case 'updateAppSettings': {
      if (typeof args.backupRoot === 'string') next.disabledStorageDisplay = args.backupRoot
      if (Array.isArray(args.projectScanRoots)) {
        next.projectScanRoots = (args.projectScanRoots as unknown[]).map((x) => String(x))
      }
      if (typeof args.projectScanMaxDepth === 'number') {
        next.projectScanMaxDepth = args.projectScanMaxDepth
      }
      if (typeof args.autoScanProjectsOnStartup === 'boolean') {
        next.autoScanProjectsOnStartup = args.autoScanProjectsOnStartup
      }
      break
    }
    case 'resetCatalog': {
      next.inContainerItems = []
      next.inLibraryItems = []
      next.inLibraryOtherItems = []
      next.missingItems = []
      next.projects = []
      next.selectedEntryIds = []
      next.selectionSummary = '未选择'
      next.detailSummaryText = '选择左侧条目查看详情'
      next.statusText = '台账已重置（浏览器预览；已写入假 catalog-backups）'
      break
    }
    case 'openPath': {
      break
    }
    case 'setSelection': {
      const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
      next.selectedEntryIds = entryIds
      if (args.detailPathSide === 'container' || args.detailPathSide === 'library') {
        next.detailPathSide = args.detailPathSide
      }
      next.selectionSummary =
        entryIds.length === 0
          ? '未选择'
          : entryIds.length === 1
            ? `已选：${entryIds[0]}`
            : `已选 ${entryIds.length} 项`
      if (entryIds.length === 1) {
        const id = entryIds[0]
        const name = findItemName(next, id)
        const side = next.detailPathSide === 'container' ? 'container' : 'library'
        next.detailSummaryText = [`Id: ${id}`, `名称: ${name}`, '（浏览器预览假数据）'].join('\n')
        next.detailMarkdownText = `# ${name}\n\n预览详情。`
        next.detailRenderedMarkdown = next.detailMarkdownText
        next.detailSourcePathDisplay =
          side === 'container' ? `C:\\container\\${id}` : `C:\\preview\\${id}`
        next.detailMarkdownFilePath =
          side === 'container'
            ? `C:\\container\\${id}\\SKILL.md`
            : `C:\\preview\\${id}\\SKILL.md`
      } else if (entryIds.length === 0) {
        next.detailSummaryText = '选择左侧条目查看详情'
        next.detailMarkdownText = ''
        next.detailRenderedMarkdown = ''
        next.detailSourcePathDisplay = ''
        next.detailMarkdownFilePath = ''
      } else {
        next.detailSummaryText = `已选择 ${entryIds.length} 项\n` + entryIds.map((id) => `- ${id}`).join('\n')
        next.detailMarkdownText = ''
        next.detailRenderedMarkdown = ''
        next.detailSourcePathDisplay = ''
        next.detailMarkdownFilePath = ''
      }
      break
    }
    case 'setDetailMode': {
      if (typeof args.mode === 'string') next.detailPaneMode = args.mode
      break
    }
    case 'saveDetailMarkdown': {
      const entryId = String(args.entryId ?? '')
      const content = String(args.content ?? '')
      if (entryId && next.selectedEntryIds.includes(entryId)) {
        next.detailMarkdownText = content
        next.detailRenderedMarkdown = content
      }
      break
    }
    case 'setClusterMode': {
      if (typeof args.index === 'number') next.clusterModeIndex = args.index
      break
    }
    case 'setPurposeDomainFilter': {
      if (typeof args.index === 'number') next.purposeDomainFilterIndex = args.index
      break
    }
    case 'setDirectoryMode': {
      if (typeof args.index === 'number') {
        next.selectedDirectoryModeIndex = args.index
        next.isCustomDirectoryMode = args.index === 1
        next.selectedDirectoryDisplay = args.index === 1 ? next.customBaseDirectory || '（未选）' : '系统目录'
      }
      break
    }
    case 'setUiLayout': {
      if (typeof args.navWidth === 'number') next.uiNavWidth = args.navWidth
      if (typeof args.listWidth === 'number') next.uiListWidth = args.listWidth
      if (typeof args.navVisible === 'boolean') next.uiNavVisible = args.navVisible
      if (typeof args.detailVisible === 'boolean') next.uiDetailVisible = args.detailVisible
      break
    }
    case 'setEntryLevel': {
      const raw = String(args.level ?? '').trim()
      const upper = raw.toUpperCase()
      const clear =
        !raw || upper === 'CLEAR' || upper === 'NONE' || raw === '未分类' || upper === 'UNCATEGORIZED'
      if (!clear && upper !== 'L0' && upper !== 'L1' && upper !== 'L2') break
      const fromArgs = Array.isArray(args.entryIds)
        ? (args.entryIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0)
        : []
      const ids = new Set(fromArgs.length > 0 ? fromArgs : next.selectedEntryIds)
      const levelKey = clear ? undefined : (upper as 'L0' | 'L1' | 'L2')
      const patch = (items: typeof next.inLibraryOtherItems) =>
        items.map((it) => (ids.has(it.entryId) ? { ...it, levelKey } : it))
      next.inContainerItems = patch(next.inContainerItems)
      next.inLibraryItems = patch(next.inLibraryItems)
      next.inLibraryOtherItems = patch(next.inLibraryOtherItems)
      next.missingItems = patch(next.missingItems)
      break
    }
    case 'setScopeGlobal': {
      const ids = new Set(next.selectedEntryIds)
      const patch = (items: typeof next.inLibraryOtherItems) =>
        items.map((it) => (ids.has(it.entryId) ? { ...it, scopeKey: 'global' } : it))
      next.inContainerItems = patch(next.inContainerItems)
      next.inLibraryItems = patch(next.inLibraryItems)
      next.inLibraryOtherItems = patch(next.inLibraryOtherItems)
      next.missingItems = patch(next.missingItems)
      break
    }
    case 'setScopeProject': {
      const projectId = String(args.projectId ?? '').trim()
      if (!projectId) break
      const ids = new Set(next.selectedEntryIds)
      const scope = `project:${projectId}`
      const patch = (items: typeof next.inLibraryOtherItems) =>
        items.map((it) => (ids.has(it.entryId) ? { ...it, scopeKey: scope } : it))
      next.inContainerItems = patch(next.inContainerItems)
      next.inLibraryItems = patch(next.inLibraryItems)
      next.inLibraryOtherItems = patch(next.inLibraryOtherItems)
      next.missingItems = patch(next.missingItems)
      break
    }
    default:
      break
  }

  return next
}

const UI_METHODS = new Set<IpcMethod>([
  'setNav',
  'setFilters',
  'setSelection',
  'setDetailMode',
  'setClusterMode',
  'setPurposeDomainFilter',
  'setDirectoryMode',
  'setUiLayout',
  'setEntryLevel',
  'setScopeGlobal',
  'setScopeProject',
  'saveDetailMarkdown',
  'updateAppSettings',
  'openPath',
])

const WINDOW_METHODS = new Set<IpcMethod>([
  'windowMinimize',
  'windowMaximizeToggle',
  'windowClose',
  'windowIsMaximized',
])

function createMockCatalogBackups(): CatalogBackupInfo[] {
  const now = Math.floor(Date.now() / 1000)
  return [
    {
      id: `catalog-bak-${now - 3600}.json`,
      path: `C:\\CursorSkills\\catalog-backups\\catalog-bak-${now - 3600}.json`,
      createdAtUnix: now - 3600,
      entryCount: 4,
      projectCount: 2,
      fileSizeBytes: 2048,
      label: 'skill×3 · rule×1',
      kindCounts: { skill: 3, rule: 1 },
      sampleEntryIds: ['skill-create-rule', 'skill-canvas', 'agent-review', 'always-on-rule'],
      sampleProjectNames: ['Demo App', 'Research Lab'],
    },
    {
      id: `catalog-bak-${now - 86400}.json`,
      path: `C:\\CursorSkills\\catalog-backups\\catalog-bak-${now - 86400}.json`,
      createdAtUnix: now - 86400,
      entryCount: 3,
      projectCount: 1,
      fileSizeBytes: 1536,
      label: 'skill×2 · agent×1',
      kindCounts: { skill: 2, agent: 1 },
      sampleEntryIds: ['skill-create-rule', 'skill-canvas', 'agent-review'],
      sampleProjectNames: ['Demo App'],
    },
  ]
}

export function installCcmMock(): void {
  let snap = createFixtureSnapshot()
  let catalogBackups = createMockCatalogBackups()

  window.ccm = {
    /** 浏览器预览无原生文件拖出 */
    startDrag() {
      /* no-op */
    },
    async invoke<T = unknown>(method: IpcMethod, args: Record<string, unknown> = {}): Promise<IpcEnvelope<T>> {
      if (method === 'getSnapshot') {
        return { ok: true, snapshot: snap }
      }

      if (method === 'listCatalogBackups') {
        return { ok: true, data: { backups: catalogBackups } as T, snapshot: snap }
      }

      if (method === 'restoreCatalogBackup') {
        const id = String(args.id ?? '')
        const hit = catalogBackups.find((b) => b.id === id)
        if (!hit) {
          return { ok: false, message: '备份不存在（预览）', snapshot: snap }
        }
        const stamp = Math.floor(Date.now() / 1000)
        catalogBackups = [
          {
            id: `catalog-bak-${stamp}.json`,
            path: `C:\\CursorSkills\\catalog-backups\\catalog-bak-${stamp}.json`,
            createdAtUnix: stamp,
            entryCount: snap.inLibraryOtherItems.length + snap.inLibraryItems.length,
            projectCount: snap.projects.length,
            fileSizeBytes: 1024,
            label: '空台账',
            kindCounts: {},
            sampleEntryIds: [],
            sampleProjectNames: snap.projects.map((p) => p.name).slice(0, 5),
          },
          ...catalogBackups,
        ].slice(0, 5)
        snap = {
          ...snap,
          statusText: `已调入台账备份（预览）${hit.id}`,
        }
        return { ok: true, snapshot: snap, message: '已调入所选台账备份（预览）' }
      }

      if (method === 'resetCatalog') {
        const stamp = Math.floor(Date.now() / 1000)
        const entryIds = [
          ...snap.inLibraryItems.map((x) => x.entryId),
          ...snap.inLibraryOtherItems.map((x) => x.entryId),
        ].slice(0, 8)
        catalogBackups = [
          {
            id: `catalog-bak-${stamp}.json`,
            path: `C:\\CursorSkills\\catalog-backups\\catalog-bak-${stamp}.json`,
            createdAtUnix: stamp,
            entryCount: snap.inLibraryOtherItems.length + snap.inLibraryItems.length,
            projectCount: snap.projects.length,
            fileSizeBytes: 1800,
            label: 'skill×n（预览）',
            kindCounts: { skill: Math.max(1, snap.inLibraryItems.length) },
            sampleEntryIds: entryIds,
            sampleProjectNames: snap.projects.map((p) => p.name).slice(0, 5),
          },
          ...catalogBackups,
        ].slice(0, 5)
        snap = applyUiMutation(snap, method, args)
        return { ok: true, snapshot: snap, message: '台账已重置（预览；已写入假 catalog-backups）' }
      }

      if (method === 'refresh') {
        return { ok: true, snapshot: snap, data: { conflicts: [] } as T }
      }

      if (method === 'getDualCopyTexts') {
        const entryId = String(args.entryId ?? '')
        const name = findItemName(snap, entryId) || entryId
        return {
          ok: true,
          snapshot: snap,
          data: {
            entryId,
            containerPath: `C:\\container\\${entryId}\\SKILL.md`,
            libraryPath: `C:\\preview\\${entryId}\\SKILL.md`,
            containerText: `# ${name}\n\n容器侧预览。\n`,
            libraryText: `# ${name}\n\n永久库侧预览。\n`,
            sameContent: false,
          } as T,
        }
      }

      if (method === 'createProjectContainer') {
        const rootPath = String(args.rootPath ?? '').trim() || 'E:\\new-project'
        const name =
          String(args.name ?? '').trim() ||
          rootPath.split(/[/\\]/).filter(Boolean).pop() ||
          '新项目'
        const id = `proj-${Date.now().toString(36)}`
        const project = {
          id,
          name,
          rootPath,
          category: String(args.category ?? '').trim() || '其它项目',
          pinned: true,
        }
        snap = {
          ...snap,
          projects: [...snap.projects, project],
          selectedNavKind: 'project',
          selectedProjectId: id,
        }
        return {
          ok: true,
          snapshot: snap,
          data: project as T,
          message: `（预览）将创建 ${rootPath}\\.cursor\\skills 等并置顶登记「${name}」；真实磁盘仅 Electron 态生效`,
        }
      }

      if (method === 'applyRefreshConflicts') {
        return { ok: true, snapshot: snap, message: PREVIEW_MSG }
      }

      if (WINDOW_METHODS.has(method)) {
        if (method === 'windowIsMaximized') {
          return { ok: true, data: { maximized: false } as T }
        }
        return { ok: true }
      }

      if (UI_METHODS.has(method)) {
        snap = applyUiMutation(snap, method, args)
        return { ok: true, snapshot: snap }
      }

      if (method === 'inspectProjectForDelete') {
        const id = String(args.id ?? '')
        const p = snap.projects.find((x) => x.id === id)
        return {
          ok: true,
          data: {
            projectName: p?.name ?? id,
            rootPath: p?.rootPath ?? '',
            cursorPath: p ? `${p.rootPath}\\.cursor` : '',
            cursorExists: false,
            fileCount: 0,
            managedCount: 0,
          } as T,
          snapshot: snap,
          message: PREVIEW_MSG,
        }
      }

      if (
        method === 'openProjectCursor' ||
        method === 'openProjectRoot' ||
        method === 'openGlobalContainer' ||
        method === 'openActiveContainer' ||
        method === 'openLibraryRoot' ||
        method === 'revealInFolder'
      ) {
        if (method === 'openGlobalContainer') {
          const tool = String(args.tool ?? snap.selectedGlobalTool ?? 'cursor')
          snap = {
            ...snap,
            selectedNavKind: 'global',
            selectedGlobalTool: tool,
            selectedProjectId: null,
          }
        }
        if (method === 'revealInFolder') {
          const revealPath = String(args.path ?? '')
          return {
            ok: true,
            message: revealPath
              ? `（浏览器预览）将在资源管理器中显示：${revealPath}`
              : '（浏览器预览）路径为空',
            snapshot: snap,
          }
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'previewMoveIntoBackup') {
        return {
          ok: true,
          data: { pendingCount: 0, items: [] } as T,
          snapshot: snap,
          message: PREVIEW_MSG,
        }
      }

      if (method === 'moveIntoBackupLibrary') {
        return {
          ok: true,
          data: { moved: 0, skipped: 0, failed: 0, conflicts: [], pendingCount: 0 } as T,
          snapshot: snap,
          message: PREVIEW_MSG,
        }
      }

      if (method === 'purgeMissing') {
        const fromArgs = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
        const ids = new Set(
          fromArgs.length > 0
            ? fromArgs
            : snap.selectedEntryIds.filter((id) => snap.missingItems.some((m) => m.entryId === id)),
        )
        const before = snap.missingItems.length
        const missingItems = snap.missingItems.filter((m) => !ids.has(m.entryId))
        const n = before - missingItems.length
        snap = {
          ...snap,
          missingItems,
          missingSummary: `缺失 ${missingItems.length} 项`,
          missingSectionVisible: missingItems.length > 0,
          selectedEntryIds: snap.selectedEntryIds.filter((id) => !ids.has(id)),
          commands: { ...snap.commands, canPurgeMissing: false },
        }
        return {
          ok: n > 0,
          message: n > 0 ? `已清理缺失 ${n} 项` : '未选中可清理的缺失项',
          snapshot: snap,
        }
      }

      if (method === 'removeProject') {
        // 预览：仅去登记；不模拟 migrate（删除路径已无迁入）
        const id = String(args.id ?? '')
        snap = {
          ...snap,
          projects: snap.projects.filter((x) => x.id !== id),
          selectedProjectId: snap.selectedProjectId === id ? null : snap.selectedProjectId,
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'previewSuggestedPurposes') {
        return {
          ok: true,
          data: {
            suggestions: [
              {
                entryId: 'skill-canvas',
                displayName: 'skill-canvas',
                kindLabel: '技能',
                kind: 'skill',
                suggestedLevel: null,
                levelLabel: '未分类（待定）',
                levelReason: '待用户判断（未分类）',
                suggestedPurpose: 'meta.docs',
                purposeLabel: '元工具 · 文档',
                sourceSummary: '永久库 · skills/skill-canvas',
                sourceKindLabel: '永久库',
                isUserDocument: false,
                selected: true,
              },
              {
                entryId: 'always-on-rule',
                displayName: 'always-on-rule',
                kindLabel: '规则',
                kind: 'rule',
                suggestedLevel: 'L0',
                levelLabel: 'L0 顶级',
                levelReason: '来自用户级 Cursor 目录',
                suggestedPurpose: '',
                purposeLabel: '（无用途建议）',
                sourceSummary: '用户文档 · .cursor/rules/always-on-rule.mdc',
                sourceKindLabel: '用户文档',
                isUserDocument: true,
                selected: true,
              },
            ],
            alreadyTagged: 1,
            noSuggestion: 0,
          } as T,
          snapshot: snap,
          message: PREVIEW_MSG,
        }
      }

      if (method === 'applySuggestedPurposes') {
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      return { ok: true, message: PREVIEW_MSG, snapshot: snap }
    },
  }
}

export function isBrowserPreview(): boolean {
  return import.meta.env.VITE_CCM_BROWSER === 'true'
}
