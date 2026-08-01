import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import type { DetailEditableFields } from '../lib/detailStyleDefs'
import {
  CONTENT_WIDTH_MM_MAX,
  CONTENT_WIDTH_MM_MIN,
  type HymdLayoutMode,
  type MdStyleState,
  applyDetailEditableChange,
  applyTypographyCustomChange,
  applyTypographyPresetChange,
  applyTypographyStyleChange,
  clampContentWidthMm,
  getDetailEditable,
  resetDetailStyle,
} from '../lib/mdStylePrefs'
import {
  TYPOGRAPHY_SLIDER_GROUPS,
  TYPOGRAPHY_STYLES,
  formatTypographyDisplayValue,
  resolveTypographyForStyle,
  roundMm,
  scaleTypographyByFont,
  type BuiltInTypographyPreset,
  type HymdTypography,
  type TypographyPreset,
} from '../lib/typographyDefs'
import './themeGallery.css'

export type ThemeGalleryPanelProps = {
  state: MdStyleState
  onChange: (next: MdStyleState) => void
}

const PERCENT_KEYS = new Set<keyof HymdTypography>([
  'headingScale',
  'h1Scale',
  'h2Scale',
  'h3Scale',
  'h4Scale',
  'h5Scale',
  'h6Scale',
  'tableFontScale',
  'blockquoteFontScale',
  'codeFontScale',
  'codeInlineFontScale',
  'footnoteFontScale',
])

const DETAIL_SLIDER_BOUNDS: Record<string, { min: number; max: number; step: number }> = {
  listMarkerFontScale: { min: 50, max: 120, step: 5 },
  codeInlineRadius: { min: 0, max: 3, step: 0.1 },
}

function styleSummary(typography: HymdTypography): string {
  return `${typography.fontSize.toFixed(1)}mm · 行 ${typography.lineHeight.toFixed(1)}mm`
}

function clampTypographyValue(key: keyof HymdTypography, raw: number, bounds: { min: number; max: number }): number {
  let v = Number(raw)
  if (!Number.isFinite(v)) v = bounds.min
  v = Math.min(bounds.max, Math.max(bounds.min, v))
  if (PERCENT_KEYS.has(key)) return Math.round(v)
  if (key === 'headingLineHeight') return Math.round(v * 100) / 100
  return roundMm(v)
}

function clampDetailSliderValue(key: string, raw: number): number {
  const bounds = DETAIL_SLIDER_BOUNDS[key]
  if (!bounds) return Number(raw)
  let v = Number(raw)
  if (!Number.isFinite(v)) v = bounds.min
  v = Math.min(bounds.max, Math.max(bounds.min, v))
  const stepped = Math.round(v / bounds.step) * bounds.step
  return Math.round(stepped * 1000) / 1000
}

function DetailExpander({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="typo-expander">
      <summary className="typo-expander-summary">{title}</summary>
      <div className="typo-group-sliders">{children}</div>
    </details>
  )
}

export function ThemeGalleryPanel({ state, onChange }: ThemeGalleryPanelProps) {
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  const detailEditable = useMemo(() => getDetailEditable(state), [state])

  const commit = useCallback(
    (next: MdStyleState) => {
      stateRef.current = next
      onChange(next)
    },
    [onChange],
  )

  const patchDetail = useCallback(
    (patch: Partial<DetailEditableFields>) => {
      const cur = stateRef.current
      const fields = { ...getDetailEditable(cur), ...patch }
      commit(applyDetailEditableChange(cur, fields))
    },
    [commit],
  )

  const onStyleCard = useCallback(
    (styleId: string) => {
      commit(applyTypographyStyleChange(stateRef.current, styleId))
    },
    [commit],
  )

  const onPreset = useCallback(
    (preset: BuiltInTypographyPreset) => {
      commit(applyTypographyPresetChange(stateRef.current, preset))
    },
    [commit],
  )

  const onTypographyField = useCallback(
    (key: keyof HymdTypography, raw: number, bounds: { min: number; max: number }) => {
      const cur = stateRef.current
      const clamped = clampTypographyValue(key, raw, bounds)
      let typography: HymdTypography
      if (cur.followFontSize && key === 'fontSize') {
        typography = scaleTypographyByFont(cur.typography, clamped)
      } else {
        typography = { ...cur.typography, [key]: clamped }
      }
      commit(applyTypographyCustomChange(cur, typography))
    },
    [commit],
  )

  const onLayoutMode = useCallback(
    (mode: HymdLayoutMode) => {
      const cur = stateRef.current
      commit({
        ...cur,
        layout: { ...cur.layout, mode },
      })
    },
    [commit],
  )

  const onLayoutWidth = useCallback(
    (raw: number) => {
      const cur = stateRef.current
      commit({
        ...cur,
        layout: { ...cur.layout, contentWidthMm: clampContentWidthMm(raw) },
      })
    },
    [commit],
  )

  const onResetTypography = useCallback(() => {
    const cur = stateRef.current
    const density: BuiltInTypographyPreset =
      cur.preset === 'custom' ? 'normal' : (cur.preset as BuiltInTypographyPreset)
    commit({
      ...cur,
      preset: density,
      typography: resolveTypographyForStyle(cur.style, density),
    })
  }, [commit])

  const onResetDetail = useCallback(() => {
    commit(resetDetailStyle(stateRef.current))
  }, [commit])

  const widthEnabled = state.layout.mode === 'centered'
  const presetActive = (id: TypographyPreset) => state.preset === id

  return (
    <div className="ccm-theme-gallery">
      <div className="gallery-header">
        <h2>排版与布局</h2>
        <p>选择排版风格与页面布局，下方可微调密度、版心与细节装饰</p>
      </div>

      <div className="style-grid">
        {TYPOGRAPHY_STYLES.map((def) => {
          const sample = resolveTypographyForStyle(def.id, 'normal')
          const active = state.style === def.id
          return (
            <button
              key={def.id}
              type="button"
              className={`style-card compact${active ? ' active' : ''}`}
              aria-pressed={active}
              onClick={() => onStyleCard(def.id)}
            >
              <div className="style-card-row">
                <span className="style-card-label">{def.label}</span>
                <span className="style-card-summary">{styleSummary(sample)}</span>
              </div>
              <div className="style-card-desc">{def.description}</div>
            </button>
          )
        })}
      </div>

      <section className="typography-panel">
        <div className="typography-header">
          <h3>页面布局</h3>
        </div>
        <div className="typo-presets">
          {(
            [
              { id: 'full' as const, label: '全宽' },
              { id: 'centered' as const, label: '长卷' },
              { id: 'paper' as const, label: '纸面' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              className={`typo-preset-btn${state.layout.mode === m.id ? ' active' : ''}`}
              onClick={() => onLayoutMode(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="typo-slider-row">
          <span className="typo-slider-label">版心宽度 (mm)</span>
          <input
            type="number"
            className="typo-slider-input"
            min={CONTENT_WIDTH_MM_MIN}
            max={CONTENT_WIDTH_MM_MAX}
            step={0.1}
            value={state.layout.contentWidthMm}
            disabled={!widthEnabled}
            onChange={(e) => onLayoutWidth(Number(e.target.value))}
          />
          <input
            type="range"
            className="typo-slider"
            min={CONTENT_WIDTH_MM_MIN}
            max={CONTENT_WIDTH_MM_MAX}
            step={0.1}
            value={state.layout.contentWidthMm}
            disabled={!widthEnabled}
            onInput={(e) => onLayoutWidth(Number((e.target as HTMLInputElement).value))}
          />
        </label>
      </section>

      <section className="typography-panel">
        <div className="typography-header">
          <h3>排版设置</h3>
          <div className="typography-header-actions">
            <button type="button" className="typo-reset-btn" onClick={onResetTypography}>
              恢复默认
            </button>
          </div>
        </div>
        <label className="typo-follow-row">
          <input
            type="checkbox"
            checked={state.followFontSize}
            onChange={(e) =>
              commit({ ...stateRef.current, followFontSize: e.target.checked })
            }
          />
          <span>跟随字高（调整字号时 mm 间距等比缩放）</span>
        </label>
        <div className="typo-presets">
          {(
            [
              { id: 'compact' as const, label: '紧凑' },
              { id: 'normal' as const, label: '适中' },
              { id: 'relaxed' as const, label: '宽松' },
            ] as const
          ).map((p) => (
            <button
              key={p.id}
              type="button"
              className={`typo-preset-btn${presetActive(p.id) ? ' active' : ''}`}
              onClick={() => onPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="typo-sliders">
          {TYPOGRAPHY_SLIDER_GROUPS.map((group) => (
            <details key={group.id} className="typo-expander" open={group.id === 'body'}>
              <summary className="typo-expander-summary">{group.title}</summary>
              <div className="typo-group-sliders">
                {group.fields.map(({ key, label, min, max, step = 1 }) => {
                  const value = state.typography[key]
                  const display = formatTypographyDisplayValue(key, value)
                  return (
                    <label key={key} className="typo-slider-row">
                      <span className="typo-slider-label">{label}</span>
                      <input
                        type="number"
                        className="typo-slider-input"
                        min={min}
                        max={max}
                        step={step}
                        value={display}
                        onChange={(e) => onTypographyField(key, Number(e.target.value), { min, max })}
                      />
                      <input
                        type="range"
                        className="typo-slider"
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onInput={(e) =>
                          onTypographyField(key, Number((e.target as HTMLInputElement).value), { min, max })
                        }
                      />
                    </label>
                  )
                })}
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="typography-panel detail-settings-panel">
        <div className="typography-header">
          <h3>细节设置</h3>
          <div className="typography-header-actions">
            <button type="button" className="typo-reset-btn" onClick={onResetDetail}>
              恢复默认
            </button>
          </div>
        </div>

        <DetailExpander title="列表 marker">
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.listMarkerFollowText}
              onChange={(e) => patchDetail({ listMarkerFollowText: e.target.checked })}
            />
            <span>跟随正文色</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">marker 色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.listMarkerColor}
              disabled={detailEditable.listMarkerFollowText}
              onChange={(e) => patchDetail({ listMarkerColor: e.target.value })}
            />
          </label>
          <label className="typo-slider-row">
            <span className="typo-slider-label">marker 字号倍率 (%)</span>
            <input
              type="number"
              className="typo-slider-input"
              min={50}
              max={120}
              step={5}
              value={detailEditable.listMarkerFontScale}
              onChange={(e) =>
                patchDetail({ listMarkerFontScale: clampDetailSliderValue('listMarkerFontScale', Number(e.target.value)) })
              }
            />
            <input
              type="range"
              className="detail-slider"
              min={50}
              max={120}
              step={5}
              value={detailEditable.listMarkerFontScale}
              onInput={(e) =>
                patchDetail({
                  listMarkerFontScale: clampDetailSliderValue(
                    'listMarkerFontScale',
                    Number((e.target as HTMLInputElement).value),
                  ),
                })
              }
            />
          </label>
        </DetailExpander>

        <DetailExpander title="表格">
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">表格宽度</span>
            <select
              className="detail-select"
              value={detailEditable.tableWidthMode}
              onChange={(e) =>
                patchDetail({ tableWidthMode: e.target.value as DetailEditableFields['tableWidthMode'] })
              }
            >
              <option value="content">按内容</option>
              <option value="full">全宽</option>
            </select>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">边框模式</span>
            <select
              className="detail-select"
              value={detailEditable.tableBorderMode}
              onChange={(e) =>
                patchDetail({ tableBorderMode: e.target.value as DetailEditableFields['tableBorderMode'] })
              }
            >
              <option value="grid">全网格</option>
              <option value="horizontal">横线</option>
              <option value="booktabs">三线表</option>
            </select>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">边框色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.tableBorderColor}
              onChange={(e) => patchDetail({ tableBorderColor: e.target.value })}
            />
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.tableZebraEnabled}
              onChange={(e) => patchDetail({ tableZebraEnabled: e.target.checked })}
            />
            <span>斑马纹</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.tableHeaderBgEnabled}
              onChange={(e) => patchDetail({ tableHeaderBgEnabled: e.target.checked })}
            />
            <span>表头底色</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">表头色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.tableHeaderBg}
              disabled={!detailEditable.tableHeaderBgEnabled}
              onChange={(e) => patchDetail({ tableHeaderBg: e.target.value })}
            />
          </label>
        </DetailExpander>

        <DetailExpander title="引用 / 链接 / 分隔线">
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">引用文字色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.quoteFg}
              onChange={(e) => patchDetail({ quoteFg: e.target.value })}
            />
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">引用边框色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.quoteBorder}
              onChange={(e) => patchDetail({ quoteBorder: e.target.value })}
            />
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.quoteItalic}
              onChange={(e) => patchDetail({ quoteItalic: e.target.checked })}
            />
            <span>引用斜体</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">链接色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.linkColor}
              onChange={(e) => patchDetail({ linkColor: e.target.value })}
            />
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.linkUnderline}
              onChange={(e) => patchDetail({ linkUnderline: e.target.checked })}
            />
            <span>链接下划线</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.headingRuleEnabled}
              onChange={(e) => patchDetail({ headingRuleEnabled: e.target.checked })}
            />
            <span>标题下划线</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.hrEnabled}
              onChange={(e) => patchDetail({ hrEnabled: e.target.checked })}
            />
            <span>Markdown 分隔线</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">分隔线色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.hrColor}
              disabled={!detailEditable.hrEnabled}
              onChange={(e) => patchDetail({ hrColor: e.target.value })}
            />
          </label>
        </DetailExpander>

        <DetailExpander title="行内 code / 加粗">
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">行内 code 底色</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.codeInlineBg}
              onChange={(e) => patchDetail({ codeInlineBg: e.target.value })}
            />
          </label>
          <label className="typo-slider-row">
            <span className="typo-slider-label">圆角 (mm)</span>
            <input
              type="number"
              className="typo-slider-input"
              min={0}
              max={3}
              step={0.1}
              value={detailEditable.codeInlineRadius}
              onChange={(e) =>
                patchDetail({ codeInlineRadius: clampDetailSliderValue('codeInlineRadius', Number(e.target.value)) })
              }
            />
            <input
              type="range"
              className="detail-slider"
              min={0}
              max={3}
              step={0.1}
              value={detailEditable.codeInlineRadius}
              onInput={(e) =>
                patchDetail({
                  codeInlineRadius: clampDetailSliderValue(
                    'codeInlineRadius',
                    Number((e.target as HTMLInputElement).value),
                  ),
                })
              }
            />
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">加粗字重</span>
            <select
              className="detail-select"
              value={detailEditable.strongWeight}
              onChange={(e) => patchDetail({ strongWeight: Number(e.target.value) as 600 | 700 })}
            >
              <option value={600}>600</option>
              <option value={700}>700</option>
            </select>
          </label>
        </DetailExpander>
      </section>
    </div>
  )
}
