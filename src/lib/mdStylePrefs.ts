/**
 * CCM 详情 Markdown 排版/布局/细节偏好（localStorage）。
 * 对应 HYmd 的 hymd.typography.* / hymd.layout.* / hymd.detailStyle.*。
 */

import {
  DEFAULT_DETAIL_STYLE,
  type DetailEditableFields,
  type DetailStyleCustom,
  buildDetailCustomFromEditable,
  resolveDetailEditableFields,
  resolveDetailStyleId,
} from './detailStyleDefs'
import {
  DEFAULT_TYPOGRAPHY_PRESET,
  DEFAULT_TYPOGRAPHY_STYLE,
  TYPOGRAPHY_LENGTH_KEYS,
  TYPOGRAPHY_SCALE_KEYS,
  isTypographyPreset,
  isTypographyStyle,
  mergeTypography,
  migrateLegacyPxTypography,
  resolveTypographyForStyle,
  resolveTypographyStyleId,
  type BuiltInTypographyPreset,
  type HymdTypography,
  type HymdTypographyStyleId,
  type TypographyPreset,
} from './typographyDefs'

export type HymdLayoutMode = 'full' | 'centered' | 'paper'

export const LAYOUT_MODE_IDS = ['full', 'centered', 'paper'] as const
export const DEFAULT_LAYOUT_MODE: HymdLayoutMode = 'centered'
export const DEFAULT_CONTENT_WIDTH_MM = 200
export const CONTENT_WIDTH_MM_MIN = 80
export const CONTENT_WIDTH_MM_MAX = 260

export interface HymdLayoutSettings {
  mode: HymdLayoutMode
  contentWidthMm: number
}

export interface MdStyleState {
  style: string
  preset: TypographyPreset
  typography: HymdTypography
  followFontSize: boolean
  detailStyle: string
  detailCustom: DetailStyleCustom
  layout: HymdLayoutSettings
}

const KEYS = {
  style: 'ccm.md.style',
  preset: 'ccm.md.preset',
  typography: 'ccm.md.typography',
  followFontSize: 'ccm.md.followFontSize',
  detailStyle: 'ccm.md.detailStyle',
  detailCustom: 'ccm.md.detailCustom',
  layoutMode: 'ccm.md.layoutMode',
  contentWidthMm: 'ccm.md.contentWidthMm',
} as const

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore quota
  }
}

export function isLayoutMode(value: string | undefined | null): value is HymdLayoutMode {
  return typeof value === 'string' && (LAYOUT_MODE_IDS as readonly string[]).includes(value)
}

export function resolveLayoutMode(value: string | undefined | null): HymdLayoutMode {
  return isLayoutMode(value) ? value : DEFAULT_LAYOUT_MODE
}

export function clampContentWidthMm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONTENT_WIDTH_MM
  const rounded = Math.round(value * 10) / 10
  return Math.min(CONTENT_WIDTH_MM_MAX, Math.max(CONTENT_WIDTH_MM_MIN, rounded))
}

export function layoutToCssVars(settings: HymdLayoutSettings): Record<string, string> {
  return {
    '--hymd-content-w-mm': String(settings.contentWidthMm),
  }
}

function resolveStyleId(raw: string | null | undefined): string {
  const value = raw ?? DEFAULT_TYPOGRAPHY_STYLE
  if (isTypographyStyle(value)) return resolveTypographyStyleId(value)
  return DEFAULT_TYPOGRAPHY_STYLE
}

function readTypographyPartial(raw: string | null): Partial<HymdTypography> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Partial<HymdTypography>
    if (!parsed || typeof parsed !== 'object') return {}
    return migrateLegacyPxTypography(parsed)
  } catch {
    return {}
  }
}

function readDetailCustom(raw: string | null): DetailStyleCustom {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as DetailStyleCustom
    if (!parsed || typeof parsed !== 'object') return {}
    return {
      light: parsed.light && typeof parsed.light === 'object' ? parsed.light : undefined,
      dark: parsed.dark && typeof parsed.dark === 'object' ? parsed.dark : undefined,
    }
  } catch {
    return {}
  }
}

/** 从 localStorage 解析完整排版/细节/布局状态 */
export function loadMdStyleState(): MdStyleState {
  const style = resolveStyleId(lsGet(KEYS.style))
  const presetRaw = lsGet(KEYS.preset) ?? DEFAULT_TYPOGRAPHY_PRESET
  const preset: TypographyPreset = isTypographyPreset(presetRaw) ? presetRaw : DEFAULT_TYPOGRAPHY_PRESET
  const followRaw = lsGet(KEYS.followFontSize)
  const followFontSize = followRaw === null ? true : followRaw !== '0' && followRaw !== 'false'
  const detailStyle = resolveDetailStyleId(lsGet(KEYS.detailStyle) ?? DEFAULT_DETAIL_STYLE)
  const detailCustom = readDetailCustom(lsGet(KEYS.detailCustom))
  const layout: HymdLayoutSettings = {
    mode: resolveLayoutMode(lsGet(KEYS.layoutMode)),
    contentWidthMm: clampContentWidthMm(Number(lsGet(KEYS.contentWidthMm) ?? DEFAULT_CONTENT_WIDTH_MM)),
  }

  if (preset !== 'custom') {
    return {
      style,
      preset,
      typography: resolveTypographyForStyle(style, preset),
      followFontSize,
      detailStyle,
      detailCustom,
      layout,
    }
  }

  const custom = readTypographyPartial(lsGet(KEYS.typography))
  return {
    style,
    preset: 'custom',
    typography: mergeTypography(resolveTypographyForStyle(style, 'normal'), custom),
    followFontSize,
    detailStyle,
    detailCustom,
    layout,
  }
}

export function saveMdStyleState(state: MdStyleState): void {
  lsSet(KEYS.style, state.style)
  lsSet(KEYS.preset, state.preset)
  lsSet(KEYS.followFontSize, state.followFontSize ? '1' : '0')
  lsSet(KEYS.detailStyle, state.detailStyle)
  lsSet(KEYS.detailCustom, JSON.stringify(state.detailCustom ?? {}))
  lsSet(KEYS.layoutMode, state.layout.mode)
  lsSet(KEYS.contentWidthMm, String(state.layout.contentWidthMm))
  if (state.preset === 'custom') {
    const partial: Partial<HymdTypography> = {}
    for (const key of [...TYPOGRAPHY_LENGTH_KEYS, ...TYPOGRAPHY_SCALE_KEYS]) {
      partial[key] = state.typography[key]
    }
    lsSet(KEYS.typography, JSON.stringify(partial))
  }
}

/** 切换内置排版卡片：沿用当前密度（custom → normal） */
export function densityForStyleChange(preset: TypographyPreset): BuiltInTypographyPreset {
  return preset === 'custom' ? 'normal' : preset
}

export function applyTypographyStyleChange(
  state: MdStyleState,
  styleId: string,
): MdStyleState {
  const density = densityForStyleChange(state.preset)
  const style = resolveStyleId(styleId)
  return {
    ...state,
    style,
    preset: density,
    typography: resolveTypographyForStyle(style, density),
    // 细节跟排版同名
    detailStyle: resolveDetailStyleId(style as HymdTypographyStyleId),
    detailCustom: {},
  }
}

export function applyTypographyPresetChange(
  state: MdStyleState,
  preset: BuiltInTypographyPreset,
): MdStyleState {
  return {
    ...state,
    preset,
    typography: resolveTypographyForStyle(state.style, preset),
  }
}

export function applyTypographyCustomChange(
  state: MdStyleState,
  typography: HymdTypography,
): MdStyleState {
  return {
    ...state,
    preset: 'custom',
    typography: { ...typography },
  }
}

export function applyDetailEditableChange(
  state: MdStyleState,
  fields: DetailEditableFields,
): MdStyleState {
  const detailCustom = buildDetailCustomFromEditable(fields, {
    style: state.detailStyle,
    custom: {},
    userStyles: [],
  })
  return { ...state, detailCustom }
}

export function resetDetailStyle(state: MdStyleState): MdStyleState {
  return { ...state, detailCustom: {} }
}

export function getDetailEditable(state: MdStyleState): DetailEditableFields {
  return resolveDetailEditableFields(
    {
      style: state.detailStyle,
      custom: state.detailCustom,
      userStyles: [],
    },
    'light',
  )
}

export function createDefaultMdStyleState(): MdStyleState {
  return {
    style: DEFAULT_TYPOGRAPHY_STYLE,
    preset: DEFAULT_TYPOGRAPHY_PRESET,
    typography: resolveTypographyForStyle(DEFAULT_TYPOGRAPHY_STYLE, DEFAULT_TYPOGRAPHY_PRESET),
    followFontSize: true,
    detailStyle: DEFAULT_DETAIL_STYLE,
    detailCustom: {},
    layout: {
      mode: DEFAULT_LAYOUT_MODE,
      contentWidthMm: DEFAULT_CONTENT_WIDTH_MM,
    },
  }
}
