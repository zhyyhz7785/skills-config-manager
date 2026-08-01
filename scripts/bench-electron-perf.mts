/**
 * Headless Electron-path bench (does NOT modify main repo).
 * Run via: npx tsx from CursorConfigManager cwd so deps resolve.
 *
 * Env: CCM_BENCH_LIBRARY, CCM_BENCH_SCAN, CCM_BENCH_DEPTH, CCM_BENCH_ROUNDS
 */
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MAIN_ELECTRON_SERVICES = path.resolve(
  __dirname,
  '../../CursorConfigManager/electron/services/index.ts',
)

async function loadMain() {
  const url = pathToFileURL(MAIN_ELECTRON_SERVICES).href
  return import(url)
}

function median(nums: number[]): number {
  const a = [...nums].sort((x, y) => x - y)
  const m = Math.floor(a.length / 2)
  return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}

async function main() {
  const lib = process.env.CCM_BENCH_LIBRARY?.trim()
  const scan = process.env.CCM_BENCH_SCAN?.trim()
  if (!lib || !scan) {
    console.error('CCM_BENCH_LIBRARY and CCM_BENCH_SCAN required')
    process.exit(2)
  }
  const depth = Number(process.env.CCM_BENCH_DEPTH || 5) || 5
  const rounds = Math.max(1, Number(process.env.CCM_BENCH_ROUNDS || 3) || 3)

  const {
    LibraryCatalogService,
    ProjectDiscoveryService,
    SkillScanService,
    mergeProjectsForContainerScan,
  } = await loadMain()

  const snapshotMs: number[] = []
  const scanMs: number[] = []
  let lastItemCount = 0
  let lastPending = 0

  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now()
    const catalog = new LibraryCatalogService(lib)
    catalog.load({ force: true })
    const projects = catalog.getProjects()
    snapshotMs.push(performance.now() - t0)

    const discovery = new ProjectDiscoveryService(lib)
    const scanService = new SkillScanService(catalog, '')
    scanService.setProjectScanMaxDepth(depth)

    const t1 = performance.now()
    const discovered = discovery.scan([scan], depth, projects)
    const { merged, pendingNew } = mergeProjectsForContainerScan(projects, discovered)
    const items = scanService.scanAll(merged)
    scanMs.push(performance.now() - t1)
    lastItemCount = items.length
    lastPending = pendingNew.length
  }

  const out = {
    product: 'electron-main-headless',
    note: 'LibraryCatalogService.load + ProjectDiscovery.scan + SkillScanService.scanAll (no WebView/IPC)',
    rounds,
    libraryRoot: lib,
    scanRoot: scan,
    projectScanMaxDepth: depth,
    snapshotMsMedian: median(snapshotMs),
    scanPreviewMsMedian: median(scanMs),
    lastItemCount,
    lastPendingNewProjectCount: lastPending,
    roundsRaw: snapshotMs.map((s, i) => ({
      snapshotMs: s,
      scanPreviewMs: scanMs[i],
    })),
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
