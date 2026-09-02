import { funnelTaxonomyLabels, type FunnelListItem } from './personaPhrases'

export const LEVEL_BUCKETS = ['L0', 'L1', 'L2', 'uncategorized'] as const
export type LevelBucket = (typeof LEVEL_BUCKETS)[number]

/** 网络行一律未分类；本地看台账层级。 */
export function levelBucketOf(item: {
  funnelOrigin?: string
  levelKey?: string | null
}): LevelBucket {
  if (item.funnelOrigin === 'network') return 'uncategorized'
  const k = (item.levelKey || '').trim().toUpperCase()
  if (k === 'L0' || k === 'L1' || k === 'L2') return k
  return 'uncategorized'
}

/** 规则最先，技能最后；同种再按显示名。kindLabel 中英兼容。 */
export function kindSortRank(kindLabel: string | undefined | null): number {
  const k = (kindLabel || '').trim().toLowerCase()
  if (k === '规则' || k === 'rule' || k === 'rules') return 0
  if (k === '技能' || k === 'skill' || k === 'skills') return 2
  return 1
}

export function compareKindThenName(
  a: { kindLabel?: string | null; displayName?: string | null },
  b: { kindLabel?: string | null; displayName?: string | null },
): number {
  const d = kindSortRank(a.kindLabel) - kindSortRank(b.kindLabel)
  if (d !== 0) return d
  return (a.displayName || '').localeCompare(b.displayName || '', undefined, {
    sensitivity: 'base',
  })
}

export function groupItemsByLevelBucket<
  T extends {
    funnelOrigin?: string
    levelKey?: string | null
    kindLabel?: string | null
    displayName?: string | null
  },
>(items: readonly T[]): Record<LevelBucket, T[]> {
  const buckets: Record<LevelBucket, T[]> = {
    L0: [],
    L1: [],
    L2: [],
    uncategorized: [],
  }
  for (const it of items) buckets[levelBucketOf(it)].push(it)
  return buckets
}

/** 同档内：规则在前、技能在后（不改变档与档之间的顺序）。 */
export function sortItemsInLevelBuckets<
  T extends {
    funnelOrigin?: string
    levelKey?: string | null
    kindLabel?: string | null
    displayName?: string | null
  },
>(items: readonly T[]): Record<LevelBucket, T[]> {
  const buckets = groupItemsByLevelBucket(items)
  for (const key of LEVEL_BUCKETS) {
    buckets[key] = [...buckets[key]].sort(compareKindThenName)
  }
  return buckets
}

export function sortItemsByLevelBucket<
  T extends {
    funnelOrigin?: string
    levelKey?: string | null
    kindLabel?: string | null
    displayName?: string | null
  },
>(items: readonly T[]): T[] {
  const buckets = groupItemsByLevelBucket(items)
  return [...buckets.L0, ...buckets.L1, ...buckets.L2, ...buckets.uncategorized]
}

export function displayLevelLabel(
  item: { funnelOrigin?: string; levelKey?: string | null },
  uncategorized: string,
): string {
  if (item.funnelOrigin === 'network') return uncategorized
  const k = (item.levelKey || '').trim().toUpperCase()
  if (k === 'L0' || k === 'L1' || k === 'L2') return k
  return uncategorized
}

/** 文件名后分格：人群 / 子档 / 功能 / 来源（级别另格）。 */
export type TaxonomySourceParts = {
  persona: string
  sub: string
  fn: string
  source: string
}

export function taxonomySourceParts(
  item: FunnelListItem,
  locale: 'zh-CN' | 'en',
  sourceLabel: string,
): TaxonomySourceParts {
  const tax = funnelTaxonomyLabels(item, locale)
  return {
    persona: tax.persona,
    sub: tax.sub,
    fn: tax.fn,
    source: sourceLabel,
  }
}
