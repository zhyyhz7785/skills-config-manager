/**
 * 并排行级 Diff（冲突窗与详情对比页签共用）。
 */
import { useRef, useState } from 'react'
import { t, useI18n } from '../i18n'
import {
  buildDiffDisplayItems,
  buildLineDiff,
  charDiffSegments,
  pairDiffRows,
  renderDiffText,
  renderSegmentedDiffText,
  whitespaceDiffBanner,
  type DiffUnit,
} from '../lib/conflictDiff'

export type SideBySideFileMeta = {
  leftModified?: string
  rightModified?: string
  leftCreated?: string
  rightCreated?: string
  leftSize?: number
  rightSize?: number
}

export type SideBySideDiffProps = {
  leftLabel: string
  rightLabel: string
  leftPath: string
  rightPath: string
  leftComparePath?: string
  rightComparePath?: string
  leftText: string
  rightText: string
  leftHint?: string
  rightHint?: string
  /** 冲突窗传入则在各栏路径下显示修改/创建/大小；详情对比页签不传 */
  fileMeta?: SideBySideFileMeta
}

export function SideBySideDiff({
  leftLabel,
  rightLabel,
  leftPath,
  rightPath,
  leftComparePath,
  rightComparePath,
  leftText,
  rightText,
  leftHint,
  rightHint,
  fileMeta,
}: SideBySideDiffProps) {
  const { t } = useI18n()
  const rows = buildLineDiff(leftText, rightText)
  const units = pairDiffRows(rows)
  const [foldSame, setFoldSame] = useState(true)
  const [showWhitespace, setShowWhitespace] = useState(true)
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set())
  const displayItems = buildDiffDisplayItems(units, foldSame)
  const foldableCount = displayItems.filter((d) => d.type === 'fold').length
  const banner = whitespaceDiffBanner(leftText, rightText)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  const syncScroll = (from: 'left' | 'right') => {
    if (syncing.current) return
    const src = from === 'left' ? leftRef.current : rightRef.current
    const dst = from === 'left' ? rightRef.current : leftRef.current
    if (!src || !dst) return
    syncing.current = true
    dst.scrollTop = src.scrollTop
    dst.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => {
      syncing.current = false
    })
  }

  const toggleFold = (key: string) => {
    setExpandedFolds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const renderUnitLine = (side: 'left' | 'right', unit: DiffUnit, key: string) => {
    if (unit.kind === 'same') {
      const text = side === 'left' ? unit.left : unit.right
      return (
        <div key={key} className="conflict-diff-line conflict-diff-same">
          {renderDiffText(text, { showWhitespace })}
        </div>
      )
    }
    if (unit.kind === 'mod') {
      const segs = charDiffSegments(unit.left, unit.right)
      const text =
        side === 'left'
          ? renderSegmentedDiffText(segs.left, { showWhitespace, inlineKind: 'del' })
          : renderSegmentedDiffText(segs.right, { showWhitespace, inlineKind: 'add' })
      return (
        <div
          key={key}
          className={`conflict-diff-line conflict-diff-${side === 'left' ? 'del' : 'add'}`}
        >
          {text}
        </div>
      )
    }
    if (unit.kind === 'del') {
      if (side === 'right') {
        return <div key={key} className="conflict-diff-line conflict-diff-empty">{'\u00a0'}</div>
      }
      return (
        <div key={key} className="conflict-diff-line conflict-diff-del">
          {renderDiffText(unit.left, { showWhitespace })}
        </div>
      )
    }
    if (side === 'left') {
      return <div key={key} className="conflict-diff-line conflict-diff-empty">{'\u00a0'}</div>
    }
    return (
      <div key={key} className="conflict-diff-line conflict-diff-add">
        {renderDiffText(unit.right, { showWhitespace })}
      </div>
    )
  }

  const renderPane = (side: 'left' | 'right') =>
    displayItems.map((item) => {
      if (item.type === 'fold') {
        const open = expandedFolds.has(item.key)
        if (open) {
          return item.units.map((u, k) => renderUnitLine(side, u, `${side}-${item.key}-${k}`))
        }
        return (
          <button
            key={`${side}-${item.key}`}
            type="button"
            className="conflict-diff-fold"
            title={t('diff.expandSame')}
            onClick={() => toggleFold(item.key)}
          >
            {t('diff.foldedSame', { n: item.count })}
          </button>
        )
      }
      return renderUnitLine(side, item.unit, `${side}-${item.key}`)
    })

  return (
    <div className="conflict-diff">
      <div className="conflict-diff-toolbar">
        <button
          type="button"
          className={`conflict-diff-fold-toggle${foldSame ? ' is-active' : ''}`}
          disabled={units.every((u) => u.kind !== 'same')}
          title={foldSame ? t('diff.expandAllSame') : t('diff.foldSame')}
          onClick={() => {
            setFoldSame((v) => !v)
            setExpandedFolds(new Set())
          }}
        >
          {foldSame ? t('diff.expandSameArea') : t('diff.foldSameArea')}
          {foldSame && foldableCount > 0 ? t('diff.foldCount', { n: foldableCount }) : ''}
        </button>
        <button
          type="button"
          className={`conflict-diff-fold-toggle${showWhitespace ? ' is-active' : ''}`}
          title={
            showWhitespace
              ? t('diff.wsOff')
              : t('diff.wsOn')
          }
          onClick={() => setShowWhitespace((v) => !v)}
        >
          {t('diff.showWhitespace')}
        </button>
      </div>
      {banner ? (
        <div className="conflict-diff-banner" role="status">
          {banner}
        </div>
      ) : null}
      <div className="conflict-diff-heads">
        <div>
          <div className="sub">{leftLabel}</div>
          <div className="sub conflict-path">{leftPath}</div>
          {leftComparePath && leftComparePath !== leftPath ? (
            <div className="sub conflict-compare-path">{t('diff.comparePath', { path: leftComparePath })}</div>
          ) : null}
          {fileMeta ? <FileMetaLine side="left" meta={fileMeta} /> : null}
        </div>
        <div>
          <div className="sub">{rightLabel}</div>
          <div className="sub conflict-path">{rightPath}</div>
          {rightComparePath && rightComparePath !== rightPath ? (
            <div className="sub conflict-compare-path">{t('diff.comparePath', { path: rightComparePath })}</div>
          ) : null}
          {fileMeta ? <FileMetaLine side="right" meta={fileMeta} /> : null}
        </div>
      </div>
      <div className="conflict-diff-panes">
        <div className="conflict-diff-pane" ref={leftRef} onScroll={() => syncScroll('left')}>
          {renderPane('left')}
        </div>
        <div className="conflict-diff-pane" ref={rightRef} onScroll={() => syncScroll('right')}>
          {renderPane('right')}
        </div>
      </div>
      {(leftHint || rightHint) && (
        <div className="conflict-diff-hints">
          <span>{leftHint}</span>
          <span>{rightHint}</span>
        </div>
      )}
    </div>
  )
}

function formatLocalDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatFileBytes(bytes?: number): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function newerModifiedSide(leftIso?: string, rightIso?: string): 'left' | 'right' | null {
  if (!leftIso || !rightIso) return null
  const l = Date.parse(leftIso)
  const r = Date.parse(rightIso)
  if (Number.isNaN(l) || Number.isNaN(r) || l === r) return null
  return l > r ? 'left' : 'right'
}

function FileMetaLine({ side, meta }: { side: 'left' | 'right'; meta: SideBySideFileMeta }) {
  const { t } = useI18n()
  const modified = side === 'left' ? meta.leftModified : meta.rightModified
  const created = side === 'left' ? meta.leftCreated : meta.rightCreated
  const size = side === 'left' ? meta.leftSize : meta.rightSize
  const newer = newerModifiedSide(meta.leftModified, meta.rightModified) === side
  return (
    <div className="sub conflict-file-meta">
      {t('diff.modified', { time: formatLocalDateTime(modified) })}
      {newer ? <span className="conflict-file-meta-newer">{t('diff.newer')}</span> : null}
      {' · '}
      <span title={t('diff.createdHint')}>
        {t('diff.created', { time: formatLocalDateTime(created) })}
      </span>
      {' · '}
      {formatFileBytes(size)}
    </div>
  )
}
