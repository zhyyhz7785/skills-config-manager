/**
 * 并排行级 Diff（冲突窗与详情对比页签共用）。
 */
import { useRef, useState } from 'react'
import {
  buildDiffDisplayItems,
  buildLineDiff,
  charDiffSegments,
  isWhitespaceOnlyDiff,
  pairDiffRows,
  renderDiffText,
  renderSegmentedDiffText,
  type DiffUnit,
} from '../lib/conflictDiff'

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
}: SideBySideDiffProps) {
  const rows = buildLineDiff(leftText, rightText)
  const units = pairDiffRows(rows)
  const [foldSame, setFoldSame] = useState(true)
  const [showWhitespace, setShowWhitespace] = useState(true)
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set())
  const displayItems = buildDiffDisplayItems(units, foldSame)
  const foldableCount = displayItems.filter((d) => d.type === 'fold').length
  const whitespaceOnly = isWhitespaceOnlyDiff(leftText, rightText)
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
            title="点击展开此段相同内容"
            onClick={() => toggleFold(item.key)}
          >
            ⋯ 已折叠 {item.count} 行相同内容（点击展开）
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
          title={foldSame ? '展开全部相同行' : '折叠连续相同行，便于查看差异'}
          onClick={() => {
            setFoldSame((v) => !v)
            setExpandedFolds(new Set())
          }}
        >
          {foldSame ? '展开相同区域' : '折叠相同区域'}
          {foldSame && foldableCount > 0 ? `（${foldableCount} 段）` : ''}
        </button>
        <button
          type="button"
          className={`conflict-diff-fold-toggle${showWhitespace ? ' is-active' : ''}`}
          title={
            showWhitespace
              ? '关闭后按原文显示空格（仍保留行级红绿）'
              : '将空格显示为 ·、Tab 显示为 →，便于看出不可见差异'
          }
          onClick={() => setShowWhitespace((v) => !v)}
        >
          显示空白
        </button>
      </div>
      {whitespaceOnly ? (
        <div className="conflict-diff-banner" role="status">
          两侧可见正文相同，差异主要为空白或行尾空格
        </div>
      ) : null}
      <div className="conflict-diff-heads">
        <div>
          <div className="sub">{leftLabel}</div>
          <div className="sub conflict-path">{leftPath}</div>
          {leftComparePath && leftComparePath !== leftPath ? (
            <div className="sub conflict-compare-path">比对：{leftComparePath}</div>
          ) : null}
        </div>
        <div>
          <div className="sub">{rightLabel}</div>
          <div className="sub conflict-path">{rightPath}</div>
          {rightComparePath && rightComparePath !== rightPath ? (
            <div className="sub conflict-compare-path">比对：{rightComparePath}</div>
          ) : null}
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
