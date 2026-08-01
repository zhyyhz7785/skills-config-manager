import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import {
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from '@milkdown/kit/core'
import '@milkdown/crepe/theme/common/style.css'
import './detailMarkdown.css'
import {
  detailStyleToCssVars,
  detailToggleDataAttr,
  resolveEffectiveDetailTokens,
} from '../lib/detailStyleDefs'
import { createEnterContractProse } from '../lib/enterContract'
import {
  clearEmptyDocSeed,
  crepeDefaultMarkdown,
  ensureProseLanding,
  ensureViewWritable,
  landIfSelectionStuck,
} from '../lib/ensureProseLanding'
import { joinFrontmatter, splitFrontmatter } from '../lib/frontmatterGuard'
import {
  detectDominantEol,
  inferRemarkStringifyOptions,
  mergeSerializedEdit,
  withDominantEol,
} from '../lib/markdownMinimalMerge'
import { layoutToCssVars, type MdStyleState } from '../lib/mdStylePrefs'
import { DEFAULT_TYPOGRAPHY_RENDER_SCALE, typographyToCssVars } from '../lib/typographyDefs'
import { initVsCodeCaret } from '../lib/vscodeCaret'

// Milkdown/Crepe 是命令式编辑器，不能安全复用 React Fast Refresh 保留的实例状态。
// 开发期：本模块 dispose 或相关父/依赖热更新时整页重载；生产构建中 import.meta.hot 不存在。
if (import.meta.hot) {
  const shouldFullReload = (file: string): boolean => {
    const n = file.replace(/\\/g, '/')
    return (
      n.includes('/App.tsx') ||
      n.includes('/DetailMarkdownCrepe.tsx') ||
      n.includes('/DetailMarkdownTabHost.tsx') ||
      n.includes('/ensureProseLanding.ts') ||
      n.includes('/enterContract.ts') ||
      n.includes('/vscodeCaret.ts') ||
      n.includes('/conflictDiff.ts')
    )
  }
  import.meta.hot.dispose(() => {
    window.location.reload()
  })
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    const updates = (payload as { updates?: Array<{ path?: string }> }).updates ?? []
    if (updates.some((u) => u.path != null && shouldFullReload(u.path))) {
      window.location.reload()
    }
  })
}

export type DetailMarkdownCrepeProps = {
  /** 固定文档 id（由页签 key 保证，实例内不换文档） */
  entryId: string
  /** 仅首次 create 使用；页签保活后正文由编辑器自管 */
  fullText: string
  filePath: string
  editable: boolean
  /** 页签是否为当前激活（隐藏时不 destroy，仅失焦） */
  active: boolean
  dirty: boolean
  mdStyle: MdStyleState
  onDirtyChange: (dirty: boolean) => void
  /** 返回 true 表示保存成功 */
  onSave: (fullContent: string) => Promise<boolean>
}

type CreateFailReason = 'size' | 'error' | 'timeout'

const DEBOUNCE_MS = 220
const ZOOM_KEY = 'ccm.detailMdZoom'
const ZOOM_MIN = 0.5
const ZOOM_MAX = 3
const CREATE_TIMEOUT_MS = 8000
const DESTROY_TIMEOUT_MS = 3000
const FAIL_DETAIL_MAX = 180

const FAIL_LABEL: Record<CreateFailReason, string> = {
  size: '编辑器容器高度为 0，等待布局恢复后重试',
  error: 'Markdown 编辑器创建失败',
  timeout: 'Markdown 编辑器创建超时',
}

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10))
}

function readStoredZoom(): number {
  try {
    const raw = localStorage.getItem(ZOOM_KEY)
    if (!raw) return 1
    const n = Number(raw)
    return Number.isFinite(n) ? clampZoom(n) : 1
  } catch {
    return 1
  }
}

function splitPath(filePath: string): { fileName: string; dir: string } {
  const normalized = filePath.replace(/\//g, '\\').trim()
  if (!normalized) return { fileName: '（无文件）', dir: '' }
  const i = normalized.lastIndexOf('\\')
  if (i < 0) return { fileName: normalized, dir: '' }
  return { fileName: normalized.slice(i + 1) || normalized, dir: normalized.slice(0, i) }
}

function applyCssVars(el: HTMLElement, vars: Record<string, string>): void {
  for (const [key, value] of Object.entries(vars)) {
    el.style.setProperty(key, value)
  }
}

function hostHasLayoutSize(wrap: HTMLElement): boolean {
  if (wrap.clientHeight > 0) return true
  const panes = wrap.closest('.detail-md-tab-panes')
  if (panes instanceof HTMLElement && panes.clientHeight > 0) return true
  const slot = wrap.querySelector('.detail-md-editor-slot')
  if (slot instanceof HTMLElement && slot.clientHeight > 0) return true
  const editor = wrap.querySelector('.detail-md-editor')
  if (editor instanceof HTMLElement && editor.clientHeight > 0) return true
  return false
}

/** 宿主可见且有非零布局尺寸时才允许 create */
function canCreateInHost(wrap: HTMLElement | null): boolean {
  if (!wrap?.isConnected) return false
  if (wrap.closest('[hidden]')) return false
  const host = wrap.closest('.detail-md-host')
  if (host instanceof HTMLElement && host.hasAttribute('hidden')) return false
  const pane = wrap.closest('.detail-md-tab-pane')
  if (pane) {
    if (!pane.classList.contains('is-active')) return false
    return hostHasLayoutSize(wrap)
  }
  const style = window.getComputedStyle(wrap)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return hostHasLayoutSize(wrap)
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
    promise.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        window.clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function formatFailDetail(detail: unknown): string {
  if (detail == null) return ''
  const raw =
    detail instanceof Error
      ? detail.message || String(detail)
      : typeof detail === 'string'
        ? detail
        : String(detail)
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= FAIL_DETAIL_MAX) return oneLine
  return `${oneLine.slice(0, FAIL_DETAIL_MAX - 1)}…`
}

/** ProseMirror 在零尺寸容器里 create 后需重测，否则正文空白 */
function refreshEditorLayout(crepe: Crepe): void {
  try {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx) as {
        requestMeasure?: () => void
        dispatch: (tr: unknown) => void
        state: { tr: unknown }
        dom?: HTMLElement
      }
      view.requestMeasure?.()
      view.dispatch(view.state.tr)
      const dom = view.dom
      if (dom) {
        void dom.offsetHeight
      }
    })
  } catch {
    // layout refresh best-effort
  }
}

export function DetailMarkdownCrepe({
  entryId: _entryId,
  fullText,
  filePath,
  editable,
  active,
  dirty,
  mdStyle,
  onDirtyChange,
  onSave,
}: DetailMarkdownCrepeProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  const readyRef = useRef(false)
  /** 单飞：并发 ensureCreated 共用同一次 Promise */
  const createInflightRef = useRef<Promise<void> | null>(null)
  const disposeCaretRef = useRef<(() => void) | null>(null)
  const fmRef = useRef('')
  /** 磁盘原文正文（未序列化），写回时未改区域照抄 */
  const originalBodyRef = useRef('')
  /** create 后 getMarkdown() 基线；dirty 与此比，不与磁盘原文比 */
  const baselineMdRef = useRef('')
  const bodyRef = useRef('')
  const debounceRef = useRef<number | null>(null)
  const dirtyRef = useRef(dirty)
  const onDirtyChangeRef = useRef(onDirtyChange)
  const onSaveRef = useRef(onSave)
  const editableRef = useRef(editable)
  const activeRef = useRef(active)
  /** 首开正文：props.fullText 只在挂载时读一次 */
  const initialFullTextRef = useRef(fullText)
  const destroyChainRef = useRef(Promise.resolve())
  const createGenRef = useRef(0)
  const focusCleanupRef = useRef<(() => void) | null>(null)
  const ensureCreatedRef = useRef<(opts?: { force?: boolean }) => Promise<void>>(async () => undefined)
  const createFailRef = useRef<CreateFailReason | null>(null)
  const wasActiveRef = useRef(active)
  const hostHadSizeRef = useRef(false)
  const [zoom, setZoom] = useState(readStoredZoom)
  const [editorReady, setEditorReady] = useState(false)
  const [createFail, setCreateFail] = useState<CreateFailReason | null>(null)
  const [createFailDetail, setCreateFailDetail] = useState('')

  dirtyRef.current = dirty
  onDirtyChangeRef.current = onDirtyChange
  onSaveRef.current = onSave
  editableRef.current = editable
  activeRef.current = active
  createFailRef.current = createFail

  const { fileName, dir } = useMemo(() => splitPath(filePath), [filePath])
  const fallbackBody = useMemo(() => {
    const { body } = splitFrontmatter(initialFullTextRef.current)
    return body || initialFullTextRef.current || '（无内容）'
  }, [])

  const detailTokens = useMemo(
    () =>
      resolveEffectiveDetailTokens(mdStyle.detailStyle, 'light', mdStyle.detailCustom, []),
    [mdStyle.detailCustom, mdStyle.detailStyle],
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const renderScale = DEFAULT_TYPOGRAPHY_RENDER_SCALE * zoom
    applyCssVars(el, typographyToCssVars(mdStyle.typography, renderScale))
    applyCssVars(el, detailStyleToCssVars(detailTokens))
    applyCssVars(el, layoutToCssVars(mdStyle.layout))
    el.style.setProperty('--ccm-md-zoom', String(zoom))

    el.dataset.detailStyle = mdStyle.detailStyle
    el.dataset.tableBorder = detailTokens.tableBorderMode
    el.dataset.tableWidth = detailTokens.tableWidthMode
    el.dataset.headingRule = detailToggleDataAttr(detailTokens.headingRuleEnabled)
    el.dataset.hrVisible = detailToggleDataAttr(detailTokens.hrEnabled)
    el.dataset.layout = mdStyle.layout.mode
  }, [detailTokens, mdStyle, zoom])

  useEffect(() => {
    try {
      localStorage.setItem(ZOOM_KEY, String(zoom))
    } catch {
      // ignore quota
    }
  }, [zoom])

  useEffect(() => {
    const panel = wrapRef.current?.closest('.panel-detail') as HTMLElement | null
    if (!panel) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.1 : -0.1)))
    }
    panel.addEventListener('wheel', onWheel, { passive: false })
    return () => panel.removeEventListener('wheel', onWheel)
  }, [])

  const forceBlurEditor = useCallback((c: Crepe | null): void => {
    try {
      if (c) {
        c.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dom.blur()
        })
      }
    } catch {
      // ignore
    }
    const ae = document.activeElement
    if (ae instanceof HTMLElement) {
      const isCe = ae.isContentEditable || ae.getAttribute('contenteditable') === 'true'
      const inRoot = Boolean(rootRef.current?.contains(ae))
      if (isCe || inRoot) ae.blur()
    }
    try {
      const sink = document.createElement('input')
      sink.setAttribute('aria-hidden', 'true')
      sink.tabIndex = -1
      sink.style.cssText =
        'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0;margin:0'
      document.body.appendChild(sink)
      sink.focus({ preventScroll: true })
      sink.blur()
      sink.remove()
    } catch {
      // ignore
    }
  }, [])

  const destroyCrepe = useCallback(async () => {
    createGenRef.current += 1
    createInflightRef.current = null
    readyRef.current = false
    const run = async () => {
      focusCleanupRef.current?.()
      focusCleanupRef.current = null
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      disposeCaretRef.current?.()
      disposeCaretRef.current = null
      const c = crepeRef.current
      crepeRef.current = null
      readyRef.current = false
      if (!c) {
        if (rootRef.current) rootRef.current.innerHTML = ''
        return
      }
      try {
        forceBlurEditor(c)
        await new Promise<void>((r) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            document.removeEventListener('compositionend', onEnd, true)
            r()
          }
          const onEnd = () => finish()
          document.addEventListener('compositionend', onEnd, true)
          window.setTimeout(finish, 0)
        })
        await withTimeout(c.destroy(), DESTROY_TIMEOUT_MS, 'crepe.destroy')
      } catch (err) {
        console.error('[DetailMarkdownCrepe] destroy failed:', err)
      }
      if (rootRef.current) rootRef.current.innerHTML = ''
    }
    const chained = destroyChainRef.current.then(run, run)
    destroyChainRef.current = chained.then(
      () => undefined,
      () => undefined,
    )
    await chained
  }, [forceBlurEditor])

  // 仅组件卸载时 destroy（关页签）；不因 active/entryId 切换销毁
  useLayoutEffect(() => {
    return () => {
      createGenRef.current += 1
      createInflightRef.current = null
      readyRef.current = false
      const c = crepeRef.current
      if (c) forceBlurEditor(c)
      void destroyCrepe()
    }
  }, [forceBlurEditor, destroyCrepe])

  const restoreWritable = useCallback((opts?: { landStuck?: boolean }) => {
    const crepe = crepeRef.current
    if (!crepe || !readyRef.current) return
    if (!editableRef.current) return
    try {
      if (crepe.readonly) crepe.setReadonly(false)
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        ensureViewWritable(view)
        if (opts?.landStuck && !(view as { composing?: boolean }).composing) {
          landIfSelectionStuck(view)
        }
      })
    } catch {
      // ignore
    }
  }, [])

  const scheduleFocus = useCallback(() => {
    focusCleanupRef.current?.()
    const crepe = crepeRef.current
    if (!crepe || !readyRef.current || !editableRef.current || !activeRef.current) {
      focusCleanupRef.current = null
      return
    }

    const focusEditorIfCurrent = () => {
      if (!editableRef.current || !activeRef.current || !readyRef.current) return
      if (crepeRef.current !== crepe) return
      restoreWritable({ landStuck: false })
      try {
        crepe.editor.action((ctx) => {
          ctx.get(editorViewCtx).focus()
        })
      } catch {
        // focus best-effort
      }
    }

    let raf1 = 0
    let raf2 = 0
    const onPointerUpOnce = () => {
      focusEditorIfCurrent()
    }
    window.addEventListener('pointerup', onPointerUpOnce, { capture: true, once: true })
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        focusEditorIfCurrent()
      })
    })
    focusCleanupRef.current = () => {
      window.removeEventListener('pointerup', onPointerUpOnce, true)
      if (raf1) cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [restoreWritable])

  const normalizeEditorMarkdown = (markdown: string): string => {
    if (markdown === '\u200b' || markdown.trim() === '\u200b') return ''
    return markdown
  }

  const verifyMergedAgainstEditor = useCallback((crepe: Crepe, mergedBody: string, expected: string): boolean => {
    try {
      let round = ''
      crepe.editor.action((ctx) => {
        const parser = ctx.get(parserCtx)
        const serializer = ctx.get(serializerCtx)
        round = normalizeEditorMarkdown(serializer(parser(mergedBody)))
      })
      return round === expected
    } catch {
      return false
    }
  }, [])

  const save = useCallback(async () => {
    if (!editableRef.current) return
    if (!activeRef.current) return

    // 冲刷 debounce，避免改字后立刻 Ctrl+S 仍读到旧 dirty/body
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const crepeLive = crepeRef.current
    if (crepeLive && readyRef.current) {
      try {
        const live = normalizeEditorMarkdown(crepeLive.getMarkdown())
        bodyRef.current = live
        const nextDirty = live !== baselineMdRef.current
        if (nextDirty !== dirtyRef.current) onDirtyChangeRef.current(nextDirty)
      } catch {
        /* keep bodyRef */
      }
    }

    const serialized = normalizeEditorMarkdown(bodyRef.current)
    const baseline = baselineMdRef.current
    const original = originalBodyRef.current
    const eol = detectDominantEol(fmRef.current || original)

    let bodyToWrite = serialized
    if (baseline === serialized) {
      bodyToWrite = original
    } else {
      const merged = mergeSerializedEdit(original, baseline, serialized)
      if (merged) {
        bodyToWrite = merged.body
        const crepe = crepeRef.current
        if (crepe && readyRef.current && !verifyMergedAgainstEditor(crepe, merged.body, serialized)) {
          console.warn(
            '[DetailMarkdownCrepe] merge verify soft-fail; writing merged body to preserve original markers',
          )
        }
      } else {
        bodyToWrite = withDominantEol(serialized, eol)
        console.warn('[DetailMarkdownCrepe] merge failed; fallback to full serialized body')
      }
    }

    const full = joinFrontmatter(fmRef.current, bodyToWrite, eol)
    const ok = await onSaveRef.current(full)
    if (ok) {
      originalBodyRef.current = bodyToWrite
      bodyRef.current = serialized
      baselineMdRef.current = serialized
      onDirtyChangeRef.current(false)
    }
  }, [verifyMergedAgainstEditor])

  const reportFail = useCallback((reason: CreateFailReason, detail?: unknown) => {
    console.error(`[DetailMarkdownCrepe] create ${reason}:`, detail ?? FAIL_LABEL[reason])
    const msg = formatFailDetail(detail)
    createFailRef.current = reason
    setCreateFail(reason)
    setCreateFailDetail(msg)
    setEditorReady(false)
  }, [])

  const clearFail = useCallback(() => {
    createFailRef.current = null
    setCreateFail(null)
    setCreateFailDetail('')
  }, [])

  const runCreate = useCallback(async (): Promise<void> => {
    if (readyRef.current && crepeRef.current) {
      if (activeRef.current) {
        refreshEditorLayout(crepeRef.current)
        scheduleFocus()
      }
      return
    }
    if (!activeRef.current) return
    if (!rootRef.current || !wrapRef.current) return

    if (!canCreateInHost(wrapRef.current)) {
      if (activeRef.current) {
        const prev = createFailRef.current
        if (prev !== 'error' && prev !== 'timeout') {
          reportFail('size')
        }
      }
      return
    }

    const gen = ++createGenRef.current
    const seedText = initialFullTextRef.current

    await destroyChainRef.current.catch(() => undefined)
    if (createGenRef.current !== gen || !activeRef.current) return
    if (readyRef.current && crepeRef.current) {
      refreshEditorLayout(crepeRef.current)
      scheduleFocus()
      return
    }

    if (!canCreateInHost(wrapRef.current)) {
      reportFail('size')
      return
    }
    if (!rootRef.current) return

    if (rootRef.current.childNodes.length > 0 && !crepeRef.current) {
      rootRef.current.innerHTML = ''
    }

    const { frontmatter, body } = splitFrontmatter(seedText)
    fmRef.current = frontmatter
    originalBodyRef.current = body
    bodyRef.current = body
    baselineMdRef.current = ''
    onDirtyChangeRef.current(false)

    const defaultMarkdown = crepeDefaultMarkdown(body)
    const crepe = new Crepe({
      root: rootRef.current,
      defaultValue: defaultMarkdown,
      features: {
        [CrepeFeature.Toolbar]: editableRef.current,
        [CrepeFeature.Table]: true,
        // CCM 详情以 skill/rule 为主，默认关 Latex 降低 KaTeX 失败面
        [CrepeFeature.Latex]: false,
        [CrepeFeature.CodeMirror]: true,
        [CrepeFeature.LinkTooltip]: false,
        [CrepeFeature.ListItem]: true,
        [CrepeFeature.BlockEdit]: false,
      },
    })

    crepe.editor.config((ctx) => {
      const inferred = inferRemarkStringifyOptions(body)
      ctx.set(remarkStringifyOptionsCtx, inferred)
    })

    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown, prevMarkdown) => {
        if (markdown === prevMarkdown) return
        if (!editableRef.current) return
        if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
        debounceRef.current = window.setTimeout(() => {
          const normalized =
            markdown === '\u200b' || markdown.trim() === '\u200b' ? '' : markdown
          bodyRef.current = normalized
          const nextDirty = normalized !== baselineMdRef.current
          if (nextDirty !== dirtyRef.current) onDirtyChangeRef.current(nextDirty)
        }, DEBOUNCE_MS)
      })
    })

    crepe.editor.use(createEnterContractProse())

    if (createGenRef.current !== gen) {
      await withTimeout(crepe.destroy().catch(() => undefined), DESTROY_TIMEOUT_MS, 'crepe.destroy.abort')
      return
    }
    crepeRef.current = crepe
    try {
      await withTimeout(crepe.create(), CREATE_TIMEOUT_MS, 'crepe.create')
    } catch (err) {
      if (crepeRef.current === crepe) crepeRef.current = null
      readyRef.current = false
      try {
        await withTimeout(crepe.destroy().catch(() => undefined), DESTROY_TIMEOUT_MS, 'crepe.destroy.afterFail')
      } catch {
        // ignore
      }
      if (rootRef.current) rootRef.current.innerHTML = ''
      if (activeRef.current && createGenRef.current === gen) {
        const isTimeout = err instanceof Error && /timed out/i.test(err.message)
        reportFail(isTimeout ? 'timeout' : 'error', err)
      }
      return
    }
    if (createGenRef.current !== gen) {
      if (crepeRef.current === crepe) crepeRef.current = null
      await withTimeout(crepe.destroy().catch(() => undefined), DESTROY_TIMEOUT_MS, 'crepe.destroy.stale')
      return
    }

    try {
      await crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        if (!body.trim()) clearEmptyDocSeed(view)
        ensureProseLanding(view)
        landIfSelectionStuck(view)
      })
    } catch {
      // landing best-effort
    }
    if (createGenRef.current !== gen) {
      if (crepeRef.current === crepe) crepeRef.current = null
      await withTimeout(crepe.destroy().catch(() => undefined), DESTROY_TIMEOUT_MS, 'crepe.destroy.stale2')
      return
    }

    if (editableRef.current) {
      try {
        crepe.setReadonly(false)
        crepe.editor.action((ctx) => {
          ensureViewWritable(ctx.get(editorViewCtx))
        })
      } catch {
        // ignore
      }
    } else {
      try {
        crepe.setReadonly(true)
      } catch {
        try {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            view.setProps({ editable: () => false })
          })
        } catch {
          // readonly best-effort
        }
      }
    }

    refreshEditorLayout(crepe)

    const editorH = rootRef.current?.clientHeight ?? 0
    if (editorH === 0 && activeRef.current && createGenRef.current === gen) {
      disposeCaretRef.current?.()
      disposeCaretRef.current = null
      crepeRef.current = null
      readyRef.current = false
      await withTimeout(crepe.destroy().catch(() => undefined), DESTROY_TIMEOUT_MS, 'crepe.destroy.zeroH')
      if (rootRef.current) rootRef.current.innerHTML = ''
      reportFail('size')
      return
    }

    readyRef.current = true
    clearFail()
    setEditorReady(true)

    try {
      const md = crepe.getMarkdown()
      const normalized = md === '\u200b' || md.trim() === '\u200b' ? '' : md
      baselineMdRef.current = normalized
      bodyRef.current = normalized
      onDirtyChangeRef.current(false)
    } catch {
      baselineMdRef.current = bodyRef.current
    }

    if (rootRef.current && createGenRef.current === gen) {
      const root = rootRef.current
      disposeCaretRef.current?.()
      disposeCaretRef.current = initVsCodeCaret(root, () => crepeRef.current)

      const onFocusIn = () => {
        if (!editableRef.current || !readyRef.current || !activeRef.current) return
        restoreWritable({ landStuck: false })
      }
      root.addEventListener('focusin', onFocusIn)
      const prevDispose = disposeCaretRef.current
      disposeCaretRef.current = () => {
        root.removeEventListener('focusin', onFocusIn)
        prevDispose?.()
      }

      if (activeRef.current) scheduleFocus()
    }
  }, [restoreWritable, scheduleFocus, reportFail, clearFail])

  const ensureCreated = useCallback(
    async (opts?: { force?: boolean }) => {
      if (readyRef.current && crepeRef.current) {
        if (activeRef.current) {
          refreshEditorLayout(crepeRef.current)
          scheduleFocus()
        }
        return
      }
      if (!activeRef.current) return

      const fail = createFailRef.current
      // error/timeout：禁止自动重试，须 force（重试按钮 / 页签重新激活）
      if (!opts?.force && (fail === 'error' || fail === 'timeout')) return

      if (createInflightRef.current) {
        await createInflightRef.current
        return
      }

      const inflight = runCreate().finally(() => {
        if (createInflightRef.current === inflight) {
          createInflightRef.current = null
        }
      })
      createInflightRef.current = inflight
      await inflight
    },
    [runCreate, scheduleFocus],
  )

  ensureCreatedRef.current = ensureCreated

  const retryCreate = useCallback(() => {
    clearFail()
    void ensureCreatedRef.current({ force: true })
  }, [clearFail])

  // 尺寸驱动：仅 size 失败或尚无失败时，在 0→有尺寸 时自动再试
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const targets: HTMLElement[] = [wrap]
    const pane = wrap.closest('.detail-md-tab-pane')
    if (pane instanceof HTMLElement) targets.push(pane)
    const panes = wrap.closest('.detail-md-tab-panes')
    if (panes instanceof HTMLElement) targets.push(panes)
    const slot = wrap.querySelector('.detail-md-editor-slot')
    if (slot instanceof HTMLElement) targets.push(slot)
    const editor = wrap.querySelector('.detail-md-editor')
    if (editor instanceof HTMLElement) targets.push(editor)

    let raf = 0
    const kick = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!activeRef.current) return
        if (readyRef.current && crepeRef.current) {
          refreshEditorLayout(crepeRef.current)
          return
        }
        const hasSize = canCreateInHost(wrapRef.current)
        const grew = hasSize && !hostHadSizeRef.current
        hostHadSizeRef.current = hasSize
        if (!hasSize) return

        const fail = createFailRef.current
        if (fail === 'error' || fail === 'timeout') return
        // size：仅在尺寸恢复边沿重试；无失败时也可首次创建
        if (fail === 'size' && !grew && createInflightRef.current) return
        if (fail === 'size' && !grew) {
          // 已有尺寸且仍是 size（例如 create 后测高为 0 又回到有尺寸）：允许再试一次
          void ensureCreatedRef.current()
          return
        }
        void ensureCreatedRef.current()
      })
    }

    hostHadSizeRef.current = canCreateInHost(wrap)
    const ro = new ResizeObserver(kick)
    for (const t of targets) ro.observe(t)
    kick()

    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const crepe = crepeRef.current
    if (!crepe || !readyRef.current) return
    try {
      crepe.setReadonly(!editable)
      if (editable) {
        crepe.editor.action((ctx) => ensureViewWritable(ctx.get(editorViewCtx)))
      }
    } catch {
      // ignore
    }
  }, [editable])

  // 激活边沿：false→true 时清失败并强制创建；失活仅 blur
  useEffect(() => {
    const wasActive = wasActiveRef.current
    wasActiveRef.current = active

    if (!active) {
      focusCleanupRef.current?.()
      focusCleanupRef.current = null
      forceBlurEditor(crepeRef.current)
      return
    }

    const activated = !wasActive && active
    if (activated) {
      clearFail()
      void ensureCreated({ force: true })
    } else if (!readyRef.current) {
      // 已激活但未就绪：仅允许 size / 无失败路径（不 force，避免清掉 error）
      void ensureCreated()
    } else if (crepeRef.current) {
      refreshEditorLayout(crepeRef.current)
      scheduleFocus()
    }

    return () => {
      focusCleanupRef.current?.()
      focusCleanupRef.current = null
    }
    // 刻意不依赖 ensureCreated 身份，避免回调重建时清失败并连环重试
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, forceBlurEditor, clearFail, scheduleFocus])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return
      const el = document.activeElement
      const inEditor =
        Boolean(rootRef.current?.contains(el)) || Boolean(wrapRef.current?.contains(el))
      if (!inEditor) return
      // 全量 App 有 .panel-detail：限制在详情面板内；P3 最小壳无该节点则跳过
      const detail = document.querySelector('.panel-detail')
      if (detail && !detail.contains(el) && wrapRef.current && !detail.contains(wrapRef.current)) {
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        e.stopPropagation()
        void save()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0')) {
        e.preventDefault()
        e.stopPropagation()
        setZoom(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  const failBannerText =
    createFail && createFail !== 'size'
      ? createFailDetail
        ? `${FAIL_LABEL[createFail]}：${createFailDetail}`
        : FAIL_LABEL[createFail]
      : null

  return (
    <div className="detail-md-crepe" ref={wrapRef}>
      <div className="detail-md-docbar" title={filePath || undefined}>
        <div className="detail-md-docbar-main">
          <span className="detail-md-filename">
            {fileName}
            {dirty ? <span className="detail-md-dirty-dot" aria-label="未保存" /> : null}
          </span>
          {dir ? <span className="detail-md-dir">{dir}</span> : null}
        </div>
        <div className="detail-md-docbar-actions">
          {!editable ? <span className="detail-md-readonly">只读</span> : null}
          {editable ? (
            <button
              type="button"
              className="detail-md-save"
              title="Ctrl+S 保存"
              onClick={() => void save()}
            >
              保存
            </button>
          ) : null}
          {zoom !== 1 ? (
            <button
              type="button"
              className="detail-md-zoom"
              title="Ctrl+0 复位"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
          ) : null}
        </div>
      </div>
      {failBannerText ? (
        <div className="detail-md-create-fail" role="alert">
          <span className="detail-md-create-fail-msg" title={failBannerText}>
            {failBannerText}
          </span>
          <button type="button" className="detail-md-retry" onClick={retryCreate}>
            重试
          </button>
        </div>
      ) : null}
      <div className="detail-md-editor-slot">
        {!editorReady ? (
          <pre className="detail-md-fallback" aria-label="Markdown 只读兜底">
            {fallbackBody}
          </pre>
        ) : null}
        {/* 始终参与布局；未就绪时由兜底不透明覆盖，不用 visibility:hidden */}
        <div ref={rootRef} className="detail-md-editor milkdown-crepe" />
      </div>
    </div>
  )
}
