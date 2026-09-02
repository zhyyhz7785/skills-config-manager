import type { LibraryListItemDto } from '../../shared/ipc'
import { annotateFunnelItem, type FunnelListItem, type FunnelOrigin } from './personaPhrases'

/** 空闲预热每块条数：约 200 条，避免一帧占满。 */
export const FUNNEL_PREFETCH_CHUNK = 200

/** 词表换刀后抬版本，避免会话内旧 personaSubs 脏缓存。origin 前缀仍给 prune 用。 */
export const FUNNEL_ANNOTATE_CACHE_VERSION = 'v3'

export function funnelAnnotateKey(
  item: Pick<LibraryListItemDto, 'entryId' | 'displayName' | 'summary' | 'sourceId'>,
  origin: FunnelOrigin,
): string {
  return `${origin}\0${item.entryId}\0${item.displayName || ''}\0${item.summary || ''}\0${item.sourceId || ''}\0${FUNNEL_ANNOTATE_CACHE_VERSION}`
}

function sameLiveFields(cached: FunnelListItem, it: LibraryListItemDto): boolean {
  const aTools = cached.originTools ?? []
  const bTools = it.originTools ?? []
  if (aTools.length !== bTools.length) return false
  for (let i = 0; i < aTools.length; i++) {
    if (aTools[i] !== bTools[i]) return false
  }
  return (
    cached.isInContainerList === it.isInContainerList &&
    cached.isInActiveUse === it.isInActiveUse &&
    cached.levelKey === it.levelKey &&
    cached.subtitle === it.subtitle &&
    cached.kindLabel === it.kindLabel
  )
}

/** 命中则只复用人群派生；容器态等快照字段始终跟当前 item。标志未变时返回同一对象。 */
export function annotateItemsCached(
  cache: Map<string, FunnelListItem>,
  items: readonly LibraryListItemDto[],
  origin: FunnelOrigin,
): FunnelListItem[] {
  const out: FunnelListItem[] = []
  for (const it of items) {
    const k = funnelAnnotateKey(it, origin)
    let cached = cache.get(k)
    if (!cached) {
      cached = annotateFunnelItem(it, origin)
      cache.set(k, cached)
      out.push(cached)
      continue
    }
    if (sameLiveFields(cached, it)) {
      out.push(cached)
      continue
    }
    const row: FunnelListItem = {
      ...it,
      funnelOrigin: origin,
      personaId: cached.personaId,
      personaPhrases: cached.personaPhrases,
      personaSubs: cached.personaSubs,
      funnelSearchHay: cached.funnelSearchHay,
    }
    cache.set(k, row)
    out.push(row)
  }
  return out
}

/** 快照换条目后丢掉不再出现的键。origin 有值时只清该来源。 */
export function pruneAnnotateCache(
  cache: Map<string, FunnelListItem>,
  liveKeys: ReadonlySet<string>,
  origin?: FunnelOrigin,
): void {
  const prefix = origin ? `${origin}\0` : ''
  for (const k of cache.keys()) {
    if (prefix && !k.startsWith(prefix)) continue
    if (!liveKeys.has(k)) cache.delete(k)
  }
}
