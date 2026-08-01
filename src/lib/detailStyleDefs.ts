/** 细节样式：元素级装饰 token（与排版风格同 ID 四套） */

export type HymdDetailStyleId = 'github' | 'word' | 'latex' | 'gongwen';

export type TableBorderMode = 'grid' | 'horizontal' | 'booktabs';

export type TableWidthMode = 'content' | 'full';

export interface DetailStyleTokens {
  quoteFg: string;
  quoteBorder: string;
  quoteBg: string;
  quoteBorderWidth: string;
  quoteItalic: boolean;
  listMarkerColor: string;
  /** 列表 marker 字号倍率 (%)，100 = 正文字号（mm 锚点经 typography 换算） */
  listMarkerFontScale: number;
  tableBorderMode: TableBorderMode;
  tableWidthMode: TableWidthMode;
  tableBorderColor: string;
  tableHeaderBg: string;
  tableZebra: string;
  codeInlineBg: string;
  codeInlineFg: string;
  codeInlineRadius: string;
  codeInlinePadding: string;
  codeBlockBg: string;
  codeBlockBorder: string;
  codeBlockRadius: string;
  linkColor: string;
  linkUnderline: boolean;
  /** H1/H2 底边横线 */
  headingRuleEnabled: boolean;
  /** Markdown --- 渲染的 hr 可见 */
  hrEnabled: boolean;
  hrColor: string;
  hrHeight: string;
  strongWeight: number;
}

export interface DetailStyleDef {
  id: HymdDetailStyleId;
  label: string;
  description: string;
  light: DetailStyleTokens;
  dark: DetailStyleTokens;
}

export const DEFAULT_DETAIL_STYLE: HymdDetailStyleId = 'github';

export const DETAIL_STYLE_IDS = [
  'github',
  'word',
  'latex',
  'gongwen',
] as const satisfies readonly HymdDetailStyleId[];

/** 旧 6 套细节 ID → 现 4 套 */
const DETAIL_STYLE_ALIASES: Readonly<Record<string, HymdDetailStyleId>> = {
  typst: 'github',
  indesign: 'latex',
};

export const DETAIL_STYLES: readonly DetailStyleDef[] = [
  {
    id: 'github',
    label: 'GitHub',
    description: '全网格表格+斑马纹、灰字引用、半透明行内 code',
    light: {
      quoteFg: '#59636e',
      quoteBorder: '#d1d9e0',
      quoteBg: 'transparent',
      quoteBorderWidth: '0.25em',
      quoteItalic: false,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 100,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#d1d9e0',
      tableHeaderBg: 'transparent',
      tableZebra: '#f6f8fa',
      codeInlineBg: 'rgba(129, 139, 152, 0.12)',
      codeInlineFg: 'inherit',
      codeInlineRadius: '1.6mm',
      codeInlinePadding: '0.2em 0.4em',
      codeBlockBg: '#f6f8fa',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '1.6mm',
      linkColor: '#0969da',
      linkUnderline: false,
      headingRuleEnabled: true,
      hrEnabled: true,
      hrColor: '#8b949e',
      hrHeight: '0.25em',
      strongWeight: 600,
    },
    dark: {
      quoteFg: '#8b949e',
      quoteBorder: '#30363d',
      quoteBg: 'transparent',
      quoteBorderWidth: '0.25em',
      quoteItalic: false,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 100,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#30363d',
      tableHeaderBg: 'transparent',
      tableZebra: '#161b22',
      codeInlineBg: 'rgba(110, 118, 129, 0.4)',
      codeInlineFg: 'inherit',
      codeInlineRadius: '1.6mm',
      codeInlinePadding: '0.2em 0.4em',
      codeBlockBg: '#161b22',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '1.6mm',
      linkColor: '#58a6ff',
      linkUnderline: false,
      headingRuleEnabled: true,
      hrEnabled: true,
      hrColor: '#30363d',
      hrHeight: '0.25em',
      strongWeight: 600,
    },
  },
  {
    id: 'word',
    label: 'Word',
    description: '全网格表格、斜体灰引用、链接下划线、浅灰 code',
    light: {
      quoteFg: '#666666',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: true,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 70,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#666666',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: '#f2f2f2',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0.1em 0.25em',
      codeBlockBg: '#f2f2f2',
      codeBlockBorder: '#d0d0d0',
      codeBlockRadius: '0mm',
      linkColor: '#0563c1',
      linkUnderline: true,
      headingRuleEnabled: false,
      hrEnabled: true,
      hrColor: '#000000',
      hrHeight: '1px',
      strongWeight: 700,
    },
    dark: {
      quoteFg: '#a0a0a0',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: true,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 70,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#666666',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: '#2d2d2d',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0.1em 0.25em',
      codeBlockBg: '#2d2d2d',
      codeBlockBorder: '#555555',
      codeBlockRadius: '0mm',
      linkColor: '#4ea0f0',
      linkUnderline: true,
      headingRuleEnabled: false,
      hrEnabled: true,
      hrColor: '#cccccc',
      hrHeight: '1px',
      strongWeight: 700,
    },
  },
  {
    id: 'latex',
    label: '学术印刷',
    description: '三线表、无框引用、无底色 code',
    light: {
      quoteFg: 'inherit',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: false,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 60,
      tableBorderMode: 'booktabs',
      tableWidthMode: 'content',
      tableBorderColor: '#000000',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: 'transparent',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0',
      codeBlockBg: 'transparent',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '0mm',
      linkColor: '#0563c1',
      linkUnderline: false,
      headingRuleEnabled: false,
      hrEnabled: true,
      hrColor: '#000000',
      hrHeight: '1px',
      strongWeight: 700,
    },
    dark: {
      quoteFg: 'inherit',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: false,
      listMarkerColor: 'inherit',
      listMarkerFontScale: 60,
      tableBorderMode: 'booktabs',
      tableWidthMode: 'content',
      tableBorderColor: '#cccccc',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: 'transparent',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0',
      codeBlockBg: 'transparent',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '0mm',
      linkColor: '#79b8ff',
      linkUnderline: false,
      headingRuleEnabled: false,
      hrEnabled: true,
      hrColor: '#cccccc',
      hrHeight: '1px',
      strongWeight: 700,
    },
  },
  {
    id: 'gongwen',
    label: '公文 GB/T 9704',
    description: '黑细框表格、无装饰引用与 code',
    light: {
      quoteFg: 'inherit',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: false,
      listMarkerColor: '#000000',
      listMarkerFontScale: 55,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#000000',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: 'transparent',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0',
      codeBlockBg: 'transparent',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '0mm',
      linkColor: 'inherit',
      linkUnderline: false,
      headingRuleEnabled: true,
      hrEnabled: true,
      hrColor: '#000000',
      hrHeight: '1px',
      strongWeight: 700,
    },
    dark: {
      quoteFg: 'inherit',
      quoteBorder: 'transparent',
      quoteBg: 'transparent',
      quoteBorderWidth: '0',
      quoteItalic: false,
      listMarkerColor: '#e0e0e0',
      listMarkerFontScale: 55,
      tableBorderMode: 'grid',
      tableWidthMode: 'content',
      tableBorderColor: '#cccccc',
      tableHeaderBg: 'transparent',
      tableZebra: 'transparent',
      codeInlineBg: 'transparent',
      codeInlineFg: 'inherit',
      codeInlineRadius: '0mm',
      codeInlinePadding: '0',
      codeBlockBg: 'transparent',
      codeBlockBorder: 'transparent',
      codeBlockRadius: '0mm',
      linkColor: 'inherit',
      linkUnderline: false,
      headingRuleEnabled: true,
      hrEnabled: true,
      hrColor: '#cccccc',
      hrHeight: '1px',
      strongWeight: 700,
    },
  },
] as const;

const DETAIL_STYLE_MAP = new Map(DETAIL_STYLES.map((s) => [s.id, s]));

export function isDetailStyleId(value: string | undefined | null): value is HymdDetailStyleId {
  return !!value && (DETAIL_STYLE_IDS as readonly string[]).includes(value);
}

/** 旧 ID 别名静默映射；非别名返回 undefined */
export function resolveDetailStyleIdAlias(value: string | undefined | null): HymdDetailStyleId | undefined {
  if (!value) return undefined;
  return DETAIL_STYLE_ALIASES[value];
}

export function resolveDetailStyleId(value: string | undefined | null): HymdDetailStyleId {
  if (isDetailStyleId(value)) return value;
  return resolveDetailStyleIdAlias(value) ?? DEFAULT_DETAIL_STYLE;
}

export function getDetailStyleDef(id: HymdDetailStyleId): DetailStyleDef {
  return DETAIL_STYLE_MAP.get(id) ?? DETAIL_STYLE_MAP.get(DEFAULT_DETAIL_STYLE)!;
}

export function resolveDetailTokens(
  id: HymdDetailStyleId,
  theme: 'light' | 'dark' | 'high-contrast',
): DetailStyleTokens {
  const def = getDetailStyleDef(id);
  return theme === 'light' ? def.light : def.dark;
}

/** 跟随正文/主题前景色（避免 `inherit` / `currentColor` 写入自定义属性后失效） */
const FOREGROUND_COLOR = 'var(--text, currentColor)';

/** color token 的 `inherit` 是 CSS-wide 关键字，写入自定义属性会失效并落到 var() 兜底 */
function colorToken(value: string): string {
  return value === 'inherit' ? FOREGROUND_COLOR : value;
}

/** 展开为 CSS 自定义属性（不含 tableBorderMode，由 data-table-border 承载） */
export function detailStyleToCssVars(tokens: DetailStyleTokens): Record<string, string> {
  return {
    '--hymd-ds-quote-fg': colorToken(tokens.quoteFg),
    '--hymd-ds-quote-border': tokens.quoteBorder,
    '--hymd-ds-quote-bg': tokens.quoteBg,
    '--hymd-ds-quote-border-width': tokens.quoteBorderWidth,
    '--hymd-ds-quote-italic': tokens.quoteItalic ? 'italic' : 'normal',
    '--hymd-ds-list-marker-color': colorToken(tokens.listMarkerColor),
    '--hymd-ds-list-marker-scale': String(Math.max(0, tokens.listMarkerFontScale) / 100),
    '--hymd-ds-table-border': tokens.tableBorderColor,
    '--hymd-ds-table-header-bg': tokens.tableHeaderBg,
    '--hymd-ds-table-zebra': tokens.tableZebra,
    '--hymd-ds-code-inline-bg': tokens.codeInlineBg,
    '--hymd-ds-code-inline-fg': colorToken(tokens.codeInlineFg),
    '--hymd-ds-code-inline-radius': tokens.codeInlineRadius,
    '--hymd-ds-code-inline-padding': tokens.codeInlinePadding,
    '--hymd-ds-code-block-bg': tokens.codeBlockBg,
    '--hymd-ds-code-block-border': tokens.codeBlockBorder,
    '--hymd-ds-code-block-radius': tokens.codeBlockRadius,
    '--hymd-ds-link-color': colorToken(tokens.linkColor),
    '--hymd-ds-link-decoration': tokens.linkUnderline ? 'underline' : 'none',
    '--hymd-ds-hr-color': tokens.hrColor,
    '--hymd-ds-hr-height': tokens.hrHeight,
    '--hymd-ds-strong-weight': String(tokens.strongWeight),
  };
}

export function detailStyleToInlineStyle(tokens: DetailStyleTokens): string {
  return Object.entries(detailStyleToCssVars(tokens))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** body data-* 开关：on / off */
export function detailToggleDataAttr(enabled: boolean): 'on' | 'off' {
  return enabled ? 'on' : 'off';
}

export type DetailStyleOverrides = Partial<DetailStyleTokens>;

export interface DetailStyleCustom {
  light?: DetailStyleOverrides;
  dark?: DetailStyleOverrides;
}

export interface HymdUserDetailStyle {
  id: string;
  label: string;
  base: string;
  overrides: DetailStyleCustom;
}

export type DetailStyleId = HymdDetailStyleId | `user:${string}`;

export function isUserDetailStyleId(value: string | undefined | null): value is `user:${string}` {
  return !!value && value.startsWith('user:');
}

export function extractUserDetailStyleId(value: string): string | undefined {
  return isUserDetailStyleId(value) ? value.slice(5) : undefined;
}

export function makeUserDetailStyleId(id: string): string {
  return `user:${id}`;
}

export function normalizeDetailStyleId(value: string | undefined | null): string {
  if (!value) return DEFAULT_DETAIL_STYLE;
  if (isDetailStyleId(value) || isUserDetailStyleId(value)) return value;
  return resolveDetailStyleIdAlias(value) ?? DEFAULT_DETAIL_STYLE;
}

export function mergeDetailTokens(
  base: DetailStyleTokens,
  ...layers: (DetailStyleOverrides | undefined)[]
): DetailStyleTokens {
  let out: DetailStyleTokens = { ...base };
  for (const layer of layers) {
    if (!layer) continue;
    out = { ...out, ...normalizeDetailOverrides(layer) };
  }
  return out;
}

/** 兼容旧版 listMarkerSize: '0.65em' → listMarkerFontScale: 65 */
function normalizeDetailOverrides(layer: DetailStyleOverrides): DetailStyleOverrides {
  const raw = layer as DetailStyleOverrides & { listMarkerSize?: string };
  if (raw.listMarkerFontScale !== undefined || raw.listMarkerSize === undefined) {
    const { listMarkerSize: _drop, ...rest } = raw;
    return rest;
  }
  const match = /^([\d.]+)em$/i.exec(String(raw.listMarkerSize).trim());
  const scale = match ? Math.round(Number(match[1]) * 100) : 100;
  const { listMarkerSize: _drop, ...rest } = raw;
  return { ...rest, listMarkerFontScale: scale };
}

export function mergeDetailCustom(
  ...layers: (DetailStyleCustom | undefined)[]
): DetailStyleCustom {
  const out: DetailStyleCustom = {};
  for (const layer of layers) {
    if (!layer) continue;
    if (layer.light) out.light = { ...out.light, ...layer.light };
    if (layer.dark) out.dark = { ...out.dark, ...layer.dark };
  }
  return out;
}

export interface DetailStyleChain {
  builtinId: HymdDetailStyleId;
  accumulated: DetailStyleCustom;
}

export function resolveDetailStyleChain(
  styleId: string,
  userStyles: readonly HymdUserDetailStyle[] = [],
): DetailStyleChain {
  if (isDetailStyleId(styleId)) {
    return { builtinId: styleId, accumulated: {} };
  }

  const aliased = resolveDetailStyleIdAlias(styleId);
  if (aliased) {
    return { builtinId: aliased, accumulated: {} };
  }

  const userId = extractUserDetailStyleId(styleId);
  if (!userId) {
    return { builtinId: DEFAULT_DETAIL_STYLE, accumulated: {} };
  }

  const entry = userStyles.find((s) => s.id === userId);
  if (!entry) {
    return { builtinId: DEFAULT_DETAIL_STYLE, accumulated: {} };
  }

  const parent = resolveDetailStyleChain(entry.base, userStyles);
  return {
    builtinId: parent.builtinId,
    accumulated: mergeDetailCustom(parent.accumulated, entry.overrides),
  };
}

export function resolveBuiltinDetailStyleId(
  styleId: string,
  userStyles: readonly HymdUserDetailStyle[] = [],
): HymdDetailStyleId {
  return resolveDetailStyleChain(styleId, userStyles).builtinId;
}

export function resolveEffectiveDetailTokens(
  styleId: string,
  theme: 'light' | 'dark' | 'high-contrast',
  custom: DetailStyleCustom = {},
  userStyles: readonly HymdUserDetailStyle[] = [],
): DetailStyleTokens {
  const colorTheme = theme === 'light' ? 'light' : 'dark';
  const themeKey = colorTheme;
  const { builtinId, accumulated } = resolveDetailStyleChain(styleId, userStyles);
  const base = resolveDetailTokens(builtinId, colorTheme);
  return mergeDetailTokens(base, accumulated[themeKey], custom[themeKey]);
}

export interface ResolvedDetailTokens {
  light: DetailStyleTokens;
  dark: DetailStyleTokens;
}

export function resolveResolvedDetailTokens(
  styleId: string,
  custom: DetailStyleCustom = {},
  userStyles: readonly HymdUserDetailStyle[] = [],
): ResolvedDetailTokens {
  return {
    light: resolveEffectiveDetailTokens(styleId, 'light', custom, userStyles),
    dark: resolveEffectiveDetailTokens(styleId, 'dark', custom, userStyles),
  };
}

export interface DetailEditableFields {
  tableBorderMode: TableBorderMode;
  tableWidthMode: TableWidthMode;
  tableBorderColor: string;
  tableZebraEnabled: boolean;
  tableHeaderBgEnabled: boolean;
  tableHeaderBg: string;
  listMarkerFollowText: boolean;
  listMarkerColor: string;
  /** marker 字号倍率 (%)，100 = 正文字号 mm 锚点 */
  listMarkerFontScale: number;
  quoteFg: string;
  quoteBorder: string;
  quoteItalic: boolean;
  codeInlineBg: string;
  /** 行内 code 圆角 (mm) */
  codeInlineRadius: number;
  linkColor: string;
  linkUnderline: boolean;
  headingRuleEnabled: boolean;
  hrEnabled: boolean;
  hrColor: string;
  strongWeight: 600 | 700;
}

/** 解析 codeInlineRadius：mm 优先；旧 px / 纯数字兼容 */
function parseCodeInlineRadiusMm(value: string): number {
  const s = String(value).trim();
  if (/mm$/i.test(s)) return parseFloat(s) || 0;
  if (/px$/i.test(s)) {
    const px = parseFloat(s);
    if (!Number.isFinite(px)) return 0;
    return Math.round((px / 3.7795) * 10) / 10;
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (n > 8) return Math.round((n / 3.7795) * 10) / 10;
  return n;
}

export function tokensToDetailEditable(tokens: DetailStyleTokens): DetailEditableFields {
  return {
    tableBorderMode: tokens.tableBorderMode,
    tableWidthMode: tokens.tableWidthMode,
    tableBorderColor: tokens.tableBorderColor,
    tableZebraEnabled: tokens.tableZebra !== 'transparent',
    tableHeaderBgEnabled: tokens.tableHeaderBg !== 'transparent',
    tableHeaderBg: tokens.tableHeaderBg === 'transparent' ? '#f6f8fa' : tokens.tableHeaderBg,
    listMarkerFollowText: tokens.listMarkerColor === 'inherit',
    listMarkerColor: tokens.listMarkerColor === 'inherit' ? '#24292f' : tokens.listMarkerColor,
    listMarkerFontScale: tokens.listMarkerFontScale,
    quoteFg: tokens.quoteFg === 'inherit' ? '#59636e' : tokens.quoteFg,
    quoteBorder: tokens.quoteBorder === 'transparent' ? '#d1d9e0' : tokens.quoteBorder,
    quoteItalic: tokens.quoteItalic,
    codeInlineBg: tokens.codeInlineBg === 'transparent' ? '#f6f8fa' : tokens.codeInlineBg,
    codeInlineRadius: parseCodeInlineRadiusMm(tokens.codeInlineRadius),
    linkColor: tokens.linkColor === 'inherit' ? '#0969da' : tokens.linkColor,
    linkUnderline: tokens.linkUnderline,
    headingRuleEnabled: tokens.headingRuleEnabled,
    hrEnabled: tokens.hrEnabled,
    hrColor: tokens.hrColor,
    strongWeight: tokens.strongWeight === 600 ? 600 : 700,
  };
}

export function detailEditableToOverrides(
  fields: DetailEditableFields,
  baseTokens: DetailStyleTokens,
): DetailStyleOverrides {
  const overrides: DetailStyleOverrides = {
    tableBorderMode: fields.tableBorderMode,
    tableWidthMode: fields.tableWidthMode,
    tableBorderColor: fields.tableBorderColor,
    listMarkerColor: fields.listMarkerFollowText ? 'inherit' : fields.listMarkerColor,
    listMarkerFontScale: fields.listMarkerFontScale,
    quoteFg: fields.quoteFg,
    quoteBorder: fields.quoteBorder,
    quoteItalic: fields.quoteItalic,
    codeInlineBg: fields.codeInlineBg,
    codeInlineRadius: `${fields.codeInlineRadius}mm`,
    linkColor: fields.linkColor,
    linkUnderline: fields.linkUnderline,
    headingRuleEnabled: fields.headingRuleEnabled,
    hrEnabled: fields.hrEnabled,
    hrColor: fields.hrColor,
    strongWeight: fields.strongWeight,
  };

  if (fields.tableZebraEnabled) {
    overrides.tableZebra =
      baseTokens.tableZebra !== 'transparent' ? baseTokens.tableZebra : '#f6f8fa';
  } else {
    overrides.tableZebra = 'transparent';
  }

  overrides.tableHeaderBg = fields.tableHeaderBgEnabled ? fields.tableHeaderBg : 'transparent';
  return overrides;
}

export function makeUniqueUserDetailStyleId(
  label: string,
  existing: readonly HymdUserDetailStyle[],
): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'detail';
  let candidate = base;
  let n = 2;
  while (existing.some((s) => s.id === candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

export interface DetailStyleResolveInput {
  style: string;
  custom: DetailStyleCustom;
  userStyles: readonly HymdUserDetailStyle[];
}

export function resolveDetailEditableFields(
  state: DetailStyleResolveInput,
  theme: 'light' | 'dark' = 'light',
): DetailEditableFields {
  const tokens = resolveEffectiveDetailTokens(state.style, theme, state.custom, state.userStyles);
  return tokensToDetailEditable(tokens);
}

export function buildDetailCustomFromEditable(
  fields: DetailEditableFields,
  state: DetailStyleResolveInput,
  theme: 'light' | 'dark' = 'light',
): DetailStyleCustom {
  const baseTokens = resolveEffectiveDetailTokens(state.style, theme, {}, state.userStyles);
  const overrides = detailEditableToOverrides(fields, baseTokens);
  return {
    light: { ...overrides },
    dark: { ...overrides },
  };
}

export function buildUserDetailStyleFromState(
  label: string,
  state: DetailStyleResolveInput,
  existing: readonly HymdUserDetailStyle[],
): HymdUserDetailStyle {
  const id = makeUniqueUserDetailStyleId(label, existing);
  const base = isDetailStyleId(state.style)
    ? state.style
    : resolveBuiltinDetailStyleId(state.style, state.userStyles);
  const chain = resolveDetailStyleChain(state.style, state.userStyles);
  const overrides = mergeDetailCustom(chain.accumulated, state.custom);
  return { id, label, base, overrides };
}
