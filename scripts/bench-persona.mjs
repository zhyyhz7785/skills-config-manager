/**
 * 漏斗派生计时（精度：performance.now，热跑中位）。
 * 用法：node scripts/bench-persona.mjs
 */
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const modUrl = pathToFileURL(resolve(root, 'src/lib/personaPhrases.ts')).href
const {
  derivePersona,
  annotateFunnelItem,
  hideLocaleMirrors,
  countByPersona,
  countPhrases,
  partitionRefine,
  partitionRefineResult,
  filterByPartition,
  filterByAssignment,
} = await import(modUrl)
const cacheUrl = pathToFileURL(resolve(root, 'src/lib/funnelAnnotateCache.ts')).href
const { annotateItemsCached } = await import(cacheUrl)

const N = Number(process.env.CCM_BENCH_N || 4000)
const ROUNDS = 5

const samples = Array.from({ length: N }, (_, i) => ({
  entryId: `net:src${i % 40}:skill-${i}`,
  displayName:
    i % 7 === 0
      ? `workflow-automation-${i}`
      : i % 5 === 0
        ? `foo-testing-${i}`
        : i % 3 === 0
          ? `azure-connector-${i}`
          : `generic-helper-${i}`,
  summary:
    i % 7 === 0
      ? 'n8n zapier automation pipeline'
      : i % 5 === 0
        ? 'tdd unit test e2e'
        : i % 3 === 0
          ? 'azure graphql webhook rest api'
          : 'helper notes and tips',
  sourceId: `src${i % 40}`,
  groupName: '',
  kindLabel: '技能',
  subtitle: '',
  isInContainerList: false,
}))

function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function time(fn) {
  const runs = []
  fn()
  for (let r = 0; r < ROUNDS; r++) {
    const t0 = performance.now()
    fn()
    runs.push(performance.now() - t0)
  }
  return { median: median(runs), runs }
}

const derive = time(() => {
  for (const it of samples) derivePersona(it)
})
const annotate = time(() => {
  const rows = samples.map((it) => annotateFunnelItem(it, 'network'))
  hideLocaleMirrors(rows)
  countByPersona(rows)
  countPhrases(rows, 'software-backend')
})

const pre = samples.map((it) => annotateFunnelItem(it, 'network'))
const chipClick = time(() => {
  pre.filter((it) => it.personaId === 'software-backend')
  countPhrases(pre, 'software-backend', 'sw-auto')
})

const partitionRefineMs = time(() => {
  partitionRefine(pre, new Set())
})
const clickRescan = partitionRefineResult(pre, new Set())
const clickId = clickRescan.chips[0]?.id ?? 'path:skills'
const filterByPartitionMs = time(() => {
  filterByPartition(pre, new Set(), clickId)
})
const assignFilterMs = time(() => {
  filterByAssignment(pre, clickRescan.assignment, clickId)
})
const filterOpenNoRefineMs = time(() => {
  pre.filter((it) => true)
})

const tableFilterOnlyMs = time(() => {
  pre.filter((it) => it.personaId === 'software-backend')
})

/** 点「网络」同步铺池：全量 annotate + 藏镜像 + 人群计数（不含短语层）。 */
const openNetwork = time(() => {
  const rows = samples.map((it) => annotateFunnelItem(it, 'network'))
  hideLocaleMirrors(rows)
  countByPersona(rows)
})

const hitCache = new Map()
annotateItemsCached(hitCache, samples, 'network')
const openNetworkCacheHit = time(() => {
  const rows = annotateItemsCached(hitCache, samples, 'network')
  hideLocaleMirrors(rows)
  countByPersona(rows)
})

console.log(
  JSON.stringify(
    {
      n: N,
      rounds: ROUNDS,
      deriveMs: derive,
      annotateFilterMs: annotate,
      chipClickMs: chipClick,
      tableFilterOnlyMs,
      openNetworkMs: openNetwork,
      openNetworkCacheHitMs: openNetworkCacheHit,
      partitionRefineMs,
      filterByPartitionMs,
      assignFilterMs,
      filterOpenNoRefineMs,
    },
    null,
    2,
  ),
)
// keep require available if tsx loader needs it
void createRequire
