/**
 * Pointer-drag reorder for flat lists (settings tables, network nav/workbench).
 * Uses hit-test via data-list-drop; no HTML5 DnD.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  LIST_DRAG_THRESHOLD_PX,
  destIndexFromInsert,
  hitTestListDrop,
  listDropToOver,
  type ListDragOver,
} from './listReorder'

export type PointerListDropResult = {
  id: string
  sourceSection: string
  targetSection: string
  toIndex: number
  targetId: string
  insert: 'before' | 'after'
}

type Session = {
  id: string
  section: string
  label: string
  startX: number
  startY: number
  active: boolean
}

export function usePointerListReorder(opts: {
  disabled?: boolean
  /** Peer ids currently in a section (ordered). */
  getPeers: (section: string) => string[]
  onDrop: (result: PointerListDropResult) => void | Promise<void>
  /** Allow drop onto a different section (e.g. pinned ↔ general). Default false. */
  allowCrossSection?: boolean
  attr?: string
  bodyClass?: string
}) {
  const {
    disabled,
    getPeers,
    onDrop,
    allowCrossSection = false,
    attr = 'data-list-drop',
    bodyClass = 'list-reordering',
  } = opts

  const sessionRef = useRef<Session | null>(null)
  const getPeersRef = useRef(getPeers)
  const onDropRef = useRef(onDrop)
  const reorderingRef = useRef(false)
  getPeersRef.current = getPeers
  onDropRef.current = onDrop

  const [dragId, setDragId] = useState<string | null>(null)
  const [dragLabel, setDragLabel] = useState('')
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null)
  const [over, setOver] = useState<ListDragOver | null>(null)
  const suppressClickRef = useRef(false)

  useEffect(() => {
    const clear = () => {
      sessionRef.current = null
      setDragId(null)
      setDragLabel('')
      setPointerPos(null)
      setOver(null)
      document.body.classList.remove(bodyClass)
    }

    const onMove = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session) return
      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (!session.active) {
        if (dx * dx + dy * dy < LIST_DRAG_THRESHOLD_PX * LIST_DRAG_THRESHOLD_PX) return
        session.active = true
        suppressClickRef.current = true
        document.body.classList.add(bodyClass)
        setDragId(session.id)
        setDragLabel(session.label)
      }
      e.preventDefault()
      setPointerPos({ x: e.clientX, y: e.clientY })
      const hit = hitTestListDrop(e.clientX, e.clientY, attr)
      if (!hit || hit.kind !== 'item' || hit.id === session.id) {
        setOver(null)
        return
      }
      if (!allowCrossSection && hit.section !== session.section) {
        setOver(null)
        return
      }
      setOver(listDropToOver(hit))
    }

    const onUp = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session) return
      const wasActive = session.active
      const id = session.id
      const sourceSection = session.section
      sessionRef.current = null
      setDragId(null)
      setDragLabel('')
      setPointerPos(null)
      setOver(null)
      document.body.classList.remove(bodyClass)
      if (!wasActive || reorderingRef.current) return
      const hit = hitTestListDrop(e.clientX, e.clientY, attr)
      if (!hit || hit.kind !== 'item' || hit.id === id) return
      if (!allowCrossSection && hit.section !== sourceSection) return
      const peers = getPeersRef.current(hit.section)
      // When staying in section, peers include source; when crossing, peers are target section
      // (source may not be present yet — append conceptually for index math).
      let order = [...peers]
      if (!order.some((x) => x === id || x.toLowerCase() === id.toLowerCase())) {
        order = [...order, id]
      }
      const from = order.findIndex((x) => x === id || x.toLowerCase() === id.toLowerCase())
      const to = order.findIndex((x) => x === hit.id || x.toLowerCase() === hit.id.toLowerCase())
      if (from < 0 || to < 0) return
      const toIndex = destIndexFromInsert(from, to, hit.insert, order.length)
      reorderingRef.current = true
      void Promise.resolve(
        onDropRef.current({
          id,
          sourceSection,
          targetSection: hit.section,
          toIndex,
          targetId: hit.id,
          insert: hit.insert,
        }),
      ).finally(() => {
        reorderingRef.current = false
      })
    }

    window.addEventListener('pointermove', onMove, { capture: true })
    window.addEventListener('pointerup', onUp, { capture: true })
    window.addEventListener('pointercancel', clear, { capture: true })
    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('pointercancel', clear, { capture: true })
      clear()
    }
  }, [allowCrossSection, attr, bodyClass])

  const onPointerDownRow = useCallback(
    (e: ReactPointerEvent, args: { id: string; section: string; label: string }) => {
      if (disabled || e.button !== 0) return
      // Don't start drag from interactive controls.
      const t = e.target
      if (t instanceof Element) {
        if (t.closest('button, input, select, textarea, a, label')) return
      }
      e.preventDefault()
      sessionRef.current = {
        id: args.id,
        section: args.section,
        label: args.label,
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      }
    },
    [disabled],
  )

  const rowPropsWithLabel = useCallback(
    (id: string, section: string, label: string, extraClass?: string) => {
      const classes = ['list-reorder-row']
      if (extraClass) classes.push(extraClass)
      if (dragId === id) classes.push('is-dragging')
      if (over?.kind === 'item' && over.id === id) {
        classes.push(over.insert === 'before' ? 'is-drop-before' : 'is-drop-after')
      }
      return {
        className: classes.join(' '),
        [attr]: `item:${id}:${section}`,
        onPointerDown: (e: ReactPointerEvent) => onPointerDownRow(e, { id, section, label }),
        onClickCapture: (e: ReactMouseEvent) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false
            e.preventDefault()
            e.stopPropagation()
          }
        },
      }
    },
    [attr, dragId, onPointerDownRow, over],
  )

  const dragGhost: ReactNode =
    dragId && pointerPos
      ? createPortal(
          <div
            className="nav-drag-ghost"
            style={{ left: pointerPos.x + 12, top: pointerPos.y + 8 }}
          >
            {dragLabel || dragId}
          </div>,
          document.body,
        )
      : null

  return {
    rowPropsWithLabel,
    dragGhost,
    isDragging: Boolean(dragId),
  }
}
