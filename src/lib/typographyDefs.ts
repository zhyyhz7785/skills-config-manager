/** CSS 参考像素链：1 mm = 96/25.4 CSS px（与 @hymd/layout/geometry 保持一致） */
export const CSS_PX_PER_MM = 96 / 25.4;

/** 排版 mm 值统一舍入到 0.1 mm（人类友好；视觉与 px 等价） */
export function roundMm(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 旧版 WYSIWYG typography px → mm（0.1 mm 精度） */
export function cssPxToMm(px: number): number {
  return roundMm(px / CSS_PX_PER_MM);
}

const PERCENT_SCALE_KEYS = new Set<keyof HymdTypography>([
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
]);

/** 滑块/标签显示：% 整数；headingLineHeight 两位；mm 一位 */
export function formatTypographyDisplayValue(key: keyof HymdTypography, value: number): string {
  if (PERCENT_SCALE_KEYS.has(key)) return String(Math.round(value));
  if (key === 'headingLineHeight') return value.toFixed(2);
  return value.toFixed(1);
}

/**
 * 排版滑块 number+range 成对选择器。
 * 两段都必须带 data-key，禁止写成 `.typo-slider-input, .typo-slider[data-key=…]`
 *（后者会命中全部 number 框）。
 */
export function typographySliderPairSelector(key: string): string {
  return `.typo-slider-input[data-key="${key}"], .typo-slider[data-key="${key}"]`;
}

/**
 * 页面几何 CSS / 协议载荷（mm）。
 * 029：编辑器纸面工厂需要 height / columns / gutter，与校对 LayoutPageGeometryPayload 对齐。
 */
export interface PageGeometryCssPayload {
  series: 'A' | 'B' | 'ANSI';
  preset: string;
  elongation: number;
  orientation: 'portrait' | 'landscape';
  widthMm: number;
  heightMm: number;
  marginMm: [number, number, number, number];
  columns: number;
  gutterMm: number;
}

export const DEFAULT_PAGE_GEOMETRY_CSS: PageGeometryCssPayload = {
  series: 'A',
  preset: 'A4',
  elongation: 1,
  orientation: 'portrait',
  widthMm: 210,
  heightMm: 297,
  marginMm: [25, 20, 25, 20],
  columns: 1,
  gutterMm: 8,
};

export function pageGeometryToCssVars(p: PageGeometryCssPayload): Record<string, string> {
  return {
    '--hymd-page-w-mm': String(p.widthMm),
    '--hymd-page-h-mm': String(p.heightMm),
    '--hymd-margin-t-mm': String(p.marginMm[0]),
    '--hymd-margin-r-mm': String(p.marginMm[1]),
    '--hymd-margin-b-mm': String(p.marginMm[2]),
    '--hymd-margin-l-mm': String(p.marginMm[3]),
    '--hymd-page-columns': String(Math.max(1, p.columns)),
    '--hymd-gutter-mm': String(p.gutterMm),
  };
}

const FRONTMATTER_TYPOGRAPHY_MAP: Readonly<Record<string, keyof HymdTypography>> = {
  font_size_mm: 'fontSize',
  line_height_mm: 'lineHeight',
  paragraph_spacing_mm: 'paragraphSpacing',
  heading_top_mm: 'headingTopSpacing',
  heading_bottom_mm: 'headingBottomSpacing',
  heading_scale: 'headingScale',
  list_indent_mm: 'listIndent',
  list_marker_gap_mm: 'listMarkerGap',
  list_item_spacing_mm: 'listItemSpacing',
  list_block_spacing_mm: 'listBlockSpacing',
  table_cell_padding_y_mm: 'tableCellPaddingY',
  table_cell_padding_x_mm: 'tableCellPaddingX',
  table_spacing_mm: 'tableSpacing',
  blockquote_spacing_mm: 'blockquoteSpacing',
  code_block_padding_mm: 'codeBlockPadding',
  first_line_indent_mm: 'firstLineIndent',
  blockquote_padding_left_mm: 'blockquotePaddingLeft',
  hr_spacing_mm: 'hrSpacing',
  footnote_spacing_mm: 'footnoteSpacing',
  h1_scale: 'h1Scale',
  h2_scale: 'h2Scale',
  h3_scale: 'h3Scale',
  h4_scale: 'h4Scale',
  h5_scale: 'h5Scale',
  h6_scale: 'h6Scale',
  heading_line_height: 'headingLineHeight',
  table_font_scale: 'tableFontScale',
  blockquote_font_scale: 'blockquoteFontScale',
  code_font_scale: 'codeFontScale',
  code_inline_font_scale: 'codeInlineFontScale',
  footnote_font_scale: 'footnoteFontScale',
};

/** 从 frontmatter.typography 解析 mm 排版覆盖（非法值忽略） */
export function resolveFrontmatterTypography(
  frontmatter: Record<string, unknown> | undefined,
): Partial<HymdTypography> {
  const raw = frontmatter?.typography;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<HymdTypography> = {};
  for (const [snake, key] of Object.entries(FRONTMATTER_TYPOGRAPHY_MAP)) {
    const v = obj[snake];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    if (PERCENT_SCALE_KEYS.has(key)) {
      if (v <= 300) out[key] = v;
    } else if (key === 'headingLineHeight') {
      if (v <= 5) out[key] = v;
    } else {
      out[key] = roundMm(v);
    }
  }
  return out;
}

function mmToPxLocal(mm: number, scale: number): number {
  return mm * scale;
}

/** 排版数值单位：mm（语义层真相源；渲染时经 typographyToCssVars 换算为 px） */
export interface HymdTypography {
  /** 正文字号 (mm) */
  fontSize: number;
  /** 行高 (mm) */
  lineHeight: number;
  /** 段距 (mm) */
  paragraphSpacing: number;
  /** 标题上间距 (mm) */
  headingTopSpacing: number;
  /** 标题下间距 (mm) */
  headingBottomSpacing: number;
  /** 100 = 默认全局标题倍率 */
  headingScale: number;
  /** 列表缩进 (mm) */
  listIndent: number;
  /** bullet 与正文间距 (mm) */
  listMarkerGap: number;
  /** 列表项间距 (mm) */
  listItemSpacing: number;
  /** 列表块间距 (mm) */
  listBlockSpacing: number;
  /** 表格单元格上下 (mm) */
  tableCellPaddingY: number;
  /** 表格单元格左右 (mm) */
  tableCellPaddingX: number;
  /** 表格外间距 (mm) */
  tableSpacing: number;
  /** 引用块间距 (mm) */
  blockquoteSpacing: number;
  /** 代码块内边距 (mm) */
  codeBlockPadding: number;
  /** 首行缩进 (mm) */
  firstLineIndent: number;
  /** 引用左内边距 (mm) */
  blockquotePaddingLeft: number;
  /** 分隔线上下间距 (mm) */
  hrSpacing: number;
  /** 脚注间距 (mm) */
  footnoteSpacing: number;
  /** H1–H6 字号倍率 (%) */
  h1Scale: number;
  h2Scale: number;
  h3Scale: number;
  h4Scale: number;
  h5Scale: number;
  h6Scale: number;
  /** 标题行高（无单位倍率） */
  headingLineHeight: number;
  /** 表格/引用/代码/脚注字号倍率 (%) */
  tableFontScale: number;
  blockquoteFontScale: number;
  codeFontScale: number;
  codeInlineFontScale: number;
  footnoteFontScale: number;
}

export type TypographyPreset = 'compact' | 'normal' | 'relaxed' | 'custom';

export const TYPOGRAPHY_PRESET_IDS = ['compact', 'normal', 'relaxed'] as const;

export type BuiltInTypographyPreset = (typeof TYPOGRAPHY_PRESET_IDS)[number];

/** mm 长度字段（跟随字高缩放；legacy px 迁移） */
export const TYPOGRAPHY_LENGTH_KEYS: ReadonlyArray<keyof HymdTypography> = [
  'fontSize',
  'lineHeight',
  'paragraphSpacing',
  'headingTopSpacing',
  'headingBottomSpacing',
  'listIndent',
  'listMarkerGap',
  'listItemSpacing',
  'listBlockSpacing',
  'tableCellPaddingY',
  'tableCellPaddingX',
  'tableSpacing',
  'blockquoteSpacing',
  'codeBlockPadding',
  'firstLineIndent',
  'blockquotePaddingLeft',
  'hrSpacing',
  'footnoteSpacing',
];

/** % / 无单位倍率字段（不随字号缩放） */
export const TYPOGRAPHY_SCALE_KEYS: ReadonlyArray<keyof HymdTypography> = [
  'headingScale',
  'h1Scale',
  'h2Scale',
  'h3Scale',
  'h4Scale',
  'h5Scale',
  'h6Scale',
  'headingLineHeight',
  'tableFontScale',
  'blockquoteFontScale',
  'codeFontScale',
  'codeInlineFontScale',
  'footnoteFontScale',
];

const DEFAULT_SCALE_FIELDS: Pick<
  HymdTypography,
  | 'h1Scale'
  | 'h2Scale'
  | 'h3Scale'
  | 'h4Scale'
  | 'h5Scale'
  | 'h6Scale'
  | 'headingLineHeight'
  | 'tableFontScale'
  | 'blockquoteFontScale'
  | 'codeFontScale'
  | 'codeInlineFontScale'
  | 'footnoteFontScale'
> = {
  h1Scale: 200,
  h2Scale: 150,
  h3Scale: 125,
  h4Scale: 100,
  h5Scale: 87.5,
  h6Scale: 85,
  headingLineHeight: 1.25,
  tableFontScale: 100,
  blockquoteFontScale: 100,
  codeFontScale: 100,
  codeInlineFontScale: 100,
  footnoteFontScale: 80,
};

/** github preset（Typora GitHub 主题对齐）；定义见文件尾（由 github 比率派生） */

/** 旧 custom 配置若 fontSize > 8，判定为 legacy px 口径 */
export function isLegacyPxTypography(partial: Partial<HymdTypography>): boolean {
  const fs = partial.fontSize;
  return fs !== undefined && fs > 8;
}

/** 将 legacy px custom 配置批量转为 mm */
export function migrateLegacyPxTypography(partial: Partial<HymdTypography>): Partial<HymdTypography> {
  if (!isLegacyPxTypography(partial)) return partial;
  const out: Partial<HymdTypography> = { ...partial };
  for (const key of TYPOGRAPHY_LENGTH_KEYS) {
    const v = out[key];
    if (typeof v === 'number') out[key] = cssPxToMm(v);
  }
  return out;
}

export type TypographySliderField = {
  key: keyof HymdTypography;
  label: string;
  min: number;
  max: number;
  step?: number;
};

export const TYPOGRAPHY_SLIDER_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  fields: ReadonlyArray<TypographySliderField>;
}> = [
  {
    id: 'body',
    title: '正文',
    fields: [
      { key: 'fontSize', label: '字号 (mm)', min: 0, max: 8, step: 0.1 },
      { key: 'lineHeight', label: '行高 (mm)', min: 0, max: 15, step: 0.1 },
      { key: 'paragraphSpacing', label: '段距 (mm)', min: 0, max: 12, step: 0.1 },
      { key: 'firstLineIndent', label: '首行缩进 (mm)', min: 0, max: 16, step: 0.1 },
    ],
  },
  {
    id: 'heading',
    title: '标题',
    fields: [
      { key: 'headingTopSpacing', label: '上间距 (mm)', min: 0, max: 16, step: 0.1 },
      { key: 'headingBottomSpacing', label: '下间距 (mm)', min: 0, max: 12, step: 0.1 },
      { key: 'headingScale', label: '全局倍率 (%)', min: 0, max: 200, step: 1 },
      { key: 'h1Scale', label: 'H1 (%)', min: 50, max: 300, step: 1 },
      { key: 'h2Scale', label: 'H2 (%)', min: 50, max: 250, step: 1 },
      { key: 'h3Scale', label: 'H3 (%)', min: 50, max: 200, step: 1 },
      { key: 'h4Scale', label: 'H4 (%)', min: 50, max: 150, step: 1 },
      { key: 'h5Scale', label: 'H5 (%)', min: 50, max: 120, step: 1 },
      { key: 'h6Scale', label: 'H6 (%)', min: 50, max: 120, step: 1 },
      { key: 'headingLineHeight', label: '标题行高', min: 1, max: 2, step: 0.05 },
    ],
  },
  {
    id: 'list',
    title: '列表',
    fields: [
      { key: 'listIndent', label: '缩进 (mm)', min: 0, max: 20, step: 0.1 },
      { key: 'listMarkerGap', label: 'bullet 间距 (mm)', min: 0, max: 6, step: 0.1 },
      { key: 'listItemSpacing', label: '项间距 (mm)', min: 0, max: 8, step: 0.1 },
      { key: 'listBlockSpacing', label: '列表块间距 (mm)', min: 0, max: 8, step: 0.1 },
    ],
  },
  {
    id: 'table',
    title: '表格',
    fields: [
      { key: 'tableCellPaddingY', label: '单元格上下 (mm)', min: 0, max: 4, step: 0.1 },
      { key: 'tableCellPaddingX', label: '单元格左右 (mm)', min: 0, max: 6, step: 0.1 },
      { key: 'tableSpacing', label: '表格外间距 (mm)', min: 0, max: 8, step: 0.1 },
      { key: 'tableFontScale', label: '表格字号 (%)', min: 50, max: 150, step: 1 },
    ],
  },
  {
    id: 'quoteCode',
    title: '引用与代码',
    fields: [
      { key: 'blockquoteSpacing', label: '引用间距 (mm)', min: 0, max: 8, step: 0.1 },
      { key: 'blockquotePaddingLeft', label: '引用左缩进 (mm)', min: 0, max: 12, step: 0.1 },
      { key: 'blockquoteFontScale', label: '引用字号 (%)', min: 50, max: 150, step: 1 },
      { key: 'codeBlockPadding', label: '代码块内边距 (mm)', min: 0, max: 8, step: 0.1 },
      { key: 'codeFontScale', label: '代码块字号 (%)', min: 50, max: 120, step: 1 },
      { key: 'codeInlineFontScale', label: '行内代码 (%)', min: 50, max: 120, step: 1 },
    ],
  },
  {
    id: 'other',
    title: '其他',
    fields: [
      { key: 'hrSpacing', label: '分隔线间距 (mm)', min: 0, max: 12, step: 0.1 },
      { key: 'footnoteFontScale', label: '脚注字号 (%)', min: 50, max: 120, step: 1 },
      { key: 'footnoteSpacing', label: '脚注间距 (mm)', min: 0, max: 8, step: 0.1 },
    ],
  },
];

export const DEFAULT_TYPOGRAPHY_PRESET: BuiltInTypographyPreset = 'normal';

/** 竞品排版样式 ID（二维：样式 × 密度 compact/normal/relaxed） */
export type HymdTypographyStyleId = 'github' | 'word' | 'latex' | 'gongwen';

export const TYPOGRAPHY_STYLE_IDS = [
  'github',
  'word',
  'latex',
  'gongwen',
] as const satisfies readonly HymdTypographyStyleId[];

export const DEFAULT_TYPOGRAPHY_STYLE: HymdTypographyStyleId = 'github';

/** 旧 6 套竞品 ID → 现 4 套（静默迁移） */
const TYPOGRAPHY_STYLE_ALIASES: Readonly<Record<string, HymdTypographyStyleId>> = {
  typst: 'github',
  indesign: 'latex',
};

/** 解析内置排版样式 ID（含旧别名） */
export function resolveTypographyStyleId(value: string | undefined | null): HymdTypographyStyleId {
  if (!value) return DEFAULT_TYPOGRAPHY_STYLE;
  if ((TYPOGRAPHY_STYLE_IDS as readonly string[]).includes(value)) {
    return value as HymdTypographyStyleId;
  }
  return TYPOGRAPHY_STYLE_ALIASES[value] ?? DEFAULT_TYPOGRAPHY_STYLE;
}

/** 以正文字号为锚点的比率组（normal 密度基准） */
export interface TypographyStyleRatios {
  lineHeightRatio: number;
  paragraphSpacingRatio: number;
  headingTopRatio: number;
  headingBottomRatio: number;
  listIndentChars: number;
  listMarkerGapChars: number;
  listItemSpacingRatio: number;
  listBlockSpacingRatio: number;
  tableCellPaddingYRatio: number;
  tableCellPaddingXRatio: number;
  tableSpacingRatio: number;
  blockquoteSpacingRatio: number;
  codeBlockPaddingRatio: number;
  headingScale?: number;
  firstLineIndentChars?: number;
  blockquotePaddingLeftRatio?: number;
  hrSpacingRatio?: number;
  footnoteSpacingRatio?: number;
  h1Scale?: number;
  h2Scale?: number;
  h3Scale?: number;
  h4Scale?: number;
  h5Scale?: number;
  h6Scale?: number;
  headingLineHeight?: number;
  tableFontScale?: number;
  blockquoteFontScale?: number;
  codeFontScale?: number;
  codeInlineFontScale?: number;
  footnoteFontScale?: number;
}

export interface TypographyStyleDef {
  id: HymdTypographyStyleId;
  label: string;
  description: string;
  /** 正文字号锚点 (mm) */
  fontSizeMm: number;
  /** normal 密度比率组 */
  ratios: TypographyStyleRatios;
}

const DEFAULT_RATIO_EXTRAS: Pick<
  TypographyStyleRatios,
  | 'firstLineIndentChars'
  | 'blockquotePaddingLeftRatio'
  | 'hrSpacingRatio'
  | 'footnoteSpacingRatio'
  | 'h1Scale'
  | 'h2Scale'
  | 'h3Scale'
  | 'h4Scale'
  | 'h5Scale'
  | 'h6Scale'
  | 'headingLineHeight'
  | 'tableFontScale'
  | 'blockquoteFontScale'
  | 'codeFontScale'
  | 'codeInlineFontScale'
  | 'footnoteFontScale'
> = {
  firstLineIndentChars: 0,
  blockquotePaddingLeftRatio: 0.7,
  hrSpacingRatio: 1,
  footnoteSpacingRatio: 0.5,
  ...DEFAULT_SCALE_FIELDS,
};

/** 竞品排版样式注册表（4 套；描述全部 mm 锚定） */
export const TYPOGRAPHY_STYLES: readonly TypographyStyleDef[] = [
  {
    id: 'github',
    label: 'GitHub',
    description: '网页阅读风：宽松行距、段距 3.0mm',
    fontSizeMm: 3.7,
    ratios: {
      lineHeightRatio: 1.6,
      paragraphSpacingRatio: 0.8,
      headingTopRatio: 1.5,
      headingBottomRatio: 1.0,
      listIndentChars: 2.9,
      listMarkerGapChars: 0.4,
      listItemSpacingRatio: 0,
      listBlockSpacingRatio: 0.8,
      tableCellPaddingYRatio: 0.4,
      tableCellPaddingXRatio: 0.7,
      tableSpacingRatio: 0.7,
      blockquoteSpacingRatio: 0.7,
      codeBlockPaddingRatio: 1.1,
      headingScale: 100,
      ...DEFAULT_RATIO_EXTRAS,
    },
  },
  {
    id: 'word',
    label: 'Word',
    description: '办公文档风：紧凑行距、段后 2.5mm',
    fontSizeMm: 3.7,
    ratios: {
      lineHeightRatio: 1.15,
      paragraphSpacingRatio: 0.67,
      headingTopRatio: 1.1,
      headingBottomRatio: 0.73,
      listIndentChars: 2.0,
      listMarkerGapChars: 0.3,
      listItemSpacingRatio: 0,
      listBlockSpacingRatio: 0.5,
      tableCellPaddingYRatio: 0.25,
      tableCellPaddingXRatio: 0.5,
      tableSpacingRatio: 0.5,
      blockquoteSpacingRatio: 0.5,
      codeBlockPaddingRatio: 0.9,
      headingScale: 100,
      ...DEFAULT_RATIO_EXTRAS,
    },
  },
  {
    id: 'latex',
    label: '学术印刷',
    description: '学术印刷风：紧凑行距、章节间距分明、三线表',
    fontSizeMm: 3.7,
    ratios: {
      lineHeightRatio: 1.2,
      paragraphSpacingRatio: 0.1,
      headingTopRatio: 1.75,
      headingBottomRatio: 1.15,
      listIndentChars: 2.5,
      listMarkerGapChars: 0.3,
      listItemSpacingRatio: 0,
      listBlockSpacingRatio: 0.4,
      tableCellPaddingYRatio: 0.3,
      tableCellPaddingXRatio: 0.5,
      tableSpacingRatio: 0.5,
      blockquoteSpacingRatio: 0.5,
      codeBlockPaddingRatio: 0.8,
      headingScale: 100,
      ...DEFAULT_RATIO_EXTRAS,
    },
  },
  {
    id: 'gongwen',
    label: '公文 GB/T 9704',
    description: '公文：字 4.2mm、行 7.4mm、首行缩进 2 字',
    fontSizeMm: 4.2,
    ratios: {
      lineHeightRatio: 1.75,
      paragraphSpacingRatio: 0,
      headingTopRatio: 1.0,
      headingBottomRatio: 0.5,
      listIndentChars: 2.0,
      listMarkerGapChars: 0.3,
      listItemSpacingRatio: 0,
      listBlockSpacingRatio: 0.3,
      tableCellPaddingYRatio: 0.3,
      tableCellPaddingXRatio: 0.5,
      tableSpacingRatio: 0.5,
      blockquoteSpacingRatio: 0.5,
      codeBlockPaddingRatio: 0.8,
      headingScale: 100,
      ...DEFAULT_RATIO_EXTRAS,
      firstLineIndentChars: 2,
      h1Scale: 100,
      h2Scale: 100,
      h3Scale: 100,
      h4Scale: 100,
      h5Scale: 100,
      h6Scale: 100,
    },
  },
] as const;

const DENSITY_FONT_DELTA: Record<BuiltInTypographyPreset, number> = {
  compact: -0.3,
  normal: 0,
  relaxed: 0.3,
};

const DENSITY_SPACING_MULT: Record<BuiltInTypographyPreset, number> = {
  compact: 0.6,
  normal: 1.0,
  relaxed: 1.4,
};

/**
 * 行高密度倍率：行高含字面本身，绝不能随块间距整体 ×0.6
 * （否则 word/latex/indesign 等 1.15~1.2 基准行高在紧凑下 <1 → 文字重叠）
 */
const DENSITY_LINE_HEIGHT_MULT: Record<BuiltInTypographyPreset, number> = {
  compact: 0.93,
  normal: 1.0,
  relaxed: 1.19,
};

/** 行高比率下限：任何密度下都不允许小于字高 1.05 倍 */
const MIN_LINE_HEIGHT_RATIO = 1.05;

function scaleStyleRatios(
  ratios: TypographyStyleRatios,
  density: BuiltInTypographyPreset,
): TypographyStyleRatios {
  const m = DENSITY_SPACING_MULT[density];
  return {
    lineHeightRatio: Math.max(
      MIN_LINE_HEIGHT_RATIO,
      ratios.lineHeightRatio * DENSITY_LINE_HEIGHT_MULT[density],
    ),
    paragraphSpacingRatio: ratios.paragraphSpacingRatio * m,
    headingTopRatio: ratios.headingTopRatio * m,
    headingBottomRatio: ratios.headingBottomRatio * m,
    listIndentChars: ratios.listIndentChars * m,
    listMarkerGapChars: ratios.listMarkerGapChars * m,
    listItemSpacingRatio: ratios.listItemSpacingRatio * m,
    listBlockSpacingRatio: ratios.listBlockSpacingRatio * m,
    tableCellPaddingYRatio: ratios.tableCellPaddingYRatio * m,
    tableCellPaddingXRatio: ratios.tableCellPaddingXRatio * m,
    tableSpacingRatio: ratios.tableSpacingRatio * m,
    blockquoteSpacingRatio: ratios.blockquoteSpacingRatio * m,
    codeBlockPaddingRatio: ratios.codeBlockPaddingRatio * m,
    headingScale: ratios.headingScale ?? 100,
    // 首行缩进是"字符数"语义（如公文固定 2 字符），不随密度缩放
    firstLineIndentChars: ratios.firstLineIndentChars ?? 0,
    blockquotePaddingLeftRatio: (ratios.blockquotePaddingLeftRatio ?? 0.7) * m,
    hrSpacingRatio: (ratios.hrSpacingRatio ?? 0.5) * m,
    footnoteSpacingRatio: (ratios.footnoteSpacingRatio ?? 0.5) * m,
    h1Scale: ratios.h1Scale ?? DEFAULT_SCALE_FIELDS.h1Scale,
    h2Scale: ratios.h2Scale ?? DEFAULT_SCALE_FIELDS.h2Scale,
    h3Scale: ratios.h3Scale ?? DEFAULT_SCALE_FIELDS.h3Scale,
    h4Scale: ratios.h4Scale ?? DEFAULT_SCALE_FIELDS.h4Scale,
    h5Scale: ratios.h5Scale ?? DEFAULT_SCALE_FIELDS.h5Scale,
    h6Scale: ratios.h6Scale ?? DEFAULT_SCALE_FIELDS.h6Scale,
    headingLineHeight: ratios.headingLineHeight ?? DEFAULT_SCALE_FIELDS.headingLineHeight,
    tableFontScale: ratios.tableFontScale ?? DEFAULT_SCALE_FIELDS.tableFontScale,
    blockquoteFontScale: ratios.blockquoteFontScale ?? DEFAULT_SCALE_FIELDS.blockquoteFontScale,
    codeFontScale: ratios.codeFontScale ?? DEFAULT_SCALE_FIELDS.codeFontScale,
    codeInlineFontScale: ratios.codeInlineFontScale ?? DEFAULT_SCALE_FIELDS.codeInlineFontScale,
    footnoteFontScale: ratios.footnoteFontScale ?? DEFAULT_SCALE_FIELDS.footnoteFontScale,
  };
}

function expandStyleRatios(fontSize: number, ratios: TypographyStyleRatios): HymdTypography {
  return {
    fontSize: roundMm(fontSize),
    lineHeight: roundMm(fontSize * ratios.lineHeightRatio),
    paragraphSpacing: roundMm(fontSize * ratios.paragraphSpacingRatio),
    headingTopSpacing: roundMm(fontSize * ratios.headingTopRatio),
    headingBottomSpacing: roundMm(fontSize * ratios.headingBottomRatio),
    headingScale: ratios.headingScale ?? 100,
    listIndent: roundMm(fontSize * ratios.listIndentChars),
    listMarkerGap: roundMm(fontSize * ratios.listMarkerGapChars),
    listItemSpacing: roundMm(fontSize * ratios.listItemSpacingRatio),
    listBlockSpacing: roundMm(fontSize * ratios.listBlockSpacingRatio),
    tableCellPaddingY: roundMm(fontSize * ratios.tableCellPaddingYRatio),
    tableCellPaddingX: roundMm(fontSize * ratios.tableCellPaddingXRatio),
    tableSpacing: roundMm(fontSize * ratios.tableSpacingRatio),
    blockquoteSpacing: roundMm(fontSize * ratios.blockquoteSpacingRatio),
    codeBlockPadding: roundMm(fontSize * ratios.codeBlockPaddingRatio),
    firstLineIndent: roundMm(fontSize * (ratios.firstLineIndentChars ?? 0)),
    blockquotePaddingLeft: roundMm(fontSize * (ratios.blockquotePaddingLeftRatio ?? 0.7)),
    hrSpacing: roundMm(fontSize * (ratios.hrSpacingRatio ?? 0.5)),
    footnoteSpacing: roundMm(fontSize * (ratios.footnoteSpacingRatio ?? 0.5)),
    h1Scale: ratios.h1Scale ?? DEFAULT_SCALE_FIELDS.h1Scale,
    h2Scale: ratios.h2Scale ?? DEFAULT_SCALE_FIELDS.h2Scale,
    h3Scale: ratios.h3Scale ?? DEFAULT_SCALE_FIELDS.h3Scale,
    h4Scale: ratios.h4Scale ?? DEFAULT_SCALE_FIELDS.h4Scale,
    h5Scale: ratios.h5Scale ?? DEFAULT_SCALE_FIELDS.h5Scale,
    h6Scale: ratios.h6Scale ?? DEFAULT_SCALE_FIELDS.h6Scale,
    headingLineHeight: ratios.headingLineHeight ?? DEFAULT_SCALE_FIELDS.headingLineHeight,
    tableFontScale: ratios.tableFontScale ?? DEFAULT_SCALE_FIELDS.tableFontScale,
    blockquoteFontScale: ratios.blockquoteFontScale ?? DEFAULT_SCALE_FIELDS.blockquoteFontScale,
    codeFontScale: ratios.codeFontScale ?? DEFAULT_SCALE_FIELDS.codeFontScale,
    codeInlineFontScale: ratios.codeInlineFontScale ?? DEFAULT_SCALE_FIELDS.codeInlineFontScale,
    footnoteFontScale: ratios.footnoteFontScale ?? DEFAULT_SCALE_FIELDS.footnoteFontScale,
  };
}

export function isTypographyStyle(value: string): value is HymdTypographyStyleId {
  return (
    (TYPOGRAPHY_STYLE_IDS as readonly string[]).includes(value) ||
    value in TYPOGRAPHY_STYLE_ALIASES
  );
}

export function getTypographyStyleDef(id: HymdTypographyStyleId): TypographyStyleDef {
  const resolved = resolveTypographyStyleId(id);
  return TYPOGRAPHY_STYLES.find((s) => s.id === resolved) ?? TYPOGRAPHY_STYLES[0];
}

/** 解析竞品样式 × 密度 → 绝对 mm（所有样式统一走比率展开） */
export function resolveStyleTypography(
  style: HymdTypographyStyleId | string,
  density: BuiltInTypographyPreset,
): HymdTypography {
  const def = getTypographyStyleDef(resolveTypographyStyleId(style));
  const fontSize = roundMm(def.fontSizeMm + DENSITY_FONT_DELTA[density]);
  const ratios = scaleStyleRatios(def.ratios, density);
  return expandStyleRatios(fontSize, ratios);
}

/** 内置密度预设 = github 样式 × 密度（Typora GitHub 主题对齐口径） */
export const TYPOGRAPHY_PRESETS: Record<BuiltInTypographyPreset, HymdTypography> = {
  compact: resolveStyleTypography('github', 'compact'),
  normal: resolveStyleTypography('github', 'normal'),
  relaxed: resolveStyleTypography('github', 'relaxed'),
};

/** 跟随字高：mm 字段等比缩放，% / 倍率字段不变 */
export function scaleTypographyByFont(t: HymdTypography, newFontSize: number): HymdTypography {
  const old = t.fontSize;
  if (!old || old <= 0 || newFontSize === old) {
    return { ...t, fontSize: roundMm(newFontSize) };
  }
  const ratio = newFontSize / old;
  const out: HymdTypography = { ...t, fontSize: roundMm(newFontSize) };
  for (const key of TYPOGRAPHY_LENGTH_KEYS) {
    if (key === 'fontSize') continue;
    out[key] = roundMm(t[key] * ratio);
  }
  return out;
}

/** 用户样式可选附带细节（与排版一并存取） */
export interface HymdUserStyleDetail {
  base: string;
  overrides: {
    light?: Record<string, unknown>;
    dark?: Record<string, unknown>;
  };
}

export interface HymdUserTypographyStyle {
  id: string;
  label: string;
  typography: HymdTypography;
  /** 可选：一并保存的细节样式 */
  detail?: HymdUserStyleDetail;
}

export function isUserTypographyStyleId(value: string): boolean {
  return value.startsWith('user:');
}

export function parseUserTypographyStyleId(value: string): string | undefined {
  return value.startsWith('user:') ? value.slice(5) : undefined;
}

export function makeUserTypographyStyleId(id: string): string {
  return `user:${id}`;
}

/** 对用户样式绝对 mm 应用密度：字号±0.3，行高走行高倍率（防重叠），其余 LENGTH ×0.6/1.4 */
export function applyDensityToTypography(
  t: HymdTypography,
  density: BuiltInTypographyPreset,
): HymdTypography {
  if (density === 'normal') return { ...t };
  const m = DENSITY_SPACING_MULT[density];
  const fontSize = roundMm(t.fontSize + DENSITY_FONT_DELTA[density]);
  const out: HymdTypography = { ...t, fontSize };
  for (const key of TYPOGRAPHY_LENGTH_KEYS) {
    if (key === 'fontSize') continue;
    out[key] = roundMm(t[key] * m);
  }
  out.lineHeight = roundMm(
    Math.max(
      fontSize * MIN_LINE_HEIGHT_RATIO,
      t.lineHeight * DENSITY_LINE_HEIGHT_MULT[density],
    ),
  );
  return out;
}

/** 解析任意 style id（内置或 user:）× 密度 → 绝对排版 */
export function resolveTypographyForStyle(
  styleId: string,
  density: BuiltInTypographyPreset,
  userStyles: readonly HymdUserTypographyStyle[] = [],
): HymdTypography {
  const userKey = parseUserTypographyStyleId(styleId);
  if (userKey) {
    const found = userStyles.find((s) => s.id === userKey);
    if (found) return applyDensityToTypography(found.typography, density);
    return resolveStyleTypography(DEFAULT_TYPOGRAPHY_STYLE, density);
  }
  return resolveStyleTypography(resolveTypographyStyleId(styleId), density);
}

export function makeUniqueUserStyleId(
  label: string,
  existing: readonly HymdUserTypographyStyle[],
): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\u4e00-\u9fff-]/g, '') || 'style';
  let id = base;
  let n = 1;
  while (existing.some((s) => s.id === id)) {
    id = `${base}-${n++}`;
  }
  return id;
}

/** WYSIWYG 默认渲染 scale：与 CSS 96dpi 链对齐，保证 mm preset 视觉等同旧 px preset */
export const DEFAULT_TYPOGRAPHY_RENDER_SCALE = CSS_PX_PER_MM;

export function isTypographyPreset(value: string): value is TypographyPreset {
  return value === 'custom' || (TYPOGRAPHY_PRESET_IDS as readonly string[]).includes(value);
}

function mmFieldToCssPx(mm: number, scale: number): string {
  return `${mmToPxLocal(mm, scale)}px`;
}

function percentToCssFactor(percent: number): string {
  return String(Math.max(0, percent) / 100);
}

/** mm 排版 → CSS 变量（唯一 px 换算点；scale 默认 CSS_PX_PER_MM） */
export function typographyToCssVars(
  t: HymdTypography,
  scale: number = DEFAULT_TYPOGRAPHY_RENDER_SCALE,
): Record<string, string> {
  const headingScale = Math.max(0, t.headingScale) / 100;
  return {
    '--hymd-mm': `${scale}px`,
    '--hymd-font-size': mmFieldToCssPx(t.fontSize, scale),
    '--hymd-line-height': mmFieldToCssPx(t.lineHeight, scale),
    '--hymd-p-spacing': mmFieldToCssPx(t.paragraphSpacing, scale),
    '--hymd-heading-top': mmFieldToCssPx(t.headingTopSpacing, scale),
    '--hymd-heading-bottom': mmFieldToCssPx(t.headingBottomSpacing, scale),
    '--hymd-heading-scale': String(headingScale),
    '--hymd-list-indent': mmFieldToCssPx(t.listIndent, scale),
    '--hymd-list-marker-gap': mmFieldToCssPx(t.listMarkerGap, scale),
    '--hymd-list-item-spacing': mmFieldToCssPx(t.listItemSpacing, scale),
    '--hymd-list-block-spacing': mmFieldToCssPx(t.listBlockSpacing, scale),
    '--hymd-table-pad-y': mmFieldToCssPx(t.tableCellPaddingY, scale),
    '--hymd-table-pad-x': mmFieldToCssPx(t.tableCellPaddingX, scale),
    '--hymd-table-spacing': mmFieldToCssPx(t.tableSpacing, scale),
    '--hymd-blockquote-spacing': mmFieldToCssPx(t.blockquoteSpacing, scale),
    '--hymd-code-padding': mmFieldToCssPx(t.codeBlockPadding, scale),
    '--hymd-first-line-indent': mmFieldToCssPx(t.firstLineIndent, scale),
    '--hymd-blockquote-pad-left': mmFieldToCssPx(t.blockquotePaddingLeft, scale),
    '--hymd-hr-spacing': mmFieldToCssPx(t.hrSpacing, scale),
    '--hymd-footnote-spacing': mmFieldToCssPx(t.footnoteSpacing, scale),
    '--hymd-h1-scale': percentToCssFactor(t.h1Scale),
    '--hymd-h2-scale': percentToCssFactor(t.h2Scale),
    '--hymd-h3-scale': percentToCssFactor(t.h3Scale),
    '--hymd-h4-scale': percentToCssFactor(t.h4Scale),
    '--hymd-h5-scale': percentToCssFactor(t.h5Scale),
    '--hymd-h6-scale': percentToCssFactor(t.h6Scale),
    '--hymd-heading-line-height': String(t.headingLineHeight),
    '--hymd-table-font-scale': percentToCssFactor(t.tableFontScale),
    '--hymd-blockquote-font-scale': percentToCssFactor(t.blockquoteFontScale),
    '--hymd-code-font-scale': percentToCssFactor(t.codeFontScale),
    '--hymd-code-inline-font-scale': percentToCssFactor(t.codeInlineFontScale),
    '--hymd-footnote-font-scale': percentToCssFactor(t.footnoteFontScale),
  };
}

export function typographyToInlineStyle(
  t: HymdTypography,
  scale: number = DEFAULT_TYPOGRAPHY_RENDER_SCALE,
): string {
  return Object.entries(typographyToCssVars(t, scale))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

export function mergeTypography(
  base: HymdTypography,
  patch: Partial<HymdTypography>,
): HymdTypography {
  return { ...base, ...patch };
}

/** 兼容旧版 custom 配置（含 legacy px 与缺省字段） */
export function normalizeTypographyPartial(
  partial: Partial<HymdTypography> | undefined,
): HymdTypography {
  const migrated = migrateLegacyPxTypography(partial ?? {});
  return mergeTypography(TYPOGRAPHY_PRESETS.normal, migrated);
}
