/**
 * SplitView sizing — adapted from VS Code
 * `src/vs/base/browser/ui/splitview/splitview.ts` (MIT).
 *
 * Behavior (proportionalLayout = false):
 * - On container resize, High-priority views absorb delta first; Low last.
 * - Sash drag resizes the two sides around the sash within min/max.
 */

export const enum LayoutPriority {
  Normal = 0,
  Low = 1,
  High = 2,
}

export type SplitViewItemOptions = {
  minimumSize: number
  maximumSize?: number
  priority?: LayoutPriority
  size: number
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/** VS Code `range(from, to)` — exclusive end; supports reverse. */
function range(from: number, to: number): number[] {
  const result: number[] = []
  if (from <= to) {
    for (let i = from; i < to; i++) result.push(i)
  } else {
    for (let i = from; i > to; i--) result.push(i)
  }
  return result
}

function pushToStart(arr: number[], value: number): void {
  const i = arr.indexOf(value)
  if (i > -1) {
    arr.splice(i, 1)
    arr.unshift(value)
  }
}

function pushToEnd(arr: number[], value: number): void {
  const i = arr.indexOf(value)
  if (i > -1) {
    arr.splice(i, 1)
    arr.push(value)
  }
}

type ViewItem = {
  minimumSize: number
  maximumSize: number
  priority: LayoutPriority
  size: number
}

export class SplitViewModel {
  private readonly views: ViewItem[] = []
  /** Content size (sum of view sizes), excluding sashes */
  private size = 0
  private readonly sashSize: number

  constructor(sashSize = 1) {
    this.sashSize = sashSize
  }

  get viewCount(): number {
    return this.views.length
  }

  getSizes(): number[] {
    return this.views.map((v) => v.size)
  }

  addView(opts: SplitViewItemOptions): void {
    const maximumSize = opts.maximumSize ?? Number.POSITIVE_INFINITY
    const minimumSize = Math.max(0, opts.minimumSize)
    const size = clamp(opts.size, minimumSize, maximumSize)
    this.views.push({
      minimumSize,
      maximumSize,
      priority: opts.priority ?? LayoutPriority.Normal,
      size,
    })
  }

  /** Replace all views (e.g. after loading persisted widths). */
  setViews(items: SplitViewItemOptions[]): void {
    this.views.length = 0
    for (const it of items) this.addView(it)
  }

  private contentSize(): number {
    return this.views.reduce((s, v) => s + v.size, 0)
  }

  private sashTotal(): number {
    return Math.max(0, this.views.length - 1) * this.sashSize
  }

  /**
   * Layout to a container width (includes sash gutters).
   * Returns view sizes after distribution.
   */
  layout(containerSize: number): number[] {
    const targetContent = Math.max(0, containerSize - this.sashTotal())
    const previousSize = Math.max(this.size, this.contentSize())
    this.size = targetContent

    const indexes = range(0, this.views.length)
    const lowPriorityIndexes = indexes.filter((i) => this.views[i].priority === LayoutPriority.Low)
    const highPriorityIndexes = indexes.filter((i) => this.views[i].priority === LayoutPriority.High)

    this.resize(this.views.length - 1, targetContent - previousSize, undefined, lowPriorityIndexes, highPriorityIndexes)
    this.distributeEmptySpace()
    return this.getSizes()
  }

  /** Drag sash between view `sashIndex` and `sashIndex + 1` by `delta` px. */
  resizeSash(sashIndex: number, delta: number): number[] {
    if (sashIndex < 0 || sashIndex >= this.views.length - 1) return this.getSizes()
    this.resize(sashIndex, delta)
    this.distributeEmptySpace()
    return this.getSizes()
  }

  private resize(
    index: number,
    delta: number,
    sizes = this.views.map((i) => i.size),
    lowPriorityIndexes?: number[],
    highPriorityIndexes?: number[],
  ): number {
    if (index < 0 || index >= this.views.length) return 0

    const upIndexes = range(index, -1)
    const downIndexes = range(index + 1, this.views.length)

    if (highPriorityIndexes) {
      for (const i of highPriorityIndexes) {
        pushToStart(upIndexes, i)
        pushToStart(downIndexes, i)
      }
    }
    if (lowPriorityIndexes) {
      for (const i of lowPriorityIndexes) {
        pushToEnd(upIndexes, i)
        pushToEnd(downIndexes, i)
      }
    }

    const upItems = upIndexes.map((i) => this.views[i])
    const upSizes = upIndexes.map((i) => sizes[i])
    const downItems = downIndexes.map((i) => this.views[i])
    const downSizes = downIndexes.map((i) => sizes[i])

    const minDeltaUp = upIndexes.reduce((r, i) => r + (this.views[i].minimumSize - sizes[i]), 0)
    const maxDeltaUp = upIndexes.reduce((r, i) => r + (this.views[i].maximumSize - sizes[i]), 0)
    const maxDeltaDown =
      downIndexes.length === 0
        ? Number.POSITIVE_INFINITY
        : downIndexes.reduce((r, i) => r + (sizes[i] - this.views[i].minimumSize), 0)
    const minDeltaDown =
      downIndexes.length === 0
        ? Number.NEGATIVE_INFINITY
        : downIndexes.reduce((r, i) => r + (sizes[i] - this.views[i].maximumSize), 0)

    delta = clamp(delta, Math.max(minDeltaUp, minDeltaDown), Math.min(maxDeltaDown, maxDeltaUp))

    for (let i = 0, deltaUp = delta; i < upItems.length; i++) {
      const item = upItems[i]
      const size = clamp(upSizes[i] + deltaUp, item.minimumSize, item.maximumSize)
      const viewDelta = size - upSizes[i]
      deltaUp -= viewDelta
      item.size = size
    }

    for (let i = 0, deltaDown = delta; i < downItems.length; i++) {
      const item = downItems[i]
      const size = clamp(downSizes[i] - deltaDown, item.minimumSize, item.maximumSize)
      const viewDelta = size - downSizes[i]
      deltaDown += viewDelta
      item.size = size
    }

    return delta
  }

  private distributeEmptySpace(): void {
    const contentSize = this.contentSize()
    let emptyDelta = this.size - contentSize

    const indexes = range(this.views.length - 1, -1)
    const lowPriorityIndexes = indexes.filter((i) => this.views[i].priority === LayoutPriority.Low)
    const highPriorityIndexes = indexes.filter((i) => this.views[i].priority === LayoutPriority.High)

    for (const index of highPriorityIndexes) pushToStart(indexes, index)
    for (const index of lowPriorityIndexes) pushToEnd(indexes, index)

    for (let i = 0; emptyDelta !== 0 && i < indexes.length; i++) {
      const item = this.views[indexes[i]]
      const size = clamp(item.size + emptyDelta, item.minimumSize, item.maximumSize)
      const viewDelta = size - item.size
      emptyDelta -= viewDelta
      item.size = size
    }
  }
}
