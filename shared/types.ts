import { randomUUID } from 'node:crypto';

/** Kind enums as camelCase strings matching catalog.json */
export type LibraryItemKind = 'skill' | 'rule' | 'agent' | 'command' | 'hook';

export type OperationKind =
  | 'discovered'
  | 'ingested'
  | 'deployed'
  | 'withdrawn'
  | 'restored'
  | 'contentChanged'
  | 'unmanaged'
  | 'registered';

export type LibraryCatalogChangeKind = 'add' | 'remove' | 'containerAdd' | 'missing';

export interface OriginRecord {
  tool: string;
  scope: string;
  originalPath: string;
  discoveredAt: string;
  isRestored: boolean;
}

export interface OperationRecord {
  at: string;
  kind: OperationKind;
  fromPath: string;
  toPath: string;
  containerRoot: string;
  note: string;
}

/** 可恢复状态点：只记路径/哈希/时间，不存正文快照 */
export type EntryCheckpointReason =
  | 'registered'
  | 'deployed'
  | 'withdrawn'
  | 'restored'
  | 'manual';

export interface EntryCheckpoint {
  at: string;
  reason: EntryCheckpointReason;
  path: string;
  contentHash: string;
  note?: string;
}

/** 库存浏览层级标记（可选；有则优先；缺省按 scope / 默认 L1） */
export type EntryLevelTag = 'L0' | 'L1' | 'L2';

export interface EntryTags {
  scope: string;
  purposes: string[];
  /** 右键/拖拽/自动归类写入；缺省则：项目→L2、用户级 rule→L0、其余未分类 */
  level?: EntryLevelTag;
  /** 永久库区内手调序（越小越靠前） */
  sortIndex?: number;
}

export interface LibraryEntry {
  id: string;
  kind: LibraryItemKind;
  /** Relative to skills-library root */
  libraryPath: string;
  isInLibrary: boolean;
  deployedPath: string;
  lastContainerPath: string;
  initialPath: string;
  isMissing: boolean;
  origins: OriginRecord[];
  history: OperationRecord[];
  /** 可恢复状态点（缺省 []；旧 catalog 无此字段） */
  checkpoints?: EntryCheckpoint[];
  /** saveAs 来源：记录该条目是从哪个 canonical id saveAs 而来（用于retire/canonicalize） */
  savedAsOf?: string;
  tags: EntryTags;
  remarkZh: string;
  trigger: string;
  description: string;
  contentHash: string;
  ingestedAt: string;
}

export interface LibraryCatalog {
  /** Schema version; v2+ includes projects[] as SSOT for registered projects */
  version: number;
  /** Registered project roots (left-nav 项目); lives in catalog, not settings */
  projects: ProjectItem[];
  entries: LibraryEntry[];
}

export function createEmptyLibraryCatalog(): LibraryCatalog {
  return { version: 2, projects: [], entries: [] };
}

export interface ProjectItem {
  id: string;
  name: string;
  rootPath: string;
  category: string;
  pinned: boolean;
  visibleTools?: string[];
  toolContainerRoots?: Record<string, string>;
}

export interface ActionLogEntry {
  at: string
  method: string
  summary: string
}

/** Plan/04 每工作区配置（PascalCase 落盘） */
export interface WorkspaceConfig {
  Id: string;
  Enabled: boolean;
  DisplayName: string;
  ContainerRoot: string;
}

export interface AppSettings {
  SkillsLibraryRoot: string;
  LibraryRootConfigured: boolean;
  /** Plan/03 网络库根（与永久库隔离） */
  NetworkLibraryRoot: string;
  NetworkLibraryConfigured: boolean;
  BackupRoot: string;
  /**
   * Legacy only: project registry moved to catalog.json `projects`.
   * Loaded for one-time migration; always saved as [].
   */
  Projects: ProjectItem[];
  PurposeTaxonomy: string[];
  SelectedProjectId?: string | null;
  ShowGlobalOnly: boolean;
  /** global | project — persisted nav kind */
  NavKind: string;
  /** 用户级焦点工作区：cursor | claude | codex（兼容旧字段） */
  SelectedGlobalTool: string;
  /** Plan/04 默认工作区 id */
  DefaultWorkspaceId: string;
  /** Plan/04 可见工作区 id 列表 */
  VisibleWorkspaceIds: string[];
  /** Plan/04 工作区配置 */
  Workspaces: WorkspaceConfig[];
  ClusterModeIndex: number;
  PurposeDomainFilterIndex: number;
  SelectedDirectoryModeIndex: number;
  CustomBaseDirectory: string;
  ProjectScanRoots: string[];
  ProjectScanMaxDepth: number;
  AutoScanProjectsOnStartup: boolean;
  LibraryFilterInitialized: boolean;
  FilterShowSkills: boolean;
  FilterShowRules: boolean;
  FilterShowAgents: boolean;
  FilterShowCommands: boolean;
  FilterShowHooks: boolean;
  /** Left nav pane width px */
  UiNavWidth: number;
  /** Center list pane width px */
  UiListWidth: number;
  /** Primary side bar (nav) visible */
  UiNavVisible: boolean;
  /** Secondary / auxiliary side bar (detail) visible */
  UiDetailVisible: boolean;
  /** Recent user actions for recovery / audit */
  LastActionLog: ActionLogEntry[];
}

export interface DiscoveredItem {
  kind: LibraryItemKind;
  suggestedId: string;
  sourcePath: string;
  tool: string;
  scope: string;
  isFolder: boolean;
  contentHash: string;
  remarkZh: string;
  trigger: string;
  description: string;
  existingEntryId?: string | null;
  contentChanged: boolean;
  needsAttention: boolean;
  isSelected: boolean;
}

export interface ClusterNode {
  name: string;
  isGroup: boolean;
  entry?: LibraryEntry;
  scopeKey?: string | null;
  children: ClusterNode[];
  isExpanded: boolean;
}

export interface LibraryCatalogChangeItem {
  changeKind: LibraryCatalogChangeKind;
  id: string;
  itemKind: LibraryItemKind;
  libraryPath: string;
  fullPath: string;
  contentHash: string;
  isFolder: boolean;
  summary: string;
  tool: string;
  scope: string;
  isSelected: boolean;
}

export interface LibraryListItem {
  entry: LibraryEntry;
  displayName: string;
  groupName: string;
  scopeKey?: string | null;
  sourceLabel?: string | null;
  isInContainerList: boolean;
}

export interface DiscoveredProject {
  rootPath: string;
  suggestedName: string;
  suggestedCategory: string;
  markers: string;
  alreadyRegistered: boolean;
  hasContentChanges: boolean;
  pendingItemCount: number;
  isSelected: boolean;
}

export interface ConfigItem {
  name: string;
  originalPath: string;
  backupPath: string;
  category: string;
  remarkZh: string;
  triggerWord: string;
  isFolder: boolean;
  isCategoryNode: boolean;
  isEnabled: boolean;
  isChecked: boolean | null;
  children: ConfigItem[];
  parent?: ConfigItem | null;
}

export interface ParsedMetadata {
  remarkZh: string;
  trigger: string;
  description: string;
  name: string;
  /** 规则 frontmatter alwaysApply（结构化字段，非正文语义） */
  alwaysApply?: boolean;
  /** 规则 frontmatter globs */
  globs?: string;
}

export interface LibraryReconcileResult {
  added: number;
  relinked: number;
  hashUpdated: number;
  unchanged: number;
}

export interface IngestResult {
  movedNew: number;
  originsAppended: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/** merge=保留目标/库内；overwrite=用来源覆盖目标；saveAs=另存新 id；skip=跳过 */
export type IngestNameConflictChoice = 'merge' | 'skip' | 'saveAs' | 'overwrite';

export interface IngestNameConflict {
  suggestedId: string;
  sourcePath: string;
  existingEntryId: string;
  libraryPathExists: boolean;
}

/** 扫描建库 / 迁入永久库 / 刷新对账 的同名冲突（供 UI 比对） */
export interface PathConflictItem {
  key: string;
  operation: 'scanBuild' | 'moveIntoBackup' | 'withdraw' | 'refresh';
  suggestedId: string;
  kind: LibraryItemKind;
  sourcePath: string;
  targetPath: string;
  /** 实际参与比对的文件路径（目录解包后的主文件，如 SKILL.md） */
  sourceComparePath?: string;
  targetComparePath?: string;
  sourcePreview: string;
  targetPreview: string;
  existingEntryId: string;
  sourceHash: string;
  targetHash: string;
  /** 源文件大小（字节） */
  sourceSize?: number;
  /** 目标文件大小（字节） */
  targetSize?: number;
  /** 源文件修改时间（ISO 8601） */
  sourceModified?: string;
  /** 目标文件修改时间（ISO 8601） */
  targetModified?: string;
  /** 源文件创建时间（ISO 8601；部分系统无） */
  sourceCreated?: string;
  /** 目标文件创建时间（ISO 8601；部分系统无） */
  targetCreated?: string;
  /** 预览包含的行数 */
  sourcePreviewLines?: number;
  /** 预览包含的行数 */
  targetPreviewLines?: number;
}

export interface ConflictResolution {
  key: string;
  choice: IngestNameConflictChoice;
}

export interface RegisterScanResult {
  registered: number;
  originsAppended: number;
  skipped: number;
  failed: number;
  errors: string[];
  conflicts: PathConflictItem[];
}

export interface MoveIntoBackupResult {
  moved: number;
  skipped: number;
  failed: number;
  messages: string[];
  conflicts: PathConflictItem[];
  pendingCount: number;
}

export function createDefaultAppSettings(): AppSettings {
  return {
    SkillsLibraryRoot: '',
    LibraryRootConfigured: false,
    NetworkLibraryRoot: '',
    NetworkLibraryConfigured: false,
    BackupRoot: '',
    Projects: [],
    PurposeTaxonomy: [],
    SelectedProjectId: null,
    ShowGlobalOnly: true,
    NavKind: 'global',
    SelectedGlobalTool: 'cursor',
    DefaultWorkspaceId: 'cursor',
    VisibleWorkspaceIds: ['cursor'],
    Workspaces: [
      { Id: 'cursor', Enabled: true, DisplayName: 'Cursor', ContainerRoot: '' },
      { Id: 'claude', Enabled: true, DisplayName: 'Claude', ContainerRoot: '' },
      { Id: 'codex', Enabled: true, DisplayName: 'Codex', ContainerRoot: '' },
    ],
    ClusterModeIndex: 0,
    PurposeDomainFilterIndex: 0,
    SelectedDirectoryModeIndex: 0,
    CustomBaseDirectory: '',
    ProjectScanRoots: [],
    ProjectScanMaxDepth: 5,
    AutoScanProjectsOnStartup: false,
    LibraryFilterInitialized: false,
    FilterShowSkills: true,
    FilterShowRules: true,
    FilterShowAgents: false,
    FilterShowCommands: false,
    FilterShowHooks: false,
    UiNavWidth: 220,
    UiListWidth: 480,
    UiNavVisible: true,
    UiDetailVisible: true,
    LastActionLog: [],
  }
}

export function createDefaultEntryTags(): EntryTags {
  return { scope: 'global', purposes: [] };
}

export function createEmptyLibraryEntry(): LibraryEntry {
  return {
    id: '',
    kind: 'skill',
    libraryPath: '',
    isInLibrary: true,
    deployedPath: '',
    lastContainerPath: '',
    initialPath: '',
    isMissing: false,
    origins: [],
    history: [],
    checkpoints: [],
    tags: createDefaultEntryTags(),
    remarkZh: '',
    trigger: '',
    description: '',
    contentHash: '',
    ingestedAt: new Date().toISOString(),
  };
}

const OPERATION_KIND_TEXT: Record<OperationKind, string> = {
  discovered: '发现',
  ingested: '迁入永久库',
  deployed: '放入容器',
  withdrawn: '移出到永久库',
  restored: '恢复原位',
  contentChanged: '内容变更',
  unmanaged: '确认去除',
  registered: '登记',
};

const KIND_LABEL: Record<LibraryItemKind, string> = {
  skill: '技能',
  rule: '规则',
  agent: '代理',
  command: '命令',
  hook: '钩子',
};

export function operationKindText(kind: OperationKind): string {
  return OPERATION_KIND_TEXT[kind] ?? kind;
}

export function formatOperationDisplayLine(op: OperationRecord): string {
  const from = op.fromPath.trim() ? op.fromPath : '—';
  const to = op.toPath.trim() ? op.toPath : '—';
  const note = op.note.trim() ? ` · ${op.note}` : '';
  const at = op.at.slice(0, 16).replace('T', ' ');
  return `${at} [${operationKindText(op.kind)}] ${from} → ${to}${note}`;
}

export function libraryEntryDisplayName(entry: LibraryEntry): string {
  return entry.id.trim() ? entry.id : entry.libraryPath;
}

export function libraryEntryScopeDisplay(entry: LibraryEntry): string {
  const scope = entry.tags?.scope ?? 'global';
  if (scope === 'global') return '用户级·全局适用';
  if (scope.startsWith('project:')) return scope.slice('project:'.length);
  return scope;
}

export function libraryEntryPurposeDisplay(entry: LibraryEntry): string {
  const purposes = entry.tags?.purposes ?? [];
  return purposes.length === 0 ? '未分类' : purposes.join(', ');
}

export function libraryEntryLocationDisplay(entry: LibraryEntry): string {
  if (entry.isMissing) return '缺失（待确认）';
  const inLib = entry.isInLibrary;
  const inContainer = Boolean(entry.deployedPath?.trim());
  if (inLib && inContainer) return '在库＋容器（双份）';
  if (inLib) return '永久库（不生效）';
  return '容器中（生效）';
}

export function libraryEntryOriginsDisplay(entry: LibraryEntry): string {
  if (!entry.origins?.length) return '（无原始路径）';
  return entry.origins
    .map((o) => `[${o.tool}/${o.scope}] ${o.originalPath}`)
    .join('\n');
}

export function libraryEntryHistoryDisplay(entry: LibraryEntry): string {
  if (!entry.history?.length) return '（无操作历史）';
  return [...entry.history]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40)
    .map(formatOperationDisplayLine)
    .join('\n');
}

export function appendLibraryHistory(
  entry: LibraryEntry,
  kind: OperationKind,
  fromPath: string,
  toPath: string,
  containerRoot = '',
  note = '',
): void {
  entry.history ??= [];
  entry.history.push({
    at: new Date().toISOString(),
    kind,
    fromPath: fromPath ?? '',
    toPath: toPath ?? '',
    containerRoot: containerRoot ?? '',
    note: note ?? '',
  });
}

export function ensureLibraryInitialPath(entry: LibraryEntry, pathValue: string): void {
  if (!entry.initialPath.trim() && pathValue.trim()) {
    entry.initialPath = pathValue;
  }
}

export function kindLabel(kind: LibraryItemKind): string {
  return KIND_LABEL[kind] ?? '项';
}

export function libraryListItemKindLabel(entry: LibraryEntry): string {
  return kindLabel(entry.kind);
}

export function libraryListItemSubtitle(item: LibraryListItem): string {
  const body = item.entry.remarkZh.trim() ? item.entry.remarkZh : item.entry.trigger;
  if (!item.sourceLabel?.trim()) return body ?? '';
  if (!body?.trim()) return item.sourceLabel;
  return `${item.sourceLabel} · ${body}`;
}

export function catalogChangeActionText(changeKind: LibraryCatalogChangeKind): string {
  switch (changeKind) {
    case 'add':
      return '登记(库)';
    case 'remove':
      return '移除';
    case 'containerAdd':
      return '登记(容器)';
    case 'missing':
      return '移除缺失';
    default:
      return changeKind;
  }
}

export function discoveredItemScopeDisplay(scope: string): string {
  if (scope === 'user-global') return '用户级·全局适用';
  if (scope === 'user') return '用户级';
  if (scope === 'backup') return '备份区';
  if (scope.startsWith('project:')) return '项目';
  return scope;
}

export function discoveredItemStatusText(item: DiscoveredItem): string {
  if (item.contentChanged) return '内容已变更';
  if (item.existingEntryId) return '已在库（将追加来源）';
  return '新建迁入';
}

export function discoveredProjectCanConfirmAdd(p: DiscoveredProject): boolean {
  return !p.alreadyRegistered || p.hasContentChanges;
}

export function discoveredProjectStatusText(p: DiscoveredProject): string {
  if (!p.alreadyRegistered) return '新建';
  if (p.hasContentChanges) {
    return p.pendingItemCount > 0 ? `有更新(${p.pendingItemCount})` : '有更新';
  }
  return '已在列表';
}

export function newProjectId(): string {
  return randomUUID().replace(/-/g, '');
}
