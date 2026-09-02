import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { t, useI18n, type I18nKey } from '../i18n'
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
  return t('typo.lineMm', {
    size: typography.fontSize.toFixed(1),
    lh: typography.lineHeight.toFixed(1),
  })
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
  const { t } = useI18n()
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
        <h2>{t('typo.title')}</h2>
        <p>{t('typo.subtitle')}</p>
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
                <span className="style-card-label">{t(`typo.style.${def.id}` as I18nKey)}</span>
                <span className="style-card-summary">{styleSummary(sample)}</span>
              </div>
              <div className="style-card-desc">{t(`typo.style.${def.id}Desc` as I18nKey)}</div>
            </button>
          )
        })}
      </div>

      <section className="typography-panel">
        <div className="typography-header">
          <h3>{t('typo.pageLayout')}</h3>
        </div>
        <div className="typo-presets">
          {(
            [
              { id: 'full' as const, label: t('typo.full') },
              { id: 'centered' as const, label: t('typo.centered') },
              { id: 'paper' as const, label: t('typo.paper') },
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
          <span className="typo-slider-label">{t('typo.contentWidth')}</span>
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
          <h3>{t('typo.settings')}</h3>
          <div className="typography-header-actions">
            <button type="button" className="typo-reset-btn" onClick={onResetTypography}>
              {t('typo.reset')}
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
          <span>{t('typo.followFont')}</span>
        </label>
        <div className="typo-presets">
          {(
            [
              { id: 'compact' as const, label: t('typo.compact') },
              { id: 'normal' as const, label: t('typo.normal') },
              { id: 'relaxed' as const, label: t('typo.relaxed') },
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
              <summary className="typo-expander-summary">{t(`typo.group.${group.id}` as I18nKey)}</summary>
              <div className="typo-group-sliders">
                {group.fields.map(({ key, min, max, step = 1 }) => {
                  const value = state.typography[key]
                  const display = formatTypographyDisplayValue(key, value)
                  return (
                    <label key={key} className="typo-slider-row">
                      <span className="typo-slider-label">{t(`typo.field.${key}` as I18nKey)}</span>
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
          <h3>{t('typo.detail')}</h3>
          <div className="typography-header-actions">
            <button type="button" className="typo-reset-btn" onClick={onResetDetail}>
              {t('typo.reset')}
            </button>
          </div>
        </div>

        <DetailExpander title={t('typo.listMarker')}>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.listMarkerFollowText}
              onChange={(e) => patchDetail({ listMarkerFollowText: e.target.checked })}
            />
            <span>{t('typo.followBodyColor')}</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.markerColor')}</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.listMarkerColor}
              disabled={detailEditable.listMarkerFollowText}
              onChange={(e) => patchDetail({ listMarkerColor: e.target.value })}
            />
          </label>
          <label className="typo-slider-row">
            <span className="typo-slider-label">{t('typo.markerScale')}</span>
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

        <DetailExpander title={t('typo.table')}>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.tableWidth')}</span>
            <select
              className="detail-select"
              value={detailEditable.tableWidthMode}
              onChange={(e) =>
                patchDetail({ tableWidthMode: e.target.value as DetailEditableFields['tableWidthMode'] })
              }
            >
              <option value="content">{t('typo.widthContent')}</option>
              <option value="full">{t('typo.full')}</option>
            </select>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.borderMode')}</span>
            <select
              className="detail-select"
              value={detailEditable.tableBorderMode}
              onChange={(e) =>
                patchDetail({ tableBorderMode: e.target.value as DetailEditableFields['tableBorderMode'] })
              }
            >
              <option value="grid">{t('typo.borderGrid')}</option>
              <option value="horizontal">{t('typo.borderHorizontal')}</option>
              <option value="booktabs">{t('typo.borderBooktabs')}</option>
            </select>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.borderColor')}</span>
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
            <span>{t('typo.zebra')}</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.tableHeaderBgEnabled}
              onChange={(e) => patchDetail({ tableHeaderBgEnabled: e.target.checked })}
            />
            <span>{t('typo.headerBg')}</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.headerColor')}</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.tableHeaderBg}
              disabled={!detailEditable.tableHeaderBgEnabled}
              onChange={(e) => patchDetail({ tableHeaderBg: e.target.value })}
            />
          </label>
        </DetailExpander>

        <DetailExpander title={t('typo.quoteLinkHr')}>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.quoteText')}</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.quoteFg}
              onChange={(e) => patchDetail({ quoteFg: e.target.value })}
            />
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.quoteBorder')}</span>
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
            <span>{t('typo.quoteItalic')}</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.linkColor')}</span>
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
            <span>{t('typo.linkUnderline')}</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.headingRuleEnabled}
              onChange={(e) => patchDetail({ headingRuleEnabled: e.target.checked })}
            />
            <span>{t('typo.headingUnderline')}</span>
          </label>
          <label className="typo-follow-row detail-check-row">
            <input
              type="checkbox"
              checked={detailEditable.hrEnabled}
              onChange={(e) => patchDetail({ hrEnabled: e.target.checked })}
            />
            <span>{t('typo.mdHr')}</span>
          </label>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.hrColor')}</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.hrColor}
              disabled={!detailEditable.hrEnabled}
              onChange={(e) => patchDetail({ hrColor: e.target.value })}
            />
          </label>
        </DetailExpander>

        <DetailExpander title={t('typo.inlineCodeBold')}>
          <label className="typo-slider-row detail-control-row">
            <span className="typo-slider-label">{t('typo.codeBg')}</span>
            <input
              type="text"
              className="detail-color"
              value={detailEditable.codeInlineBg}
              onChange={(e) => patchDetail({ codeInlineBg: e.target.value })}
            />
          </label>
          <label className="typo-slider-row">
            <span className="typo-slider-label">{t('typo.radiusMm')}</span>
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
            <span className="typo-slider-label">{t('typo.boldWeight')}</span>
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
