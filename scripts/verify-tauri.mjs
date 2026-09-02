#!/usr/bin/env node
/**
 * Verify pure Tauri2 product path (no Electron / sidecar remnants).
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

if (fs.existsSync(path.join(root, 'electron'))) {
  console.error('FAIL: electron/ directory must be removed')
  process.exit(1)
}
if (fs.existsSync(path.join(root, 'src-tauri/src/sidecar.rs'))) {
  console.error('FAIL: sidecar.rs must be removed')
  process.exit(1)
}
if (fs.existsSync(path.join(root, 'scripts/run-sidecar.mjs'))) {
  console.error('FAIL: run-sidecar.mjs must be removed')
  process.exit(1)
}
for (const rel of [
  'src-tauri/src/recipes.rs',
  'src-tauri/src/drift.rs',
  'src-tauri/src/drag_paths.rs',
  'sidecar/ccm-sidecar.mts',
  'scripts/run-electron-bench.mjs',
  'scripts/bench-electron-perf.mts',
]) {
  if (fs.existsSync(path.join(root, rel))) {
    console.error(`FAIL: ${rel} must be removed`)
    process.exit(1)
  }
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const name of ['electron', 'electron-builder', 'vite-plugin-electron', 'vite-plugin-electron-renderer']) {
  if (deps[name]) {
    console.error(`FAIL: package.json still depends on ${name}`)
    process.exit(1)
  }
}
const cargoToml = fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')
if (/\bureq\b/.test(cargoToml)) {
  console.error('FAIL: Cargo.toml still has ureq (sidecar HTTP)')
  process.exit(1)
}
console.log('Remnant checks OK (no electron/sidecar)')

const bridge = fs.readFileSync(path.join(root, 'src/tauri/ccmBridge.ts'), 'utf8')
if (bridge.includes('useSidecarBypass') || bridge.includes('sidecarInvoke')) {
  console.error('FAIL: ccmBridge must not call sidecar bypass')
  process.exit(1)
}
if (!bridge.includes('stubUnimplemented')) {
  console.error('FAIL: ccmBridge missing stubUnimplemented')
  process.exit(1)
}
if (bridge.includes('resolve_drag_file_paths') || bridge.includes('tauri-plugin-drag')) {
  console.error('FAIL: startDrag / drag plugin must be removed')
  process.exit(1)
}
if (bridge.includes('scanProjectsPreview') || bridge.includes('previewLibraryDrift')) {
  console.error('FAIL: retired IPC still wired in ccmBridge')
  process.exit(1)
}
console.log('Bridge static checks OK')

const appTsx = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8')
if (!appTsx.includes('scanAndIngestPreview')) {
  console.error('FAIL: App should use scanAndIngestPreview for 扫描建库')
  process.exit(1)
}
if (appTsx.includes('扫描建库 · 选择目录') || appTsx.includes('ScanRootsPickerModal')) {
  console.error('FAIL: App 不得再弹「扫描建库 · 选择目录」；勾选已迁入设置')
  process.exit(1)
}
if (appTsx.includes('shouldOpenClassify') || appTsx.includes('skipBusyGuard')) {
  console.error('FAIL: confirmScanBuild 后不得再打开自动归类弹窗')
  process.exit(1)
}
{
  const confirmStart = appTsx.indexOf('const runConfirmScanBuild')
  if (confirmStart < 0) {
    console.error('FAIL: App 须保留 runConfirmScanBuild')
    process.exit(1)
  }
  const confirmEnd = appTsx.indexOf('\n  const ', confirmStart + 1)
  const confirmBody = appTsx.slice(
    confirmStart,
    confirmEnd < 0 ? confirmStart + 2500 : confirmEnd,
  )
  if (confirmBody.includes('openSuggestPurposes')) {
    console.error('FAIL: confirmScanBuild 后不得再 openSuggestPurposes')
    process.exit(1)
  }
}
if (!appTsx.includes("t('toolbar.autoClassify')")) {
  console.error('FAIL: App 须保留顶栏「自动归类」')
  process.exit(1)
}
if (appTsx.includes('扫描建库已完成')) {
  console.error('FAIL: 自动归类弹窗不得再写扫完必弹口吻')
  process.exit(1)
}
if (!appTsx.includes('optimisticWorkspaceEye')) {
  console.error('FAIL: App must keep optimisticWorkspaceEye (workspace eye speed)')
  process.exit(1)
}
if (!appTsx.includes('mergeOmitNetworkSnapshot')) {
  console.error('FAIL: App must keep mergeOmitNetworkSnapshot for light workspace snaps')
  process.exit(1)
}
console.log('App UI static checks OK')

// 网络列表按操作动线重设计（防回归）：
// 1) 上下窗同一套列表行：不得再有表头四列；须走 ListEntryBody + L0/L1/L2 分组
const netShelf = fs.readFileSync(path.join(root, 'src/components/NetworkShelf.tsx'), 'utf8')
if (/<th>热度<\/th>/.test(netShelf) || /<th>来源<\/th>/.test(netShelf)) {
  console.error('FAIL: NetworkShelf 表头不得再含 热度/来源 列（左侧源导航已展示）')
  process.exit(1)
}
if (!netShelf.includes('ListEntryBody') || !netShelf.includes('groupItemsByLevelBucket')) {
  console.error('FAIL: NetworkWorkbench 须用 ListEntryBody 且按 L0/L1/L2/未分类分组')
  process.exit(1)
}
if (!netShelf.includes("t('net.colLocal')")) {
  console.error('FAIL: NetworkShelf 须含本地来源文案（行 meta 用）')
  process.exit(1)
}
if (appTsx.includes("t('cluster.byLevel')") || appTsx.includes('GroupModeSelect')) {
  console.error('FAIL: 永久库列表不得再有「按层级用途」分组下拉')
  process.exit(1)
}
// 2) 网络行右键：转入本地 + 全部放入未分类；不得再镜像意向层级子菜单
if (appTsx.includes('意向层级（转入本地时生效）')) {
  console.error('FAIL: networkItemMenu 不得再含意向层级子菜单')
  process.exit(1)
}
if (!appTsx.includes("t('menu.putAllUncategorized')")) {
  console.error('FAIL: 网络行右键须含「全部放入未分类」')
  process.exit(1)
}
if (!appTsx.includes('openEntryOpsLog')) {
  console.error('FAIL: App 须保留 openEntryOpsLog（定制与操作记录入口）')
  process.exit(1)
}
// 2b) 右键菜单禁止「上移/下移/移至顶部/移至底部」；排序只走左键拖拽
const settingsModal = fs.readFileSync(
  path.join(root, 'src/components/SettingsModal.tsx'),
  'utf8',
)
if (
  !settingsModal.includes("t('settings.workspaceRoots')") ||
  !settingsModal.includes('scanSkipWorkspaceIds') ||
  !settingsModal.includes("t('settings.addFolder')")
) {
  console.error('FAIL: SettingsModal 扫描展开须含工作区容器根勾选与添加目录')
  process.exit(1)
}
const listReorder = fs.readFileSync(path.join(root, 'src/lib/listReorder.ts'), 'utf8')
if (
  appTsx.includes('reorderMenuItems') ||
  settingsModal.includes('reorderMenuItems') ||
  /export function reorderMenuItems/.test(listReorder)
) {
  console.error('FAIL: reorderMenuItems 已废弃；右键排序入口须全部删除')
  process.exit(1)
}
if (
  /label:\s*['"]上移['"]/.test(appTsx) ||
  /label:\s*['"]移至顶部['"]/.test(appTsx) ||
  /label:\s*['"]下移['"]/.test(appTsx) ||
  /label:\s*['"]移至底部['"]/.test(appTsx)
) {
  console.error('FAIL: App 右键菜单不得再含 上移/下移/移至顶部/移至底部')
  process.exit(1)
}
if (
  settingsModal.includes('右键可上移') ||
  settingsModal.includes("window.prompt('排序：up / down / top / bottom'")
) {
  console.error('FAIL: SettingsModal 不得再保留右键 prompt 排序入口')
  process.exit(1)
}
if (netShelf.includes('右键可上移')) {
  console.error('FAIL: NetworkShelf 提示文案不得再提右键排序')
  process.exit(1)
}
// 3) oplog 已在 promote / setIntendedLevel / 库内保存路径接线
const netLibRs = fs.readFileSync(path.join(root, 'src-tauri/src/network_library.rs'), 'utf8')
const netCustRs = fs.readFileSync(
  path.join(root, 'src-tauri/src/network_customization.rs'),
  'utf8',
)
if (!netLibRs.includes('oplog::append')) {
  console.error('FAIL: network_library.rs 须在 promote/setIntendedLevel 等路径写 oplog')
  process.exit(1)
}
if (!netCustRs.includes('oplog::append')) {
  console.error('FAIL: network_customization.rs 须在记录定制 diff 时写 oplog')
  process.exit(1)
}
if (!bridge.includes('get_entry_operation_log')) {
  console.error('FAIL: getEntryOperationLog / get_entry_operation_log not wired')
  process.exit(1)
}
// 4) 社区批量眼须覆盖用户源：后端清/加 pin + 前端乐观更新都不得跳过 kind==='user'
if (!netLibRs.includes('批量眼须覆盖两者')) {
  console.error('FAIL: set_network_popular_visibility_all 社区分支须覆盖用户源 pin')
  process.exit(1)
}
if (appTsx.includes("if (n.kind === 'user' || n.isOfficialSample) return n")) {
  console.error('FAIL: optimisticPopularVisibilityAll 不得跳过用户源（社区批量眼须同关/同开）')
  process.exit(1)
}
if (netShelf.includes('刷新热度') || netShelf.includes('searchSkillsSh')) {
  console.error('FAIL: NetworkShelf 不得再含刷新热度 / skills.sh 搜索')
  process.exit(1)
}
if (netShelf.includes('检查更新')) {
  console.error('FAIL: NetworkShelf 不得再含侧栏「检查更新」（改官网/社区标题刷新图标）')
  process.exit(1)
}
if (!netShelf.includes('onRefreshSection') || !netShelf.includes('RefreshGlyph')) {
  console.error('FAIL: NetworkNav 须含分组刷新 onRefreshSection / RefreshGlyph')
  process.exit(1)
}
if (!netShelf.includes('net-sort-select')) {
  console.error('FAIL: NetworkShelf 须含社区排序 net-sort-select')
  process.exit(1)
}
if (!appTsx.includes('setNetworkPopularSort')) {
  console.error('FAIL: App 须接线 setNetworkPopularSort')
  process.exit(1)
}
if (!appTsx.includes('fetch-concurrency') || !appTsx.includes('FETCH_CONCURRENCY_DEFAULT')) {
  console.error('FAIL: 拉取窗须含并行路数 fetch-concurrency（默认 3）')
  process.exit(1)
}
if (/\bfetchQueueRef\.current\s*=\s*fetchQueue\b/.test(appTsx)) {
  console.error('FAIL: 不得在渲染期用 fetchQueue state 覆盖 fetchQueueRef')
  process.exit(1)
}
if (!appTsx.includes('const commitFetchQueue')) {
  console.error('FAIL: App 须含 commitFetchQueue（入队先写 ref 再泵）')
  process.exit(1)
}
for (const name of ['enqueueNetworkFetch', 'fetchPickedUncached', 'refreshNetworkSection']) {
  if (!appTsx.includes(`const ${name}`)) {
    console.error(`FAIL: App 须保留 ${name}`)
    process.exit(1)
  }
  const start = appTsx.indexOf(`const ${name}`)
  const end = appTsx.indexOf('\n  const ', start + 1)
  const body = appTsx.slice(start, end < 0 ? start + 2500 : end)
  if (!body.includes('commitFetchQueue')) {
    console.error(`FAIL: ${name} 入队须走 commitFetchQueue（先写 ref 再泵）`)
    process.exit(1)
  }
}
if (settingsModal.includes('fetch-concurrency') || settingsModal.includes('并行路数')) {
  console.error('FAIL: SettingsModal 不得含并行路数（入口在拉取窗）')
  process.exit(1)
}
const settingsRs = fs.readFileSync(path.join(root, 'src-tauri/src/settings.rs'), 'utf8')
if (!settingsRs.includes('network_fetch_concurrency')) {
  console.error('FAIL: settings.rs 须含 network_fetch_concurrency')
  process.exit(1)
}
if (
  !settingsRs.includes('scan_skip_workspace_ids') ||
  !settingsRs.includes('scan_extra_roots')
) {
  console.error('FAIL: settings.rs 须含 scan_skip_workspace_ids / scan_extra_roots')
  process.exit(1)
}
if (settingsModal.includes('迁入永久库')) {
  console.error('FAIL: SettingsModal 不得再含「迁入永久库」（入口改主区空白右键）')
  process.exit(1)
}
if (!appTsx.includes("t('menu.promoteToLibrary')")) {
  console.error('FAIL: 主区空白右键须含「迁入永久库」')
  process.exit(1)
}
if (
  !settingsModal.includes("t('settings.export')") ||
  !settingsModal.includes("t('settings.import')") ||
  !settingsModal.includes("t('settings.deleteNetworkCache')") ||
  !settingsModal.includes("t('settings.allDrives')")
) {
  console.error('FAIL: SettingsModal 须含台账存储/读取、回厂删缓存选项、全部盘符摘要')
  process.exit(1)
}
if (
  settingsModal.includes('Git / gh HTTP') ||
  settingsModal.includes('备份根') ||
  settingsModal.includes('程序设置目录') ||
  settingsModal.includes('网络更新检查间隔')
) {
  console.error('FAIL: SettingsModal 不得再含代理 / 备份根 / 程序设置目录 / 网络间隔')
  process.exit(1)
}
if (
  settingsModal.includes('漂移报告') ||
  settingsModal.includes('部署配方') ||
  settingsModal.includes('SkillsShApiToken') ||
  settingsModal.includes('skills.sh')
) {
  console.error('FAIL: SettingsModal 不得再含漂移报告 / 部署配方 / skills.sh')
  process.exit(1)
}
console.log('Network list redesign static checks OK')

// 5) 选择提速与点名开文档（防回归）：
//    a. 禁止遗留调试插桩（agent log / debug-10020b）回到源码热路径
const libRs = fs.readFileSync(path.join(root, 'src-tauri/src/lib.rs'), 'utf8')
const snapshotRs = fs.readFileSync(path.join(root, 'src-tauri/src/snapshot.rs'), 'utf8')
for (const [name, text] of [
  ['lib.rs', libRs],
  ['snapshot.rs', snapshotRs],
  ['network_library.rs', netLibRs],
  ['App.tsx', appTsx],
]) {
  if (text.includes('#region agent log') || text.includes('debug-10020b')) {
    console.error(`FAIL: ${name} 含调试插桩残留（#region agent log / debug-10020b）`)
    process.exit(1)
  }
}
//    b. set_selection 必须返回轻快照（省略网络列表大负载），且轻量命令已接线
const setSelBody = libRs.slice(
  libRs.indexOf('fn set_selection('),
  libRs.indexOf('fn set_selection_light('),
)
if (!setSelBody.includes('snapshot_now_light')) {
  console.error('FAIL: set_selection 须返回 snapshot_now_light（勿把全量快照当选择操作用）')
  process.exit(1)
}
if (!libRs.includes('set_selection_light') || !bridge.includes('set_selection_light')) {
  console.error('FAIL: set_selection_light 未接线（勾选类轻操作需免快照）')
  process.exit(1)
}
//    c. 网络列表：点行只勾选（toggleNetworkCheck）、点名称开文档（net-wb-name-link）
if (!appTsx.includes('toggleNetworkCheck') || !appTsx.includes('openNetworkDoc')) {
  console.error('FAIL: App 须保留 toggleNetworkCheck（点行勾选）与 openNetworkDoc（点名开文档）')
  process.exit(1)
}
if (!appTsx.includes('selectionLightSeqRef') || !appTsx.includes('setSelectionLight')) {
  console.error('FAIL: 勾选轻路径须带 selectionLightSeqRef 丢弃过期 setSelectionLight 响应')
  process.exit(1)
}
const openNetStart = appTsx.indexOf('const openNetworkDoc')
const openNetEnd = appTsx.indexOf('const saveDetailMarkdown')
const openNetBody =
  openNetStart >= 0 && openNetEnd > openNetStart ? appTsx.slice(openNetStart, openNetEnd) : ''
if (!openNetBody) {
  console.error('FAIL: 无法定位 openNetworkDoc 函数体')
  process.exit(1)
}
if (openNetBody.includes("'raw'") || openNetBody.includes('"raw"')) {
  console.error('FAIL: openNetworkDoc 不得强制 raw；网络条目默认 Markdown')
  process.exit(1)
}
if (!openNetBody.includes('markdown')) {
  console.error('FAIL: openNetworkDoc 须切到 markdown')
  process.exit(1)
}
const modeBlockStart = snapshotRs.indexOf('detail_pane_mode:')
const modeBlockEnd = snapshotRs.indexOf('detail_summary_text,')
const modeBlock =
  modeBlockStart >= 0 && modeBlockEnd > modeBlockStart
    ? snapshotRs.slice(modeBlockStart, modeBlockEnd)
    : ''
if (!modeBlock.includes('markdown')) {
  console.error('FAIL: snapshot detail_pane_mode 有正文时应升 markdown')
  process.exit(1)
}
if (modeBlock.includes('"raw"') || modeBlock.includes("'raw'")) {
  console.error('FAIL: 网络条目不得在 snapshot 中自动升 raw；有正文应升 markdown')
  process.exit(1)
}
const crepeTsx = fs.readFileSync(path.join(root, 'src/components/DetailMarkdownCrepe.tsx'), 'utf8')
if (!crepeTsx.includes('SIZE_RETRY_MAX')) {
  console.error('FAIL: DetailMarkdownCrepe 须有 SIZE_RETRY_MAX（零高度自毁重试上限）')
  process.exit(1)
}
if (!crepeTsx.includes('detail-md-copy')) {
  console.error('FAIL: DetailMarkdownCrepe 须有复制按钮（detail-md-copy）')
  process.exit(1)
}
if (!crepeTsx.includes("t('md.copyFull')") || !crepeTsx.includes("t('md.copyPlain')")) {
  console.error('FAIL: DetailMarkdownCrepe 须同时有「复制全文」与「复制纯文本」')
  process.exit(1)
}
if (!netShelf.includes('net-wb-name-link')) {
  console.error('FAIL: NetworkShelf 名称单元格须为 net-wb-name-link（点名称打开文档）')
  process.exit(1)
}
console.log('Selection speed & name-link static checks OK')

// 6) 侧栏/过滤等热路径须返轻快照（勿每击重建 8000+ 网络 DTO）
function extractFnBody(src, fnName) {
  const start = src.indexOf(`fn ${fnName}(`)
  if (start < 0) return ''
  const rest = src.slice(start)
  const next = rest.search(/\nfn [a-z_]/)
  return next > 0 ? rest.slice(0, next) : rest
}
const hotLightCmds = [
  'set_nav',
  'set_default_workspace',
  'set_filters',
  'set_cluster_mode',
  'set_ui_layout',
  'reorder_workspace',
]
for (const name of hotLightCmds) {
  const body = extractFnBody(libRs, name)
  if (!body) {
    console.error(`FAIL: lib.rs 找不到热路径命令 ${name}`)
    process.exit(1)
  }
  if (!body.includes('snapshot_now_light')) {
    console.error(`FAIL: ${name} 须返回 snapshot_now_light（侧栏/过滤轻操作勿用全量快照）`)
    process.exit(1)
  }
  const withoutLight = body.replace(/snapshot_now_light\s*\([^)]*\)/g, '')
  if (/\bsnapshot_now\s*\(/.test(withoutLight)) {
    console.error(`FAIL: ${name} 仍调用 snapshot_now()；热路径须只用 snapshot_now_light`)
    process.exit(1)
  }
}
console.log('Hot-path light snapshot static checks OK')

const checkUpdatesBody = extractFnBody(libRs, 'check_network_updates')
if (!checkUpdatesBody.includes('refresh_network_heat')) {
  console.error('FAIL: check_network_updates 须顺带调用 refresh_network_heat（热度随检查更新刷新）')
  process.exit(1)
}

// 7) 官网源单层 + 拉取自愈（防回归）
const catalogRs = fs.readFileSync(path.join(root, 'src-tauri/src/network_catalog.rs'), 'utf8')
const netLibFull = fs.readFileSync(path.join(root, 'src-tauri/src/network_library.rs'), 'utf8')
if (
  netShelf.includes('collapsedCompanies') ||
  netShelf.includes('net-nav-company')
) {
  console.error('FAIL: NetworkShelf 官网段须单层（不得再含公司折叠 collapsedCompanies / net-nav-company）')
  process.exit(1)
}
for (const id of [
  'anthropics-courses',
  'anthropics-claude-cookbooks',
  'microsoft-azure-skills',
  'microsoft-generative-ai-for-beginners',
  'vercel-agent-browser',
  'vercel-skills-cli',
  'google-adk-samples',
]) {
  // POPULAR_SOURCES 条目用 p("id", ...)；RETIRED_POPULAR_IDS 常量允许出现
  const entryRe = new RegExp(`p\\(\\s*"${id}"`)
  if (entryRe.test(catalogRs)) {
    console.error(`FAIL: POPULAR_SOURCES 不得再含退役官方源 ${id}`)
    process.exit(1)
  }
}
if (!catalogRs.includes('RETIRED_POPULAR_IDS')) {
  console.error('FAIL: network_catalog 须保留 RETIRED_POPULAR_IDS（迁移清理）')
  process.exit(1)
}
if (
  !netLibFull.includes('force_remove_dir_all') ||
  !netLibFull.includes('cached_repo_state')
) {
  console.error('FAIL: network_library 须含 force_remove_dir_all 与 cached_repo_state（半成品缓存自愈）')
  process.exit(1)
}
if (
  !netLibFull.includes('fn is_transient_network_error') ||
  !netLibFull.includes('已保留本地缓存')
) {
  console.error('FAIL: network_library 须含 is_transient_network_error，且 fetch 失败网络类须保留缓存')
  process.exit(1)
}
if (
  !netLibFull.includes('fn try_skip_up_to_date') ||
  !netLibFull.includes('ls-remote') ||
  !netLibFull.includes('已是最新，已跳过下载') ||
  !netLibFull.includes('healthy_cache_same_head_skips_fetch')
) {
  console.error('FAIL: network_library 须在下载前 ls-remote 比对 HEAD，相同则跳过 fetch/clone')
  process.exit(1)
}
const fetchJobRs = fs.readFileSync(path.join(root, 'src-tauri/src/network_fetch_job.rs'), 'utf8')
if (!fetchJobRs.includes('是否有更新，必要时再下载')) {
  console.error('FAIL: network_fetch_job 准备阶段须先提示检查是否有更新')
  process.exit(1)
}
if (
  !netLibFull.includes('整仓=单技能') ||
  !netLibFull.includes('dest.join("SKILL.md").is_file()')
) {
  console.error('FAIL: network_library 须识别仓库根部 SKILL.md（整仓单技能）')
  process.exit(1)
}
for (const id of [
  'langchain-ai-langchain',
  'run-llama-llama-index',
  'geekan-metaclaw',
  'stanfordnlp-dspy',
  'browserbase-stagehand',
  'davepoon-claude-code-skills',
  'arch3rpro-skills-manager-plus',
  'hesreallyhim-awesome-claude-code',
  'voltagent-awesome-agent-skills',
  'travisvn-awesome-claude-skills',
  'behisecc-awesome-claude-skills',
  'heilcheng-awesome-agent-skills',
  'chrlsio-agent-skills',
  'composio-awesome-claude-skills',
  'antigravity-awesome-skills',
  'joaomdmoura-crewai',
  'xingkongliang-skills-manager',
  'luongnv89-agent-skill-manager',
  'eyh0602-skillshub',
  'significant-gravitas-auto-gpt',
  'jackyst0-awesome-agent-skills',
  'larksuite-cli',
  'affaan-m-ecc',
  'alirezarezvani-claude-skills',
]) {
  const entryRe = new RegExp(`p\\(\\s*"${id}"`)
  if (entryRe.test(catalogRs)) {
    console.error(`FAIL: POPULAR_SOURCES 不得再含退役源 ${id}`)
    process.exit(1)
  }
  if (!catalogRs.includes(`"${id}"`)) {
    console.error(`FAIL: RETIRED_POPULAR_IDS 须含 ${id}`)
    process.exit(1)
  }
}
if (new RegExp('p\\(\\s*"blader-humanizer"').test(catalogRs) === false) {
  console.error('FAIL: POPULAR_SOURCES 须保留 blader-humanizer（根 SKILL.md 仓）')
  process.exit(1)
}
for (const id of [
  'op7418-guizang-ppt-skill',
  'kangarooking-cangjie-skill',
  'garrytan-gstack',
  'vercel-labs-agent-browser',
]) {
  if (new RegExp(`p\\(\\s*"${id}"`).test(catalogRs) === false) {
    console.error(`FAIL: POPULAR_SOURCES 须含 ${id}`)
    process.exit(1)
  }
}
if (new RegExp('p\\(\\s*"vercel-agent-browser"').test(catalogRs)) {
  console.error('FAIL: POPULAR_SOURCES 不得再用退役官网 id vercel-agent-browser')
  process.exit(1)
}
if (!netShelf.includes("t('net.keepCacheOnFail')")) {
  console.error('FAIL: NetworkShelf 空态须注明网络故障保留本地缓存')
  process.exit(1)
}
if (
  !netShelf.includes('net-nav-cached') ||
  !netShelf.includes('net-nav-uncached') ||
  !netShelf.includes("t('net.fetchUncached')")
) {
  console.error('FAIL: NetworkShelf 须含缓存色 class 与「拉取未缓存」')
  process.exit(1)
}
if (
  !appTsx.includes('networkNavPickedIds') ||
  !appTsx.includes('onSelectNetworkNav') ||
  !appTsx.includes('e.shiftKey') ||
  !appTsx.includes('FETCH_CONCURRENCY_DEFAULT')
) {
  console.error('FAIL: App.tsx 须含侧栏 Ctrl/Shift 多选与未缓存拉取队列')
  process.exit(1)
}
if (
  !appTsx.includes('modal-scroll') ||
  !appTsx.includes('fetch-job-list') ||
  !appTsx.includes('fetch-job-cmd') ||
  !appTsx.includes("t('fetch.checkingOut')") ||
  !appTsx.includes('enqueueNetworkFetch')
) {
  console.error('FAIL: 拉取弹层须可滚（modal-scroll）且进程行默认折叠命令、全局排队')
  process.exit(1)
}
const stylesCss = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
if (
  !stylesCss.includes('.modal-scroll') ||
  !stylesCss.includes('scrollbar-gutter: stable') ||
  !stylesCss.includes('.fetch-job-cmd')
) {
  console.error('FAIL: styles.css 须含 modal-scroll gutter 与 fetch-job-cmd')
  process.exit(1)
}
const withdrawRs = fs.readFileSync(path.join(root, 'src-tauri/src/withdraw.rs'), 'utf8')
if (/source_modified:\s*None/.test(withdrawRs)) {
  console.error('FAIL: path_conflict_dto must not hardcode source_modified: None')
  process.exit(1)
}
if (!withdrawRs.includes('source_created') || !withdrawRs.includes('system_time_iso_utc')) {
  console.error('FAIL: path_conflict_dto must write created/mtime via file metadata')
  process.exit(1)
}
const sideDiff = fs.readFileSync(path.join(root, 'src/components/SideBySideDiff.tsx'), 'utf8')
if (!sideDiff.includes('conflict-file-meta') || !sideDiff.includes("t('diff.newer')")) {
  console.error('FAIL: SideBySideDiff must show file times and 较新')
  process.exit(1)
}
console.log('Conflict file-time static checks OK')

console.log('Official flatten & fetch self-heal static checks OK')

if (!bridge.includes('set_workspaces_in_work_area') && !bridge.includes('setWorkspacesInWorkArea')) {
  console.error('FAIL: setWorkspacesInWorkArea / set_workspaces_in_work_area not wired')
  process.exit(1)
}
console.log('Workspace eye bridge checks OK')

const discoveryRs = fs.readFileSync(
  path.join(root, 'src-tauri/src/project_discovery.rs'),
  'utf8',
)
if (!discoveryRs.includes('discover_projects_merged')) {
  console.error('FAIL: project_discovery missing discover_projects_merged')
  process.exit(1)
}
console.log('Project discovery module OK')

console.log('=== i18n unit tests ===')
const i18nTest = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--test', 'src/i18n/i18n.test.ts'],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(i18nTest.stdout || '')
process.stderr.write(i18nTest.stderr || '')
if (i18nTest.status !== 0) process.exit(i18nTest.status ?? 1)

console.log('=== levelCluster unit tests ===')
const levelClusterTest = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--test', 'src/lib/levelCluster.test.ts'],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(levelClusterTest.stdout || '')
process.stderr.write(levelClusterTest.stderr || '')
if (levelClusterTest.status !== 0) process.exit(levelClusterTest.status ?? 1)

console.log('=== network standby unit tests ===')
const standbyTest = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/tsx/dist/cli.mjs'), '--test', 'src/lib/networkStandby.test.ts'],
  { cwd: root, encoding: 'utf8' },
)
process.stdout.write(standbyTest.stdout || '')
process.stderr.write(standbyTest.stderr || '')
if (standbyTest.status !== 0) process.exit(standbyTest.status ?? 1)

console.log('=== cargo test ===')
// 隔离 APPDATA：库测会经 library-pointer 读写真实库设置（ccm-settings.json），
// 曾把测试临时 home 派生的容器根泄漏进真实设置，必须沙箱化。
const sandboxAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-verify-appdata-'))
const cargo = spawnSync(
  process.execPath,
  [
    path.join(root, 'scripts', 'with-cargo.mjs'),
    'cargo',
    'test',
    '--manifest-path',
    'src-tauri/Cargo.toml',
    '--lib',
    '--',
    '--test-threads=1',
  ],
  { cwd: root, encoding: 'utf8', env: { ...process.env, APPDATA: sandboxAppData } },
)
process.stdout.write(cargo.stdout || '')
process.stderr.write(cargo.stderr || '')
if (cargo.status !== 0) process.exit(cargo.status ?? 1)

console.log('\nverify:tauri passed (pure Tauri2)')
