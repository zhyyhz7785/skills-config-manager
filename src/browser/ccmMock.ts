import type { AppSnapshot, CatalogBackupInfo, IpcEnvelope, IpcMethod, LibraryListItemDto } from '../../shared/ipc'

function kindLetterFromLabel(kindLabel: string | undefined): string {
  const k = (kindLabel ?? '').toLowerCase()
  if (k.includes('rule') || k === '规则') return 'R'
  if (k.includes('agent') || k === '代理') return 'A'
  if (k.includes('command') || k === '命令') return 'C'
  if (k.includes('hook') || k === '钩子') return 'H'
  return 'S'
}

function stripKindLevelPrefix(id: string): string {
  let cur = id.trim()
  for (let n = 0; n < 8; n += 1) {
    const next = cur.replace(/^[SRAHC][012][-_]/i, '').replace(/^L[012][A-Za-z]*\d*[-_]/, '')
    if (next === cur) return cur
    cur = next
  }
  return cur
}

function desiredLevelId(kindLabel: string | undefined, id: string, level: 'L0' | 'L1' | 'L2' | undefined): string {
  const stem = stripKindLevelPrefix(id) || 'item'
  if (!level) return stem
  const digit = level.charAt(1)
  return `${kindLetterFromLabel(kindLabel)}${digit}-${stem}`
}

function rewriteRelPath(rel: string | null | undefined, oldId: string, newId: string): string | null | undefined {
  if (!rel) return rel
  const sep = rel.includes('\\') ? '\\' : '/'
  return rel
    .split(/[/\\]/)
    .map((part) => {
      if (part.toLowerCase() === oldId.toLowerCase()) return newId
      const m = part.match(/^(.*)(\.(mdc|md|ps1|skill))$/i)
      if (m && m[1].toLowerCase() === oldId.toLowerCase()) return `${newId}${m[2]}`
      return part
    })
    .join(sep)
}

function createFixtureSnapshot(): AppSnapshot {
  return {
    isLibraryConfigured: true,
    libraryRootDisplay: 'C:\\CursorSkills',
    disabledStorageDisplay: 'C:\\CursorSkills',
    statusText: '浏览器设计预览 | 假数据 | 永久库根：C:\\CursorSkills | catalog 4',
    activeContainerPathDisplay: 'C:\\Users\\Demo\\.cursor',
    navNodes: [
      {
        name: '工作区',
        kind: 'category',
        isExpanded: true,
        children: [
          { name: 'Cursor', kind: 'global', tool: 'cursor', isExpanded: false, children: [] },
          {
            name: '备份区域',
            kind: 'category',
            isExpanded: false,
            children: [
              { name: 'Gemini CLI', kind: 'global', tool: 'gemini', isExpanded: false, children: [] },
            ],
          },
        ],
      },
      {
        name: '容器',
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
          {
            name: '隐藏容器',
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
        inWorkArea: true,
        displayName: 'Cursor',
        containerRoot: 'C:\\Users\\Demo\\.cursor',
        isDefault: true,
        isVisible: true,
        isFocused: true,
        deployMode: 'copy',
      },
      {
        id: 'claude',
        enabled: true,
        inWorkArea: true,
        displayName: 'Claude Code',
        containerRoot: 'C:\\Users\\Demo\\.claude',
        isDefault: false,
        isVisible: false,
        isFocused: false,
        deployMode: 'symlink',
      },
      {
        id: 'codex',
        enabled: true,
        inWorkArea: true,
        displayName: 'Codex',
        containerRoot: 'C:\\Users\\Demo\\.codex',
        isDefault: false,
        isVisible: false,
        isFocused: false,
        deployMode: 'symlink',
      },
      {
        id: 'copilot',
        enabled: true,
        inWorkArea: false,
        displayName: 'GitHub Copilot',
        containerRoot: 'C:\\Users\\Demo\\.github-copilot',
        isDefault: false,
        isVisible: false,
        isFocused: false,
        deployMode: 'symlink',
      },
      {
        id: 'gemini',
        enabled: true,
        inWorkArea: false,
        displayName: 'Gemini CLI',
        containerRoot: 'C:\\Users\\Demo\\.gemini',
        isDefault: false,
        isVisible: false,
        isFocused: false,
        deployMode: 'symlink',
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
    filterShowAgents: false,
    filterShowCommands: false,
    filterShowHooks: false,
    purposeDomainFilterIndex: 0,
    clusterModeIndex: 0,
    clusterModeOptions: ['按层级用途', '按项目归属', '扁平'],
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
        libraryPathRel: 'skills/create-rule',
      },
      {
        entryId: 'rule-commit',
        displayName: 'git-commit',
        groupName: 'Rules',
        kindLabel: 'Rule',
        subtitle: '提交信息约定',
        sourceLabel: 'Cursor',
        isInContainerList: true,
        libraryPathRel: 'rules/git-commit/git-commit.mdc',
      },
    ],
    inLibraryItems: [],
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
        libraryPathRel: 'skills/canvas',
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
        libraryPathRel: 'skills/create-rule',
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
        libraryPathRel: 'rules/git-commit/git-commit.mdc',
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
        libraryPathRel: 'rules/L1T20-web-electron/L1T20-web-electron.mdc',
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
    networkLibraryItems: [
      {
        entryId: 'net:demo:sample-skill',
        displayName: 'sample-skill',
        groupName: '网络库',
        kindLabel: 'Skill',
        subtitle: 'https://github.com/anthropics/skills · 演示',
        isInContainerList: false,
        sourceId: 'anthropics-skills',
        sourceUrl: 'https://github.com/anthropics/skills',
        heatLabel: '★26.4k · 官方',
        intendedLevel: 'L1',
        securityLevel: 'pass',
        updateAvailable: false,
        summary: '演示条目：官方 Skill 示例（设计预览）',
        promotedEntryId: 'sample-skill',
        hasCustomization: true,
        searchText: 'sample-skill anthropics',
      },
    ],
    networkLibrarySummary: '1',
    networkLibraryHeader: '网络库（开源橱窗）',
    isNetworkLibraryConfigured: true,
    networkLibraryRootDisplay: 'C:\\CursorSkills\\net',
    networkOfficialNav: [
      {
        id: 'claude_code',
        kind: 'official',
        displayName: 'Claude Code',
        pinned: true,
        primaryRepoUrl: 'https://github.com/anthropics/skills',
        baselineId: 'anthropics-skills',
        heatLabel: '★官方样例',
        hasDefaultRepo: true,
        cachedCount: 1,
        hasCachedSource: true,
        isOfficialSample: true,
      },
      {
        id: 'cursor',
        kind: 'official',
        displayName: 'Cursor',
        pinned: true,
        primaryRepoUrl: '',
        heatLabel: '无默认官方仓',
        hasDefaultRepo: false,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: false,
      },
      {
        id: 'codex',
        kind: 'official',
        displayName: 'Codex',
        pinned: false,
        primaryRepoUrl: '',
        heatLabel: '无默认官方仓',
        hasDefaultRepo: false,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: false,
      },
      {
        id: 'gemini_cli',
        kind: 'official',
        displayName: 'Gemini CLI',
        pinned: false,
        primaryRepoUrl: '',
        heatLabel: '无默认官方仓',
        hasDefaultRepo: false,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: false,
      },
    ],
    networkPopularNav: [
      {
        id: 'anthropics-skills',
        kind: 'popular',
        displayName: 'anthropics/skills',
        pinned: true,
        primaryRepoUrl: 'https://github.com/anthropics/skills',
        baselineId: 'anthropics-skills',
        heatLabel: '★166k · 官方样例',
        hasDefaultRepo: true,
        cachedCount: 1,
        hasCachedSource: true,
        isOfficialSample: true,
        officialCompany: 'Anthropic',
        inCandidatePool: false,
      },
      {
        id: 'vercel-agent-skills',
        kind: 'popular',
        displayName: 'vercel-labs/agent-skills',
        pinned: true,
        primaryRepoUrl: 'https://github.com/vercel-labs/agent-skills',
        baselineId: 'vercel-agent-skills',
        heatLabel: '★29.7k · 官方样例',
        hasDefaultRepo: true,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: true,
        officialCompany: 'Vercel Labs',
        inCandidatePool: false,
      },
      {
        id: 'openai-skills',
        kind: 'popular',
        displayName: 'openai/skills',
        pinned: true,
        primaryRepoUrl: 'https://github.com/openai/skills',
        heatLabel: '★24.5k · 官方样例',
        hasDefaultRepo: true,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: true,
        officialCompany: 'OpenAI',
        inCandidatePool: false,
      },
      {
        id: 'obra-superpowers',
        kind: 'popular',
        displayName: 'obra/superpowers',
        pinned: true,
        primaryRepoUrl: 'https://github.com/obra/superpowers',
        heatLabel: '★264k · 框架',
        hasDefaultRepo: true,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: false,
        inCandidatePool: true,
      },
      {
        id: 'mattpocock-skills',
        kind: 'popular',
        displayName: 'mattpocock/skills',
        pinned: true,
        primaryRepoUrl: 'https://github.com/mattpocock/skills',
        heatLabel: '★197k · ~grill/TDD',
        hasDefaultRepo: true,
        cachedCount: 0,
        hasCachedSource: false,
        isOfficialSample: false,
        inCandidatePool: true,
      },
    ],
    networkPopularSort: 'stars',
    networkPopularVisibleLimit: 10,
    networkUpdateCheckIntervalMinutes: 0,
    networkGitHttpProxy: '',
    networkFetchConcurrency: 3,
    inContainerSummary: '容器中 2 项',
    inLibrarySummary: '永久库 5',
    inLibraryOwnSummary: '0',
    inLibraryOtherSummary: '永久库 5',
    inLibraryOwnHeader: '',
    inLibraryOtherHeader: '永久库 · 5',
    missingSummary: '缺失 0 项',
    missingSectionVisible: false,
    selectedEntryIds: ['skill-create-rule'],
    selectionSummary: '已选：skill-create-rule',
    detailPaneMode: 'markdown',
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
    scanSkipWorkspaceIds: [],
    scanExtraRoots: [],
    appSettingsDirDisplay: 'C:\\CursorSkills',
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
    case 'updateWorkspaceConfig': {
      const id = String(args.id ?? '')
      const inWorkArea = typeof args.inWorkArea === 'boolean' ? args.inWorkArea : undefined
      next.workspaces = (next.workspaces ?? []).map((w) => {
        if (w.id !== id) return w
        return {
          ...w,
          ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
          ...(typeof args.displayName === 'string' && args.displayName.trim()
            ? { displayName: args.displayName.trim() }
            : {}),
          ...(typeof args.containerRoot === 'string'
            ? { containerRoot: args.containerRoot }
            : {}),
          ...(inWorkArea != null ? { inWorkArea, isVisible: inWorkArea } : {}),
        }
      })
      if (inWorkArea === true) {
        const ids = new Set(next.visibleWorkspaceIds ?? [])
        ids.add(id)
        next.visibleWorkspaceIds = [...ids]
      } else if (inWorkArea === false) {
        next.visibleWorkspaceIds = (next.visibleWorkspaceIds ?? []).filter((x) => x !== id)
        if (next.defaultWorkspaceId === id) {
          const fb = (next.workspaces ?? []).find((w) => w.inWorkArea && w.id !== id)
          if (fb) {
            next.defaultWorkspaceId = fb.id
            next.workspaces = (next.workspaces ?? []).map((w) => ({
              ...w,
              isDefault: w.id === fb.id,
            }))
          }
        }
      }
      next.omitNetworkLibraryList = true
      next.networkLibrarySummary = '__omit_network_list__'
      break
    }
    case 'setWorkspacesInWorkArea': {
      const ids = new Set(
        Array.isArray(args.ids) ? (args.ids as unknown[]).map((x) => String(x)) : [],
      )
      const inWorkArea = args.inWorkArea !== false
      if (!inWorkArea) {
        const remaining = (next.workspaces ?? []).filter(
          (w) => w.inWorkArea && !ids.has(w.id),
        ).length
        if (remaining === 0) {
          // leave unchanged; invoke layer still returns ok in preview
          break
        }
      }
      next.workspaces = (next.workspaces ?? []).map((w) => {
        if (!ids.has(w.id)) return w
        return {
          ...w,
          inWorkArea,
          enabled: inWorkArea ? true : w.enabled,
          isVisible: inWorkArea,
        }
      })
      if (inWorkArea) {
        const vis = new Set(next.visibleWorkspaceIds ?? [])
        for (const id of ids) vis.add(id)
        next.visibleWorkspaceIds = [...vis]
      } else {
        next.visibleWorkspaceIds = (next.visibleWorkspaceIds ?? []).filter((x) => !ids.has(x))
        if (ids.has(String(next.defaultWorkspaceId))) {
          const fb = (next.workspaces ?? []).find((w) => w.inWorkArea)
          if (fb) {
            next.defaultWorkspaceId = fb.id
            next.workspaces = (next.workspaces ?? []).map((w) => ({
              ...w,
              isDefault: w.id === fb.id,
            }))
          }
        }
      }
      next.omitNetworkLibraryList = true
      next.networkLibrarySummary = '__omit_network_list__'
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
      if (Array.isArray(args.scanSkipWorkspaceIds)) {
        next.scanSkipWorkspaceIds = (args.scanSkipWorkspaceIds as unknown[]).map((x) => String(x))
      }
      if (Array.isArray(args.scanExtraRoots)) {
        next.scanExtraRoots = (args.scanExtraRoots as unknown[])
          .map((x) => {
            const o = x as { path?: unknown; tool?: unknown }
            return { path: String(o.path ?? ''), tool: String(o.tool ?? 'cursor') }
          })
          .filter((r) => r.path.trim())
      }
      if (typeof args.networkFetchConcurrency === 'number') {
        const n = Math.round(args.networkFetchConcurrency)
        next.networkFetchConcurrency = Math.max(1, Math.min(8, n))
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
      const p = typeof args.path === 'string' ? args.path.trim() : ''
      if (/^https?:\/\//i.test(p)) {
        window.open(p, '_blank', 'noopener,noreferrer')
      }
      break
    }
    case 'setSelectionLight': {
      // 轻量选择：只记选中集，不动详情（与后端 set_selection_light 对齐）
      const entryIds = Array.isArray(args.entryIds) ? (args.entryIds as string[]) : []
      next.selectedEntryIds = entryIds
      if (args.detailPathSide === 'container' || args.detailPathSide === 'library') {
        next.detailPathSide = args.detailPathSide
      }
      break
    }
    case 'setSelectionDetail': {
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
      const rename = new Map<string, string>()
      const patchOne = (it: LibraryListItemDto): LibraryListItemDto => {
        if (!ids.has(it.entryId)) return it
        const newId = desiredLevelId(it.kindLabel, it.entryId, levelKey)
        if (newId !== it.entryId) rename.set(it.entryId, newId)
        const displayName =
          it.displayName === it.entryId
            ? newId
            : it.displayName.includes(it.entryId)
              ? it.displayName.replace(it.entryId, newId)
              : it.displayName
        return {
          ...it,
          levelKey,
          entryId: newId,
          displayName,
          libraryPathRel: rewriteRelPath(it.libraryPathRel, it.entryId, newId) ?? it.libraryPathRel,
        }
      }
      const patch = (items: LibraryListItemDto[]) => items.map(patchOne)
      next.inContainerItems = patch(next.inContainerItems)
      next.inLibraryItems = patch(next.inLibraryItems)
      next.inLibraryOtherItems = patch(next.inLibraryOtherItems)
      next.missingItems = patch(next.missingItems)
      if (rename.size > 0) {
        next.selectedEntryIds = next.selectedEntryIds.map((id) => rename.get(id) ?? id)
      }
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
  'setSelectionLight',
  'setSelectionDetail',
  'setDetailMode',
  'setClusterMode',
  'setUiLayout',
  'setEntryLevel',
  'setScopeGlobal',
  'setScopeProject',
  'saveDetailMarkdown',
  'updateAppSettings',
  'openPath',
  'reorderProject',
  'reorderWorkspace',
  'reorderLibraryEntry',
  'reorderNetworkNav',
  'reorderNetworkListItem',
  'reorderProjectScanRoots',
  'togglePinProject',
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
  /** 预览态多 job：jobId → sourceId（同源拒绝） */
  const previewFetchJobs = new Map<string, string>()
  let catalogBackups = createMockCatalogBackups()

  window.ccm = {
    async invoke<T = unknown>(method: IpcMethod, args: Record<string, unknown> = {}): Promise<IpcEnvelope<T>> {
      if (method === 'getSnapshot') {
        return { ok: true, snapshot: snap }
      }

      if (method === 'pickFile' || method === 'saveFile') {
        const path =
          method === 'saveFile'
            ? 'C:\\preview\\catalog-export.json'
            : 'C:\\preview\\catalog-import.json'
        return { ok: true, data: { path } as T, snapshot: snap }
      }

      if (method === 'exportCatalog') {
        const path = String(args.path ?? 'C:\\preview\\catalog-export.json')
        return { ok: true, message: `台账已存储（预览）：${path}`, snapshot: snap }
      }

      if (method === 'importCatalog') {
        snap = { ...snap, statusText: '已读取台账（预览）' }
        return { ok: true, message: '已读取台账（预览）', snapshot: snap }
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
        const kept = args.deleteNetworkCache === false
        return {
          ok: true,
          snapshot: snap,
          message: kept
            ? '台账已重置（预览；网络缓存已保留）'
            : '台账已重置（预览；已写入假 catalog-backups）',
        }
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

      if (method === 'setSelectionDetail') {
        // H6 轻路径：复用 setSelection 假数据变更，只回传选中相关子集
        snap = applyUiMutation(snap, 'setSelectionDetail', args)
        return {
          ok: true,
          data: {
            selectedEntryIds: snap.selectedEntryIds,
            selectionSummary: snap.selectionSummary,
            detailPaneMode: snap.detailPaneMode,
            detailSummaryText: snap.detailSummaryText,
            detailMarkdownText: snap.detailMarkdownText,
            detailSourcePathDisplay: snap.detailSourcePathDisplay,
            detailMarkdownFilePath: snap.detailMarkdownFilePath,
            detailPathSide: snap.detailPathSide,
            commands: snap.commands,
          } as T,
        }
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
        method === 'openActiveContainer' ||
        method === 'openLibraryRoot' ||
        method === 'revealInFolder' ||
        method === 'openPath' ||
        method === 'openCurrentDirectory' ||
        method === 'openLibraryEntry'
      ) {
        if (method === 'revealInFolder') {
          const revealPath = String(args.path ?? '')
          if (!revealPath) {
            return { ok: false, message: '（浏览器预览）路径为空' }
          }
          return { ok: true }
        }
        return { ok: true }
      }
      if (method === 'openGlobalContainer') {
        const tool = String(args.tool ?? snap.selectedGlobalTool ?? 'cursor')
        snap = {
          ...snap,
          selectedNavKind: 'global',
          selectedGlobalTool: tool,
          selectedProjectId: null,
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

      if (method === 'previewClearProjectSkills') {
        return {
          ok: true,
          data: { skillCount: 0, ruleCount: 0, leftover: 0, projects: [] } as T,
          snapshot: snap,
          message: PREVIEW_MSG,
        }
      }

      if (method === 'clearProjectSkills') {
        return {
          ok: true,
          data: { moved: 0, skipped: 0, failed: 0, leftover: 0, conflicts: [] } as T,
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

      if (method === 'setNetworkPin') {
        const section = String(args.section ?? '')
        const id = String(args.id ?? '')
        const pinned = Boolean(args.pinned)
        const patch = (list: typeof snap.networkOfficialNav) =>
          (list ?? []).map((n) => (n.id === id ? { ...n, pinned } : n))
        if (section === 'official') {
          snap = { ...snap, networkOfficialNav: patch(snap.networkOfficialNav) }
        } else if (section === 'popular') {
          let nav = patch(snap.networkPopularNav)
          // 与后端 ensure_community_candidate 对齐：开眼池外社区行时纳入候选池并扩 N
          const target = (nav ?? []).find((n) => n.id === id)
          if (pinned && target && !target.isOfficialSample && target.kind !== 'user') {
            const community = (nav ?? []).filter(
              (n) => !n.isOfficialSample && n.kind !== 'user',
            )
            const pos = community.findIndex((n) => n.id === id)
            const needed = pos + 1
            const limit = Number(snap.networkPopularVisibleLimit ?? 0)
            if (pos >= 0 && limit < needed) {
              let communityIdx = 0
              nav = (nav ?? []).map((n) => {
                if (n.isOfficialSample || n.kind === 'user') return n
                const inCandidatePool = communityIdx < needed
                communityIdx += 1
                return { ...n, inCandidatePool }
              })
              snap = { ...snap, networkPopularVisibleLimit: needed }
            }
          }
          snap = { ...snap, networkPopularNav: nav }
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'setNetworkPopularVisibleLimit') {
        const list = snap.networkPopularNav ?? []
        const community = list.filter((n) => !n.isOfficialSample && n.kind !== 'user')
        const limit = Math.max(0, Math.min(Number(args.limit ?? 10), community.length, 50))
        let communityIdx = 0
        snap = {
          ...snap,
          networkPopularVisibleLimit: limit,
          networkPopularNav: list.map((n) => {
            if (n.isOfficialSample || n.kind === 'user') {
              return { ...n, inCandidatePool: false }
            }
            const inCandidatePool = communityIdx < limit
            communityIdx += 1
            return { ...n, inCandidatePool }
          }),
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'setNetworkPopularSort') {
        const raw = String(args.mode ?? 'stars').trim().toLowerCase()
        const mode =
          raw === 'updated' || raw === 'forks' || raw === 'custom' ? raw : 'stars'
        snap = { ...snap, networkPopularSort: mode }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'setNetworkPopularVisibilityAll') {
        const show = Boolean(args.show)
        const scopeRaw = typeof args.scope === 'string' ? args.scope.trim().toLowerCase() : 'community'
        const scope = scopeRaw === 'official' ? 'official' : 'community'
        const list = snap.networkPopularNav ?? []
        if (scope === 'official') {
          snap = {
            ...snap,
            networkPopularNav: list.map((n) =>
              n.isOfficialSample ? { ...n, pinned: show } : n,
            ),
          }
        } else {
          const community = list.filter((n) => !n.isOfficialSample && n.kind !== 'user')
          // 与后端对齐：闭眼保留 N；开眼时 N=0 → 恢复默认 10
          const cur = Number(snap.networkPopularVisibleLimit ?? 0)
          const limit = show
            ? Math.min(cur === 0 ? 10 : cur, community.length, 50)
            : cur
          let communityIdx = 0
          snap = {
            ...snap,
            networkPopularVisibleLimit: limit,
            networkPopularNav: list.map((n) => {
              if (n.kind === 'user' || n.isOfficialSample) {
                // 社区批量显隐保留官网/用户 pin
                return n
              }
              const inCandidatePool = communityIdx < limit
              communityIdx += 1
              return { ...n, inCandidatePool, pinned: show ? inCandidatePool : false }
            }),
          }
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'startNetworkFetch') {
        const idArg = typeof args.id === 'string' ? args.id.trim() : ''
        const urlArg =
          typeof args.urlOrBaselineId === 'string'
            ? args.urlOrBaselineId.trim()
            : typeof args.url === 'string'
              ? args.url.trim()
              : ''
        const sourceId =
          idArg ||
          (urlArg ? urlArg.replace(/\/+$/, '').split('/').slice(-2).join('-').toLowerCase() : '') ||
          'preview'
        for (const sid of previewFetchJobs.values()) {
          if (sid.toLowerCase() === sourceId.toLowerCase()) {
            return {
              ok: false,
              message: `源「${sourceId}」已有进行中的拉取任务`,
              snapshot: snap,
            }
          }
        }
        const jobId = `preview-${Date.now()}-${previewFetchJobs.size}`
        previewFetchJobs.set(jobId, sourceId)
        return {
          ok: true,
          message: PREVIEW_MSG,
          snapshot: snap,
          data: { jobId, sourceId } as T,
        }
      }

      if (method === 'cancelNetworkFetch') {
        const jobId = String(args.jobId ?? '').trim()
        if (jobId) previewFetchJobs.delete(jobId)
        return { ok: true, message: '已请求停止拉取（预览）', snapshot: snap }
      }

      if (method === 'openNetworkEntryDir' || method === 'openNetworkSourceCacheDir') {
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      if (method === 'removeNetworkUserSource') {
        const sid = String(args?.sourceId ?? '').trim()
        snap = {
          ...snap,
          networkPopularNav: (snap.networkPopularNav ?? []).filter(
            (n) => n.id !== sid || n.kind !== 'user',
          ),
        }
        return { ok: true, message: `已移除用户源「${sid || '?'}」（预览）`, snapshot: snap }
      }

      if (method === 'getEntryOperationLog') {
        const entryId = String((args as { entryId?: unknown } | undefined)?.entryId ?? '')
        return {
          ok: true,
          message: PREVIEW_MSG,
          data: {
            entryId,
            networkEntryId: entryId.startsWith('net:') ? entryId : '',
            sourceId: 'preview-source',
            level: 'L1',
            hasCustomization: true,
            unifiedDiff: '--- a/preview.md\n+++ b/preview.md\n@@ -1,2 +1,3 @@\n # 预览\n-旧行\n+新行\n+我的定制补充\n',
            baselineHash: 'preview-baseline',
            customHash: 'preview-custom',
            updatedAt: String(Math.floor(Date.now() / 1000)),
            events: [
              {
                ts: String(Math.floor(Date.now() / 1000) - 3600),
                op: 'promote',
                entryId,
                networkEntryId: entryId.startsWith('net:') ? entryId : '',
                sourceId: 'preview-source',
                level: 'L1',
                note: '转入本地（预览数据）',
              },
              {
                ts: String(Math.floor(Date.now() / 1000) - 600),
                op: 'recordDiff',
                entryId,
                networkEntryId: '',
                sourceId: 'preview-source',
                level: '',
                note: '库内保存：已记录定制 diff（预览数据）',
              },
            ],
          } as T,
        }
      }

      if (
        method === 'fetchNetworkSource' ||
        method === 'checkNetworkUpdates' ||
        method === 'applyNetworkCacheUpdate' ||
        method === 'promoteNetworkToLibrary' ||
        method === 'setNetworkIntendedLevel' ||
        method === 'cleanupNetworkCache' ||
        method === 'reapplyNetworkCustomization' ||
        method === 'ensureDefaultNetworkLibrary' ||
        method === 'chooseNetworkLibraryRoot'
      ) {
        return {
          ok: true,
          message: PREVIEW_MSG,
          snapshot: snap,
          data: { updateAvailable: 0, promoted: 0 } as T,
        }
      }

      if (method === 'updateAppSettings') {
        if (typeof args.networkUpdateCheckIntervalMinutes === 'number') {
          snap = {
            ...snap,
            networkUpdateCheckIntervalMinutes: args.networkUpdateCheckIntervalMinutes,
          }
        }
        if (typeof args.networkGitHttpProxy === 'string') {
          const t = args.networkGitHttpProxy.trim()
          snap = {
            ...snap,
            networkGitHttpProxy: t
              ? t.match(/^[a-z][a-z0-9+.-]*:\/\//i)
                ? t
                : `http://${t}`
              : '',
          }
        }
        if (typeof args.networkFetchConcurrency === 'number') {
          const n = Math.round(args.networkFetchConcurrency)
          snap = {
            ...snap,
            networkFetchConcurrency: Math.max(1, Math.min(8, n)),
          }
        }
        return { ok: true, message: PREVIEW_MSG, snapshot: snap }
      }

      return { ok: true, message: PREVIEW_MSG, snapshot: snap }
    },
  }
}

export function isBrowserPreview(): boolean {
  return import.meta.env.VITE_CCM_BROWSER === 'true'
}
