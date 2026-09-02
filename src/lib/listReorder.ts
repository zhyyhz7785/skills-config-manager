/**
 * Unified pointer-drag + absolute-index reorder helpers (WebView2-safe; no HTML5 DnD).
 */

export type ReorderDirection = 'up' | 'down' | 'top' | 'bottom'

export const LIST_DRAG_THRESHOLD_PX = 5

export type ListDropHit =
  | { kind: 'item'; id: string; section: string; insert: 'before' | 'after' }
  | { kind: 'section'; section: string }

export type ListDragOver =
  | { kind: 'item'; id: string; insert: 'before' | 'after' }
  | { kind: 'section'; section: string }

/** Resolve absolute peer index from direction relative to current index. */
export function peerIndexForDirection(
  from: number,
  peerCount: number,
  direction: ReorderDirection,
): number {
  if (peerCount <= 0 || from < 0) return from
  switch (direction) {
    case 'up':
      return Math.max(0, from - 1)
    case 'down':
      return Math.min(peerCount - 1, from + 1)
    case 'top':
      return 0
    case 'bottom':
      return peerCount - 1
  }
}

/** before/after on a target peer → dest index after remove-then-insert. */
export function destIndexFromInsert(
  from: number,
  to: number,
  insert: 'before' | 'after',
  peerCount: number,
): number {
  if (from < 0 || to < 0 || peerCount <= 0) return from
  let dest = insert === 'before' ? to : to + 1
  if (from < dest) dest -= 1
  return Math.max(0, Math.min(dest, peerCount - 1))
}

/** Move `id` inside `order` to `toIndex` (in-place). Returns whether mutated. */
export function moveIdToIndex(order: string[], id: string, toIndex: number): boolean {
  const from = order.findIndex((x) => x === id || x.toLowerCase() === id.toLowerCase())
  if (from < 0) return false
  const to = Math.max(0, Math.min(toIndex, order.length - 1))
  if (from === to) return false
  const [item] = order.splice(from, 1)
  order.splice(to, 0, item!)
  return true
}

export function moveIdByDirection(
  order: string[],
  id: string,
  direction: ReorderDirection,
): boolean {
  const from = order.findIndex((x) => x === id || x.toLowerCase() === id.toLowerCase())
  if (from < 0) return false
  return moveIdToIndex(order, id, peerIndexForDirection(from, order.length, direction))
}

export function hitTestListDrop(
  clientX: number,
  clientY: number,
  attr = 'data-list-drop',
): ListDropHit | null {
  const el = document.elementFromPoint(clientX, clientY)
  if (!el || !(el instanceof Element)) return null
  const node = el.closest(`[${attr}]`)
  if (!node) return null
  const raw = node.getAttribute(attr) || ''
  if (raw.startsWith('section:')) {
    return { kind: 'section', section: raw.slice('section:'.length) }
  }
  if (raw.startsWith('item:')) {
    // item:{id}:{section}
    const rest = raw.slice('item:'.length)
    const idx = rest.lastIndexOf(':')
    if (idx <= 0) return null
    const id = rest.slice(0, idx)
    const section = rest.slice(idx + 1)
    if (!id || !section) return null
    const rect = node.getBoundingClientRect()
    const insert: 'before' | 'after' =
      clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return { kind: 'item', id, section, insert }
  }
  return null
}

export function listDropToOver(hit: ListDropHit): ListDragOver {
  if (hit.kind === 'section') return { kind: 'section', section: hit.section }
  return { kind: 'item', id: hit.id, insert: hit.insert }
}

export type MoveInSectionArgs = {
  id: string
  sourceSection: string
  targetSection: string
  /** Peer ids in target section AFTER any section-change (includes moved id). */
  peersAfterSectionChange: string[]
  targetPeerIndex?: number
  changeSection?: (id: string, targetSection: string) => Promise<void>
  moveToIndex: (id: string, toIndex: number) => Promise<void>
}

/**
 * Cross-section then absolute index. Prefer backend absolute move; this helper
 * only orchestrates section change + one moveToIndex call.
 */
export async function moveInSection(args: MoveInSectionArgs): Promise<void> {
  const {
    id,
    sourceSection,
    targetSection,
    peersAfterSectionChange,
    targetPeerIndex,
    changeSection,
    moveToIndex,
  } = args
  if (sourceSection !== targetSection) {
    if (!changeSection) return
    await changeSection(id, targetSection)
  }
  const peers = peersAfterSectionChange
  const from = peers.findIndex((x) => x === id || x.toLowerCase() === id.toLowerCase())
  if (from < 0) return
  const to =
    targetPeerIndex == null
      ? peers.length - 1
      : Math.max(0, Math.min(targetPeerIndex, peers.length - 1))
  if (from === to) return
  await moveToIndex(id, to)
}
