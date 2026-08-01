/**
 * VS Code 风格正文光标（移植自 HYmd vscodeCaret.ts）：
 * 2px 竖条 + 主题色 + 闪烁；CodeMirror 代码块内不绘制。
 * 高度按所在块级 line-height 固定，避免标题混排时随字形跳动。
 */

import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import type { EditorView } from '@milkdown/kit/prose/view'

const CARET_CLASS = 'hymd-vscode-caret'
const VISIBLE = 'hymd-vscode-caret--visible'
const BLINK = 'hymd-vscode-caret--blink'

const BLOCK_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,.ProseMirror > div,.milkdown-list-item-block'

function parseLineHeightPx(el: Element): number {
  const cs = getComputedStyle(el)
  const raw = cs.lineHeight
  const n = parseFloat(raw)
  if (Number.isFinite(n) && raw !== 'normal') return n
  const fontSize = parseFloat(cs.fontSize) || 14
  return fontSize * 1.25
}

function blockLineHeightPx(fromEl: Element | null, view?: EditorView | null): number {
  const block = fromEl?.closest(BLOCK_SELECTOR) as Element | null
  if (block) return parseLineHeightPx(block)
  const pm = fromEl?.closest('.ProseMirror')
  if (pm) return parseLineHeightPx(pm)
  if (view?.dom) return parseLineHeightPx(view.dom)
  return 22
}

function rectWithStableHeight(
  left: number,
  top: number,
  bottom: number,
  lineHeight: number,
): DOMRect {
  // 以字形盒中线为轴、用块级 line-height 定高，避免加粗/混排时 top 漂移带动竖条上下跳
  const h = Math.max(lineHeight, 2)
  const mid = (top + bottom) / 2
  return new DOMRect(left, mid - h / 2, 0, h)
}

function caretRectFromView(view: EditorView): DOMRect | null {
  const { selection } = view.state
  if (!selection.empty) return null
  if (!view.hasFocus()) return null
  try {
    const c = view.coordsAtPos(selection.head)
    let fromEl: Element | null = null
    try {
      const dom = view.domAtPos(selection.head)
      const node = dom.node
      fromEl =
        node.nodeType === Node.TEXT_NODE
          ? node.parentElement
          : (node as Element | null)
    } catch {
      fromEl = view.dom
    }
    const lh = blockLineHeightPx(fromEl, view)
    return rectWithStableHeight(c.left, c.top, c.bottom, lh)
  } catch {
    return null
  }
}

function caretRectFromSelection(sel: Selection): DOMRect | null {
  if (sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const el =
    node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element | null)
  if (!el) return null

  const lh = blockLineHeightPx(el)
  const rects = range.getClientRects()
  if (rects.length > 0) {
    const r = rects[rects.length - 1]!
    return rectWithStableHeight(r.left, r.top, r.bottom, lh)
  }
  const box = range.getBoundingClientRect()
  const parentBox = el.getBoundingClientRect()
  const x = box.left || parentBox.left
  const y = box.top || parentBox.top
  const bottom = box.height >= 2 ? box.bottom : y + lh
  return rectWithStableHeight(x, y, bottom, lh)
}

function tryGetView(crepe: Crepe | null): EditorView | null {
  if (!crepe) return null
  let view: EditorView | null = null
  try {
    crepe.editor.action((ctx) => {
      view = ctx.get(editorViewCtx)
    })
  } catch {
    return null
  }
  return view
}

function caretRectFromGapCursor(view: EditorView): DOMRect | null {
  const { selection } = view.state
  if (!(selection instanceof GapCursor)) return null
  if (!view.hasFocus()) return null
  try {
    const c = view.coordsAtPos(selection.head)
    let fromEl: Element | null = view.dom
    try {
      const dom = view.domAtPos(selection.head)
      const node = dom.node
      fromEl =
        node.nodeType === Node.TEXT_NODE
          ? node.parentElement
          : (node as Element | null) || view.dom
    } catch {
      /* keep view.dom */
    }
    const lh = blockLineHeightPx(fromEl, view)
    return rectWithStableHeight(c.left, c.top, c.bottom, lh)
  } catch {
    return null
  }
}

function showCaret(
  caret: HTMLElement,
  rect: DOMRect,
  blinkRestart: { timer: number },
): void {
  caret.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`
  caret.style.height = `${Math.round(rect.height)}px`
  caret.classList.add(VISIBLE)
  caret.classList.remove(BLINK)
  window.clearTimeout(blinkRestart.timer)
  blinkRestart.timer = window.setTimeout(() => {
    caret.classList.add(BLINK)
  }, 0)
}

export function initVsCodeCaret(
  editorRoot: HTMLElement,
  getCrepe: () => Crepe | null = () => null,
): () => void {
  const caret = document.createElement('div')
  caret.className = CARET_CLASS
  caret.setAttribute('aria-hidden', 'true')
  document.body.appendChild(caret)

  let raf = 0
  const blinkRestart = { timer: 0 }

  const hide = (): void => {
    caret.classList.remove(VISIBLE, BLINK)
    document.body.classList.remove('hymd-gapcursor-caret')
  }

  const paint = (): void => {
    const view = tryGetView(getCrepe())
    if (view) {
      const gapRect = caretRectFromGapCursor(view)
      if (gapRect && gapRect.height >= 2) {
        document.body.classList.add('hymd-gapcursor-caret')
        showCaret(caret, gapRect, blinkRestart)
        return
      }
      document.body.classList.remove('hymd-gapcursor-caret')

      const viewRect = caretRectFromView(view)
      if (viewRect && viewRect.height >= 2) {
        // 在 ProseMirror 内且非代码块时优先用 view 坐标
        const headDom = (() => {
          try {
            const d = view.domAtPos(view.state.selection.head)
            const n = d.node
            return n.nodeType === Node.TEXT_NODE
              ? n.parentElement
              : (n as Element | null)
          } catch {
            return null
          }
        })()
        if (headDom?.closest('.cm-editor, .cm-content')) {
          hide()
          return
        }
        if (headDom && editorRoot.contains(headDom)) {
          showCaret(caret, viewRect, blinkRestart)
          return
        }
      }
    } else {
      document.body.classList.remove('hymd-gapcursor-caret')
    }

    const sel = window.getSelection()
    if (!sel || !sel.isCollapsed || !sel.focusNode) {
      hide()
      return
    }

    const focusEl =
      sel.focusNode.nodeType === Node.TEXT_NODE
        ? sel.focusNode.parentElement
        : (sel.focusNode as Element | null)
    if (!focusEl || !editorRoot.contains(focusEl)) {
      hide()
      return
    }
    if (focusEl.closest('.cm-editor, .cm-content')) {
      hide()
      return
    }
    const pm = focusEl.closest('.ProseMirror')
    if (!pm) {
      hide()
      return
    }

    const ae = document.activeElement
    if (!ae || (!pm.contains(ae) && ae !== pm)) {
      hide()
      return
    }

    const rect = caretRectFromSelection(sel)
    if (!rect || rect.height < 2) {
      hide()
      return
    }

    showCaret(caret, rect, blinkRestart)
  }

  const schedule = (): void => {
    window.cancelAnimationFrame(raf)
    raf = window.requestAnimationFrame(paint)
  }

  const mo = new MutationObserver(schedule)
  mo.observe(editorRoot, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  })

  document.addEventListener('selectionchange', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('scroll', schedule, true)
  editorRoot.addEventListener('keydown', schedule, true)
  editorRoot.addEventListener('keyup', schedule)
  editorRoot.addEventListener('mousedown', schedule, true)
  editorRoot.addEventListener('mouseup', schedule)
  editorRoot.addEventListener('click', schedule, true)
  editorRoot.addEventListener('focusin', schedule)
  editorRoot.addEventListener('focusout', schedule)

  schedule()

  return () => {
    mo.disconnect()
    window.cancelAnimationFrame(raf)
    window.clearTimeout(blinkRestart.timer)
    document.removeEventListener('selectionchange', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('scroll', schedule, true)
    editorRoot.removeEventListener('keydown', schedule, true)
    editorRoot.removeEventListener('keyup', schedule)
    editorRoot.removeEventListener('mousedown', schedule, true)
    editorRoot.removeEventListener('mouseup', schedule)
    editorRoot.removeEventListener('click', schedule, true)
    editorRoot.removeEventListener('focusin', schedule)
    editorRoot.removeEventListener('focusout', schedule)
    caret.remove()
    document.body.classList.remove('hymd-gapcursor-caret')
  }
}
