import type { ClusterNodeDto, LibraryListItemDto } from '../../shared/ipc'

/**
 * 列表搜索过滤纯函数（H5 性能优化时从 App.tsx 提出，便于合成基准测量）。
 * q 须已 trim + toLowerCase；空格分词后每个词都须命中（AND）。
 * 匹配字段：searchText/entryId/displayName/subtitle/groupName/sourceLabel/
 * kindLabel/levelKey/intendedLevel，再拼 extraHay（人群/子档/短语/功能域词面）。
 */
export function matchesSearchQuery(item: LibraryListItemDto, q: string, extraHay = ''): boolean {
  if (!q) return true
  const hay =
    `${item.searchText || ''} ${item.entryId} ${item.displayName} ${item.subtitle} ${item.groupName} ${item.sourceLabel || ''} ${item.kindLabel || ''} ${item.levelKey || ''} ${item.intendedLevel || ''} ${extraHay}`.toLowerCase()
  const terms = q.split(/\s+/).filter(Boolean)
  return terms.every((term) => hay.includes(term))
}

export function filterItemsByQuery(
  items: LibraryListItemDto[],
  q: string,
  extraHayByEntryId?: ReadonlyMap<string, string>,
): LibraryListItemDto[] {
  return items.filter((item) =>
    matchesSearchQuery(item, q, extraHayByEntryId?.get(item.entryId) ?? ''),
  )
}

/** 按已命中的 entryId 集合裁剪聚类树；命中分组强制展开。q 为空时原样返回（与原实现一致） */
export function filterClusterTreeByIds(
  nodes: ClusterNodeDto[],
  q: string,
  keepEntryIds: ReadonlySet<string>,
): ClusterNodeDto[] {
  if (!q) return nodes
  const walk = (ns: ClusterNodeDto[]): ClusterNodeDto[] => {
    const out: ClusterNodeDto[] = []
    for (const n of ns) {
      if (n.isGroup) {
        const children = walk(n.children || [])
        if (children.length > 0) out.push({ ...n, children, isExpanded: true })
      } else if (n.entryId && keepEntryIds.has(n.entryId)) {
        out.push(n)
      }
    }
    return out
  }
  return walk(nodes)
}
