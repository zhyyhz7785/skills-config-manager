/** IPC channel names and envelope types shared by main ↔ preload ↔ renderer */

export const IPC = {
  invoke: 'ccm:invoke',
} as const;

export type IpcMethod =
  | 'getSnapshot'
  | 'chooseLibraryRoot'
  | 'setNav'
  | 'setFilters'
  | 'setSelection'
  | 'setDetailMode'
  | 'setClusterMode'
  | 'setPurposeDomainFilter'
  | 'refresh'
  | 'applyRefreshConflicts'
  | 'scanAndIngestPreview'
  | 'confirmIngest'
  | 'confirmScanBuild'
  | 'previewMoveIntoBackup'
  | 'moveIntoBackupLibrary'
  | 'deploy'
  | 'withdraw'
  | 'unmanage'
  | 'purgeMissing'
  | 'editTags'
  | 'setEntryLevel'
  | 'setScopeGlobal'
  | 'setScopeProject'
  | 'addProject'
  | 'createProjectContainer'
  | 'editProject'
  | 'inspectProjectForDelete'
  | 'removeProject'
  | 'togglePinProject'
  | 'scanProjectsPreview'
  | 'confirmScanProjects'
  | 'openOriginalDirectory'
  | 'openCurrentDirectory'
  | 'openLibraryEntry'
  | 'openPermanentLibrary'
  | 'pickFolder'
  | 'openPath'
  | 'setDirectoryMode'
  | 'toggleConfigItem'
  | 'enableAllConfig'
  | 'disableAllConfig'
  | 'refreshConfig'
  | 'windowMinimize'
  | 'windowMaximizeToggle'
  | 'windowClose'
  | 'windowIsMaximized'
  | 'reorderProject'
  | 'setUiLayout'
  | 'openProjectRoot'
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
  | 'listCatalogBackups'
  | 'restoreCatalogBackup'
  | 'ensureDefaultNetworkLibrary'
  | 'chooseNetworkLibraryRoot'
  | 'listNetworkBaselineSources'
  | 'fetchNetworkSource'
  | 'checkNetworkUpdates'
  | 'applyNetworkCacheUpdate'
  | 'promoteNetworkToLibrary'
  | 'setNetworkPin'
  | 'setNetworkAgentRepoOverride'
  | 'setNetworkIntendedLevel'
  | 'evaluateNetworkSecurity'
  | 'fetchNetworkNavSource'
  | 'reapplyNetworkCustomization'
  | 'refreshNetworkHeat'
  | 'searchSkillsSh'
  | 'cleanupNetworkCache'
  | 'setWorkspaceVisibility'
  | 'setDefaultWorkspace'
  | 'updateWorkspaceConfig'
  | 'previewLibraryDrift'
  | 'listDeployRecipes'
  | 'saveDeployRecipe'
  | 'deleteDeployRecipe'
  | 'applyDeployRecipe'

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
}

/** 网络侧栏：官方 Agent 或 GitHub 热门源节点 */
export interface NetworkNavNodeDto {
  id: string
  kind: string
  displayName: string
  pinned: boolean
  primaryRepoUrl: string
  baselineId?: string | null
  heatLabel: string
  hasDefaultRepo: boolean
  cachedCount: number
}

/** Plan/04 工作区配置（快照侧） */
export interface WorkspaceDto {
  id: string
  enabled: boolean
  displayName: string
  containerRoot: string
  isDefault: boolean
  isVisible: boolean
  isFocused: boolean
}

/** Plan/04 可见工作区的容器/曾用于分区 */
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
  purposeTaxonomy: string[]
  clusterModeIndex: number
  clusterModeOptions: string[]
  directoryModeOptions: string[]
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
  isNetworkLibraryConfigured: boolean
  networkLibraryRootDisplay: string
  networkOfficialNav?: NetworkNavNodeDto[]
  networkPopularNav?: NetworkNavNodeDto[]
  /** 0=关；分钟；定时仅 checkNetworkUpdates */
  networkUpdateCheckIntervalMinutes?: number
  /** 是否已配置 skills.sh API Key（不暴露密钥） */
  skillsShConfigured?: boolean
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
  /** 程序设置目录（settings.json 所在） */
  appSettingsDirDisplay: string
  selectedDirectoryModeIndex: number
  isCustomDirectoryMode: boolean
  customBaseDirectory: string
  selectedDirectoryDisplay: string
  configItems: ConfigItemDto[]
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

