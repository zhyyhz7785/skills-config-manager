/** IPC channel names and envelope types shared by main ↔ preload ↔ renderer */

export const IPC = {
  invoke: 'ccm:invoke',
} as const;

export type IpcMethod =
  | 'getSnapshot'
  | 'chooseLibraryRoot'
  | 'setNav'
  | 'setFilters'
  | 'setSelectionDetail'
  | 'setSelectionLight'
  | 'setDetailMode'
  | 'setClusterMode'
  | 'refresh'
  | 'applyRefreshConflicts'
  | 'scanAndIngestPreview'
  | 'confirmScanBuild'
  | 'previewMoveIntoBackup'
  | 'moveIntoBackupLibrary'
  | 'deploy'
  | 'withdraw'
  | 'previewClearProjectSkills'
  | 'clearProjectSkills'
  | 'purgeMissing'
  | 'editTags'
  | 'setEntryLevel'
  | 'setScopeGlobal'
  | 'setScopeProject'
  | 'createProjectContainer'
  | 'editProject'
  | 'updateProjectTools'
  | 'inspectProjectForDelete'
  | 'removeProject'
  | 'togglePinProject'
  | 'openCurrentDirectory'
  | 'openLibraryEntry'
  | 'pickFolder'
  | 'pickFile'
  | 'saveFile'
  | 'openPath'
  | 'windowMinimize'
  | 'windowMaximizeToggle'
  | 'windowClose'
  | 'windowIsMaximized'
  | 'reorderProject'
  | 'reorderWorkspace'
  | 'reorderLibraryEntry'
  | 'reorderNetworkNav'
  | 'reorderNetworkListItem'
  | 'reorderProjectScanRoots'
  | 'setUiLayout'
  | 'openProjectCursor'
  | 'openGlobalContainer'
  | 'openActiveContainer'
  | 'openLibraryRoot'
  | 'revealInFolder'
  | 'ensureDefaultLibrary'
  | 'previewSuggestedPurposes'
  | 'applySuggestedPurposes'
  | 'saveDetailMarkdown'
  | 'getDualCopyTexts'
  | 'updateAppSettings'
  | 'resetCatalog'
  | 'exportCatalog'
  | 'importCatalog'
  | 'listCatalogBackups'
  | 'restoreCatalogBackup'
  | 'ensureDefaultNetworkLibrary'
  | 'chooseNetworkLibraryRoot'
  | 'fetchNetworkSource'
  | 'checkNetworkUpdates'
  | 'applyNetworkCacheUpdate'
  | 'promoteNetworkToLibrary'
  | 'setNetworkPin'
  | 'setNetworkPopularVisibleLimit'
  | 'setNetworkPopularSort'
  | 'setNetworkPopularVisibilityAll'
  | 'setNetworkIntendedLevel'
  | 'startNetworkFetch'
  | 'cancelNetworkFetch'
  | 'openNetworkEntryDir'
  | 'openNetworkSourceCacheDir'
  | 'removeNetworkUserSource'
  | 'reapplyNetworkCustomization'
  | 'getEntryOperationLog'
  | 'cleanupNetworkCache'
  | 'setDefaultWorkspace'
  | 'updateWorkspaceConfig'
  | 'setWorkspacesInWorkArea'

export interface IpcEnvelope<T = unknown> {
  ok: boolean
  data?: T
  message?: string
  snapshot?: AppSnapshot
}

export interface NavNodeDto {
  name: string
  kind: string
  projectId?: string | null
  /** 通用用户级子项：cursor | claude | codex */
  tool?: string | null
  isExpanded: boolean
  children: NavNodeDto[]
}

export interface ProjectItemDto {
  id: string
  name: string
  rootPath: string
  category: string
  pinned: boolean
  /** Plan/04 Should：项目侧可见工具（空=仅 cursor） */
  visibleTools?: string[]
  toolContainerRoots?: Record<string, string>
}

/** 删除项目前检查：.cursor 是否仍有文件（有文件则弹窗强制删除或打开目录） */
export interface ProjectDeleteInspectDto {
  projectName: string
  rootPath: string
  cursorPath: string
  cursorExists: boolean
  fileCount: number
  /** 仍返回，供诊断；删除弹窗不再用其做迁入 */
  managedCount: number
}

export interface LibraryListItemDto {
  entryId: string
  displayName: string
  groupName: string
  scopeKey?: string | null
  /** 库存浏览层级（含 tags.level 覆盖后的结果） */
  levelKey?: 'L0' | 'L1' | 'L2' | null
  /** 永久库相对路径（拖拽文案 / 目录展示用） */
  libraryPathRel?: string | null
  kindLabel: string
  subtitle: string
  sourceLabel?: string | null
  isInContainerList: boolean
  /** 永久库分区：该条目当前也在活动容器中生效（与「容器中」重复展示） */
  isInActiveUse?: boolean
  /** 前端即时搜索用：id/remark/description/trigger/path 拼接 */
  searchText?: string
  /** 网络库行：源 id / URL / 热度 / 意向层级 / 安全 / 更新标记 */
  sourceId?: string | null
  sourceUrl?: string | null
  heatLabel?: string | null
  intendedLevel?: string | null
  securityLevel?: string | null
  updateAvailable?: boolean | null
  /** 网络库行：条目描述（索引 summary），列表「描述」列展示 */
  summary?: string | null
  /** 网络库行：已转入本地时对应的永久库条目 id（空=未转入） */
  promotedEntryId?: string | null
  /** 网络库行：已转入且有非空定制 diff */
  hasCustomization?: boolean | null
  /** 永久库条目来源工作区 tool id（与侧栏图标同源） */
  originTools?: string[]
}

/** 用户粘贴 / skills.sh 拉取后持久进热门侧栏的源（设置 NetworkUserSources） */
export interface NetworkUserSourceDto {
  id: string
  label: string
  url: string
}

/** 网络侧栏热门源节点；`pinned`＝眼睛打开（主列表可见），false＝齿轮隐藏池 */
export interface NetworkNavNodeDto {
  id: string
  /** popular＝固化精选；user＝用户持久源；official＝兼容字段 */
  kind: string
  displayName: string
  pinned: boolean
  primaryRepoUrl: string
  baselineId?: string | null
  heatLabel: string
  hasDefaultRepo: boolean
  cachedCount: number
  /** 索引 sources[] 是否已有该源且磁盘缓存健康（已拉取过，即使发现 0 条） */
  hasCachedSource?: boolean
  /** 索引有该源但磁盘缓存缺失/损坏，侧栏提示「需重新拉取」 */
  needsRefetch?: boolean
  /** 官方样例（侧栏置顶段 / 星标）；与 baselineId（拉取基线）正交 */
  isOfficialSample?: boolean
  /** 官方样例所属公司（分层标题）；非官方为空 */
  officialCompany?: string | null
  /** skills | courses | cookbooks | generic：侧栏徽标与 0 条文案分档 */
  contentType?: string | null
  /** 是否落在社区候选池前 N（官网/用户源为 false）；候选过滤用 N，开眼用 pinned */
  inCandidatePool?: boolean
}

/** 热门仓库排序：stars 默认；updated/forks 按 heat-cache；custom＝拖拽后自定义序 */
export type NetworkPopularSortMode = 'stars' | 'updated' | 'forks' | 'custom'

/** Plan/04 工作区配置（快照侧） */
export interface WorkspaceDto {
  id: string
  enabled: boolean
  /** 是否在工作区域（设置「工作区域」表）；false＝仅设置内工具池，不进侧栏 */
  inWorkArea: boolean
  displayName: string
  containerRoot: string
  isDefault: boolean
  isVisible: boolean
  isFocused: boolean
  /** 只读推导：默认槽 copy；其余工作区域槽 symlink */
  deployMode: 'copy' | 'symlink' | string
}

/** 扫描建库额外目录（设置持久化；path＝目录，tool＝记入 origins.tool 的工作区 id） */
export interface ScanExtraRootDto {
  path: string
  tool: string
}

/** Plan/04 可见工作区的容器分区（history* 保留为空兼容字段） */
export interface WorkspaceContainerSectionDto {
  workspaceId: string
  displayName: string
  containerRootDisplay: string
  isFocused: boolean
  inContainerItems: LibraryListItemDto[]
  inContainerHeader: string
  inContainerSummary: string
  historyItems: LibraryListItemDto[]
  historyHeader: string
  historySummary: string
}

export interface ClusterNodeDto {
  name: string
  isGroup: boolean
  entryId?: string | null
  scopeKey?: string | null
  isExpanded: boolean
  children: ClusterNodeDto[]
}

export interface ConfigItemDto {
  id: string
  name: string
  originalPath: string
  backupPath: string
  category: string
  remarkZh: string
  triggerWord: string
  isFolder: boolean
  isCategoryNode: boolean
  isEnabled: boolean
  isChecked?: boolean | null
  children: ConfigItemDto[]
}

export interface CommandAvailabilityDto {
  canDeploy: boolean
  canWithdraw: boolean
  canUnmanage: boolean
  canEditTags: boolean
  canPurgeMissing: boolean
  canScanProjects: boolean
  canCancelOrRestore: boolean
  canOpenOriginalDirectory: boolean
  canOpenCurrentDirectory: boolean
  /** 打开所选条目在当前库（容器）中对应文件夹所在位置 */
  canOpenLibraryEntry: boolean
  /** 打开所选条目在永久库中对应文件夹所在位置 */
  canOpenPermanentLibrary: boolean
  canSetScope: boolean
  canAddProject: boolean
  canEditProject: boolean
  canRemoveProject: boolean
  canTogglePinProject: boolean
  /** 详情 Markdown 可写回主文件（非 .skill ZIP、存在可写元数据文件） */
  canSaveDetailMarkdown: boolean
}

export interface AppSnapshot {
  isLibraryConfigured: boolean
  libraryRootDisplay: string
  disabledStorageDisplay: string
  statusText: string
  activeContainerPathDisplay: string
  navNodes: NavNodeDto[]
  selectedNavKind: string
  selectedProjectId?: string | null
  /** 焦点工作区 id（兼容旧 SelectedGlobalTool） */
  selectedGlobalTool: string
  /** 焦点工作区显示名（工具栏「部署 → …」） */
  focusWorkspaceDisplayName?: string
  defaultWorkspaceId?: string
  visibleWorkspaceIds?: string[]
  workspaces?: WorkspaceDto[]
  visibleContainerSections?: WorkspaceContainerSectionDto[]
  projects: ProjectItemDto[]
  filterShowSkills: boolean
  filterShowRules: boolean
  filterShowAgents: boolean
  filterShowCommands: boolean
  filterShowHooks: boolean
  purposeDomainFilterIndex: number
  clusterModeIndex: number
  clusterModeOptions: string[]
  /** 导航为「通用」时为 true；Cursor 下配合容器中规则条目显示 Settings 粘贴提示 */
  showUserRulesSettingsHint: boolean
  /** 通用·Cursor：规则需粘贴 Settings；Claude/Codex：路径说明 */
  userRulesSettingsHintText: string
  inContainerItems: LibraryListItemDto[]
  inLibraryItems: LibraryListItemDto[]
  inLibraryOtherItems: LibraryListItemDto[]
  missingItems: LibraryListItemDto[]
  permanentLibraryRoots: ClusterNodeDto[]
  /** Plan/03 网络库（开源橱窗）条目 */
  networkLibraryItems: LibraryListItemDto[]
  networkLibrarySummary: string
  networkLibraryHeader: string
  /**
   * 为 true 时后端跳过了 networkLibraryItems（nav-only 变更）。
   * 前端须保留上一帧的列表与 summary；summary 也可能是 `__omit_network_list__`。
   */
  omitNetworkLibraryList?: boolean
  /** 读取 network-index 失败时的错误（有则列表可能为空，需警示而非当「无条目」） */
  networkIndexError?: string | null
  isNetworkLibraryConfigured: boolean
  networkLibraryRootDisplay: string
  networkOfficialNav?: NetworkNavNodeDto[]
  networkPopularNav?: NetworkNavNodeDto[]
  /** 热门侧栏排序：stars | updated | forks | custom */
  networkPopularSort?: NetworkPopularSortMode | string
  /** 社区候选池数量 N（开眼真相仍是 pinned；官网/用户源不计 N） */
  networkPopularVisibleLimit?: number
  /** 0=关；分钟；定时仅 checkNetworkUpdates */
  networkUpdateCheckIntervalMinutes?: number
  /** Git / gh HTTP(S) 代理；空则尝试环境变量与系统代理 */
  networkGitHttpProxy?: string
  /** 网络库同时 git 拉取路数（1–8，默认 3） */
  networkFetchConcurrency?: number
  inContainerSummary: string
  inLibrarySummary: string
  inLibraryOwnSummary: string
  inLibraryOtherSummary: string
  inLibraryOwnHeader: string
  inLibraryOtherHeader: string
  missingSummary: string
  missingSectionVisible: boolean
  selectedEntryIds: string[]
  selectionSummary: string
  detailPaneMode: string
  detailSummaryText: string
  detailMarkdownText: string
  detailRenderedMarkdown: string
  detailSourcePathDisplay: string
  /** 当前详情 Markdown 对应的主文件绝对路径（SKILL.md / .mdc 等） */
  detailMarkdownFilePath: string
  /** 详情打开侧：container=容器副本；library=永久库正本 */
  detailPathSide: 'container' | 'library'
  isScanningProjects: boolean
  cancelOrRestoreButtonText: string
  cancelOrRestoreButtonToolTip: string
  autoScanProjectsOnStartup: boolean
  /** 项目扫描根（是什么：扫库 walk 起点列表；起什么作用：限制发现范围） */
  projectScanRoots: string[]
  /** 项目扫描最大深度 */
  projectScanMaxDepth: number
  /** 本机默认扫描盘符（设置页固定层） */
  defaultProjectScanRoots: string[]
  /** 扫描建库跳过的工作区 id（空＝扫全部已知容器根） */
  scanSkipWorkspaceIds: string[]
  /** 扫描建库额外目录（设置中添加，不随每次扫描丢弃） */
  scanExtraRoots: ScanExtraRootDto[]
  /** 程序设置目录（settings.json 所在） */
  appSettingsDirDisplay: string
  commands: CommandAvailabilityDto
  uiNavWidth: number
  uiListWidth: number
  /** Primary side bar (nav) visible */
  uiNavVisible: boolean
  /** Secondary / auxiliary side bar (detail) visible */
  uiDetailVisible: boolean
  /** Hint for renderer: show scan preview once after ensuring default library */
  shouldPromptStartupScan: boolean
}

export interface DiscoveredItemDto {
  key: string
  kind: string
  suggestedId: string
  sourcePath: string
  tool: string
  scope: string
  isFolder: boolean
  contentHash: string
  remarkZh: string
  contentChanged: boolean
  needsAttention: boolean
  isSelected: boolean
  existingEntryId?: string | null
}

export interface SuggestedPurposeDto {
  entryId: string
  displayName: string
  kindLabel: string
  /** 资产类型键：skill / rule / …，供弹窗分组 */
  kind: string
  /** null = 建议未分类 */
  suggestedLevel: 'L0' | 'L1' | 'L2' | null
  levelLabel: string
  /** 层级建议依据简述 */
  levelReason: string
  /** 用途键；空串表示本次不写入用途 */
  suggestedPurpose: string
  purposeLabel: string
  /** 来源路径摘要（含「用户文档/项目文档/永久库」标签） */
  sourceSummary: string
  /** 短标签：用户文档 / 项目文档 / 永久库 */
  sourceKindLabel: string
  /** 是否用户级容器文档 */
  isUserDocument: boolean
  selected: boolean
}

export interface DiscoveredProjectDto {
  rootPath: string
  suggestedName: string
  suggestedCategory: string
  markers: string
  alreadyRegistered: boolean
  hasContentChanges: boolean
  pendingItemCount: number
  canConfirmAdd: boolean
  isSelected: boolean
  statusText: string
}

export interface PathConflictDto {
  key: string
  operation: string
  suggestedId: string
  kind: string
  sourcePath: string
  targetPath: string
  /** 实际参与比对的文件路径（目录解包后的主文件） */
  sourceComparePath?: string
  targetComparePath?: string
  sourcePreview: string
  targetPreview: string
  existingEntryId: string
  sourceHash: string
  targetHash: string
  sourceSize?: number
  targetSize?: number
  sourceModified?: string
  targetModified?: string
  sourceCreated?: string
  targetCreated?: string
  sourcePreviewLines?: number
  targetPreviewLines?: number
}

export interface MoveIntoBackupPreviewDto {
  pendingCount: number
  items: Array<{ entryId: string; displayName: string; currentPath: string }>
}

/** 双份正文：详情「对比容器与永久库」 */
export interface DualCopyTextsDto {
  entryId: string
  containerPath: string
  libraryPath: string
  containerText: string
  libraryText: string
  sameContent: boolean
}

/** 台账环形备份摘要（catalog-backups/ 下最多 5 份） */
export interface CatalogBackupInfo {
  id: string
  path: string
  createdAtUnix: number
  entryCount: number
  projectCount: number
  fileSizeBytes: number
  /** 类型摘要短串，如 skill×3 · rule×2 */
  label: string
  /** kind → 数量 */
  kindCounts: Record<string, number>
  /** 前若干条目 id */
  sampleEntryIds: string[]
  /** 前若干项目名 */
  sampleProjectNames: string[]
}

/** 网络拉取进度事件（Tauri `network-fetch-progress`） */
export interface NetworkFetchProgressEvent {
  jobId: string
  sourceId?: string | null
  phase: string
  detail: string
  bytesHint?: number | null
  stalled: boolean
  /** git 进度 0–100；无匹配时缺省 */
  percent?: number | null
}

/** 网络拉取完成事件（Tauri `network-fetch-finished`） */
export interface NetworkFetchFinishedEvent {
  jobId: string
  sourceId?: string | null
  ok: boolean
  message: string
  snapshot?: AppSnapshot
}

/** startNetworkFetch 成功时 data 载荷 */
export interface StartNetworkFetchResult {
  jobId: string
  sourceId: string
}

/** 网络库写操作通用结果（晋升 / 移除用户源等） */
export interface NetworkOpResultDto {
  ok: boolean
  message: string
  conflicts?: PathConflictDto[]
  promoted?: number
  updateAvailable?: number
  blocked?: boolean
  warnings?: string[]
  reapplyHints?: Array<{
    entryId?: string
    networkEntryId?: string
    message?: string
    skillName?: string
  }>
}

/** 操作日志事件（oplog.jsonl 单行）：谁在何时对哪个条目做了什么 */
export interface OpEventDto {
  ts: string
  op: string
  entryId: string
  networkEntryId: string
  sourceId: string
  level: string
  note: string
}

/** getEntryOperationLog 载荷：当前定制 diff + 级别 + 操作事件 */
export interface EntryOperationLogDto {
  entryId: string
  networkEntryId: string
  sourceId: string
  level: string
  hasCustomization: boolean
  unifiedDiff: string
  baselineHash: string
  customHash: string
  updatedAt: string
  events: OpEventDto[]
}

/** H6 点选轻路径载荷：仅随选中变化的快照字段，前端与上一帧快照合并 */
export interface SelectionDetailDto {
  selectedEntryIds: string[]
  selectionSummary: string
  detailPaneMode: string
  detailSummaryText: string
  detailMarkdownText: string
  detailSourcePathDisplay: string
  detailMarkdownFilePath: string
  detailPathSide: 'container' | 'library'
  commands: CommandAvailabilityDto
}

/** 部分 IPC 方法的参数（未列方法仍用宽松 Record） */
export type IpcMethodArgs = {
  setNetworkPopularVisibleLimit: { limit: number }
  setNetworkPopularSort: { mode: string }
  startNetworkFetch: {
    kind?: string | null
    id?: string | null
    urlOrBaselineId?: string | null
    url?: string | null
    label?: string | null
  }
  cancelNetworkFetch: { jobId: string }
  removeNetworkUserSource: { sourceId: string }
  promoteNetworkToLibrary: {
    entryIds: string[]
    resolutions?: unknown[]
    forceSecurityOverride?: boolean
  }
  setNetworkPopularVisibilityAll: { show: boolean; scope?: 'official' | 'community' }
  setNetworkPin: { section: string; id: string; pinned: boolean }
  setWorkspacesInWorkArea: { ids: string[]; inWorkArea: boolean }
  getEntryOperationLog: { entryId: string }
  setSelectionLight: { entryIds: string[]; detailPathSide?: 'container' | 'library' }
  setSelectionDetail: { entryIds: string[]; detailPathSide?: 'container' | 'library' }
}

/** 部分 IPC 方法的 data 载荷（信封仍为 IpcEnvelope） */
export type IpcMethodReturns = {
  setNetworkPopularVisibleLimit: undefined
  setNetworkPopularSort: undefined
  startNetworkFetch: StartNetworkFetchResult
  cancelNetworkFetch: undefined
  removeNetworkUserSource: NetworkOpResultDto
  promoteNetworkToLibrary: NetworkOpResultDto
  setNetworkPopularVisibilityAll: undefined
  setNetworkPin: undefined
  setWorkspacesInWorkArea: undefined
  getEntryOperationLog: EntryOperationLogDto
  setSelectionLight: undefined
  setSelectionDetail: SelectionDetailDto
}

