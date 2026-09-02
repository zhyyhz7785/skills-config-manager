import type { LibraryListItemDto } from '../../shared/ipc'
import { getLocale } from '../i18n/locale'

/** 人群档：Research/14 十档 + 未归类（派生未命中）。没有「软件」父档。 */
export type PersonaId =
  | 'engineering'
  | 'learning'
  | 'docs'
  | 'creative'
  | 'software-frontend'
  | 'software-backend'
  | 'writing'
  | 'marketing'
  | 'product'
  | 'general'
  | 'unclassified'

export type ClassifiedPersona = Exclude<PersonaId, 'unclassified'>

export type FunnelOrigin = 'library' | 'network'

/** 芯片文案：按界面 locale（语言区域码）取 zh 或 en。 */
export type ChipCopy = { zh: string; en: string }

/** 本层未分到前面各桶的余数。芯片层互斥时必须钉住，否则子级之和对不上上级。 */
export const OTHER_ID = '其他'

/** 子档 id：Research/16 按 14 公开区域细切。 */
export type PersonaSubId =
  | 'sw-auto'
  | 'sw-scrape'
  | 'sw-cli'
  | 'sw-lang'
  | 'sw-front'
  | 'sw-client'
  | 'sw-impl'
  | 'sw-test'
  | 'sw-review'
  | 'sw-sec'
  | 'sw-comp'
  | 'sw-collab'
  | 'sw-api'
  | 'sw-infra'
  | 'sw-observe'
  | 'sw-ship'
  | 'sw-db'
  | 'sw-ml'
  | 'sw-arch'
  | 'wr-draft'
  | 'wr-academic'
  | 'wr-deai'
  | 'wr-trans'
  | 'wr-notes'
  | 'wr-doc'
  | 'ln-teach'
  | 'ln-loop'
  | 'ln-first'
  | 'ln-kb'
  | 'ln-graph'
  | 'ln-sci'
  | 'ln-med'
  | 'mk-copy'
  | 'mk-cold'
  | 'mk-price'
  | 'mk-ads'
  | 'mk-seo'
  | 'mk-growth'
  | 'mk-social'
  | 'mk-cal'
  | 'mk-ecom'
  | 'pd-discover'
  | 'pd-reqs'
  | 'pd-launch'
  | 'pd-metrics'
  | 'pd-invest'
  | 'pd-supply'
  | 'pd-hr'
  | 'pd-cs'
  | 'pd-legal'
  | 'pd-fin'
  | 'dc-slides'
  | 'dc-sheets'
  | 'dc-pdf'
  | 'dc-conv'
  | 'dc-prod'
  | 'cr-brand'
  | 'cr-ui'
  | 'cr-image'
  | 'cr-av'
  | 'cr-voice'
  | 'cr-art'
  | 'cr-3d'
  | 'en-std'
  | 'en-calc'
  | 'en-spec'
  | 'en-review'
  | 'en-site'
  | 'en-bim'
  | 'en-gis'
  | 'en-cad'
  | 'en-print'
  | 'gn-install'
  | 'gn-split'
  | 'gn-idea'
  | 'gn-agent'
  | 'gn-agwrite'
  | 'gn-compact'
  | 'gn-tmpl'
  | 'gn-search'
  | 'gn-mail'
  | 'gn-cal'
  | 'gn-files'
  | 'gn-comms'
  | 'gn-slack'
  | 'gn-meet'

export type PersonaSubFilter = PersonaSubId | typeof OTHER_ID

export type FunnelListItem = LibraryListItemDto & {
  funnelOrigin: FunnelOrigin
  personaId: PersonaId
  personaPhrases: string[]
  personaSubs: PersonaSubId[]
  /** 搜索面：人群/子档/短语/功能域的中英标签，已小写空格连接 */
  funnelSearchHay: string
}

export type PersonaSubDef = { id: PersonaSubId; label: ChipCopy; phrases: string[] }

export type FunnelReadyOpts = {
  personaCount: number
  subCount: number
  visibleSubCount: number
}

export const PERSONA_CHIPS: { id: PersonaId; label: ChipCopy }[] = [
  { id: 'engineering', label: { zh: '工程', en: 'Engineering' } },
  { id: 'learning', label: { zh: '学习', en: 'Learning' } },
  { id: 'docs', label: { zh: '文档', en: 'Docs' } },
  { id: 'creative', label: { zh: '创意', en: 'Creative' } },
  { id: 'software-frontend', label: { zh: '软件前端', en: 'Frontend dev' } },
  { id: 'software-backend', label: { zh: '软件后端', en: 'Backend dev' } },
  { id: 'writing', label: { zh: '文字', en: 'Writing' } },
  { id: 'marketing', label: { zh: '营销', en: 'Marketing' } },
  { id: 'product', label: { zh: '产品', en: 'Product' } },
  { id: 'general', label: { zh: '通用', en: 'General' } },
  { id: 'unclassified', label: { zh: '未归类', en: 'Unclassified' } },
]

/** 主档唯一时的先后：工程 → 营销 → 创意 → 文档 → 学习 → 文字 → 产品 → 软件前端 → 软件后端 → 通用 */
const PERSONA_PRIORITY: Record<ClassifiedPersona, number> = {
  engineering: 0,
  marketing: 1,
  creative: 2,
  docs: 3,
  learning: 4,
  writing: 5,
  product: 6,
  'software-frontend': 7,
  'software-backend': 8,
  general: 9,
}

type Rule = { phrase: string; persona: ClassifiedPersona; keys: string[] }

const RULES: Rule[] = [
  { phrase: '规范问答', persona: 'engineering', keys: ['standards-qa', '规范问答', '条文', '砼规'] },
  { phrase: '结构计算', persona: 'engineering', keys: ['structural-calculation', '结构计算', '配筋', '内力计算'] },
  { phrase: '结构说明', persona: 'engineering', keys: ['design-statement', '结构设计说明'] },
  { phrase: '图纸审查', persona: 'engineering', keys: ['plan-review-reply', '图纸审查'] },
  { phrase: '施工管理', persona: 'engineering', keys: ['施工管理', '工期', '造价'] },
  { phrase: 'BIM建模', persona: 'engineering', keys: ['bim', 'revit', 'ifc'] },
  { phrase: 'GIS地图', persona: 'engineering', keys: ['gis', 'geojson', 'mapbox'] },
  { phrase: '参数化CAD', persona: 'engineering', keys: ['text-to-cad', 'implicit-cad', 'cad-viewer', 'step-parts'] },
  { phrase: '切片打印', persona: 'engineering', keys: ['gcode', 'bambu-labs', 'sendcutsend'] },
  { phrase: '第一性学习', persona: 'learning', keys: ['first-principles', '第一性'] },
  { phrase: '知识库索引', persona: 'learning', keys: ['knowledge-base-index', '知识库索引'] },
  { phrase: '知识图谱', persona: 'learning', keys: ['knowledge graph', 'ontology', 'graph rag'] },
  { phrase: '教学出题', persona: 'learning', keys: ['quiz', 'tutoring', 'curriculum', 'lesson plan'] },
  { phrase: '持续学习', persona: 'learning', keys: ['continuous-learning', 'continual-learning'] },
  { phrase: '医学辅助', persona: 'learning', keys: ['medical', 'clinical', 'healthcare', 'emr', 'phi-compliance'] },
  {
    phrase: '科学计算',
    persona: 'learning',
    keys: ['numpy', 'matlab', 'pytorch-patterns', 'simulation'],
  },
  { phrase: '核心逻辑', persona: 'docs', keys: ['core-logic-doc', '核心逻辑'] },
  { phrase: '项目文档', persona: 'docs', keys: ['project-docs-structure'] },
  { phrase: '帮助手册', persona: 'docs', keys: ['project-help-doc', '帮助文档'] },
  { phrase: '术语门闩', persona: 'docs', keys: ['terminology-gate'] },
  { phrase: '总体计划', persona: 'docs', keys: ['abstract-plan', '总体计划'] },
  { phrase: '幻灯片', persona: 'docs', keys: ['pptx', 'powerpoint', 'slide deck'] },
  { phrase: '表格处理', persona: 'docs', keys: ['xlsx', 'spreadsheet', 'excel'] },
  { phrase: 'PDF处理', persona: 'docs', keys: ['pdf', 'docx'] },
  { phrase: '文档转换', persona: 'docs', keys: ['docx-to', 'pdf-to', 'md-to-docx', 'convert-pdf'] },
  { phrase: '算法艺术', persona: 'creative', keys: ['algorithmic-art', 'generative art'] },
  { phrase: '品牌规范', persona: 'creative', keys: ['brand-guideline', 'brand-voice', 'brand identity'] },
  { phrase: '画布原型', persona: 'creative', keys: ['canvas-design', 'figma'] },
  { phrase: '主题设计', persona: 'creative', keys: ['theme-factory'] },
  { phrase: '网页设计', persona: 'creative', keys: ['web-artifacts', 'frontend-design'] },
  { phrase: '图像处理', persona: 'creative', keys: ['image gen', 'midjourney', 'stable diffusion', 'fal-ai-media', 'ai-image', 'ai-product-photography'] },
  { phrase: '音视频', persona: 'creative', keys: ['ffmpeg', 'youtube', 'video edit', 'ai-video', 'ai-music', 'ai-podcast'] },
  { phrase: '语音合成', persona: 'creative', keys: ['tts', 'text-to-speech', 'elevenlabs'] },
  { phrase: '三维建模', persona: 'creative', keys: ['blender', 'unreal'] },
  { phrase: '产品立项', persona: 'product', keys: ['product-discovery', 'product-lens', '竞品调研'] },
  { phrase: '竞品分析', persona: 'product', keys: ['competitor', 'competitive-platform', 'competitive-report'] },
  { phrase: '财务记账', persona: 'product', keys: ['invoice', 'billing', 'bookkeep', 'expense', 'customer-billing', 'adding-stripe', 'stripe'] },
  { phrase: '法律合同', persona: 'product', keys: ['legal', 'contract', 'compliance', 'customs-trade'] },
  { phrase: '招聘人事', persona: 'product', keys: ['recruit', 'hiring', 'resume'] },
  { phrase: '客户支持', persona: 'product', keys: ['zendesk', 'helpdesk', 'customer support'] },
  { phrase: '投资材料', persona: 'product', keys: ['investor-materials', 'investor-outreach'] },
  { phrase: '供应链', persona: 'product', keys: ['logistics', 'procurement', 'carrier-relationship'] },
  { phrase: '性能优化', persona: 'software-backend', keys: ['performance-optimization', 'performance', 'optimize speed'] },
  { phrase: 'UI风格', persona: 'software-frontend', keys: ['tauri2-vscode-ui-style', 'ui-style'] },
  { phrase: '品味审查', persona: 'software-backend', keys: ['l0-code-review'] },
  { phrase: '桌面壳', persona: 'software-frontend', keys: ['tauri', 'electron'] },
  { phrase: 'MCP构建', persona: 'software-backend', keys: ['mcp-builder', 'model context protocol'] },
  { phrase: 'Azure云', persona: 'software-backend', keys: ['azure'] },
  { phrase: 'GitHub协作', persona: 'software-backend', keys: ['pull request', 'github action', 'copilot'] },
  { phrase: '安全加固', persona: 'software-backend', keys: ['owasp', 'xss', 'csrf', 'safety-guard', 'security hardening', 'adding-auth', 'nextauth'] },
  { phrase: '威胁建模', persona: 'software-backend', keys: ['threat-model', 'stride'] },
  { phrase: '合规检查', persona: 'software-backend', keys: ['soc2', 'regulatory'] },
  { phrase: '成本优化', persona: 'software-backend', keys: ['finops', 'cost-optim'] },
  { phrase: '日志查询', persona: 'software-backend', keys: ['kusto', 'log-analytics'] },
  { phrase: '数据库', persona: 'software-backend', keys: ['postgres', 'mongodb', 'prisma', 'redis-patterns'] },
  { phrase: 'API对接', persona: 'software-backend', keys: ['openapi', 'graphql', 'webhook', 'rest api'] },
  { phrase: '工作流自动化', persona: 'software-backend', keys: ['n8n', 'zapier', 'rube', 'automation', 'automate'] },
  { phrase: '数据抓取', persona: 'software-backend', keys: ['scrape', 'crawler', 'playwright', 'browser-use'] },
  { phrase: '机器学习', persona: 'software-backend', keys: ['machine learning', 'fine-tun', 'embedding', 'llm eval'] },
  { phrase: '提示工程', persona: 'software-backend', keys: ['prompt engineering', 'system prompt'] },
  { phrase: '语言惯用法', persona: 'software-backend', keys: ['-patterns', 'coding-standards', 'golang-patterns', 'rust-patterns'] },
  { phrase: '前端框架', persona: 'software-frontend', keys: ['nextjs', 'nuxt', 'angular', 'turbopack'] },
  { phrase: '移动应用', persona: 'software-frontend', keys: ['swiftui', 'swift-actor', 'react native', 'flutter'] },
  { phrase: '游戏开发', persona: 'software-frontend', keys: ['unity', 'game engine'] },
  { phrase: '基础设施', persona: 'software-backend', keys: ['terraform', 'kubernetes', 'docker', 'homelab', 'wireguard'] },
  { phrase: '可观测性', persona: 'software-backend', keys: ['observability', 'datadog', 'sentry', 'canary-watch'] },
  { phrase: '无障碍', persona: 'software-frontend', keys: ['a11y', 'accessibility', 'wcag'] },
  { phrase: '国际化', persona: 'software-frontend', keys: ['i18n', 'l10n', 'localization'] },
  { phrase: '迁移升级', persona: 'software-backend', keys: ['migrat', 'upgrade path'] },
  { phrase: '代码生成', persona: 'software-backend', keys: ['codegen', 'scaffold', 'boilerplate'] },
  { phrase: '类型安全', persona: 'software-backend', keys: ['typescript', 'type-safe', 'zod'] },
  { phrase: '状态管理', persona: 'software-frontend', keys: ['redux', 'zustand'] },
  { phrase: 'CLI工具', persona: 'software-backend', keys: ['command-line', 'nanoclaw-repl'] },
  { phrase: '合并冲突', persona: 'software-backend', keys: ['merge-conflict', 'git-guardrail'] },
  { phrase: '验证循环', persona: 'software-backend', keys: ['verification-loop', 'verify-and-stop', 'eval-harness'] },
  { phrase: '仓库导览', persona: 'software-backend', keys: ['code-tour', 'codebase-onboarding', 'codebase-design'] },
  { phrase: '启动发布', persona: 'software-backend', keys: ['launch', 'release note'] },
  { phrase: '基准测试', persona: 'software-backend', keys: ['bench-skill', 'benchmark'] },
  { phrase: '写功能', persona: 'software-backend', keys: ['implement feature', 'write feature', '写功能'] },
  { phrase: '修缺陷', persona: 'software-backend', keys: ['debug', 'bugfix', 'bug fix', '修缺陷'] },
  { phrase: '代码审查', persona: 'software-backend', keys: ['code review', 'review pr', '代码审查'] },
  { phrase: '测试', persona: 'software-backend', keys: ['tdd', 'unit test', 'e2e', '测试'] },
  { phrase: '前端界面', persona: 'software-frontend', keys: ['frontend', 'react', 'css', '前端界面'] },
  { phrase: '发布上线', persona: 'software-backend', keys: ['deploy', 'ci/cd', 'github actions', '发布上线', 'feature-flag'] },
  { phrase: '重构清理', persona: 'software-backend', keys: ['refactor', 'tech debt', '重构清理'] },
  { phrase: '架构设计', persona: 'software-backend', keys: ['architecture', 'system design'] },
  { phrase: '长文起草', persona: 'writing', keys: ['longform', 'draft article', '长文'] },
  { phrase: '去AI腔', persona: 'writing', keys: ['humanizer', 'de-ai', '去ai', 'ai腔'] },
  { phrase: '翻译润色', persona: 'writing', keys: ['translate', '翻译'] },
  { phrase: '笔记整理', persona: 'writing', keys: ['obsidian', 'zettel', 'notion', '笔记'] },
  { phrase: '学术写作', persona: 'writing', keys: ['academic', 'scientific-writing', 'peer-review', '学术'] },
  { phrase: '文档结构', persona: 'writing', keys: ['documentation', 'readme', '文档结构'] },
  { phrase: '转化文案', persona: 'marketing', keys: ['copywriting', 'landing page', 'cta', '转化文案'] },
  { phrase: '冷邮件', persona: 'marketing', keys: ['cold-email', 'cold email', 'cold outreach', '冷邮件'] },
  { phrase: 'SEO', persona: 'marketing', keys: ['seo', 'aeo', 'aso', 'app-store-optimization'] },
  { phrase: '定价', persona: 'marketing', keys: ['pricing', '定价'] },
  { phrase: '投放', persona: 'marketing', keys: ['ppc', 'ad campaign', 'paid ads', '投放', 'ads', 'ad-creative'] },
  { phrase: '社媒短文', persona: 'marketing', keys: ['twitter', 'linkedin', 'instagram', 'social media', '社媒'] },
  { phrase: '内容日历', persona: 'marketing', keys: ['content calendar', 'newsletter'] },
  { phrase: '增长实验', persona: 'marketing', keys: ['growth experiment', 'ab test', 'lead-intelligence'] },
  { phrase: '电商运营', persona: 'marketing', keys: ['shopify', 'ecommerce', 'amazon listing'] },
  { phrase: '写需求', persona: 'product', keys: ['prd', 'user story', 'requirements doc', '写需求', 'agile-product', 'product-owner'] },
  { phrase: '用户调研', persona: 'product', keys: ['user research', 'user interview', '用户调研'] },
  { phrase: '决策备忘', persona: 'product', keys: ['decision record', 'adr', '决策'] },
  { phrase: '发布计划', persona: 'product', keys: ['roadmap', 'go-to-market', '发布计划'] },
  { phrase: '增长上市', persona: 'product', keys: ['gtm-0-to-1', 'gtm-launch'] },
  { phrase: '指标分析', persona: 'product', keys: ['analytics', 'kpi', 'metrics dashboard', '指标'] },
  { phrase: 'Agent编排', persona: 'general', keys: ['multi-agent', 'orchestrat', 'agent-harness', 'autonomous-loop', 'agentic-engineering'] },
  { phrase: '上下文压缩', persona: 'general', keys: ['caveman', 'cavecrew', 'strategic-compact', 'context-budget', 'token-budget'] },
  { phrase: '邮件运营', persona: 'general', keys: ['email-ops', 'gmail', 'imap'] },
  { phrase: '日历日程', persona: 'general', keys: ['calendar', 'schedule meeting'] },
  { phrase: '文件整理', persona: 'general', keys: ['file organiz'] },
  { phrase: '内部沟通', persona: 'general', keys: ['internal-comms'] },
  { phrase: 'Slack助手', persona: 'general', keys: ['slack'] },
  { phrase: '模板技能', persona: 'general', keys: ['template-skill'] },
  { phrase: '给代理写', persona: 'general', keys: ['writing-for-agents', 'writing-beats', 'writing-fragments'] },
  {
    phrase: '装技能',
    persona: 'general',
    keys: [
      'skill-creator',
      'skill-installer',
      'using-agent-skills',
      'using-superpowers',
      'create skill',
      'install skill',
      'skill-stocktake',
      '装技能',
    ],
  },
  { phrase: '拆任务', persona: 'general', keys: ['task breakdown', 'plan-writing', '拆任务'] },
  { phrase: '会议纪要', persona: 'general', keys: ['meeting notes', 'standup', '会议纪要'] },
  { phrase: '研究检索', persona: 'general', keys: ['web search', 'gpt-researcher', 'gpt researcher', 'exa-search', 'iterative-retrieval', '检索', '.claude'] },
  { phrase: '头脑风暴', persona: 'general', keys: ['brainstorm', 'ideation', 'idea-refine', '头脑风暴'] },
]

/** 名称 kebab 词 → 短语（只看名称 token，避免摘要误伤） */
const TOKEN_PHRASE: Record<string, { phrase: string; persona: ClassifiedPersona }> = {
  security: { phrase: '安全加固', persona: 'software-backend' },
  testing: { phrase: '测试', persona: 'software-backend' },
  test: { phrase: '测试', persona: 'software-backend' },
  tests: { phrase: '测试', persona: 'software-backend' },
  research: { phrase: '研究检索', persona: 'general' },
  agent: { phrase: 'Agent编排', persona: 'general' },
  verification: { phrase: '验证循环', persona: 'software-backend' },
  review: { phrase: '代码审查', persona: 'software-backend' },
  laravel: { phrase: '语言惯用法', persona: 'software-backend' },
  springboot: { phrase: '语言惯用法', persona: 'software-backend' },
  quarkus: { phrase: '语言惯用法', persona: 'software-backend' },
  csharp: { phrase: '语言惯用法', persona: 'software-backend' },
  python: { phrase: '语言惯用法', persona: 'software-backend' },
  golang: { phrase: '语言惯用法', persona: 'software-backend' },
  audit: { phrase: '安全加固', persona: 'software-backend' },
  marketing: { phrase: '转化文案', persona: 'marketing' },
  content: { phrase: '内容日历', persona: 'marketing' },
  pipeline: { phrase: '工作流自动化', persona: 'software-backend' },
  workflow: { phrase: '工作流自动化', persona: 'software-backend' },
  prompt: { phrase: '提示工程', persona: 'software-backend' },
  architecture: { phrase: '架构设计', persona: 'software-backend' },
  knowledge: { phrase: '知识库索引', persona: 'learning' },
  swift: { phrase: '移动应用', persona: 'software-frontend' },
  handoff: { phrase: '拆任务', persona: 'general' },
  dashboard: { phrase: '指标分析', persona: 'product' },
  payment: { phrase: '财务记账', persona: 'product' },
  search: { phrase: '研究检索', persona: 'general' },
  logistics: { phrase: '供应链', persona: 'product' },
  quality: { phrase: '测试', persona: 'software-backend' },
  memory: { phrase: '上下文压缩', persona: 'general' },
  harness: { phrase: 'Agent编排', persona: 'general' },
  connector: { phrase: 'API对接', persona: 'software-backend' },
  cache: { phrase: '性能优化', persona: 'software-backend' },
  optimizer: { phrase: '性能优化', persona: 'software-backend' },
  discovery: { phrase: '用户调研', persona: 'product' },
  scan: { phrase: '安全加固', persona: 'software-backend' },
  builder: { phrase: '代码生成', persona: 'software-backend' },
  deploy: { phrase: '发布上线', persona: 'software-backend' },
  debug: { phrase: '修缺陷', persona: 'software-backend' },
  refactor: { phrase: '重构清理', persona: 'software-backend' },
  frontend: { phrase: '前端界面', persona: 'software-frontend' },
  backend: { phrase: '写功能', persona: 'software-backend' },
  api: { phrase: 'API对接', persona: 'software-backend' },
  graphql: { phrase: 'API对接', persona: 'software-backend' },
  docker: { phrase: '基础设施', persona: 'software-backend' },
  kubernetes: { phrase: '基础设施', persona: 'software-backend' },
  terraform: { phrase: '基础设施', persona: 'software-backend' },
  gcp: { phrase: '基础设施', persona: 'software-backend' },
  azure: { phrase: 'Azure云', persona: 'software-backend' },
  react: { phrase: '前端界面', persona: 'software-frontend' },
  nextjs: { phrase: '前端框架', persona: 'software-frontend' },
  vue: { phrase: '前端界面', persona: 'software-frontend' },
  android: { phrase: '移动应用', persona: 'software-frontend' },
  ios: { phrase: '移动应用', persona: 'software-frontend' },
  flutter: { phrase: '移动应用', persona: 'software-frontend' },
  email: { phrase: '邮件运营', persona: 'general' },
  slack: { phrase: 'Slack助手', persona: 'general' },
  meeting: { phrase: '会议纪要', persona: 'general' },
  writing: { phrase: '长文起草', persona: 'writing' },
  translate: { phrase: '翻译润色', persona: 'writing' },
  seo: { phrase: 'SEO', persona: 'marketing' },
  pricing: { phrase: '定价', persona: 'marketing' },
  twitter: { phrase: '社媒短文', persona: 'marketing' },
  linkedin: { phrase: '社媒短文', persona: 'marketing' },
  prd: { phrase: '写需求', persona: 'product' },
  roadmap: { phrase: '发布计划', persona: 'product' },
  analytics: { phrase: '指标分析', persona: 'product' },
  invoice: { phrase: '财务记账', persona: 'product' },
  legal: { phrase: '法律合同', persona: 'product' },
  pdf: { phrase: 'PDF处理', persona: 'docs' },
  pptx: { phrase: '幻灯片', persona: 'docs' },
  xlsx: { phrase: '表格处理', persona: 'docs' },
  documentation: { phrase: '文档结构', persona: 'writing' },
  ads: { phrase: '投放', persona: 'marketing' },
  auth: { phrase: '安全加固', persona: 'software-backend' },
  stripe: { phrase: '财务记账', persona: 'product' },
  aeo: { phrase: 'SEO', persona: 'marketing' },
  aso: { phrase: 'SEO', persona: 'marketing' },
}

/**
 * 来源主题兜底：仅当名称+摘要零命中时，按 sourceId 子串归档。
 * 不进 haystack；规则命中永远优先。杂货源不收录。
 */
const SOURCE_THEME: { key: string; persona: ClassifiedPersona; phrase?: string }[] = [
  { key: 'nvidia-skills', persona: 'software-backend' },
  { key: 'k-dense-ai-scientific', persona: 'learning', phrase: '科学计算' },
  { key: 'earthtojake-text-to-cad', persona: 'engineering', phrase: '参数化CAD' },
  { key: 'trailofbits', persona: 'software-backend' },
  { key: 'aws-agent-toolkit', persona: 'software-backend' },
  { key: 'expo-skills', persona: 'software-frontend', phrase: '移动应用' },
  { key: 'get-convex', persona: 'software-backend' },
  { key: 'huggingface', persona: 'software-backend' },
  { key: 'microsoft-skills', persona: 'software-backend' },
  { key: 'remotion', persona: 'creative', phrase: '音视频' },
  { key: 'phuryn-pm', persona: 'product' },
  { key: 'coreyhaines31', persona: 'marketing' },
  { key: 'affaan-m-ecc', persona: 'general', phrase: 'Agent编排' },
  { key: 'open-gsd-gsd-core', persona: 'general' },
  { key: 'luongnv89', persona: 'general', phrase: '装技能' },
  { key: 'larksuite', persona: 'general' },
  { key: 'supabase', persona: 'software-backend', phrase: '数据库' },
  { key: 'antfu-skills', persona: 'software-frontend', phrase: '前端框架' },
  { key: 'onmax-nuxt-skills', persona: 'software-frontend', phrase: '前端框架' },
  { key: 'nextlevelbuilder-ui-ux-pro-max', persona: 'creative', phrase: '网页设计' },
  { key: 'vercel-labs-agent-browser', persona: 'software-backend', phrase: '数据抓取' },
]

function buildPhraseTable(): Record<ClassifiedPersona, string[]> {
  const out = {} as Record<ClassifiedPersona, string[]>
  for (const id of Object.keys(PERSONA_PRIORITY) as ClassifiedPersona[]) out[id] = []
  for (const r of RULES) {
    if (!out[r.persona].includes(r.phrase)) out[r.persona].push(r.phrase)
  }
  return out
}

export const PERSONA_PHRASES: Record<ClassifiedPersona, string[]> = buildPhraseTable()

export const PHRASE_CHIP_MAX = 10

/** 出表上限：约一屏工作台行（行高 33px × 12 ≈ 396px）。少于 10 会多切无意义层，多于 20 仍难扫。 */
export const FUNNEL_LIST_MAX = 12

/** 十档子档：Research/16 按 14 公开区域细切。软件后端 sw-auto 仍排第一。 */
export const PERSONA_SUBS: Record<ClassifiedPersona, PersonaSubDef[]> = {
  'software-frontend': [
    {
      id: 'sw-front',
      label: { zh: '前端', en: 'Frontend' },
      phrases: ['前端框架', '前端界面', '状态管理', 'UI风格', '国际化', '无障碍'],
    },
    { id: 'sw-client', label: { zh: '客户端', en: 'Clients' }, phrases: ['移动应用', '游戏开发', '桌面壳'] },
  ],
  'software-backend': [
    { id: 'sw-auto', label: { zh: '工作流自动化', en: 'Workflow' }, phrases: ['工作流自动化'] },
    { id: 'sw-scrape', label: { zh: '数据抓取', en: 'Scraping' }, phrases: ['数据抓取'] },
    { id: 'sw-cli', label: { zh: '命令行', en: 'CLI' }, phrases: ['CLI工具'] },
    { id: 'sw-lang', label: { zh: '语言惯用法', en: 'Language' }, phrases: ['语言惯用法', '类型安全'] },
    { id: 'sw-impl', label: { zh: '功能实现', en: 'Implement' }, phrases: ['写功能', '代码生成', '重构清理', '仓库导览'] },
    { id: 'sw-test', label: { zh: '测试', en: 'Testing' }, phrases: ['测试', '验证循环', '基准测试'] },
    { id: 'sw-review', label: { zh: '审查修补', en: 'Review' }, phrases: ['修缺陷', '代码审查', '品味审查', '合并冲突'] },
    { id: 'sw-sec', label: { zh: '安全', en: 'Security' }, phrases: ['安全加固', '威胁建模'] },
    { id: 'sw-comp', label: { zh: '合规', en: 'Compliance' }, phrases: ['合规检查'] },
    { id: 'sw-collab', label: { zh: '协作', en: 'Collab' }, phrases: ['GitHub协作'] },
    { id: 'sw-api', label: { zh: '接口', en: 'APIs' }, phrases: ['API对接', 'MCP构建'] },
    { id: 'sw-infra', label: { zh: '云与设施', en: 'Infra' }, phrases: ['基础设施', 'Azure云'] },
    { id: 'sw-observe', label: { zh: '可观测', en: 'Observability' }, phrases: ['可观测性', '日志查询', '成本优化'] },
    { id: 'sw-ship', label: { zh: '交付上线', en: 'Ship' }, phrases: ['发布上线', '启动发布', '迁移升级'] },
    { id: 'sw-db', label: { zh: '数据库', en: 'Database' }, phrases: ['数据库'] },
    { id: 'sw-ml', label: { zh: '机器学习', en: 'ML' }, phrases: ['机器学习', '提示工程'] },
    { id: 'sw-arch', label: { zh: '架构性能', en: 'Architecture' }, phrases: ['架构设计', '性能优化'] },
  ],
  writing: [
    { id: 'wr-draft', label: { zh: '长文起草', en: 'Longform' }, phrases: ['长文起草'] },
    { id: 'wr-academic', label: { zh: '学术写作', en: 'Academic' }, phrases: ['学术写作'] },
    { id: 'wr-deai', label: { zh: '去AI腔', en: 'De-AI' }, phrases: ['去AI腔'] },
    { id: 'wr-trans', label: { zh: '翻译润色', en: 'Translate' }, phrases: ['翻译润色'] },
    { id: 'wr-notes', label: { zh: '笔记整理', en: 'Notes' }, phrases: ['笔记整理'] },
    { id: 'wr-doc', label: { zh: '文档结构', en: 'Doc structure' }, phrases: ['文档结构'] },
  ],
  learning: [
    { id: 'ln-teach', label: { zh: '教学出题', en: 'Teaching' }, phrases: ['教学出题'] },
    { id: 'ln-loop', label: { zh: '持续学习', en: 'Continual' }, phrases: ['持续学习'] },
    { id: 'ln-first', label: { zh: '第一性学习', en: 'First principles' }, phrases: ['第一性学习'] },
    { id: 'ln-kb', label: { zh: '知识库索引', en: 'Knowledge base' }, phrases: ['知识库索引'] },
    { id: 'ln-graph', label: { zh: '知识图谱', en: 'Knowledge graph' }, phrases: ['知识图谱'] },
    { id: 'ln-sci', label: { zh: '科学计算', en: 'Scientific computing' }, phrases: ['科学计算'] },
    { id: 'ln-med', label: { zh: '医学辅助', en: 'Medical' }, phrases: ['医学辅助'] },
  ],
  marketing: [
    { id: 'mk-copy', label: { zh: '转化文案', en: 'Copy' }, phrases: ['转化文案'] },
    { id: 'mk-cold', label: { zh: '冷邮件', en: 'Cold email' }, phrases: ['冷邮件'] },
    { id: 'mk-price', label: { zh: '定价', en: 'Pricing' }, phrases: ['定价'] },
    { id: 'mk-ads', label: { zh: '投放', en: 'Ads' }, phrases: ['投放'] },
    { id: 'mk-seo', label: { zh: 'SEO', en: 'SEO' }, phrases: ['SEO'] },
    { id: 'mk-growth', label: { zh: '增长实验', en: 'Growth' }, phrases: ['增长实验'] },
    { id: 'mk-social', label: { zh: '社媒短文', en: 'Social' }, phrases: ['社媒短文'] },
    { id: 'mk-cal', label: { zh: '内容日历', en: 'Calendar' }, phrases: ['内容日历'] },
    { id: 'mk-ecom', label: { zh: '电商运营', en: 'Commerce' }, phrases: ['电商运营'] },
  ],
  product: [
    { id: 'pd-discover', label: { zh: '发现立项', en: 'Discovery' }, phrases: ['产品立项', '竞品分析', '用户调研'] },
    { id: 'pd-reqs', label: { zh: '需求决策', en: 'Requirements' }, phrases: ['写需求', '决策备忘'] },
    { id: 'pd-launch', label: { zh: '发布增长', en: 'Launch' }, phrases: ['发布计划', '增长上市'] },
    { id: 'pd-metrics', label: { zh: '指标分析', en: 'Metrics' }, phrases: ['指标分析'] },
    { id: 'pd-invest', label: { zh: '投资材料', en: 'Investor' }, phrases: ['投资材料'] },
    { id: 'pd-supply', label: { zh: '供应链', en: 'Supply' }, phrases: ['供应链'] },
    { id: 'pd-hr', label: { zh: '招聘人事', en: 'Hiring' }, phrases: ['招聘人事'] },
    { id: 'pd-cs', label: { zh: '客户支持', en: 'Support' }, phrases: ['客户支持'] },
    { id: 'pd-legal', label: { zh: '法律合同', en: 'Legal' }, phrases: ['法律合同'] },
    { id: 'pd-fin', label: { zh: '财务记账', en: 'Finance' }, phrases: ['财务记账'] },
  ],
  docs: [
    { id: 'dc-slides', label: { zh: '幻灯片', en: 'Slides' }, phrases: ['幻灯片'] },
    { id: 'dc-sheets', label: { zh: '表格处理', en: 'Sheets' }, phrases: ['表格处理'] },
    { id: 'dc-pdf', label: { zh: 'PDF处理', en: 'PDF' }, phrases: ['PDF处理'] },
    { id: 'dc-conv', label: { zh: '文档转换', en: 'Convert' }, phrases: ['文档转换'] },
    {
      id: 'dc-prod',
      label: { zh: '产品文档', en: 'Product docs' },
      phrases: ['核心逻辑', '项目文档', '帮助手册', '术语门闩', '总体计划'],
    },
  ],
  creative: [
    { id: 'cr-brand', label: { zh: '品牌规范', en: 'Brand' }, phrases: ['品牌规范'] },
    { id: 'cr-ui', label: { zh: '界面设计', en: 'UI design' }, phrases: ['画布原型', '主题设计', '网页设计'] },
    { id: 'cr-image', label: { zh: '图像处理', en: 'Images' }, phrases: ['图像处理'] },
    { id: 'cr-av', label: { zh: '音视频', en: 'AV' }, phrases: ['音视频'] },
    { id: 'cr-voice', label: { zh: '语音合成', en: 'Speech' }, phrases: ['语音合成'] },
    { id: 'cr-art', label: { zh: '算法艺术', en: 'Generative art' }, phrases: ['算法艺术'] },
    { id: 'cr-3d', label: { zh: '三维建模', en: '3D' }, phrases: ['三维建模'] },
  ],
  engineering: [
    { id: 'en-std', label: { zh: '规范问答', en: 'Standards' }, phrases: ['规范问答'] },
    { id: 'en-calc', label: { zh: '结构计算', en: 'Structural calc' }, phrases: ['结构计算'] },
    { id: 'en-spec', label: { zh: '结构说明', en: 'Design notes' }, phrases: ['结构说明'] },
    { id: 'en-review', label: { zh: '图纸审查', en: 'Plan review' }, phrases: ['图纸审查'] },
    { id: 'en-site', label: { zh: '施工管理', en: 'Construction' }, phrases: ['施工管理'] },
    { id: 'en-bim', label: { zh: 'BIM建模', en: 'BIM' }, phrases: ['BIM建模'] },
    { id: 'en-gis', label: { zh: 'GIS地图', en: 'GIS' }, phrases: ['GIS地图'] },
    { id: 'en-cad', label: { zh: '参数化CAD', en: 'CAD' }, phrases: ['参数化CAD'] },
    { id: 'en-print', label: { zh: '切片打印', en: 'Print' }, phrases: ['切片打印'] },
  ],
  general: [
    { id: 'gn-install', label: { zh: '装技能', en: 'Install skills' }, phrases: ['装技能'] },
    { id: 'gn-split', label: { zh: '拆任务', en: 'Break down' }, phrases: ['拆任务'] },
    { id: 'gn-idea', label: { zh: '头脑风暴', en: 'Brainstorm' }, phrases: ['头脑风暴'] },
    { id: 'gn-agent', label: { zh: '智能体编排', en: 'Agent harness' }, phrases: ['Agent编排'] },
    { id: 'gn-agwrite', label: { zh: '给代理写', en: 'Write for agents' }, phrases: ['给代理写'] },
    { id: 'gn-compact', label: { zh: '上下文压缩', en: 'Compact' }, phrases: ['上下文压缩'] },
    { id: 'gn-tmpl', label: { zh: '模板技能', en: 'Template' }, phrases: ['模板技能'] },
    { id: 'gn-search', label: { zh: '研究检索', en: 'Research' }, phrases: ['研究检索'] },
    { id: 'gn-mail', label: { zh: '邮件运营', en: 'Email' }, phrases: ['邮件运营'] },
    { id: 'gn-cal', label: { zh: '日历日程', en: 'Calendar' }, phrases: ['日历日程'] },
    { id: 'gn-files', label: { zh: '文件整理', en: 'Files' }, phrases: ['文件整理'] },
    { id: 'gn-comms', label: { zh: '内部沟通', en: 'Comms' }, phrases: ['内部沟通'] },
    { id: 'gn-slack', label: { zh: 'Slack助手', en: 'Slack' }, phrases: ['Slack助手'] },
    { id: 'gn-meet', label: { zh: '会议纪要', en: 'Meetings' }, phrases: ['会议纪要'] },
  ],
}

const PHRASE_TO_SUB = new Map<string, PersonaSubId>()
for (const defs of Object.values(PERSONA_SUBS)) {
  for (const s of defs) {
    for (const p of s.phrases) PHRASE_TO_SUB.set(p, s.id)
  }
}

export function personaSubDefs(persona: ClassifiedPersona): PersonaSubDef[] {
  return PERSONA_SUBS[persona]
}

export function personaSubsOf(phrases: readonly string[], persona: ClassifiedPersona): PersonaSubId[] {
  const allowed = new Set(PERSONA_SUBS[persona].map((s) => s.id))
  const out: PersonaSubId[] = []
  for (const p of phrases) {
    const s = PHRASE_TO_SUB.get(p)
    if (s && allowed.has(s) && !out.includes(s)) out.push(s)
  }
  return out
}

function stemName(name: string): string {
  return String(name || '')
    .replace(/\s*·\s*.+$/, '')
    .trim()
}

function tokensOf(s: string): string[] {
  return String(s)
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean)
}

type KeyTester = (h: string, toks: ReadonlySet<string>) => boolean

function compileKey(key: string): KeyTester {
  const k = String(key).toLowerCase().trim()
  if (!k) return () => false
  if (/[\u4e00-\u9fff]/.test(k)) return (h) => h.includes(k)
  if (k.includes(' ') || k.includes('/') || k.includes('-')) return (h) => h.includes(k)
  if (k.length <= 4) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?:^|[^a-z0-9])${esc}(?:$|[^a-z0-9])`)
    return (h, toks) => toks.has(k) || re.test(h)
  }
  return (h) => h.includes(k)
}

const COMPILED_RULES = RULES.map((r) => ({
  phrase: r.phrase,
  persona: r.persona,
  testers: r.keys.map(compileKey),
}))

function entryIdTail(entryId: string): string {
  const id = String(entryId || '')
  const i = id.lastIndexOf(':')
  return i >= 0 ? id.slice(i + 1) : id
}

function contentHaystack(
  item: Pick<LibraryListItemDto, 'displayName' | 'summary' | 'entryId'>,
): string {
  return [item.displayName, item.summary, entryIdTail(item.entryId || '')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function relPath(item: Pick<LibraryListItemDto, 'libraryPathRel'>): string {
  return (item.libraryPathRel || '').replace(/\\/g, '/').toLowerCase()
}

/** 细分用：名称+摘要+id 尾 + 缓存相对路径。归档仍只用 contentHaystack，避免路径里的仓库名整仓误标。 */
function haystack(
  item: Pick<LibraryListItemDto, 'displayName' | 'summary' | 'entryId' | 'libraryPathRel'>,
): string {
  return [contentHaystack(item), relPath(item)].filter(Boolean).join(' ')
}

function pickPersona(personas: Set<ClassifiedPersona>): PersonaId {
  if (personas.size === 0) return 'unclassified'
  let best: ClassifiedPersona | null = null
  let bestPri = 99
  for (const p of personas) {
    const pri = PERSONA_PRIORITY[p]
    if (pri < bestPri) {
      best = p
      bestPri = pri
    }
  }
  return best ?? 'unclassified'
}

/**
 * 派生主档 + 能对上的短语。主档唯一（09 优先级）；短语可多个。
 * 不写盘、不改索引。
 */
export function derivePersona(
  item: Pick<
    LibraryListItemDto,
    'displayName' | 'summary' | 'searchText' | 'sourceId' | 'entryId' | 'libraryPathRel'
  >,
): { personaId: PersonaId; phrases: string[] } {
  const stem = stemName(item.displayName || '')
  const h = contentHaystack(item)
  const toks = new Set(tokensOf(h))
  const phraseSet = new Set<string>()
  const personas = new Set<ClassifiedPersona>()
  const add = (phrase: string, persona: ClassifiedPersona) => {
    phraseSet.add(phrase)
    personas.add(persona)
  }
  for (const r of COMPILED_RULES) {
    for (const t of r.testers) {
      if (t(h, toks)) {
        add(r.phrase, r.persona)
        break
      }
    }
  }
  for (const t of tokensOf(stem)) {
    const mapped = TOKEN_PHRASE[t]
    if (mapped) add(mapped.phrase, mapped.persona)
  }
  if (personas.size === 0) {
    const sid = String(item.sourceId || '').toLowerCase()
    if (sid) {
      for (const t of SOURCE_THEME) {
        if (!sid.includes(t.key)) continue
        if (t.phrase) add(t.phrase, t.persona)
        else personas.add(t.persona)
        break
      }
    }
  }
  return { personaId: pickPersona(personas), phrases: [...phraseSet] }
}

export function annotateFunnelItem(
  item: LibraryListItemDto,
  origin: FunnelOrigin,
): FunnelListItem {
  const d = derivePersona(item)
  const personaSubs = d.personaId === 'unclassified' ? [] : personaSubsOf(d.phrases, d.personaId)
  return {
    ...item,
    funnelOrigin: origin,
    personaId: d.personaId,
    personaPhrases: d.phrases,
    personaSubs,
    funnelSearchHay: buildFunnelSearchHay(item, d.personaId, d.phrases, personaSubs),
  }
}

/** 中文短语 id 的展示别名（芯片上不直接用生 id）。 */
const PHRASE_ZH_ALIAS: Record<string, string> = {
  Agent编排: '智能体编排',
  API对接: '接口对接',
  CLI工具: '命令行',
  Azure云: '微软云',
  MCP构建: 'MCP服务',
  SEO: '搜索优化',
  'fn:foundry': 'Foundry',
  'fn:azure-ai': 'Azure AI',
  'fn:azure-data': '数据存储',
  'fn:azure-messaging': '消息事件',
  'fn:azure-identity': '身份密钥',
  'fn:azure-monitor': '监视',
  'fn:azure-integration': '集成管理',
  'fn:azure-compute': '计算部署',
  'fn:m365': 'M365',
  'fn:sci-genomics': '基因组',
  'fn:sci-chem': '药物化学',
  'fn:sci-clinical': '临床影像',
  'fn:sci-ml': '机器学习',
  'fn:sci-physics': '材料物理',
  'fn:sci-data': '数据分析',
  'fn:sci-lab': '实验自动化',
  'fn:sci-comms': '科研写作',
  'fn:sci-method': '方法平台',
  'path:skills': '技能包',
  'path:prompts': '提示词',
  'path:instructions': '指令',
  'path:agents': '代理角色',
  'lang:py': 'Python',
  'lang:ts': 'TypeScript',
  'lang:dotnet': '.NET',
  'lang:java': 'Java',
  'lang:rust': 'Rust',
  'fn:nv-doca': 'DOCA网络',
  'fn:nv-tao': 'TAO视觉',
  'fn:nv-nemo': 'NeMo训练',
  'fn:nv-jetson': 'Jetson边缘',
  'fn:nv-cudax': 'CUDA-X计算',
  'fn:nv-video': '视频分析',
  'fn:nv-holoscan': '医疗传感',
  'fn:nv-physics': '物理仿真',
  'fn:nv-rag': 'RAG推理',
  'fn:aws-serverless': '计算无服务',
  'fn:aws-storage': '存储分析',
  'fn:aws-database': '云数据库',
  'fn:aws-network': '网络分发',
  'fn:aws-identity': '身份安全',
  'fn:aws-ops': '可观测运维',
  'fn:aws-template': '模板部署',
  'fn:aws-bedrock': 'Bedrock智能体',
  'fn:aws-migrate': '迁移韧性',
  'fn:copilot-gtm': '增长上市',
  'fn:copilot-prd': '写需求',
  'fn:copilot-sec': '安全审查',
  'fn:copilot-cloud': '云服务',
  'fn:copilot-test': '语言测试',
  'fn:copilot-docs': '文档转换',
  'fn:copilot-mcp': 'MCP服务',
  'fn:copilot-migrate': '迁移方案',
  'fn:media-image': '图像生成',
  'fn:media-video': '视频生成',
  'fn:media-audio': '语音音频',
  'fn:media-design': '设计视觉',
  'fn:media-writing': '写作内容',
  'fn:media-social': '社媒素材',
  'fn:media-product': '产品指南',
  'fn:media-sdk': '界面SDK',
  'fn:media-platform': '平台工具',
  'fn:tob-contracts': '合约安全',
  'fn:tob-audit': '代码审计',
  'fn:tob-malware': '恶意分析',
  'fn:tob-verify': '形式验证',
  'fn:tob-reverse': '逆向工程',
  'fn:tob-mobile': '移动安全',
  'fn:tob-eng': '工程配套',
  'fn:tob-team': '团队管理',
  'fn:tob-trouble': '排障工具',
  'fn:gsd-workflow': '工作流环',
  'fn:gsd-ideate': '构思规格',
  'fn:gsd-review': '质量审查',
  'fn:gsd-project': '项目里程碑',
  'fn:gsd-manage': '配置工作区',
  'fn:gsd-context': '记忆上下文',
  'fn:gsd-help': '帮助更新',
  'fn:pm-exec': '执行落地',
  'fn:pm-discover': '产品发现',
  'fn:pm-strategy': '产品战略',
  'fn:pm-research': '市场研究',
  'fn:pm-gtm': '上市动作',
  'fn:pm-growth': '营销增长',
  'fn:pm-toolkit': '工具箱',
  'fn:pm-data': '数据分析',
  'fn:pm-ai': 'AI交付',
  'fn:mkt-seo': 'SEO检索',
  'fn:mkt-cold': '冷邮件获客',
  'fn:mkt-pricing': '定价变现',
  'fn:mkt-ads': '投放广告',
  'fn:mkt-copy': '转化文案',
  'fn:mkt-social': '社媒内容',
  'fn:mkt-growth': '增长留存',
  'fn:mkt-sales': '销售公关',
  'fn:mkt-strategy': '策略研究',
  'fn:jeff-lang': '语言',
  'fn:jeff-backend': '后端框架',
  'fn:jeff-frontend': '前端移动',
  'fn:jeff-cloud': '云与库',
  'fn:jeff-arch': '架构接口',
  'fn:jeff-test': '测试质量',
  'fn:jeff-ops': '运维发布',
  'fn:jeff-sec': '安全',
  'fn:jeff-data': '数据机器学习',
  'fn:sp-cursor': 'Cursor原生',
  'fn:sp-test': '测试浏览器',
  'fn:sp-auth': '鉴权收款',
  'fn:sp-metrics': '指标监控',
  'fn:sp-infra': '发布基础设施',
  'fn:sp-quality': '质量安全',
  'fn:sp-ui': '前端界面',
  'fn:sp-copy': '文案SEO',
  'fn:sp-flow': '工作流并行',
  'fn:sw-ai': 'AI工具',
  'fn:sw-meta': '元技能',
  'fn:sw-docs': '文档图表',
  'fn:sw-ui': '前端设计',
  'fn:sw-quality': '开发质量',
  'fn:sw-product': '产品规划',
  'fn:sw-work': '职场沟通',
  'fn:sw-test': '测试',
  'fn:sw-tools': '工具杂项',
  'fn:spow-tdd': '测试驱动',
  'fn:spow-debug': '系统调试',
  'fn:spow-plan': '写计划',
  'fn:spow-subagent': '子代理',
  'fn:spow-review': '代码审查',
  'fn:spow-git': 'Git工作区',
  'fn:spow-meta': '装技能',
  'fn:cvx-start': '起步建库',
  'fn:cvx-auth': '鉴权授权',
  'fn:cvx-data': '数据运维',
  'fn:cvx-deploy': '部署发布',
  'fn:cvx-cost': '观测成本',
  'fn:cvx-test': '审查测试',
  'fn:cvx-agent': 'Agent组件',
  'fn:cvx-docs': '文档插件',
  'fn:hf-hub': 'Hub命令',
  'fn:hf-data': '数据集',
  'fn:hf-train': '训练微调',
  'fn:hf-spaces': 'Spaces演示',
  'fn:hf-cloud': 'SageMaker上云',
  'fn:hf-local': '本地推理',
  'fn:hf-eval': '论文评测',
  'fn:expo-router': '路由导航',
  'fn:expo-ui': '原生界面',
  'fn:expo-design': '设计系统',
  'fn:expo-data': '数据请求',
  'fn:expo-module': '原生模块',
  'fn:expo-store': '应用商店',
  'fn:expo-cloud': '云构建',
  'fn:expo-migrate': '迁移升级',
  'fn:expo-feedback': '技能反馈',
  'fn:addy-discover': '发现技能',
  'fn:addy-define': '定义规格',
  'fn:addy-plan': '拆任务',
  'fn:addy-build': '增量构建',
  'fn:addy-verify': '验证调试',
  'fn:addy-review': '质量审查',
  'fn:addy-sec': '安全加固',
  'fn:addy-perf': '性能',
  'fn:addy-ship': '发布上线',
  'fn:matt-eng': '工程日常',
  'fn:matt-grill': '拷问对齐',
  'fn:matt-arch': '架构设计',
  'fn:matt-prod': '生产力',
  'fn:matt-write': '给代理写',
  'fn:matt-ts': 'TypeScript课',
  'fn:matt-git': 'Git护栏',
  'fn:rem-create': '创建升级',
  'fn:rem-captions': '字幕剪辑',
  'fn:rem-render': '渲染导出',
  'fn:rem-maps': '地图交互',
  'fn:rem-studio': 'Studio文档',
}

/** 短语 / 细分 / 连接器芯片的英文；缺译时 chipCopy 会把 en 也写成中文 id。 */
const PHRASE_EN: Record<string, string> = {
  规范问答: 'Standards Q&A',
  结构计算: 'Structural calc',
  结构说明: 'Design statement',
  图纸审查: 'Drawing review',
  施工管理: 'Construction',
  BIM建模: 'BIM',
  GIS地图: 'GIS',
  参数化CAD: 'Parametric CAD',
  切片打印: 'Slicing / print',
  第一性学习: 'First principles',
  知识库索引: 'Knowledge index',
  知识图谱: 'Knowledge graph',
  教学出题: 'Quizzes',
  持续学习: 'Continuous learning',
  医学辅助: 'Medical',
  科学计算: 'Scientific computing',
  核心逻辑: 'Core logic',
  项目文档: 'Project docs',
  帮助手册: 'Help manual',
  术语门闩: 'Terminology gate',
  总体计划: 'Master plan',
  幻灯片: 'Slides',
  表格处理: 'Spreadsheets',
  PDF处理: 'PDF',
  文档转换: 'Doc conversion',
  算法艺术: 'Algorithmic art',
  品牌规范: 'Brand guidelines',
  画布原型: 'Canvas / Figma',
  主题设计: 'Theme design',
  网页设计: 'Web design',
  图像处理: 'Images',
  音视频: 'Audio/video',
  语音合成: 'Speech synthesis',
  三维建模: '3D modeling',
  产品立项: 'Product discovery',
  竞品分析: 'Competitive analysis',
  财务记账: 'Billing',
  法律合同: 'Legal / contracts',
  招聘人事: 'Hiring',
  客户支持: 'Support',
  投资材料: 'Investor materials',
  供应链: 'Supply chain',
  性能优化: 'Performance',
  UI风格: 'UI style',
  品味审查: 'Taste review',
  桌面壳: 'Desktop shell',
  MCP构建: 'MCP builder',
  Azure云: 'Azure',
  GitHub协作: 'GitHub',
  安全加固: 'Security hardening',
  威胁建模: 'Threat modeling',
  合规检查: 'Compliance',
  成本优化: 'Cost optimization',
  日志查询: 'Log query',
  数据库: 'Databases',
  API对接: 'API integration',
  工作流自动化: 'Workflow automation',
  数据抓取: 'Scraping',
  机器学习: 'Machine learning',
  提示工程: 'Prompt engineering',
  语言惯用法: 'Language idioms',
  前端框架: 'Frontend frameworks',
  移动应用: 'Mobile apps',
  游戏开发: 'Game development',
  基础设施: 'Infrastructure',
  可观测性: 'Observability',
  无障碍: 'Accessibility',
  国际化: 'i18n',
  迁移升级: 'Migrations',
  代码生成: 'Codegen',
  类型安全: 'Type safety',
  状态管理: 'State management',
  CLI工具: 'CLI tools',
  合并冲突: 'Merge conflicts',
  验证循环: 'Verification loop',
  仓库导览: 'Code tour',
  启动发布: 'Launch',
  基准测试: 'Benchmarks',
  写功能: 'Features',
  修缺陷: 'Bugfix',
  代码审查: 'Code review',
  测试: 'Testing',
  前端界面: 'Frontend UI',
  发布上线: 'Deploy',
  重构清理: 'Refactor',
  架构设计: 'Architecture',
  长文起草: 'Longform',
  去AI腔: 'De-AI tone',
  翻译润色: 'Translation',
  笔记整理: 'Notes',
  学术写作: 'Academic writing',
  文档结构: 'Doc structure',
  转化文案: 'Conversion copy',
  冷邮件: 'Cold email',
  SEO: 'SEO',
  定价: 'Pricing',
  投放: 'Ads',
  社媒短文: 'Social posts',
  内容日历: 'Content calendar',
  增长实验: 'Growth experiments',
  电商运营: 'Ecommerce',
  写需求: 'Requirements',
  用户调研: 'User research',
  决策备忘: 'Decision records',
  发布计划: 'Roadmap',
  增长上市: 'GTM launch',
  指标分析: 'Metrics',
  Agent编排: 'Agent orchestration',
  上下文压缩: 'Context compression',
  邮件运营: 'Email ops',
  日历日程: 'Calendar',
  文件整理: 'File organization',
  内部沟通: 'Internal comms',
  Slack助手: 'Slack',
  模板技能: 'Skill templates',
  给代理写: 'Writing for agents',
  装技能: 'Install skills',
  拆任务: 'Task breakdown',
  会议纪要: 'Meeting notes',
  研究检索: 'Research',
  头脑风暴: 'Brainstorm',
  融资投资: 'Fundraising',
  定价策略: 'Pricing strategy',
  法务合规: 'Legal / compliance',
  日志追踪: 'Tracing',
  库表迁移: 'Schema migration',
  Linux运维: 'Linux ops',
  准备评估: 'Readiness',
  教学注释: 'Educational comments',
  评测实验: 'Eval experiments',
  应用商店: 'App stores',
  蛋白实验: 'Protein lab',
  单细胞: 'Single-cell',
  天体物理: 'Astrophysics',
  增长矩阵: 'Growth matrix',
  设计规范: 'Design specs',
  通讯协作: 'Comms',
  开发者工具: 'Dev tools',
  营销销售: 'Sales',
  文档存储: 'Docs & storage',
  财务收款: 'Payments',
  日历邮件: 'Calendar & mail',
  客服工单: 'Support tickets',
  电商零售: 'Retail',
  社媒渠道: 'Social channels',
  数据分析: 'Analytics',
  人事招聘: 'HR & hiring',
  'fn:foundry': 'Foundry',
  'fn:azure-ai': 'Azure AI',
  'fn:azure-data': 'Data & storage',
  'fn:azure-messaging': 'Messaging',
  'fn:azure-identity': 'Identity',
  'fn:azure-monitor': 'Monitoring',
  'fn:azure-integration': 'Integration',
  'fn:azure-compute': 'Compute & deploy',
  'fn:m365': 'M365',
  'fn:sci-genomics': 'Genomics',
  'fn:sci-chem': 'Cheminformatics',
  'fn:sci-clinical': 'Clinical imaging',
  'fn:sci-ml': 'Machine learning',
  'fn:sci-physics': 'Materials & physics',
  'fn:sci-data': 'Data analysis',
  'fn:sci-lab': 'Lab automation',
  'fn:sci-comms': 'Sci communication',
  'fn:sci-method': 'Methods & platforms',
  'path:skills': 'Skill packs',
  'path:prompts': 'Prompts',
  'path:instructions': 'Instructions',
  'path:agents': 'Agents',
  'lang:py': 'Python',
  'lang:ts': 'TypeScript',
  'lang:dotnet': '.NET',
  'lang:java': 'Java',
  'lang:rust': 'Rust',
  'fn:nv-doca': 'DOCA networking',
  'fn:nv-tao': 'TAO vision',
  'fn:nv-nemo': 'NeMo training',
  'fn:nv-jetson': 'Jetson edge',
  'fn:nv-cudax': 'CUDA-X compute',
  'fn:nv-video': 'Video analytics',
  'fn:nv-holoscan': 'Medical sensing',
  'fn:nv-physics': 'Physics sim',
  'fn:nv-rag': 'RAG inference',
  'fn:aws-serverless': 'Compute / serverless',
  'fn:aws-storage': 'Storage / analytics',
  'fn:aws-database': 'Databases',
  'fn:aws-network': 'Networking',
  'fn:aws-identity': 'Identity / security',
  'fn:aws-ops': 'Ops / observability',
  'fn:aws-template': 'Templates',
  'fn:aws-bedrock': 'Bedrock agents',
  'fn:aws-migrate': 'Migration',
  'fn:copilot-gtm': 'GTM launch',
  'fn:copilot-prd': 'Requirements',
  'fn:copilot-sec': 'Security review',
  'fn:copilot-cloud': 'Cloud services',
  'fn:copilot-test': 'Language tests',
  'fn:copilot-docs': 'Doc conversion',
  'fn:copilot-mcp': 'MCP servers',
  'fn:copilot-migrate': 'Migrations',
  'fn:media-image': 'Images',
  'fn:media-video': 'Video gen',
  'fn:media-audio': 'Speech / audio',
  'fn:media-design': 'Design',
  'fn:media-writing': 'Writing',
  'fn:media-social': 'Social media',
  'fn:media-product': 'Product guides',
  'fn:media-sdk': 'UI / SDK',
  'fn:media-platform': 'Platform tools',
  'fn:tob-contracts': 'Contracts',
  'fn:tob-audit': 'Code audit',
  'fn:tob-malware': 'Malware',
  'fn:tob-verify': 'Formal verify',
  'fn:tob-reverse': 'Reverse eng',
  'fn:tob-mobile': 'Mobile security',
  'fn:tob-eng': 'Eng tooling',
  'fn:tob-team': 'Team',
  'fn:tob-trouble': 'Troubleshooting',
  'fn:gsd-workflow': 'Workflow loop',
  'fn:gsd-ideate': 'Ideate / spec',
  'fn:gsd-review': 'Quality review',
  'fn:gsd-project': 'Milestones',
  'fn:gsd-manage': 'Workspace',
  'fn:gsd-context': 'Memory / context',
  'fn:gsd-help': 'Help / updates',
  'fn:pm-exec': 'Execution',
  'fn:pm-discover': 'Discovery',
  'fn:pm-strategy': 'Strategy',
  'fn:pm-research': 'Market research',
  'fn:pm-gtm': 'Go-to-market',
  'fn:pm-growth': 'Growth',
  'fn:pm-toolkit': 'Toolkit',
  'fn:pm-data': 'Analytics',
  'fn:pm-ai': 'AI shipping',
  'fn:mkt-seo': 'SEO',
  'fn:mkt-cold': 'Cold email',
  'fn:mkt-pricing': 'Pricing',
  'fn:mkt-ads': 'Ads',
  'fn:mkt-copy': 'Copy',
  'fn:mkt-social': 'Social content',
  'fn:mkt-growth': 'Retention',
  'fn:mkt-sales': 'Sales / PR',
  'fn:mkt-strategy': 'Strategy research',
  'fn:jeff-lang': 'Languages',
  'fn:jeff-backend': 'Backend',
  'fn:jeff-frontend': 'Frontend / mobile',
  'fn:jeff-cloud': 'Cloud / data',
  'fn:jeff-arch': 'Architecture',
  'fn:jeff-test': 'Testing',
  'fn:jeff-ops': 'Ops',
  'fn:jeff-sec': 'Security',
  'fn:jeff-data': 'Data / ML',
  'fn:sp-cursor': 'Cursor native',
  'fn:sp-test': 'Browser tests',
  'fn:sp-auth': 'Auth / billing',
  'fn:sp-metrics': 'Metrics',
  'fn:sp-infra': 'Ship / infra',
  'fn:sp-quality': 'Quality / security',
  'fn:sp-ui': 'Frontend UI',
  'fn:sp-copy': 'Copy / SEO',
  'fn:sp-flow': 'Parallel workflow',
  'fn:sw-ai': 'AI tools',
  'fn:sw-meta': 'Meta skills',
  'fn:sw-docs': 'Docs / diagrams',
  'fn:sw-ui': 'Frontend design',
  'fn:sw-quality': 'Dev quality',
  'fn:sw-product': 'Product planning',
  'fn:sw-work': 'Workplace',
  'fn:sw-test': 'Testing',
  'fn:sw-tools': 'Utilities',
  'fn:spow-tdd': 'TDD',
  'fn:spow-debug': 'Debugging',
  'fn:spow-plan': 'Planning',
  'fn:spow-subagent': 'Subagents',
  'fn:spow-review': 'Code review',
  'fn:spow-git': 'Git workspace',
  'fn:spow-meta': 'Install skills',
  'fn:cvx-start': 'Getting started',
  'fn:cvx-auth': 'Auth',
  'fn:cvx-data': 'Data ops',
  'fn:cvx-deploy': 'Deploy',
  'fn:cvx-cost': 'Cost / insights',
  'fn:cvx-test': 'Review / test',
  'fn:cvx-agent': 'Agent components',
  'fn:cvx-docs': 'Docs / plugins',
  'fn:hf-hub': 'Hub CLI',
  'fn:hf-data': 'Datasets',
  'fn:hf-train': 'Training',
  'fn:hf-spaces': 'Spaces',
  'fn:hf-cloud': 'SageMaker',
  'fn:hf-local': 'Local inference',
  'fn:hf-eval': 'Papers / eval',
  'fn:expo-router': 'Routing',
  'fn:expo-ui': 'Native UI',
  'fn:expo-design': 'Design system',
  'fn:expo-data': 'Data fetching',
  'fn:expo-module': 'Native modules',
  'fn:expo-store': 'App stores',
  'fn:expo-cloud': 'EAS cloud',
  'fn:expo-migrate': 'Upgrades',
  'fn:expo-feedback': 'Skill feedback',
  'fn:addy-discover': 'Discover',
  'fn:addy-define': 'Define',
  'fn:addy-plan': 'Plan',
  'fn:addy-build': 'Build',
  'fn:addy-verify': 'Verify',
  'fn:addy-review': 'Review',
  'fn:addy-sec': 'Security',
  'fn:addy-perf': 'Performance',
  'fn:addy-ship': 'Ship',
  'fn:matt-eng': 'Engineering',
  'fn:matt-grill': 'Grill / align',
  'fn:matt-arch': 'Architecture',
  'fn:matt-prod': 'Productivity',
  'fn:matt-write': 'Writing for agents',
  'fn:matt-ts': 'TypeScript',
  'fn:matt-git': 'Git guardrails',
  'fn:rem-create': 'Create / upgrade',
  'fn:rem-captions': 'Captions',
  'fn:rem-render': 'Render',
  'fn:rem-maps': 'Maps',
  'fn:rem-studio': 'Studio / docs',
}

function phraseChip(id: string): ChipCopy | undefined {
  const en = PHRASE_EN[id]
  if (!en) return undefined
  return { zh: PHRASE_ZH_ALIAS[id] ?? id, en }
}

/** 名称词 → 中文；无映射的生 token 不露面，并进「其他」。 */
const TOKEN_ZH: Record<string, string> = {
  auth: '鉴权',
  stripe: '收款',
  cuda: '显卡计算',
  nvidia: '英伟达',
  n8n: '开源编排',
  zapier: '连接器',
}

/** 来源短名 → 中文；Composio 大批量收成「Rube应用」，不铺每个 SaaS 英文名。 */
const SOURCE_ZH: { key: string; zh: string }[] = [
  { key: 'composio', zh: 'Rube应用' },
  { key: 'nvidia-skills', zh: '英伟达' },
  { key: 'microsoft-skills', zh: '微软技能' },
  { key: 'aws-agent', zh: '亚马逊云' },
  { key: 'github-awesome-copilot', zh: 'GitHub助手' },
  { key: 'coreyhaines', zh: '营销写作' },
  { key: 'inference-sh', zh: '生成媒体' },
  { key: 'alirezarezvani', zh: '商业技能集' },
  { key: 'spencerpauly', zh: 'Cursor技能集' },
  { key: 'softaworks', zh: '代理工具箱' },
  { key: 'jeffallan', zh: '技能合集' },
  { key: 'k-dense', zh: '科研工具' },
  { key: 'trailofbits', zh: '安全审计' },
  { key: 'affaan-m-ecc', zh: '多代理系统' },
  { key: 'open-gsd', zh: '任务拆解' },
  { key: 'phuryn-pm', zh: '产品技能' },
  { key: 'expo-skills', zh: 'Expo移动' },
  { key: 'get-convex', zh: 'Convex后端' },
  { key: 'huggingface', zh: '开源模型' },
  { key: 'mattpocock', zh: '类型安全课' },
  { key: 'larksuite', zh: '飞书' },
  { key: 'earthtojake', zh: '文本转CAD' },
  { key: 'obra-superpowers', zh: '超能力装技' },
  { key: 'luongnv89', zh: '技能管理' },
]

/** 细分层摘要关键词桶：只切分、不改归档。 */
const REFINE_RULES: { id: string; keys: string[] }[] = [
  { id: '融资投资', keys: ['fundraising', 'investor', 'venture capital', 'pitch deck', 'seed round'] },
  { id: '定价策略', keys: ['pricing strategy', 'pricing page', 'saas pricing'] },
  { id: '法务合规', keys: ['gdpr', 'hipaa', 'compliance', 'legal review', 'privacy policy'] },
  { id: '日志追踪', keys: ['tracing', 'opentelemetry', 'distributed trace'] },
  { id: '库表迁移', keys: ['schema migrat', 'flyway', 'liquibase', 'alembic'] },
  { id: 'Linux运维', keys: ['systemd', 'pacman', 'apt-get', 'arch linux', 'selinux'] },
  { id: '准备评估', keys: ['acreadiness', 'readiness assessment', 'agentrc'] },
  { id: '教学注释', keys: ['educational comments', 'add-educational'] },
  { id: '评测实验', keys: ['arize', 'llm-as-judge', 'experiment tracking'] },
  { id: '应用商店', keys: ['app store', 'play store', 'appstore'] },
  { id: '蛋白实验', keys: ['protein', 'foundry api', 'adaptyv'] },
  { id: '单细胞', keys: ['single-cell', 'anndata', 'scrna'] },
  { id: '天体物理', keys: ['astropy', 'astronomy'] },
  { id: '增长矩阵', keys: ['ansoff', 'market penet'] },
  { id: '设计规范', keys: ['human interface', 'hig-expert', 'unocss'] },
]

const COMPILED_REFINE = REFINE_RULES.map((r) => ({
  id: r.id,
  testers: r.keys.map(compileKey),
}))

/** GitHub 助手等：按缓存相对路径里的工件种类切，不靠来源整包。 */
const PATH_KIND_RULES: { id: string; test: (p: string) => boolean }[] = [
  { id: 'path:skills', test: (p) => /(?:^|\/)skills\//.test(p) },
  {
    id: 'path:prompts',
    test: (p) => /(?:^|\/)prompts\//.test(p) || p.includes('.prompt.md'),
  },
  {
    id: 'path:instructions',
    test: (p) => /(?:^|\/)instructions\//.test(p) || p.includes('.instructions.md'),
  },
  {
    id: 'path:agents',
    test: (p) => /(?:^|\/)agents\//.test(p) || p.includes('.agent.md'),
  },
]

/** 微软官方 Skill Catalog 域：按名称/路径前缀切，不靠来源。 */
const AZURE_DOMAIN_RULES: { id: string; keys: string[] }[] = [
  { id: 'fn:foundry', keys: ['foundry', 'microsoft-foundry'] },
  {
    id: 'fn:azure-ai',
    keys: ['azure-ai-', 'azure-openai', 'openai', 'azure-speech', 'azure-vision'],
  },
  {
    id: 'fn:azure-data',
    keys: ['azure-storage', 'azure-cosmos', 'azure-data-tables'],
  },
  {
    id: 'fn:azure-messaging',
    keys: ['eventhub', 'eventgrid', 'servicebus', 'webpubsub'],
  },
  { id: 'fn:azure-identity', keys: ['azure-identity', 'keyvault', 'entra'] },
  {
    id: 'fn:azure-monitor',
    keys: ['azure-monitor', 'appinsights', 'opentelemetry'],
  },
  {
    id: 'fn:azure-integration',
    keys: ['appconfiguration', 'containerregistry', 'azure-mgmt-'],
  },
  {
    id: 'fn:azure-compute',
    keys: ['azure-compute', 'aks', 'azure-deploy', 'azure-prepare'],
  },
  { id: 'fn:m365', keys: ['m365-'] },
]

const COMPILED_AZURE = AZURE_DOMAIN_RULES.map((r) => ({
  id: r.id,
  testers: r.keys.map(compileKey),
}))

/** K-Dense 官方 Skill Catalog 域（18 类合并为 9）：按技能目录名切，不靠来源。 */
const SCIENCE_DOMAIN_RULES: { id: string; keys: string[] }[] = [
  {
    id: 'fn:sci-genomics',
    keys: [
      'scanpy',
      'anndata',
      'pysam',
      'pydeseq2',
      'phylogenetics',
      'etetoolkit',
      'scikit-bio',
      'tiledbvcf',
      'scvi-tools',
      'scvelo',
      'gget',
      'biopython',
      'bioservices',
      'bulk-rnaseq',
      'arboreto',
      'cellxgene-census',
      'deeptools',
      'flowio',
      'polars-bio',
      'zarr-python',
      'geniml',
      'gtars',
      'genomic-coordinates',
      'genomic-intelligence',
      'onekgpd',
      'pathway-enrichment',
      'lamindb',
    ],
  },
  {
    id: 'fn:sci-chem',
    keys: [
      'rdkit',
      'datamol',
      'molfeat',
      'deepchem',
      'torchdrug',
      'diffdock',
      'molecular-dynamics',
      'rowan',
      'medchem',
      'pytdc',
      'pyopenms',
      'matchms',
    ],
  },
  {
    id: 'fn:sci-clinical',
    keys: [
      'pathml',
      'pydicom',
      'histolab',
      'pyhealth',
      'treatment-plans',
      'clinical-reports',
      'clinical-decision-support',
      'pkpd-modeling',
      'depmap',
      'imaging-data-commons',
      'bids',
      'neurokit2',
      'neuropixels-analysis',
      'relsa-severity-assessment',
      'deepspot-m',
    ],
  },
  {
    id: 'fn:sci-ml',
    keys: [
      'scikit-learn',
      'scikit-survival',
      'transformers',
      'pytorch-lightning',
      'shap',
      'pymc',
      'pymoo',
      'umap-learn',
      'torch-geometric',
      'stable-baselines3',
      'pufferlib',
      'aeon',
      'timesfm-forecasting',
    ],
  },
  {
    id: 'fn:sci-physics',
    keys: [
      'pymatgen',
      'pennylane',
      'qiskit',
      'qutip',
      'cirq',
      'astropy',
      'sympy',
      'simpy',
      'cobrapy',
      'matlab',
      'fluidsim',
      'openpiv',
    ],
  },
  {
    id: 'fn:sci-data',
    keys: [
      'seaborn',
      'matplotlib',
      'vaex',
      'polars',
      'dask',
      'statsmodels',
      'scientific-visualization',
      'geopandas',
      'geomaster',
      'networkx',
      'liteparse',
      'markitdown',
      'exploratory-data-analysis',
      'statistical-analysis',
      'statistical-power',
      'experimental-design',
      'uncertainty-and-units',
    ],
  },
  {
    id: 'fn:sci-lab',
    keys: [
      'opentrons-integration',
      'pylabrobot',
      'benchling-integration',
      'labarchive-integration',
      'protocolsio-integration',
      'ginkgo-cloud-lab',
      'esm',
      'tamarind',
      'adaptyv',
      'glycoengineering',
      'lab-hardware-cad',
    ],
  },
  {
    id: 'fn:sci-comms',
    keys: [
      'paperzilla',
      'paper-lookup',
      'paperclip',
      'literature-review',
      'bgpt-paper-search',
      'scientific-writing',
      'scientific-slides',
      'scientific-schematics',
      'peer-review',
      'pyzotero',
      'citation-management',
      'venue-templates',
      'latex-posters',
      'pptx-posters',
      'open-notebook',
      'exa-search',
      'parallel-web',
      'research-lookup',
      'infographics',
      'markdown-mermaid-writing',
      'generate-image',
    ],
  },
  {
    id: 'fn:sci-method',
    keys: [
      'research-grants',
      'scientific-brainstorming',
      'scientific-critical-thinking',
      'hypothesis-generation',
      'hypogenic',
      'scholar-evaluation',
      'what-if-oracle',
      'consciousness-council',
      'dhdna-profiler',
      'market-research-reports',
      'arbor',
      'nextflow',
      'pacsomatic',
      'modal',
      'database-lookup',
      'usfiscaldata',
      'hugging-science',
      'ontology-term-resolution',
      'pathogen-variant-surveillance',
      'primekg',
      'optimize-for-gpu',
      'dnanexus-integration',
      'latchbio-integration',
      'omero-integration',
      'get-available-resources',
      'autoskill',
      'pi-agent',
      'iso-standards-readiness',
      'analytical-method-validation',
    ],
  },
]

const COMPILED_SCIENCE = SCIENCE_DOMAIN_RULES.map((r) => ({
  id: r.id,
  testers: r.keys.map(compileKey),
}))

type DomainRule = { id: string; keys: string[] }

function compileDomain(rules: DomainRule[]) {
  return rules.map((r) => ({ id: r.id, testers: r.keys.map(compileKey) }))
}

/** NVIDIA 官方产品前缀：勿用短词 nv / cuda。 */
const NVIDIA_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:nv-doca', keys: ['doca-'] },
  { id: 'fn:nv-tao', keys: ['tao-'] },
  { id: 'fn:nv-nemo', keys: ['nemo-', 'mcore-', 'launch-nemo', 'nemoclaw', 'nemotron'] },
  { id: 'fn:nv-jetson', keys: ['jetson-'] },
  {
    id: 'fn:nv-cudax',
    keys: ['accelerated-computing', 'cupynumeric', 'cuopt-', 'cudaq-', 'dali-', 'tilegym-'],
  },
  { id: 'fn:nv-video', keys: ['deepstream-', 'vss-', 'amc-', 'rtvi-'] },
  {
    id: 'fn:nv-holoscan',
    keys: ['holoscan-', 'holohub-', 'hsb-', 'i4h-', 'dicom-', 'digital-health', 'nv-generate', 'nv-segment', 'nv-reason'],
  },
  { id: 'fn:nv-physics', keys: ['earth2studio', 'physicsnemo', 'omniverse-', 'physical-ai', 'warp-'] },
  { id: 'fn:nv-rag', keys: ['rag-blueprint', 'rag-eval', 'rag-perf', 'dynamo-'] },
]

/** AWS 官方目录/插件：勿用短词 aws。 */
const AWS_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:aws-serverless', keys: ['serverless-skills', 'ec2-skills', 'web-and-mobile-development'] },
  { id: 'fn:aws-storage', keys: ['storage-skills', 'analytics-skills', 'aws-data-analytics'] },
  { id: 'fn:aws-database', keys: ['database-skills'] },
  {
    id: 'fn:aws-network',
    keys: ['networking-and-content-delivery-skills', 'messaging-and-streaming-skills'],
  },
  {
    id: 'fn:aws-identity',
    keys: ['security-and-identity-skills', 'aws-agents-for-devsecops'],
  },
  { id: 'fn:aws-ops', keys: ['operations-skills', 'system-table-skills'] },
  { id: 'fn:aws-template', keys: ['aws-core', 'core-skills'] },
  { id: 'fn:aws-bedrock', keys: ['plugins/aws-agents/'] },
  { id: 'fn:aws-migrate', keys: ['migration-and-modernization-skills', 'resilience-skills'] },
]

/** GitHub Copilot 本机只有 skills/，靠名称功能词。排在 NVIDIA/AWS 之后。 */
const COPILOT_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:copilot-gtm', keys: ['gtm-'] },
  { id: 'fn:copilot-prd', keys: ['breakdown-feature-prd', 'breakdown-epic-pm'] },
  { id: 'fn:copilot-sec', keys: ['security-review', 'threat-model', 'tm7-threat'] },
  {
    id: 'fn:copilot-cloud',
    keys: ['aws-cdk', 'aws-cloudwatch', 'aws-cost', 'aws-resource', 'aws-well-', 'azure-architecture', 'azure-container', 'azure-deployment', 'azure-developer', 'azure-devops', 'azure-pricing', 'azure-resource', 'azure-role', 'azure-smart', 'azure-static', 'azure-well-'],
  },
  { id: 'fn:copilot-test', keys: ['csharp-xunit', 'unit-test', 'webapp-testing', 'pester-'] },
  { id: 'fn:copilot-docs', keys: ['convert-pdf', 'md-to-docx', 'pdftk-'] },
  { id: 'fn:copilot-mcp', keys: ['mcp-', '-mcp-server'] },
  {
    id: 'fn:copilot-migrate',
    keys: ['oracle-to-postgres', 'winui3-migration', 'javax-to-jakarta', 'issue-fields-migration'],
  },
]

const MEDIA_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:media-image', keys: ['tools/image', 'guides/photo'] },
  { id: 'fn:media-video', keys: ['tools/video', 'guides/video'] },
  { id: 'fn:media-audio', keys: ['tools/audio'] },
  { id: 'fn:media-design', keys: ['guides/design'] },
  { id: 'fn:media-writing', keys: ['guides/writing', 'guides/content'] },
  { id: 'fn:media-social', keys: ['tools/social', 'guides/social'] },
  { id: 'fn:media-product', keys: ['guides/product'] },
  { id: 'fn:media-sdk', keys: ['/ui/', '/sdk/'] },
  {
    id: 'fn:media-platform',
    keys: ['tools/llm', 'tools/utilities', 'infsh-cli', 'guides/prompting', 'guides/agent', 'tools/agent'],
  },
]

const TOB_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:tob-contracts', keys: ['building-secure-contracts'] },
  {
    id: 'fn:tob-audit',
    keys: [
      'c-review',
      'rust-review',
      'differential-review',
      'static-analysis',
      'variant-analysis',
      'sharp-edges',
      'audit-context-building',
      'entry-point-analyzer',
      'zeroize-audit',
      'supply-chain-risk-auditor',
      'agentic-actions-auditor',
      'semgrep-rule',
      'vulnerability-triage',
    ],
  },
  { id: 'fn:tob-malware', keys: ['yara-authoring'] },
  {
    id: 'fn:tob-verify',
    keys: [
      'writing-lean-proofs',
      'property-based-testing',
      'fp-check',
      'spec-to-code-compliance',
      'constant-time-analysis',
      'dimensional-analysis',
    ],
  },
  { id: 'fn:tob-reverse', keys: ['dwarf-expert'] },
  { id: 'fn:tob-mobile', keys: ['firebase-apk-scanner'] },
  {
    id: 'fn:tob-eng',
    keys: [
      'git-cleanup',
      'gh-cli',
      'github-triage',
      'devcontainer-setup',
      'modern-python',
      'open-sourcing',
      'skill-improver',
      'trailmark',
      'mutation-testing',
      'testing-handbook',
    ],
  },
  { id: 'fn:tob-team', keys: ['culture-index', 'let-fate-decide', 'second-opinion'] },
  { id: 'fn:tob-trouble', keys: ['claude-in-chrome-troubleshooting', 'burpsuite-project-parser'] },
]

const GSD_DOMAIN_RULES: DomainRule[] = [
  {
    id: 'fn:gsd-workflow',
    keys: [
      'gsd-ns-workflow',
      'gsd-discuss',
      'gsd-plan-phase',
      'gsd-execute',
      'gsd-verify',
      'gsd-phase',
      'gsd-progress',
      'gsd-validate',
      'gsd-secure-phase',
      'gsd-ui-phase',
      'gsd-mvp',
      'gsd-ultraplan',
      'gsd-fast',
      'gsd-quick',
      'gsd-next',
      'gsd-pause',
      'gsd-resume',
      'gsd-autonomous',
    ],
  },
  { id: 'fn:gsd-ideate', keys: ['gsd-ns-ideate', 'gsd-explore', 'gsd-sketch', 'gsd-spike', 'gsd-spec', 'gsd-capture'] },
  {
    id: 'fn:gsd-review',
    keys: ['gsd-ns-review', 'gsd-code-review', 'gsd-debug', 'gsd-eval', 'gsd-ui-review', 'gsd-audit'],
  },
  {
    id: 'fn:gsd-project',
    keys: ['gsd-ns-project', 'gsd-milestone', 'gsd-new-project', 'gsd-onboard', 'gsd-complete-milestone'],
  },
  {
    id: 'fn:gsd-manage',
    keys: [
      'gsd-ns-manage',
      'gsd-config',
      'gsd-workspace',
      'gsd-workstreams',
      'gsd-ship',
      'gsd-inbox',
      'gsd-settings',
      'gsd-manager',
    ],
  },
  {
    id: 'fn:gsd-context',
    keys: ['gsd-ns-context', 'gsd-map', 'gsd-graphify', 'gsd-docs', 'gsd-extract-learnings', 'gsd-mempalace', 'gsd-ingest'],
  },
  { id: 'fn:gsd-help', keys: ['gsd-help', 'gsd-update'] },
]

const PM_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:pm-exec', keys: ['pm-execution'] },
  { id: 'fn:pm-discover', keys: ['pm-product-discovery'] },
  { id: 'fn:pm-strategy', keys: ['pm-product-strategy'] },
  { id: 'fn:pm-research', keys: ['pm-market-research'] },
  { id: 'fn:pm-gtm', keys: ['pm-go-to-market'] },
  { id: 'fn:pm-growth', keys: ['pm-marketing-growth'] },
  { id: 'fn:pm-toolkit', keys: ['pm-toolkit'] },
  { id: 'fn:pm-data', keys: ['pm-data-analytics'] },
  { id: 'fn:pm-ai', keys: ['pm-ai-shipping'] },
]

const MARKETING_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:mkt-seo', keys: ['seo-audit', 'ai-seo', 'programmatic-seo', 'site-architecture', 'directory-submissions'] },
  { id: 'fn:mkt-cold', keys: ['cold-email', 'prospecting', 'lead-magnets'] },
  { id: 'fn:mkt-pricing', keys: ['paywalls', 'offers'] },
  { id: 'fn:mkt-ads', keys: ['ad-creative'] },
  { id: 'fn:mkt-copy', keys: ['copywriting', 'copy-editing', 'popups'] },
  { id: 'fn:mkt-social', keys: ['influencer-marketing', 'community-marketing'] },
  { id: 'fn:mkt-growth', keys: ['churn-prevention', 'referrals', 'marketing-loops', 'ab-testing'] },
  { id: 'fn:mkt-sales', keys: ['sales-enablement', 'public-relations', 'co-marketing', 'revops'] },
  {
    id: 'fn:mkt-strategy',
    keys: ['marketing-plan', 'marketing-psychology', 'marketing-ideas', 'marketing-council', 'content-strategy', 'competitor-profiling'],
  },
]

const JEFFALLAN_DOMAIN_RULES: DomainRule[] = [
  {
    id: 'fn:jeff-lang',
    keys: [
      'python-pro',
      'javascript-pro',
      'typescript-pro',
      'golang-pro',
      'rust-engineer',
      'php-pro',
      'cpp-pro',
      'csharp-developer',
      'java-architect',
      'kotlin-specialist',
      'sql-pro',
    ],
  },
  {
    id: 'fn:jeff-backend',
    keys: ['django-expert', 'fastapi-expert', 'nestjs-expert', 'laravel-specialist', 'rails-expert', 'spring-boot-engineer', 'dotnet-core-expert'],
  },
  {
    id: 'fn:jeff-frontend',
    keys: ['react-expert', 'vue-expert', 'angular-architect', 'flutter-expert', 'react-native-expert', 'nextjs-developer', 'swift-expert'],
  },
  { id: 'fn:jeff-cloud', keys: ['cloud-architect', 'kubernetes-specialist', 'terraform-engineer', 'django-storages-s3'] },
  {
    id: 'fn:jeff-arch',
    keys: ['architecture-designer', 'api-designer', 'graphql-architect', 'microservices-architect', 'websocket-engineer', 'mcp-developer'],
  },
  { id: 'fn:jeff-test', keys: ['test-master', 'playwright-expert', 'chaos-engineer'] },
  { id: 'fn:jeff-ops', keys: ['devops-engineer', 'sre-engineer', 'monitoring-expert', 'cli-developer'] },
  { id: 'fn:jeff-sec', keys: ['secure-code-guardian', 'security-reviewer'] },
  {
    id: 'fn:jeff-data',
    keys: ['postgres-pro', 'database-optimizer', 'pandas-pro', 'ml-pipeline', 'spark-engineer', 'fine-tuning-expert', 'rag-architect'],
  },
]

const SPENCER_DOMAIN_RULES: DomainRule[] = [
  {
    id: 'fn:sp-cursor',
    keys: ['suggesting-cursor-hooks', 'suggesting-cursor-rules', 'suggesting-skills', 'switching-projects', 'saving-workspace-context'],
  },
  {
    id: 'fn:sp-test',
    keys: [
      'adding-e2e-tests',
      'verifying-in-browser',
      'recording-browser-flow',
      'visual-qa-testing',
      'form-testing',
      'dark-mode-testing',
      'responsive-testing',
      'writing-tests',
      'python-tdd',
      'grinding-until-pass',
      'api-smoke-testing',
    ],
  },
  { id: 'fn:sp-auth', keys: ['adding-auth', 'adding-stripe'] },
  {
    id: 'fn:sp-metrics',
    keys: ['adding-analytics', 'adding-error-tracking', 'profiling-performance', 'auditing-performance', 'tailing-build', 'monitoring-terminal'],
  },
  {
    id: 'fn:sp-infra',
    keys: ['adding-docker', 'kubernetes-deploying', 'setting-up-ci', 'setting-up-terraform', 'adding-feature-flags'],
  },
  {
    id: 'fn:sp-quality',
    keys: ['auditing-security', 'reviewing-code', 'accessibility-auditing', 'incident-response', 'auto-type-checking'],
  },
  { id: 'fn:sp-ui', keys: ['using-ui-stack', 'converting-css', 'react-native-patterns'] },
  { id: 'fn:sp-copy', keys: ['writing-copy', 'seo-auditing'] },
  {
    id: 'fn:sp-flow',
    keys: ['parallel-', 'babysitting-pr', 'creating-pr', 'comparing-branches', 'writing-commit', 'best-of-n', 'systematic-debugging'],
  },
]

const SOFTAWORKS_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:sw-ai', keys: ['gemini', 'perplexity', 'gepetto', 'codex'] },
  { id: 'fn:sw-meta', keys: ['skill-judge', 'plugin-forge', 'command-creator', 'agent-md-refactor'] },
  {
    id: 'fn:sw-docs',
    keys: ['crafting-effective-readmes', 'mermaid-diagrams', 'draw-io', 'excalidraw', 'marp-slide', 'c4-architecture', 'web-to-markdown'],
  },
  { id: 'fn:sw-ui', keys: ['design-system-starter', 'react-dev', 'react-useeffect'] },
  {
    id: 'fn:sw-quality',
    keys: ['reducing-entropy', 'naming-analyzer', 'openapi-to-typescript', 'dependency-updater', 'database-schema-designer'],
  },
  {
    id: 'fn:sw-product',
    keys: ['game-changing-features', 'requirements-clarity', 'frontend-to-backend-requirements', 'ship-learn-next'],
  },
  {
    id: 'fn:sw-work',
    keys: [
      'difficult-workplace-conversations',
      'professional-communication',
      'feedback-mastery',
      'daily-meeting-update',
      'writing-clearly',
      'lesson-learned',
      'session-handoff',
    ],
  },
  { id: 'fn:sw-test', keys: ['qa-test-planner'] },
  { id: 'fn:sw-tools', keys: ['commit-work', 'datadog-cli', 'domain-name-brainstormer', 'meme-factory'] },
]

const SUPERPOWERS_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:spow-tdd', keys: ['test-driven-development'] },
  { id: 'fn:spow-debug', keys: ['systematic-debugging', 'verification-before-completion'] },
  { id: 'fn:spow-plan', keys: ['writing-plans', 'executing-plans', 'brainstorming'] },
  { id: 'fn:spow-subagent', keys: ['dispatching-parallel-agents', 'subagent-driven-development'] },
  { id: 'fn:spow-review', keys: ['requesting-code-review', 'receiving-code-review'] },
  { id: 'fn:spow-git', keys: ['using-git-worktrees', 'finishing-a-development-branch'] },
  { id: 'fn:spow-meta', keys: ['using-superpowers', 'writing-skills'] },
]

const CONVEX_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:cvx-start', keys: ['convex-quickstart', 'convex-add', 'convex-expert', 'convex-design', 'convex-explain', 'convex-suggest'] },
  { id: 'fn:cvx-auth', keys: ['convex-auth'] },
  { id: 'fn:cvx-data', keys: ['convex-backup', 'convex-seed', 'convex-migrate', 'convex-env'] },
  { id: 'fn:cvx-deploy', keys: ['convex-deploy', 'convex-domains', 'convex-launch'] },
  { id: 'fn:cvx-cost', keys: ['convex-billing', 'convex-cost', 'convex-insights', 'convex-monitor', 'convex-optimize'] },
  { id: 'fn:cvx-test', keys: ['convex-test', 'convex-reviewer', 'convex-verify', 'convex-self-heal', 'convex-sentinel'] },
  { id: 'fn:cvx-agent', keys: ['convex-agent', 'convex-create-component', 'convex-crons'] },
  { id: 'fn:cvx-docs', keys: ['convex-docs', 'convex-improve-convex-plugin'] },
]

const HF_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:hf-hub', keys: ['hf-cli', 'huggingface-best', 'huggingface-tool-builder', 'hf-mem'] },
  { id: 'fn:hf-data', keys: ['huggingface-datasets'] },
  {
    id: 'fn:hf-train',
    keys: ['huggingface-llm-trainer', 'huggingface-vision-trainer', 'train-sentence', 'trl-training', 'huggingface-trackio'],
  },
  { id: 'fn:hf-spaces', keys: ['huggingface-spaces', 'huggingface-gradio', 'huggingface-lora-space', 'huggingface-zerogpu'] },
  { id: 'fn:hf-cloud', keys: ['hf-cloud-'] },
  { id: 'fn:hf-local', keys: ['huggingface-local-models', 'transformers-js'] },
  { id: 'fn:hf-eval', keys: ['huggingface-community-evals', 'huggingface-papers', 'huggingface-paper-publisher'] },
]

const EXPO_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:expo-router', keys: ['expo-router'] },
  { id: 'fn:expo-ui', keys: ['expo-ui', 'expo-native-ui', 'expo-dom'] },
  { id: 'fn:expo-design', keys: ['expo-design-system', 'expo-tailwind'] },
  { id: 'fn:expo-data', keys: ['expo-data-fetching'] },
  { id: 'fn:expo-module', keys: ['expo-module', 'expo-migrate-module'] },
  { id: 'fn:expo-store', keys: ['eas-app-stores'] },
  { id: 'fn:expo-cloud', keys: ['eas-hosting', 'eas-workflows', 'eas-observe', 'eas-update', 'eas-simulator'] },
  { id: 'fn:expo-migrate', keys: ['expo-upgrade', 'expo-web-to-native', 'expo-brownfield'] },
  { id: 'fn:expo-feedback', keys: ['expo-skill-feedback'] },
]

const ADDY_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:addy-discover', keys: ['using-agent-skills'] },
  { id: 'fn:addy-define', keys: ['interview-me', 'idea-refine', 'spec-driven-development', 'source-driven-development', 'doubt-driven-development'] },
  { id: 'fn:addy-plan', keys: ['planning-and-task-breakdown'] },
  {
    id: 'fn:addy-build',
    keys: ['incremental-implementation', 'test-driven-development', 'frontend-ui-engineering', 'api-and-interface-design', 'context-engineering'],
  },
  { id: 'fn:addy-verify', keys: ['browser-testing-with-devtools', 'debugging-and-error-recovery'] },
  { id: 'fn:addy-review', keys: ['code-review-and-quality', 'code-simplification'] },
  { id: 'fn:addy-sec', keys: ['security-and-hardening'] },
  { id: 'fn:addy-perf', keys: ['performance-optimization'] },
  {
    id: 'fn:addy-ship',
    keys: [
      'shipping-and-launch',
      'ci-cd-and-automation',
      'git-workflow-and-versioning',
      'documentation-and-adrs',
      'observability-and-instrumentation',
      'deprecation-and-migration',
    ],
  },
]

const MATT_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:matt-eng', keys: ['/engineering/', 'to-tickets', 'implement', 'tdd'] },
  { id: 'fn:matt-grill', keys: ['grill-'] },
  { id: 'fn:matt-arch', keys: ['improve-codebase-architecture', 'codebase-design'] },
  { id: 'fn:matt-prod', keys: ['/productivity/', 'handoff', 'teach'] },
  { id: 'fn:matt-write', keys: ['writing-for-agents', 'writing-beats', 'writing-fragments'] },
  { id: 'fn:matt-ts', keys: ['setup-ts-deep-modules', 'migrate-to-shoehorn'] },
  { id: 'fn:matt-git', keys: ['git-guardrails'] },
]

const REMOTION_DOMAIN_RULES: DomainRule[] = [
  { id: 'fn:rem-create', keys: ['remotion-create', 'remotion-upgrade', 'remotion-best-practices'] },
  { id: 'fn:rem-captions', keys: ['remotion-captions', 'remotion-markup', 'remotion-multimedia'] },
  { id: 'fn:rem-render', keys: ['remotion-render', 'remotion-saas'] },
  { id: 'fn:rem-maps', keys: ['remotion-maps', 'remotion-interactivity'] },
  { id: 'fn:rem-studio', keys: ['remotion-studio', 'remotion-docs'] },
]

const EXTRA_DOMAIN_RULES: DomainRule[][] = [
  NVIDIA_DOMAIN_RULES,
  AWS_DOMAIN_RULES,
  COPILOT_DOMAIN_RULES,
  MEDIA_DOMAIN_RULES,
  TOB_DOMAIN_RULES,
  GSD_DOMAIN_RULES,
  PM_DOMAIN_RULES,
  MARKETING_DOMAIN_RULES,
  JEFFALLAN_DOMAIN_RULES,
  SPENCER_DOMAIN_RULES,
  SOFTAWORKS_DOMAIN_RULES,
  SUPERPOWERS_DOMAIN_RULES,
  CONVEX_DOMAIN_RULES,
  HF_DOMAIN_RULES,
  EXPO_DOMAIN_RULES,
  ADDY_DOMAIN_RULES,
  MATT_DOMAIN_RULES,
  REMOTION_DOMAIN_RULES,
]

const COMPILED_EXTRA_DOMAINS = EXTRA_DOMAIN_RULES.map(compileDomain)

function isAzureFnId(id: string): boolean {
  return id === 'fn:foundry' || id === 'fn:m365' || id.startsWith('fn:azure')
}

/** 功能域之后的语言后缀；仅当已选 Azure / Foundry / M365 域才启用。 */
const LANG_SUFFIX_RULES: { id: string; keys: string[] }[] = [
  { id: 'lang:py', keys: ['-py'] },
  { id: 'lang:ts', keys: ['-ts'] },
  { id: 'lang:dotnet', keys: ['-dotnet'] },
  { id: 'lang:java', keys: ['-java'] },
  { id: 'lang:rust', keys: ['-rust'] },
]

const COMPILED_LANG = LANG_SUFFIX_RULES.map((r) => ({
  id: r.id,
  testers: r.keys.map(compileKey),
}))

const FUNCTION_CHIP_IDS: string[] = [
  ...PATH_KIND_RULES.map((r) => r.id),
  ...AZURE_DOMAIN_RULES.map((r) => r.id),
  ...SCIENCE_DOMAIN_RULES.map((r) => r.id),
  ...EXTRA_DOMAIN_RULES.flatMap((t) => t.map((r) => r.id)),
  ...LANG_SUFFIX_RULES.map((r) => r.id),
]

type ConnectorCat = { id: string; tokens: string[] }

const CONNECTOR_CATEGORIES: ConnectorCat[] = [
  {
    id: '通讯协作',
    tokens: ['slack', 'discord', 'teams', 'zoom', 'telegram', 'whatsapp', 'mattermost', 'webex'],
  },
  {
    id: '开发者工具',
    tokens: ['github', 'gitlab', 'jira', 'linear', 'bitbucket', 'asana', 'trello', 'clickup', 'pagerduty'],
  },
  {
    id: '营销销售',
    tokens: ['hubspot', 'mailchimp', 'salesforce', 'pipedrive', 'intercom', 'marketo', 'klaviyo'],
  },
  {
    id: '文档存储',
    tokens: ['notion', 'airtable', 'confluence', 'dropbox', 'box', 'evernote', 'coda'],
  },
  {
    id: '财务收款',
    tokens: ['stripe', 'quickbooks', 'xero', 'paypal', 'square', 'freshbooks'],
  },
  {
    id: '日历邮件',
    tokens: ['gmail', 'outlook', 'calendly', 'calendar', 'front', 'superhuman'],
  },
  { id: '客服工单', tokens: ['zendesk', 'freshdesk', 'helpscout', 'gorgias'] },
  { id: '电商零售', tokens: ['shopify', 'woocommerce', 'magento', 'bigcommerce'] },
  {
    id: '社媒渠道',
    tokens: ['twitter', 'linkedin', 'youtube', 'instagram', 'facebook', 'tiktok', 'pinterest'],
  },
  { id: '数据分析', tokens: ['mixpanel', 'amplitude', 'segment', 'snowflake', 'bigquery', 'metabase'] },
  { id: '人事招聘', tokens: ['greenhouse', 'lever', 'workday', 'bamboohr', 'lattice'] },
]

const TOKEN_TO_CONNECTOR = new Map<string, string>()
for (const c of CONNECTOR_CATEGORIES) {
  for (const t of c.tokens) TOKEN_TO_CONNECTOR.set(t, c.id)
}

const SAAS_LABEL: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  gmail: 'Gmail',
  paypal: 'PayPal',
  zendesk: 'Zendesk',
  shopify: 'Shopify',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  pagerduty: 'PagerDuty',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  mixpanel: 'Mixpanel',
  airtable: 'Airtable',
  confluence: 'Confluence',
  quickbooks: 'QuickBooks',
  woocommerce: 'WooCommerce',
  freshdesk: 'Freshdesk',
  helpscout: 'Help Scout',
  bamboohr: 'BambooHR',
  workday: 'Workday',
}

function saasLabel(tok: string): string {
  if (SAAS_LABEL[tok]) return SAAS_LABEL[tok]
  return tok ? tok.charAt(0).toUpperCase() + tok.slice(1) : tok
}

const LETTER_COARSE: { id: string; zh: string; en: string; from: string; to: string }[] = [
  { id: '段AE', zh: '名称 A–E', en: 'Names A–E', from: 'a', to: 'e' },
  { id: '段FJ', zh: '名称 F–J', en: 'Names F–J', from: 'f', to: 'j' },
  { id: '段KO', zh: '名称 K–O', en: 'Names K–O', from: 'k', to: 'o' },
  { id: '段PT', zh: '名称 P–T', en: 'Names P–T', from: 'p', to: 't' },
  { id: '段UZ', zh: '名称 U–Z', en: 'Names U–Z', from: 'u', to: 'z' },
]

const PHRASE_ORDER: string[] = []
for (const r of RULES) {
  if (!PHRASE_ORDER.includes(r.phrase)) PHRASE_ORDER.push(r.phrase)
}

/** 漏斗芯片 id（短语 / 细分 / 连接器），供英文覆盖测试。 */
export const FUNNEL_CHIP_IDS: string[] = [
  ...PHRASE_ORDER,
  ...REFINE_RULES.map((r) => r.id),
  ...CONNECTOR_CATEGORIES.map((c) => c.id),
  ...FUNCTION_CHIP_IDS,
]

export function chipCopy(id: string): ChipCopy {
  if (id === OTHER_ID) return { zh: '其他', en: 'Other' }
  const phrase = phraseChip(id)
  if (phrase) return phrase
  if (id.startsWith('tok:')) {
    const tok = id.slice(4)
    return { zh: TOKEN_ZH[tok] ?? tok, en: tok }
  }
  if (id.startsWith('src:')) {
    const key = id.slice(4)
    const hit = SOURCE_ZH.find((s) => s.key === key)
    return { zh: hit?.zh ?? key, en: key }
  }
  if (id.startsWith('saas:')) {
    const tok = id.slice(5)
    const pretty = saasLabel(tok)
    return { zh: pretty, en: pretty }
  }
  if (id.startsWith('段')) {
    const coarse = LETTER_COARSE.find((g) => g.id === id)
    if (coarse) return { zh: coarse.zh, en: coarse.en }
    const letter = id.slice(1)
    if (/^[A-Z]$/.test(letter)) return { zh: `名称 ${letter}`, en: `Names ${letter}` }
  }
  return { zh: id, en: id }
}

function pushChipHay(parts: string[], id: string): void {
  parts.push(id)
  const c = chipCopy(id)
  if (c.zh) parts.push(c.zh)
  if (c.en && c.en !== c.zh && c.en !== id) parts.push(c.en)
}

/** 人群 + 子档 + 短语 + 静态功能域的中英词面；不含来源/名称段动态桶。 */
function buildFunnelSearchHay(
  item: Pick<LibraryListItemDto, 'displayName' | 'summary' | 'entryId' | 'libraryPathRel'>,
  personaId: PersonaId,
  phrases: readonly string[],
  subs: readonly PersonaSubId[],
): string {
  const parts: string[] = [personaId]
  const personaChip = PERSONA_CHIPS.find((c) => c.id === personaId)
  if (personaChip) {
    parts.push(personaChip.label.zh, personaChip.label.en)
  }
  if (personaId !== 'unclassified') {
    const defs = PERSONA_SUBS[personaId]
    for (const sid of subs) {
      parts.push(sid)
      const def = defs.find((s) => s.id === sid)
      if (def) parts.push(def.label.zh, def.label.en)
    }
  }
  for (const p of phrases) pushChipHay(parts, p)
  const p = relPath(item)
  for (const r of PATH_KIND_RULES) {
    if (r.test(p)) pushChipHay(parts, r.id)
  }
  const h = haystack(item)
  const toks = new Set(tokensOf(h))
  const domainTables = [COMPILED_AZURE, COMPILED_SCIENCE, COMPILED_REFINE, ...COMPILED_EXTRA_DOMAINS]
  for (const table of domainTables) {
    for (const r of table) {
      if (r.testers.some((t) => t(h, toks))) pushChipHay(parts, r.id)
    }
  }
  return parts.join(' ').toLowerCase()
}

export function chipLabelZh(id: string): string {
  return chipCopy(id).zh
}

export function chipLabel(id: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  const c = chipCopy(id)
  return locale === 'en' ? c.en : c.zh
}

export type PartitionChip = {
  id: string
  label: ChipCopy
  count: number
}

export type RefineStep = { id: string }

type MatchBucket = { id: string; match: (it: FunnelListItem) => boolean }

/** 贪心：每条只进第一个命中桶；未命中进「其他」。子级之和（含其他）= 上级 n。 */
export function partitionExclusive(
  items: FunnelListItem[],
  buckets: MatchBucket[],
): { chips: PartitionChip[]; assignment: Map<string, string> } {
  const assignment = new Map<string, string>()
  const counts = new Map<string, number>()
  for (const b of buckets) counts.set(b.id, 0)
  let other = 0
  for (const it of items) {
    let hit = OTHER_ID
    for (const b of buckets) {
      if (b.match(it)) {
        hit = b.id
        break
      }
    }
    assignment.set(it.entryId, hit)
    if (hit === OTHER_ID) other += 1
    else counts.set(hit, (counts.get(hit) || 0) + 1)
  }
  const named: PartitionChip[] = []
  for (const b of buckets) {
    const c = counts.get(b.id) || 0
    if (c > 0) named.push({ id: b.id, label: chipCopy(b.id), count: c })
  }
  named.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count
    const loc = getLocale()
    if (loc === 'en') return a.label.en.localeCompare(b.label.en, 'en')
    return a.label.zh.localeCompare(b.label.zh, 'zh')
  })
  if (other > 0) named.push({ id: OTHER_ID, label: chipCopy(OTHER_ID), count: other })
  return { chips: named, assignment }
}

export function primaryPersonaSub(item: FunnelListItem): PersonaSubFilter {
  if (item.personaId === 'unclassified') return OTHER_ID
  for (const s of PERSONA_SUBS[item.personaId]) {
    if (item.personaSubs.includes(s.id)) return s.id
  }
  return OTHER_ID
}

function phraseAllowList(
  persona: ClassifiedPersona,
  personaSub: PersonaSubFilter | null,
): string[] {
  if (personaSub && personaSub !== OTHER_ID) {
    return PERSONA_SUBS[persona].find((s) => s.id === personaSub)?.phrases ?? []
  }
  return PERSONA_PHRASES[persona]
}

export function primaryPhrase(item: FunnelListItem, allowed: readonly string[]): string {
  for (const p of allowed) {
    if (item.personaPhrases.includes(p)) return p
  }
  return OTHER_ID
}

const TAXONOMY_MISSING = '—'

export type FunnelTaxonomyLabels = {
  persona: string
  sub: string
  fn: string
}

/** 行内分类：人群 · 子档 · 主动作短语（功能）。不做功能桶扫描。 */
export function funnelTaxonomyLabels(
  item: FunnelListItem,
  locale: 'zh-CN' | 'en' = 'zh-CN',
): FunnelTaxonomyLabels {
  const loc = (s: { zh: string; en: string }) => (locale === 'en' ? s.en : s.zh)
  const personaChip = PERSONA_CHIPS.find((c) => c.id === item.personaId)
  const persona = personaChip ? loc(personaChip.label) : TAXONOMY_MISSING

  if (item.personaId === 'unclassified') {
    const first = item.personaPhrases[0]
    return {
      persona,
      sub: TAXONOMY_MISSING,
      fn: first ? chipLabel(first, locale) : TAXONOMY_MISSING,
    }
  }

  const subId = primaryPersonaSub(item)
  const subDef = PERSONA_SUBS[item.personaId].find((s) => s.id === subId)
  const sub = subDef ? loc(subDef.label) : chipLabel(subId, locale)

  const phraseId = primaryPhrase(item, PERSONA_PHRASES[item.personaId])
  const fn =
    item.personaPhrases.length === 0 ? TAXONOMY_MISSING : chipLabel(phraseId, locale)

  return { persona, sub, fn }
}

function nameInitial(item: FunnelListItem): string {
  const stem = stemName(item.displayName || item.entryId || '').toLowerCase()
  const m = stem.match(/[a-z]/)
  return m ? m[0] : ''
}

function fineLetterBuckets(from: string, to: string): MatchBucket[] {
  const letters: MatchBucket[] = []
  for (let c = from.charCodeAt(0); c <= to.charCodeAt(0); c++) {
    const ch = String.fromCharCode(c)
    letters.push({
      id: `段${ch.toUpperCase()}`,
      match: (it: FunnelListItem) => nameInitial(it) === ch,
    })
  }
  return letters
}

function letterBuckets(items: FunnelListItem[], exclude: ReadonlySet<string>): MatchBucket[] {
  const coarseHit = LETTER_COARSE.find((g) => exclude.has(g.id))
  if (coarseHit) {
    if ([...exclude].some((id) => /^段[A-Z]$/.test(id))) return []
    return fineLetterBuckets(coarseHit.from, coarseHit.to)
  }
  const coarse = LETTER_COARSE.map((g) => ({
    id: g.id,
    from: g.from,
    to: g.to,
    match: (it: FunnelListItem) => {
      const ch = nameInitial(it)
      return ch >= g.from && ch <= g.to
    },
  }))
  const covering = coarse.filter((g) => items.some(g.match))
  if (covering.length === 1 && items.every(covering[0].match)) {
    return fineLetterBuckets(covering[0].from, covering[0].to)
  }
  return coarse.map(({ id, match }) => ({ id, match }))
}

function firstNameToken(item: FunnelListItem): string {
  return tokensOf(stemName(item.displayName || ''))[0] || ''
}

function skipAllMatch(items: FunnelListItem[], match: (it: FunnelListItem) => boolean): boolean {
  return items.length > 0 && items.every(match)
}

function tryPushBucket(
  buckets: MatchBucket[],
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
  id: string,
  match: (it: FunnelListItem) => boolean,
): void {
  if (exclude.has(id)) return
  if (buckets.some((b) => b.id === id)) return
  if (!items.some(match) || skipAllMatch(items, match)) return
  buckets.push({ id, match })
}

function buildSourceBuckets(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
): MatchBucket[] {
  const buckets: MatchBucket[] = []
  const sources: string[] = []
  for (const it of items) {
    if (it.sourceId) sources.push(it.sourceId.toLowerCase())
  }
  for (const s of SOURCE_ZH) {
    if (!sources.some((src) => src.includes(s.key))) continue
    tryPushBucket(buckets, items, exclude, `src:${s.key}`, (it) =>
      (it.sourceId || '').toLowerCase().includes(s.key),
    )
  }
  return buckets
}

function pushCompiledDomains(
  buckets: MatchBucket[],
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
  compiled: { id: string; testers: KeyTester[] }[],
): void {
  for (const r of compiled) {
    const match = (it: FunnelListItem) => {
      const h = haystack(it)
      const toks = new Set(tokensOf(h))
      return r.testers.some((t) => t(h, toks))
    }
    tryPushBucket(buckets, items, exclude, r.id, match)
  }
}

/** 功能层：路径种类 → Azure 域 → 科研域 → 官方产品/目录域 →（已选 Azure 域时）语言后缀 → 短语。不含来源。 */
function buildFunctionBuckets(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
): MatchBucket[] {
  const buckets: MatchBucket[] = []
  const presentP = new Set<string>()
  const presentT = new Set<string>()
  for (const it of items) {
    for (const p of it.personaPhrases) presentP.add(p)
    for (const t of tokensOf(stemName(it.displayName || ''))) presentT.add(t)
  }

  for (const r of PATH_KIND_RULES) {
    tryPushBucket(buckets, items, exclude, r.id, (it) => r.test(relPath(it)))
  }

  pushCompiledDomains(buckets, items, exclude, COMPILED_AZURE)
  pushCompiledDomains(buckets, items, exclude, COMPILED_SCIENCE)
  for (const table of COMPILED_EXTRA_DOMAINS) {
    pushCompiledDomains(buckets, items, exclude, table)
  }

  if ([...exclude].some(isAzureFnId)) {
    pushCompiledDomains(buckets, items, exclude, COMPILED_LANG)
  }

  for (const p of PHRASE_ORDER) {
    if (exclude.has(p)) continue
    const compiled = COMPILED_RULES.find((r) => r.phrase === p)
    const match = (it: FunnelListItem) => {
      if (it.personaPhrases.includes(p)) {
        const tok = firstNameToken(it)
        const mapped = TOKEN_PHRASE[tok]
        if (mapped && mapped.phrase === p && TOKEN_TO_CONNECTOR.has(tok)) return false
        return true
      }
      if (!compiled) return false
      const h = contentHaystack(it)
      const toks = new Set(tokensOf(h))
      if (!compiled.testers.some((t) => t(h, toks))) return false
      const tok = firstNameToken(it)
      const mapped = TOKEN_PHRASE[tok]
      if (mapped && mapped.phrase === p && TOKEN_TO_CONNECTOR.has(tok)) return false
      return true
    }
    if (presentP.has(p) || items.some(match)) {
      tryPushBucket(buckets, items, exclude, p, match)
    }
  }

  for (const r of COMPILED_REFINE) {
    const match = (it: FunnelListItem) => {
      const h = haystack(it)
      const toks = new Set(tokensOf(h))
      return r.testers.some((t) => t(h, toks))
    }
    tryPushBucket(buckets, items, exclude, r.id, match)
  }

  const selectedCat = CONNECTOR_CATEGORIES.find((c) => exclude.has(c.id))
  if (selectedCat) {
    const presentSaas = new Set<string>()
    for (const it of items) {
      const tok = firstNameToken(it)
      if (TOKEN_TO_CONNECTOR.get(tok) === selectedCat.id) presentSaas.add(tok)
    }
    for (const tok of presentSaas) {
      tryPushBucket(buckets, items, exclude, `saas:${tok}`, (it) => firstNameToken(it) === tok)
    }
  } else {
    for (const c of CONNECTOR_CATEGORIES) {
      tryPushBucket(
        buckets,
        items,
        exclude,
        c.id,
        (it) => TOKEN_TO_CONNECTOR.get(firstNameToken(it)) === c.id,
      )
    }
  }

  for (const tok of Object.keys(TOKEN_ZH)) {
    const id = `tok:${tok}`
    if (!presentT.has(tok)) continue
    const mapped = TOKEN_PHRASE[tok]
    if (mapped && exclude.has(mapped.phrase)) continue
    tryPushBucket(buckets, items, exclude, id, (it) =>
      tokensOf(stemName(it.displayName || '')).includes(tok),
    )
  }

  for (const tok of presentT) {
    const mapped = TOKEN_PHRASE[tok]
    if (!mapped || exclude.has(mapped.phrase) || presentP.has(mapped.phrase)) continue
    if (TOKEN_TO_CONNECTOR.has(tok)) continue
    tryPushBucket(buckets, items, exclude, mapped.phrase, (it) =>
      tokensOf(stemName(it.displayName || '')).includes(tok),
    )
  }

  return buckets
}

export function buildRefineBuckets(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
): MatchBucket[] {
  const fn = buildFunctionBuckets(items, exclude)
  const inLetter = [...exclude].some((id) => id.startsWith('段'))
  if (inLetter) return [...fn, ...letterBuckets(items, exclude)]
  const { chips: fnChips } = partitionExclusive(items, fn)
  if (splittingChips(fnChips, items.length).length > 0) return fn
  const withSrc = [...fn, ...buildSourceBuckets(items, exclude)]
  const { chips: srcChips } = partitionExclusive(items, withSrc)
  if (splittingChips(srcChips, items.length).length > 0) return withSrc
  if (items.length > FUNNEL_LIST_MAX) return [...withSrc, ...letterBuckets(items, exclude)]
  return withSrc
}

export type RefineLayerKind = 'function' | 'source' | 'name'

/** 本层芯片在干什么：功能 / 来源 / 名称。全是段* → 名称；全是 src: → 来源；其余功能。 */
export function refineLayerKind(chips: { id: string }[]): RefineLayerKind {
  const ids = chips.map((c) => c.id).filter((id) => id !== OTHER_ID)
  if (ids.length === 0) return 'function'
  if (ids.every((id) => id.startsWith('段'))) return 'name'
  if (ids.every((id) => id.startsWith('src:'))) return 'source'
  return 'function'
}

export type PartitionRefineResult = {
  chips: PartitionChip[]
  assignment: Map<string, string>
}

const EMPTY_ASSIGNMENT: Map<string, string> = new Map()

/** 一次功能桶扫描同时给出芯片与分桶表，避免点芯片再扫一遍。 */
export function partitionRefineResult(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
): PartitionRefineResult {
  if (items.length <= 1) return { chips: [], assignment: EMPTY_ASSIGNMENT }
  return partitionExclusive(items, buildRefineBuckets(items, exclude))
}

export function partitionRefine(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
): PartitionChip[] {
  return partitionRefineResult(items, exclude).chips
}

/** 按已有分桶表收窄，O(n)；点芯片热路径用这个，不重跑扫描。 */
export function filterByAssignment(
  items: FunnelListItem[],
  assignment: ReadonlyMap<string, string>,
  selectedId: string,
): FunnelListItem[] {
  return items.filter((it) => assignment.get(it.entryId) === selectedId)
}

export function filterByPartition(
  items: FunnelListItem[],
  exclude: ReadonlySet<string>,
  selectedId: string,
): FunnelListItem[] {
  const { assignment } = partitionRefineResult(items, exclude)
  return filterByAssignment(items, assignment, selectedId)
}

/** 能切开当前集的芯片；count=n 的单桶（含「全是其他」）视为无法再切。 */
export function splittingChips(chips: PartitionChip[], n: number): PartitionChip[] {
  return chips.filter((c) => c.count > 0 && c.count < n)
}

export function itemMatchesPersonaFilter(
  item: FunnelListItem,
  persona: PersonaId | null,
  phrasePath: readonly string[] = [],
  personaSub: PersonaSubFilter | null = null,
): boolean {
  if (persona && item.personaId !== persona) return false
  if (personaSub && primaryPersonaSub(item) !== personaSub) return false
  if (phrasePath.length > 0 && persona && persona !== 'unclassified') {
    const allowed = phraseAllowList(persona as ClassifiedPersona, personaSub)
    if (primaryPhrase(item, allowed) !== phrasePath[0]) return false
  }
  return true
}

/** 未选人群且无已选细分时跳过功能桶扫描（打开筛选的热路径）。 */
export function funnelNeedsRefinePass(
  persona: PersonaId | null,
  refineStepCount: number,
): boolean {
  return persona != null || refineStepCount > 0
}

/** 表始终可铺。FUNNEL_LIST_MAX 只决定是否展开子档/短语/细分芯片。参数保留以免调用点改签名。 */
export function funnelTableReady(
  _persona?: PersonaId | null,
  _personaSub?: PersonaSubFilter | null,
  _phrasePath?: readonly string[],
  _opts?: FunnelReadyOpts,
): boolean {
  return true
}

/** 表始终可铺；细分芯片与表并存。 */
export function funnelListReady(_matchedCount?: number, _refineChipCount?: number): boolean {
  return true
}

export function stemSkillName(name: string): string {
  return stemName(name)
}

export function isLocaleMirror(name: string, extra = ''): boolean {
  const s = `${name} ${extra}`.toLowerCase()
  return (
    /[·•]\s*ja-jp/.test(s) ||
    s.includes('ja-jp/') ||
    s.includes('/plugins/') ||
    s.includes('\\plugins\\') ||
    /[·•]\s*es\//.test(s)
  )
}

/** 同 sourceId + 去后缀名称只留一条；无 locale 后缀优先。 */
export function hideLocaleMirrors<
  T extends { entryId: string; displayName?: string; sourceId?: string | null },
>(items: T[]): T[] {
  const best = new Map<string, T>()
  for (const it of items) {
    const stem = stemName(it.displayName || it.entryId)
    const key = `${it.sourceId || ''}::${stem.toLowerCase()}`
    const prev = best.get(key)
    if (!prev) {
      best.set(key, it)
      continue
    }
    const prevMirror = isLocaleMirror(prev.displayName || '', prev.entryId)
    const nextMirror = isLocaleMirror(it.displayName || '', it.entryId)
    if (prevMirror && !nextMirror) best.set(key, it)
  }
  return items.filter((it) => {
    const stem = stemName(it.displayName || it.entryId)
    const key = `${it.sourceId || ''}::${stem.toLowerCase()}`
    return best.get(key) === it
  })
}

export function countByPersona(items: FunnelListItem[]): Record<PersonaId, number> {
  const out = {} as Record<PersonaId, number>
  for (const c of PERSONA_CHIPS) out[c.id] = 0
  for (const it of items) out[it.personaId] = (out[it.personaId] || 0) + 1
  return out
}

export function emptyPersonaSubCounts(
  persona: ClassifiedPersona,
): Record<string, number> & { [OTHER_ID]: number } {
  const out = { [OTHER_ID]: 0 } as Record<string, number> & { [OTHER_ID]: number }
  for (const s of PERSONA_SUBS[persona]) out[s.id] = 0
  return out
}

export function countByPersonaSub(
  items: FunnelListItem[],
  persona: ClassifiedPersona,
): Record<string, number> & { [OTHER_ID]: number } {
  const out = emptyPersonaSubCounts(persona)
  for (const it of items) {
    if (it.personaId !== persona) continue
    const sub = primaryPersonaSub(it)
    out[sub] = (out[sub] || 0) + 1
  }
  return out
}

export function visiblePersonaSubCount(counts: Record<string, number>): number {
  let n = 0
  for (const c of Object.values(counts)) {
    if (c > 0) n += 1
  }
  return n
}

export function countPhrases(
  items: FunnelListItem[],
  persona: ClassifiedPersona,
  personaSub: PersonaSubFilter | null = null,
): { phrase: string; count: number }[] {
  const allowed = phraseAllowList(persona, personaSub)
  const subset = items.filter((it) => {
    if (it.personaId !== persona) return false
    if (personaSub && primaryPersonaSub(it) !== personaSub) return false
    return true
  })
  const buckets: MatchBucket[] = allowed.map((id) => ({
    id,
    match: (it: FunnelListItem) => it.personaPhrases.includes(id),
  }))
  return partitionExclusive(subset, buckets).chips.map((c) => ({ phrase: c.id, count: c.count }))
}

/** 默认露 Top N；已选与「其他」始终钉在可见行。 */
export function visiblePhraseChips(
  ranked: { phrase: string; count: number }[],
  selected: string | null,
  expanded: boolean,
  max = PHRASE_CHIP_MAX,
): { phrase: string; count: number }[] {
  const other = ranked.find((x) => x.phrase === OTHER_ID)
  const named = ranked.filter((x) => x.phrase !== OTHER_ID)
  if (expanded || named.length + (other ? 1 : 0) <= max) return ranked
  const head = named.slice(0, max)
  const headSet = new Set(head.map((x) => x.phrase))
  const extra =
    selected && selected !== OTHER_ID && !headSet.has(selected)
      ? ranked.find((x) => x.phrase === selected)
      : undefined
  const out = extra ? [...head, extra] : [...head]
  return other ? [...out, other] : out
}

export function visiblePartitionChips(
  chips: PartitionChip[],
  selected: string | null,
  expanded: boolean,
  max = PHRASE_CHIP_MAX,
): PartitionChip[] {
  const ranked = chips.map((c) => ({ phrase: c.id, count: c.count }))
  const vis = visiblePhraseChips(ranked, selected, expanded, max)
  return vis
    .map((x) => chips.find((c) => c.id === x.phrase))
    .filter((c): c is PartitionChip => !!c)
}
