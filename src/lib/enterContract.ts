/**
 * Enter / 首字输入契约（精简移植自 HYmd enterContractProse）。
 * - 首字兜底：sole empty code_block / GapCursor / 空 code_block → paragraph 再写入
 * - Enter：非 code 强制拆出 paragraph（避免 schema defaultBlockAt 误出 code_block）
 */

import { $prose } from '@milkdown/kit/utils'
import { splitBlock } from '@milkdown/kit/prose/commands'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { ResolvedPos } from '@milkdown/kit/prose/model'
import { isSoleEmptyCodeBlock } from './ensureProseLanding'

function isInsideListItem($from: ResolvedPos): boolean {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'list_item') return true
  }
  return false
}

function isInsideTable($from: ResolvedPos): boolean {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'table') return true
  }
  return false
}

/** 唯一空 code_block：整篇换成带首字的 paragraph */
function typeIntoSoleEmptyCodeBlock(view: EditorView, text: string): boolean {
  if (!isSoleEmptyCodeBlock(view.state.doc)) return false
  const paraType = view.state.schema.nodes.paragraph
  const textType = view.state.schema.text
  if (!paraType || !textType) return false
  let tr = view.state.tr.replaceWith(
    0,
    view.state.doc.content.size,
    paraType.create(null, textType(text)),
  )
  try {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(1 + text.length), 1))
  } catch {
    return false
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/** GapCursor 上打字：插入 paragraph 并写入 */
function typeIntoGapCursor(view: EditorView, text: string): boolean {
  const { state } = view
  if (!(state.selection instanceof GapCursor)) return false
  const paraType = state.schema.nodes.paragraph
  const textType = state.schema.text
  if (!paraType || !textType) return false
  const pos = state.selection.head
  let tr = state.tr.insert(pos, paraType.create(null, textType(text)))
  try {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1 + text.length), 1))
  } catch {
    return false
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

/**
 * 空 code_block 内打字且 CM 未接管：将该块换成 paragraph。
 * （有意写代码时应点进 .cm-content；此处专治「光标在、键入无效」。）
 */
function typeIntoEmptyCodeBlock(view: EditorView, text: string): boolean {
  const { state } = view
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const $from = selection.$from
  if ($from.parent.type.name !== 'code_block' || $from.parent.content.size !== 0) return false
  const paraType = state.schema.nodes.paragraph
  const textType = state.schema.text
  if (!paraType || !textType) return false
  const from = $from.before()
  const to = $from.after()
  let tr = state.tr.replaceWith(from, to, paraType.create(null, textType(text)))
  try {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(from + 1 + text.length), 1))
  } catch {
    return false
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

function tryExitCodeBlock(view: EditorView): boolean {
  const { state } = view
  const { selection, schema } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const $from = selection.$from
  if ($from.parent.type.name !== 'code_block') return false
  const paraType = schema.nodes.paragraph
  if (!paraType) return false

  const afterPos = $from.after()
  let tr = state.tr
  let targetPos = afterPos
  const $after = state.doc.resolve(Math.min(afterPos, state.doc.content.size))
  const next = $after.nodeAfter
  if (!next || next.type.name === 'code_block' || next.type.name === 'table') {
    tr = tr.insert(afterPos, paraType.create())
    targetPos = afterPos
  } else if (next.isTextblock) {
    targetPos = afterPos
  } else {
    tr = tr.insert(afterPos, paraType.create())
    targetPos = afterPos
  }

  try {
    const $in = tr.doc.resolve(Math.min(targetPos + 1, tr.doc.content.size))
    const sel = TextSelection.findFrom($in, 1) ?? TextSelection.near($in, 1)
    if (sel.$from.parent.type.name === 'code_block') return false
    tr = tr.setSelection(sel)
  } catch {
    return false
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

function tryLandParagraphFromGap(view: EditorView): boolean {
  const { state } = view
  const { selection, schema } = state
  if (!(selection instanceof GapCursor)) return false
  const $pos = selection.$head
  const nearCode =
    $pos.nodeBefore?.type.name === 'code_block' || $pos.nodeAfter?.type.name === 'code_block'
  if (!nearCode && state.doc.textContent) return false

  const paraType = schema.nodes.paragraph
  if (!paraType) return false
  const pos = $pos.pos

  if ($pos.nodeAfter?.type.name === 'paragraph') {
    try {
      const sel =
        TextSelection.findFrom(state.doc.resolve(pos + 1), 1) ??
        TextSelection.near(state.doc.resolve(pos + 1), 1)
      if (sel.$from.parent.type.name === 'code_block') return false
      view.dispatch(state.tr.setSelection(sel).scrollIntoView())
      return true
    } catch {
      /* insert */
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

function tryForceParagraphEnter(view: EditorView): boolean {
  const { state } = view
  const { selection, schema } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return false

  const $from = selection.$from
  if ($from.parent.type.name === 'code_block') return false
  if (isInsideListItem($from) || isInsideTable($from)) return false
  if (!$from.parent.isTextblock) return false

  const paraType = schema.nodes.paragraph
  if (!paraType) return false

  const atEnd = $from.parentOffset >= $from.parent.content.size
  if (atEnd) {
    const insertPos = $from.after()
    let tr = state.tr.insert(insertPos, paraType.create())
    try {
      const $in = tr.doc.resolve(Math.min(insertPos + 1, tr.doc.content.size))
      const sel = TextSelection.findFrom($in, 1) ?? TextSelection.near($in, 1)
      if (sel.$from.parent.type.name === 'code_block') return false
      tr = tr.setSelection(sel)
    } catch {
      return false
    }
    view.dispatch(tr.scrollIntoView())
    return true
  }

  let did = false
  splitBlock(state, (tr) => {
    let next = tr
    const $pos = next.selection.$from
    if ($pos.parent.type.name !== 'paragraph' && $pos.parent.isTextblock) {
      next = next.setBlockType($pos.before(), $pos.after(), paraType)
    }
    view.dispatch(next.scrollIntoView())
    did = true
  })
  return did
}

function onEnter(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Enter') return false
  if (event.altKey) return false

  const mod = event.metaKey || event.ctrlKey
  const shift = event.shiftKey
  if (shift && !mod) return false

  const { selection } = view.state
  const $from = selection instanceof GapCursor ? selection.$head : selection.$from

  if (!(selection instanceof GapCursor) && isInsideListItem($from) && !mod) {
    return false
  }

  const inCode =
    !(selection instanceof GapCursor) && $from.parent.type.name === 'code_block'

  if (mod && inCode) return tryExitCodeBlock(view)
  if (inCode) return false
  if (!mod && tryLandParagraphFromGap(view)) return true
  if (!mod && tryForceParagraphEnter(view)) return true
  return false
}

function onTextInput(view: EditorView, text: string): boolean {
  if (!text) return false
  if (typeIntoSoleEmptyCodeBlock(view, text)) return true
  if (typeIntoGapCursor(view, text)) return true
  if (typeIntoEmptyCodeBlock(view, text)) return true
  return false
}

export function createEnterContractProse() {
  const pluginKey = new PluginKey('ccm-enter-contract')
  return $prose(
    () =>
      new Plugin({
        key: pluginKey,
        props: {
          handleKeyDown(view, event) {
            if (!onEnter(view, event)) return false
            event.preventDefault()
            return true
          },
          handleTextInput(view, _from, _to, text) {
            return onTextInput(view, text)
          },
        },
      }),
  )
}
