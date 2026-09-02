import type { LibraryListItemDto, NetworkNavNodeDto } from '../../shared/ipc'
import { sourceIdFromUrl } from '../../shared/networkSourceId'

/** 主列表可见：官网/用户看开眼；社区精选还须在候选池内。 */
export function isNetworkNavMainVisible(n: NetworkNavNodeDto): boolean {
  if (!n.pinned) return false
  if (n.kind === 'user' || n.isOfficialSample) return true
  return n.inCandidatePool !== false
}

/** 开眼源 id 集（侧栏主列表可见行）。 */
export function openEyeSourceIds(popular: NetworkNavNodeDto[]): Set<string> {
  return new Set(popular.filter(isNetworkNavMainVisible).map((n) => n.id))
}

/**
 * 待选库口径：无点选 = 开眼源并集；有点选 = 再与点选相交（点选只应来自开眼行）。
 * `sourceId` 可能与侧栏 id 不同，用 `primaryRepoUrl` 做别名。
 */
export function itemInStandbyLibrary(
  item: Pick<LibraryListItemDto, 'sourceId'>,
  openEyeIds: Set<string>,
  pickedIds: Set<string>,
  popular: NetworkNavNodeDto[],
): boolean {
  if (openEyeIds.size === 0) return false
  const effectivePicked =
    pickedIds.size > 0
      ? new Set([...pickedIds].filter((id) => openEyeIds.has(id)))
      : openEyeIds
  if (effectivePicked.size === 0) return false
  const sid = item.sourceId || ''
  for (const id of effectivePicked) {
    if (sid === id) return true
    const nav = popular.find((n) => n.id === id)
    const url = nav?.primaryRepoUrl?.trim()
    if (url && sid === sourceIdFromUrl(url)) return true
  }
  return false
}
