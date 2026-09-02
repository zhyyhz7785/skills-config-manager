/**
 * React host for {@link SplitViewModel} (VS Code SplitView semantics).
 * Horizontal: view | sash | view | sash | view …
 * Vertical: view / sash / view …
 *
 * Size after mount is owned internally. Pass a new `restoreKey` (e.g. from
 * settings snapshot) to re-apply `panes[].size` hints.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { LayoutPriority, SplitViewModel } from './splitview'

export type SplitOrientation = 'horizontal' | 'vertical'

export type WorkbenchSplitPane = {
  key: string
  min: number
  max?: number
  priority: LayoutPriority
  /** Applied when `restoreKey` changes or on first mount */
  size: number
  node: ReactElement
}

type Props = {
  className?: string
  orientation?: SplitOrientation
  panes: WorkbenchSplitPane[]
  /** Bump when loading persisted widths from settings */
  restoreKey?: string
  onSizesChange?: (sizes: number[]) => void
  onSashChangeEnd?: (sizes: number[]) => void
}

export { LayoutPriority }

export function WorkbenchSplit({
  className,
  orientation = 'horizontal',
  panes,
  restoreKey = '',
  onSizesChange,
  onSashChangeEnd,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const modelRef = useRef<SplitViewModel | null>(null)
  const orientationRef = useRef(orientation)
  orientationRef.current = orientation
  const [sizes, setSizes] = useState(() => panes.map((p) => p.size))
  const panesRef = useRef(panes)
  panesRef.current = panes
  const onSizesChangeRef = useRef(onSizesChange)
  const onSashChangeEndRef = useRef(onSashChangeEnd)
  onSizesChangeRef.current = onSizesChange
  onSashChangeEndRef.current = onSashChangeEnd

  const measure = (el: HTMLElement) =>
    orientationRef.current === 'vertical' ? el.clientHeight : el.clientWidth

  const buildModel = useCallback((viewSizes: number[]) => {
    const model = new SplitViewModel(1)
    model.setViews(
      panesRef.current.map((p, i) => ({
        minimumSize: p.min,
        maximumSize: p.max,
        priority: p.priority,
        size: viewSizes[i] ?? p.size,
      })),
    )
    modelRef.current = model
    return model
  }, [])

  const commit = useCallback((next: number[], end = false) => {
    setSizes(next)
    onSizesChangeRef.current?.(next)
    if (end) onSashChangeEndRef.current?.(next)
  }, [])

  const applyHints = useCallback(() => {
    const hinted = panesRef.current.map((p) => p.size)
    buildModel(hinted)
    const el = rootRef.current
    if (el) commit(modelRef.current!.layout(measure(el)))
    else setSizes(hinted)
  }, [buildModel, commit, orientation])

  const paneSignature = panes.map((p) => p.key).join('|')

  useLayoutEffect(() => {
    applyHints()
  }, [restoreKey, paneSignature, applyHints])

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const model = modelRef.current ?? buildModel(sizes)
      commit(model.layout(measure(el)))
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildModel, commit, orientation])

  const startSashDrag = (sashIndex: number, e: ReactMouseEvent) => {
    e.preventDefault()
    const vertical = orientationRef.current === 'vertical'
    const sashEl = e.currentTarget as HTMLElement
    sashEl.classList.add('is-dragging')
    document.body.classList.add('sash-dragging')
    if (vertical) document.body.classList.add('sash-dragging-ns')
    let last = vertical ? e.clientY : e.clientX
    const model = modelRef.current ?? buildModel(sizes)

    const move = (ev: MouseEvent) => {
      const pos = vertical ? ev.clientY : ev.clientX
      const d = pos - last
      last = pos
      if (d === 0) return
      commit(model.resizeSash(sashIndex, d))
    }
    const up = () => {
      sashEl.classList.remove('is-dragging')
      document.body.classList.remove('sash-dragging')
      document.body.classList.remove('sash-dragging-ns')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      commit(model.getSizes(), true)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const tracks = panes
    .map((_, i) => `${Math.max(0, Math.round(sizes[i] ?? panes[i].size))}px${i < panes.length - 1 ? ' 1px' : ''}`)
    .join(' ')
  const vertical = orientation === 'vertical'

  return (
    <div
      ref={rootRef}
      className={className}
      style={{
        display: 'grid',
        ...(vertical ? { gridTemplateRows: tracks } : { gridTemplateColumns: tracks }),
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        width: '100%',
        height: '100%',
      }}
    >
      {panes.map((pane, i) => (
        <Fragment key={pane.key}>
          {pane.node}
          {i < panes.length - 1 ? (
            <div
              className={vertical ? 'splitter splitter-ns' : 'splitter'}
              onMouseDown={(e) => startSashDrag(i, e)}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  )
}
