/**
 * 空文档 / 卡死选区可输入落地（精简自 HYmd enterContract.ensureProseLanding）。
 * 根因：Crepe/schema 下空文件常落成唯一空 code_block；或选区停在 GapCursor /
 * 空 code_block 上时自绘 caret 仍可见但无法 TextInput。
 */

import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PmNode } from '@milkdown/kit/prose/model'

/** 零宽空格：空正文 create 时避免 Milkdown #2370 createAndFill 爆栈 */
export const EMPTY_DOC_SEED = '\u200b'

export function crepeDefaultMarkdown(initial: string): string {
  return initial.trim() ? initial : EMPTY_DOC_SEED
}

export function isSoleEmptyCodeBlock(doc: PmNode): boolean {
  return (
    doc.childCount === 1 &&
    doc.child(0).type.name === 'code_block' &&
    doc.child(0).content.size === 0
  )
}

/** create / replaceAll 空正文后：清掉 ZWSP 种子 → 空 paragraph */
export function clearEmptyDocSeed(view: EditorView): void {
  const { state } = view
  const para = state.schema.nodes.paragraph
  if (!para) return
  const text = state.doc.textContent
  if (text !== EMPTY_DOC_SEED && text.trim() !== '') return
  view.dispatch(state.tr.replaceWith(0, state.doc.content.size, para.create()).scrollIntoView())
}

function trySetTextSel(view: EditorView, pos: number): boolean {
  try {
    const sel = TextSelection.create(view.state.doc, pos)
    view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
    return true
  } catch {
    return false
  }
}

/**
 * 保证文档可输入正文：sole empty code_block → paragraph，选区落入段内。
 * 在 crepe.create 后调用。
 */
export function ensureProseLanding(view: EditorView): boolean {
  const { state } = view
  const { doc, schema, selection } = state
  const paraType = schema.nodes.paragraph
  if (!paraType) return false

  if (isSoleEmptyCodeBlock(doc)) {
    let tr = state.tr.replaceWith(0, doc.content.size, paraType.create())
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, 1))
    } catch {
      return false
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }

  if (doc.childCount === 0) {
    let tr = state.tr.insert(0, paraType.create())
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, 1))
    } catch {
      return false
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }

  if (selection instanceof GapCursor && !doc.textContent) {
    const first = doc.child(0)
    if (first?.type.name === 'paragraph') {
      if (trySetTextSel(view, 1)) return true
    }
    const pos = selection.head
    let tr = state.tr.insert(pos, paraType.create())
    try {
      const $in = tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))
      tr = tr.setSelection(TextSelection.near($in, 1))
    } catch {
      return false
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }

  return false
}

/**
 * 选区卡在不可 TextInput 位置时强制落入 paragraph：
 * - GapCursor（含贴 code_block）
 * - 空 code_block 内的 TextSelection（CM NodeView 未接管焦点时）
 */
export function landIfSelectionStuck(view: EditorView): boolean {
  if (ensureProseLanding(view)) return true

  const { state } = view
  const { selection, schema, doc } = state
  const paraType = schema.nodes.paragraph
  if (!paraType) return false

  if (selection instanceof GapCursor) {
    const pos = selection.head
    const $pos = selection.$head
    const before = $pos.nodeBefore
    const after = $pos.nodeAfter

    if (after?.type.name === 'paragraph') {
      try {
        const sel =
          TextSelection.findFrom(doc.resolve(pos + 1), 1) ??
          TextSelection.near(doc.resolve(pos + 1), 1)
        if (sel.$from.parent.type.name !== 'code_block') {
          view.dispatch(state.tr.setSelection(sel).scrollIntoView())
          return true
        }
      } catch {
        /* insert below */
      }
    }
    if (before?.type.name === 'paragraph') {
      try {
        const land = pos - 1
        const sel =
          TextSelection.findFrom(doc.resolve(Math.max(1, land)), -1) ??
          TextSelection.near(doc.resolve(Math.max(1, land)), -1)
        if (sel.$from.parent.type.name !== 'code_block') {
          view.dispatch(state.tr.setSelection(sel).scrollIntoView())
          return true
        }
      } catch {
        /* insert below */
      }
    }

    let tr = state.tr.insert(pos, paraType.create())
    try {
      const $in = tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))
      const sel = TextSelection.findFrom($in, 1) ?? TextSelection.near($in, 1)
      if (sel.$from.parent.type.name === 'code_block') return false
      tr = tr.setSelection(sel)
    } catch {
      return false
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }

  if (selection instanceof TextSelection && selection.empty) {
    const $from = selection.$from
    if ($from.parent.type.name === 'code_block' && $from.parent.content.size === 0) {
      const from = $from.before()
      const to = $from.after()
      let tr = state.tr.replaceWith(from, to, paraType.create())
      try {
        tr = tr.setSelection(TextSelection.create(tr.doc, from + 1))
      } catch {
        return false
      }
      view.dispatch(tr.scrollIntoView())
      return true
    }
  }

  return false
}

/** 强制可写：仅在 PM/DOM 实际不可写时改 props，避免每键 setProps */
export function ensureViewWritable(view: EditorView): void {
  if (!view.editable) {
    view.setProps({ editable: () => true })
  }
  if (view.dom.getAttribute('contenteditable') !== 'true') {
    view.dom.setAttribute('contenteditable', 'true')
  }
}
