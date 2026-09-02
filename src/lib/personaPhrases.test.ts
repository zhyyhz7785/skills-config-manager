import assert from 'node:assert/strict'
import test from 'node:test'
import {
  derivePersona,
  itemMatchesPersonaFilter,
  annotateFunnelItem,
  hideLocaleMirrors,
  countPhrases,
  countByPersonaSub,
  visiblePhraseChips,
  funnelTableReady,
  funnelNeedsRefinePass,
  partitionRefine,
  partitionRefineResult,
  filterByPartition,
  filterByAssignment,
  splittingChips,
  funnelListReady,
  chipLabelZh,
  chipLabel,
  funnelTaxonomyLabels,
  refineLayerKind,
  OTHER_ID,
  FUNNEL_LIST_MAX,
  FUNNEL_CHIP_IDS,
  PERSONA_CHIPS,
} from './personaPhrases.ts'

test('cold-email is marketing not writing', () => {
  const d = derivePersona({
    entryId: 'net:coreyhaines:cold-email',
    displayName: 'cold-email',
    summary: 'You are an expert cold email writer',
    sourceId: 'coreyhaines31-marketingskills',
  })
  assert.equal(d.personaId, 'marketing')
  assert.ok(d.phrases.includes('冷邮件'))
})

test('humanizer is writing 去AI腔', () => {
  const d = derivePersona({
    entryId: 'net:blader:humanizer',
    displayName: 'humanizer',
    summary: 'Remove AI writing patterns',
    sourceId: 'blader-humanizer',
  })
  assert.equal(d.personaId, 'writing')
  assert.ok(d.phrases.includes('去AI腔'))
})

test('skill-creator is general 装技能', () => {
  const d = derivePersona({
    entryId: 'net:anthropics:skill-creator',
    displayName: 'skill-creator',
    summary: 'A skill for creating new skills',
    sourceId: 'anthropics-skills',
  })
  assert.equal(d.personaId, 'general')
  assert.ok(d.phrases.includes('装技能'))
})

test('marketing item can carry multiple phrases', () => {
  const d = derivePersona({
    entryId: 'net:demo:growth',
    displayName: 'seo-audit-and-pricing',
    summary: 'cold-email plus pricing page',
    sourceId: 'coreyhaines31-marketingskills',
  })
  assert.equal(d.personaId, 'marketing')
  assert.ok(d.phrases.includes('冷邮件'))
  assert.ok(d.phrases.includes('SEO'))
  assert.ok(d.phrases.includes('定价'))
  assert.ok(d.phrases.length >= 3)
})

test('marketing phrase filter excludes humanizer', () => {
  const cold = annotateFunnelItem(
    {
      entryId: 'a',
      displayName: 'cold-email',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'cold email writer',
      sourceId: 'marketingskills',
    },
    'network',
  )
  const human = annotateFunnelItem(
    {
      entryId: 'b',
      displayName: 'humanizer',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'Remove AI writing patterns',
      sourceId: 'blader-humanizer',
    },
    'network',
  )
  const phrases = ['冷邮件']
  assert.equal(itemMatchesPersonaFilter(cold, 'marketing', phrases), true)
  assert.equal(itemMatchesPersonaFilter(human, 'marketing', phrases), false)
})

test('standards-qa is engineering 规范问答', () => {
  const d = derivePersona({
    entryId: 'lib:L1D10-standards-qa',
    displayName: 'L1D10-standards-qa',
    summary: '根据工程规范库回答技术问题',
  })
  assert.equal(d.personaId, 'engineering')
  assert.ok(d.phrases.includes('规范问答'))
})

test('pptx is docs 幻灯片', () => {
  const d = derivePersona({
    entryId: 'net:anthropics:pptx',
    displayName: 'pptx',
    summary: 'Create PowerPoint slide decks',
  })
  assert.equal(d.personaId, 'docs')
  assert.ok(d.phrases.includes('幻灯片'))
})

test('brand-guidelines is creative 品牌规范', () => {
  const d = derivePersona({
    entryId: 'net:anthropics:brand-guidelines',
    displayName: 'brand-guidelines',
    summary: 'Apply Anthropic brand identity',
  })
  assert.equal(d.personaId, 'creative')
  assert.ok(d.phrases.includes('品牌规范'))
})

test('name token testing maps to 测试', () => {
  const d = derivePersona({
    entryId: 'net:demo:foo-testing',
    displayName: 'foo-testing',
    summary: 'Run the suite',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.ok(d.phrases.includes('测试'))
})

test('hideLocaleMirrors keeps one stem per source', () => {
  const a = annotateFunnelItem(
    {
      entryId: 'net:ecc:ops',
      displayName: 'unified-notifications-ops',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      sourceId: 'affaan-m-ecc',
    },
    'network',
  )
  const b = annotateFunnelItem(
    {
      entryId: 'net:ecc:ops-ja',
      displayName: 'unified-notifications-ops · ja-JP/skills',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      sourceId: 'affaan-m-ecc',
    },
    'network',
  )
  const out = hideLocaleMirrors([b, a])
  assert.equal(out.length, 1)
  assert.equal(out[0].entryId, 'net:ecc:ops')
})

test('visiblePhraseChips pins selected beyond top 10', () => {
  const ranked = Array.from({ length: 12 }, (_, i) => ({
    phrase: `p${i}`,
    count: 12 - i,
  }))
  const vis = visiblePhraseChips(ranked, 'p11', false, 10)
  assert.equal(vis.length, 11)
  assert.ok(vis.some((x) => x.phrase === 'p11'))
})

test('n8n automation is software-backend sw-auto', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:demo:n8n',
      displayName: 'n8n-workflow',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'n8n zapier automation',
    },
    'network',
  )
  assert.equal(it.personaId, 'software-backend')
  assert.ok(it.personaSubs.includes('sw-auto'))
  assert.equal(itemMatchesPersonaFilter(it, 'software-backend', [], 'sw-auto'), true)
  assert.equal(itemMatchesPersonaFilter(it, 'software-backend', [], 'sw-infra'), false)
  assert.equal(itemMatchesPersonaFilter(it, 'software-frontend'), false)
})

test('azure maps to sw-infra not sw-auto', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:demo:az',
      displayName: 'azure-functions',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'Azure service architecture',
    },
    'network',
  )
  assert.equal(it.personaId, 'software-backend')
  assert.ok(it.personaSubs.includes('sw-infra'))
})

test('adding-auth maps to sw-sec', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:spencer:adding-auth',
      displayName: 'adding-auth',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'Add authentication using NextAuth.js',
    },
    'network',
  )
  assert.equal(it.personaId, 'software-backend')
  assert.ok(it.personaSubs.includes('sw-sec'))
})

test('frontend maps to sw-front', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:demo:react-ui',
      displayName: 'react-nextjs',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'frontend react nextjs css',
    },
    'network',
  )
  assert.equal(it.personaId, 'software-frontend')
  assert.ok(it.personaSubs.includes('sw-front'))
  assert.equal(itemMatchesPersonaFilter(it, 'software-backend'), false)
})

test('cold-email maps to mk-cold', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:coreyhaines:cold-email',
      displayName: 'cold-email',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'You are an expert cold email writer',
      sourceId: 'coreyhaines31-marketingskills',
    },
    'network',
  )
  assert.equal(it.personaId, 'marketing')
  assert.ok(it.personaSubs.includes('mk-cold'))
})

test('tutoring maps to ln-teach', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:demo:quiz',
      displayName: 'quiz-maker',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'tutoring curriculum lesson plan',
    },
    'network',
  )
  assert.equal(it.personaId, 'learning')
  assert.ok(it.personaSubs.includes('ln-teach'))
})

test('pptx maps to dc-slides', () => {
  const it = annotateFunnelItem(
    {
      entryId: 'net:anthropics:pptx',
      displayName: 'pptx',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'Create PowerPoint slide decks',
    },
    'network',
  )
  assert.equal(it.personaId, 'docs')
  assert.ok(it.personaSubs.includes('dc-slides'))
})

test('countByPersonaSub is exclusive primary sub', () => {
  const auto = annotateFunnelItem(
    {
      entryId: 'a',
      displayName: 'n8n-flow',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'n8n automation',
    },
    'network',
  )
  const counts = countByPersonaSub([auto], 'software-backend')
  assert.ok(counts['sw-auto'] >= 1)
})

test('countPhrases only counts selected persona word table', () => {
  const cold = annotateFunnelItem(
    {
      entryId: 'a',
      displayName: 'cold-email',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'cold email writer',
    },
    'network',
  )
  const rows = countPhrases([cold], 'marketing')
  assert.ok(rows.some((r) => r.phrase === '冷邮件' && r.count === 1))
})

test('library origin item matches same phrase filter', () => {
  const local = annotateFunnelItem(
    {
      entryId: 'lib:cold',
      displayName: 'cold-email',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'cold email writer',
    },
    'library',
  )
  assert.equal(local.funnelOrigin, 'library')
  assert.equal(itemMatchesPersonaFilter(local, 'marketing', ['冷邮件']), true)
})

test('funnelTableReady always allows the table', () => {
  assert.equal(funnelTableReady(null, null, []), true)
  assert.equal(funnelTableReady('unclassified', null, []), true)
  assert.equal(funnelTableReady('marketing', null, []), true)
  assert.equal(funnelTableReady('marketing', null, ['冷邮件']), true)
  assert.equal(
    funnelTableReady('software-backend', null, [], {
      personaCount: 2000,
      subCount: 0,
      visibleSubCount: 17,
    }),
    true,
  )
  assert.equal(
    funnelTableReady('software-backend', 'sw-lang', [], {
      personaCount: 2000,
      subCount: 40,
      visibleSubCount: 4,
    }),
    true,
  )
})

test('no persona filter keeps the whole pool', () => {
  const auto = stubItem('a', 'n8n-flow', { summary: 'n8n automation' })
  const front = stubItem('c', 'react-ui', { summary: 'frontend react nextjs css' })
  const items = [auto, front]
  assert.equal(items.every((it) => itemMatchesPersonaFilter(it, null)), true)
})

test('frontend and backend personas do not dump each other', () => {
  const auto = stubItem('a', 'n8n-flow', { summary: 'n8n automation' })
  const azure = stubItem('b', 'azure-functions', { summary: 'Azure service architecture' })
  const front = stubItem('c', 'react-ui', { summary: 'frontend react nextjs css' })
  const items = [auto, azure, front]
  const backend = items.filter((it) => itemMatchesPersonaFilter(it, 'software-backend'))
  const frontend = items.filter((it) => itemMatchesPersonaFilter(it, 'software-frontend'))
  assert.equal(backend.length, 2)
  assert.equal(frontend.length, 1)
  assert.equal(frontend[0].entryId, 'c')
  assert.equal(
    funnelTableReady('software-backend', null, [], {
      personaCount: 2000,
      subCount: 0,
      visibleSubCount: 17,
    }),
    true,
  )
  assert.equal(
    funnelTableReady('software-backend', 'sw-auto', [], {
      personaCount: 2000,
      subCount: 8,
      visibleSubCount: 17,
    }),
    true,
  )
})

test('exclusive phrase match uses primary phrase only', () => {
  const a = annotateFunnelItem(
    {
      entryId: 'a',
      displayName: 'n8n-azure-flow',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'n8n automation azure graphql webhook',
    },
    'network',
  )
  const b = annotateFunnelItem(
    {
      entryId: 'b',
      displayName: 'zapier-only',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: 'zapier automation',
    },
    'network',
  )
  assert.equal(itemMatchesPersonaFilter(a, 'software-backend', ['工作流自动化'], 'sw-auto'), true)
  assert.equal(itemMatchesPersonaFilter(b, 'software-backend', ['工作流自动化'], 'sw-auto'), true)
  const chips = partitionRefine([a, b], new Set(['工作流自动化']))
  const sum = chips.reduce((n, c) => n + c.count, 0)
  assert.equal(sum, 2)
  const ids = new Set(chips.map((c) => c.id))
  assert.equal(ids.size, chips.length)
})

test('funnelListReady always allows the table', () => {
  assert.equal(FUNNEL_LIST_MAX, 12)
  assert.equal(funnelListReady(12, 5), true)
  assert.equal(funnelListReady(13, 5), true)
  assert.equal(funnelListReady(868, 0), true)
})

test('funnelNeedsRefinePass skips full-pool refine until a persona is picked', () => {
  assert.equal(funnelNeedsRefinePass(null, 0), false)
  assert.equal(funnelNeedsRefinePass('software-frontend', 0), true)
  assert.equal(funnelNeedsRefinePass(null, 1), true)
})

function stubItem(
  entryId: string,
  displayName: string,
  extra: { summary?: string; sourceId?: string; libraryPathRel?: string } = {},
) {
  return annotateFunnelItem(
    {
      entryId,
      displayName,
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: false,
      summary: extra.summary,
      sourceId: extra.sourceId,
      libraryPathRel: extra.libraryPathRel,
    },
    'network',
  )
}

test('exclusive software-backend subs plus 其他 equal backend n', () => {
  const auto = stubItem('a', 'n8n-flow', { summary: 'n8n automation' })
  const both = stubItem('b', 'n8n-azure', { summary: 'n8n automation azure graphql' })
  const cloud = stubItem('c', 'azure-functions', { summary: 'Azure service architecture' })
  const items = [auto, both, cloud]
  const counts = countByPersonaSub(items, 'software-backend')
  const sum = Object.values(counts).reduce((n, c) => n + c, 0)
  assert.equal(sum, 3)
  assert.equal(counts['sw-auto'], 2)
  assert.equal(counts['sw-infra'], 1)
})

test('exclusive phrase chips plus 其他 equal parent n', () => {
  const a = stubItem('a', 'n8n-flow', { summary: 'n8n automation' })
  const b = stubItem('b', 'playwright-scrape', { summary: 'scrape crawler playwright' })
  const c = stubItem('c', 'nanoclaw-repl', { summary: 'command-line repl' })
  const d = stubItem('d', 'mystery-auto', { summary: 'automation only' })
  const items = [a, b, c, d]
  const autoParent = items.filter((it) =>
    itemMatchesPersonaFilter(it, 'software-backend', [], 'sw-auto'),
  )
  const rows = countPhrases(items, 'software-backend', 'sw-auto')
  const sum = rows.reduce((n, r) => n + r.count, 0)
  assert.equal(sum, autoParent.length)
  const phrases = rows.map((r) => r.phrase)
  assert.equal(new Set(phrases).size, phrases.length)
  const backend = items.filter((it) => itemMatchesPersonaFilter(it, 'software-backend'))
  assert.equal(backend.length, 4)
  const groupRows = countPhrases(backend, 'software-backend', null)
  assert.equal(
    groupRows.reduce((n, r) => n + r.count, 0),
    backend.length,
  )
})

test('refine chips are exclusive and sum to n; no raw english tokens', () => {
  const items = [
    stubItem('a', 'slack-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('b', 'github-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('c', 'n8n-azure-flow', { summary: 'n8n automation azure graphql webhook' }),
    stubItem('d', 'zapier-only', { summary: 'zapier automation' }),
  ]
  const chips = partitionRefine(items, new Set(['工作流自动化']))
  const n = items.length
  const sum = chips.reduce((s, c) => s + c.count, 0)
  assert.equal(sum, n)
  assert.equal(new Set(chips.map((c) => c.id)).size, chips.length)
  for (const c of chips) {
    assert.notEqual(c.id, 'automation')
    assert.notEqual(c.id, 'api')
    assert.match(c.label.zh, /[^\u0000-\u007f]|其他|MCP|PDF|A–E|F–J|K–O|P–T|U–Z|^名称 [A-Z]$/)
  }
  const useful = splittingChips(chips, n)
  if (n > 1) assert.ok(useful.length > 0 || chips.every((c) => c.count === n))
})

test('chip labels use zh not raw API/SEO/CLI', () => {
  assert.equal(chipLabelZh('API对接'), '接口对接')
  assert.equal(chipLabelZh('SEO'), '搜索优化')
  assert.equal(chipLabelZh('CLI工具'), '命令行')
  assert.equal(chipLabelZh('Azure云'), '微软云')
  assert.equal(chipLabelZh('MCP构建'), 'MCP服务')
  assert.equal(chipLabelZh('Agent编排'), '智能体编排')
  assert.equal(chipLabelZh(OTHER_ID), '其他')
})

test('English funnel chips have no CJK', () => {
  assert.equal(chipLabel('语言惯用法', 'en'), 'Language idioms')
  assert.equal(chipLabel('前端界面', 'en'), 'Frontend UI')
  assert.equal(chipLabel('架构设计', 'en'), 'Architecture')
  assert.equal(chipLabel(OTHER_ID, 'en'), 'Other')
  const cjk = /[\u4e00-\u9fff]/
  for (const id of FUNNEL_CHIP_IDS) {
    const en = chipLabel(id, 'en')
    assert.ok(en.length > 0, id)
    assert.ok(!cjk.test(en), `${id} en=${en}`)
  }
  for (const c of PERSONA_CHIPS) {
    assert.ok(c.label.en.length > 0, c.id)
    assert.ok(!cjk.test(c.label.en), `${c.id} en=${c.label.en}`)
  }
})

test('ads maps to marketing 投放', () => {
  const d = derivePersona({
    entryId: 'net:coreyhaines:ads',
    displayName: 'ads',
    summary: 'paid advertising campaigns on Google Ads',
  })
  assert.equal(d.personaId, 'marketing')
  assert.ok(d.phrases.includes('投放'))
})

test('adding-auth maps to 安全加固', () => {
  const d = derivePersona({
    entryId: 'net:spencer:adding-auth',
    displayName: 'adding-auth',
    summary: 'Add authentication using NextAuth.js',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.ok(d.phrases.includes('安全加固'))
})

test('ai-image maps to creative 图像处理', () => {
  const d = derivePersona({
    entryId: 'net:inf:ai-image-generation',
    displayName: 'ai-image-generation',
    summary: 'Generate AI images with FLUX',
  })
  assert.equal(d.personaId, 'creative')
  assert.ok(d.phrases.includes('图像处理'))
})

test('visiblePhraseChips pins 其他', () => {
  const ranked = [
    ...Array.from({ length: 12 }, (_, i) => ({ phrase: `p${i}`, count: 12 - i })),
    { phrase: OTHER_ID, count: 3 },
  ]
  const vis = visiblePhraseChips(ranked, null, false, 10)
  assert.ok(vis.some((x) => x.phrase === OTHER_ID))
  assert.ok(vis.length <= 11)
})

test('SOURCE_THEME fallback: nvidia zero-hit becomes 软件后端 without 科学计算', () => {
  const d = derivePersona({
    entryId: 'net:nv:amc-run-rtsp-calibration',
    displayName: 'amc-run-rtsp-calibration',
    summary: 'Calibrate a dataset from live RTSP camera streams',
    sourceId: 'nvidia-skills',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.equal(d.phrases.includes('科学计算'), false)
})

test('SOURCE_THEME does not override a rule hit', () => {
  const d = derivePersona({
    entryId: 'net:nv:n8n-flow',
    displayName: 'n8n-workflow',
    summary: 'n8n zapier automation',
    sourceId: 'nvidia-skills',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.ok(d.phrases.includes('工作流自动化'))
})

test('mixed source with zero hit stays unclassified', () => {
  const d = derivePersona({
    entryId: 'net:ali:xyz-unknown',
    displayName: 'xyz-unknown-widget',
    summary: 'A miscellaneous helper with no domain words',
    sourceId: 'alirezarezvani-claude-skills',
  })
  assert.equal(d.personaId, 'unclassified')
})

test('letter buckets stay off when semantic chips can split', () => {
  const items = [
    stubItem('a', 'slack-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('b', 'github-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('c', 'n8n-azure-flow', { summary: 'n8n automation azure graphql webhook' }),
  ]
  const chips = partitionRefine(items, new Set(['工作流自动化']))
  assert.equal(
    chips.some((c) => c.id.startsWith('段')),
    false,
  )
  assert.ok(splittingChips(chips, items.length).length > 0)
})

test('connector category maps slack-automation to 通讯协作', () => {
  const items = [
    stubItem('a', 'slack-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('b', 'discord-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
    stubItem('c', 'github-automation', {
      summary: 'rube automation',
      sourceId: 'composio-awesome-claude-skills',
    }),
  ]
  const chips = partitionRefine(items, new Set(['工作流自动化']))
  const sum = chips.reduce((n, c) => n + c.count, 0)
  assert.equal(sum, 3)
  const chat = chips.find((c) => c.id === '通讯协作')
  assert.ok(chat)
  assert.equal(chat!.count, 2)
  const members = filterByPartition(items, new Set(['工作流自动化']), '通讯协作')
  const next = partitionRefine(members, new Set(['工作流自动化', '通讯协作']))
  assert.ok(next.some((c) => c.id === 'saas:slack' && c.label.zh === 'Slack'))
  assert.ok(next.some((c) => c.id === 'saas:discord' && c.label.zh === 'Discord'))
})

test('microsoft azure domains split storage vs ai; no whole-catalog source chip', () => {
  const storageNames = [
    'azure-storage-blob-py',
    'azure-storage-queue-py',
    'azure-storage-file-py',
    'azure-cosmos-py',
    'azure-data-tables-py',
  ]
  const aiNames = [
    'azure-ai-ml-py',
    'azure-ai-textanalytics-py',
    'azure-ai-formrecognizer-py',
    'azure-openai-py',
  ]
  const items = [...storageNames, ...aiNames].map((name, i) =>
    stubItem(`ms${i}`, name, {
      sourceId: 'microsoft-skills',
      libraryPathRel: `cache/microsoft-skills/skills/${name}/SKILL.md`,
    }),
  )
  const chips = partitionRefine(items, new Set(['Azure云']))
  const n = items.length
  assert.equal(chips.reduce((s, c) => s + c.count, 0), n)
  const data = chips.find((c) => c.id === 'fn:azure-data')
  const ai = chips.find((c) => c.id === 'fn:azure-ai')
  assert.ok(data, `got ${chips.map((c) => c.id).join(',')}`)
  assert.ok(ai, `got ${chips.map((c) => c.id).join(',')}`)
  assert.notEqual(data!.id, ai!.id)
  assert.equal(
    chips.some((c) => c.id === 'src:microsoft-skills'),
    false,
  )
  assert.equal(
    chips.some((c) => c.id.startsWith('段')),
    false,
  )
  assert.equal(refineLayerKind(chips), 'function')
})

test('github copilot path kinds split; not swallowed by source chip', () => {
  const prompts = ['zzq-alpha', 'zzq-beta', 'zzq-gamma', 'zzq-delta', 'zzq-epsilon']
  const skills = ['zzq-zeta', 'zzq-eta', 'zzq-theta', 'zzq-iota', 'zzq-kappa']
  const items = [
    ...prompts.map((name, i) =>
      stubItem(`gp${i}`, name, {
        sourceId: 'github-awesome-copilot',
        libraryPathRel: `cache/github-awesome-copilot/prompts/${name}.prompt.md`,
      }),
    ),
    ...skills.map((name, i) =>
      stubItem(`gs${i}`, name, {
        sourceId: 'github-awesome-copilot',
        libraryPathRel: `cache/github-awesome-copilot/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  const n = items.length
  assert.equal(chips.reduce((s, c) => s + c.count, 0), n)
  assert.ok(chips.some((c) => c.id === 'path:prompts'), `got ${chips.map((c) => c.id).join(',')}`)
  assert.ok(chips.some((c) => c.id === 'path:skills'), `got ${chips.map((c) => c.id).join(',')}`)
  assert.equal(
    chips.some((c) => c.id === 'src:github-awesome-copilot'),
    false,
  )
  assert.equal(
    chips.some((c) => c.id.startsWith('段')),
    false,
  )
})

test('azure language suffix splits after a function domain is selected', () => {
  const items = [
    stubItem('py', 'azure-storage-blob-py', {
      sourceId: 'microsoft-skills',
      libraryPathRel: 'cache/microsoft-skills/skills/azure-storage-blob-py/SKILL.md',
    }),
    stubItem('ts', 'azure-storage-blob-ts', {
      sourceId: 'microsoft-skills',
      libraryPathRel: 'cache/microsoft-skills/skills/azure-storage-blob-ts/SKILL.md',
    }),
  ]
  const chips = partitionRefine(items, new Set(['Azure云', 'fn:azure-data']))
  assert.equal(chips.reduce((s, c) => s + c.count, 0), 2)
  assert.ok(chips.some((c) => c.id === 'lang:py'))
  assert.ok(chips.some((c) => c.id === 'lang:ts'))
})

function kDenseItem(id: string, name: string) {
  return stubItem(id, name, {
    sourceId: 'k-dense-ai-scientific-agent-skills',
    libraryPathRel: `cache/k-dense-ai-scientific-agent-skills/skills/${name}/SKILL.md`,
  })
}

test('k-dense science domains split genomics vs physics vs writing; no whole-catalog source chip', () => {
  const items = [
    kDenseItem('g1', 'pydeseq2'),
    kDenseItem('g2', 'pysam'),
    kDenseItem('g3', 'phylogenetics'),
    kDenseItem('g4', 'scanpy'),
    kDenseItem('p1', 'pennylane'),
    kDenseItem('p2', 'qiskit'),
    kDenseItem('p3', 'pymatgen'),
    kDenseItem('c1', 'paperzilla'),
    kDenseItem('c2', 'scientific-writing'),
    kDenseItem('c3', 'pyzotero'),
    kDenseItem('c4', 'literature-review'),
    kDenseItem('c5', 'scientific-slides'),
    kDenseItem('c6', 'venue-templates'),
  ]
  const chips = partitionRefine(items, new Set(['科学计算']))
  const n = items.length
  assert.equal(chips.reduce((s, c) => s + c.count, 0), n)
  const ids = chips.map((c) => c.id).join(',')
  assert.ok(chips.some((c) => c.id === 'fn:sci-genomics'), `got ${ids}`)
  assert.ok(chips.some((c) => c.id === 'fn:sci-physics'), `got ${ids}`)
  assert.ok(chips.some((c) => c.id === 'fn:sci-comms'), `got ${ids}`)
  assert.equal(
    chips.some((c) => c.id.startsWith('src:') && c.id.includes('k-dense')),
    false,
  )
  assert.equal(
    chips.some((c) => c.id.startsWith('段')),
    false,
  )
  assert.equal(refineLayerKind(chips), 'function')
})

test('science domain does not enable azure language suffixes', () => {
  const items = [kDenseItem('a', 'pydeseq2'), kDenseItem('b', 'pysam')]
  const chips = partitionRefine(items, new Set(['科学计算', 'fn:sci-genomics']))
  assert.equal(
    chips.some((c) => c.id.startsWith('lang:')),
    false,
  )
})

function assertFunctionSplit(chips: ReturnType<typeof partitionRefine>, n: number, ids: string[]) {
  assert.equal(chips.reduce((s, c) => s + c.count, 0), n)
  const got = chips.map((c) => c.id).join(',')
  for (const id of ids) assert.ok(chips.some((c) => c.id === id), `missing ${id} in ${got}`)
  assert.equal(chips.some((c) => c.id.startsWith('src:')), false, got)
  assert.equal(chips.some((c) => c.id.startsWith('段')), false, got)
  assert.equal(refineLayerKind(chips), 'function')
}

test('nvidia product prefixes split doca vs tao; no source chip', () => {
  const doca = ['doca-flow', 'doca-eth', 'doca-rdma', 'doca-setup', 'doca-telemetry']
  const tao = ['tao-train-dino', 'tao-finetune-clip', 'tao-run-on-docker', 'tao-list-capabilities']
  const items = [
    ...doca.map((name, i) =>
      stubItem(`d${i}`, name, {
        sourceId: 'nvidia-skills',
        libraryPathRel: `cache/nvidia-skills/skills/${name}/SKILL.md`,
      }),
    ),
    ...tao.map((name, i) =>
      stubItem(`t${i}`, name, {
        sourceId: 'nvidia-skills',
        libraryPathRel: `cache/nvidia-skills/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:nv-doca', 'fn:nv-tao'])
})

test('aws service dirs split serverless vs database; no infrastructure source chip', () => {
  const serverless = ['lambda-event-source', 'lambda-url', 'api-gateway-http', 'step-functions-express']
  const db = ['dynamodb-single-table', 'rds-proxy', 'aurora-serverless', 'elasticache-redis']
  const items = [
    ...serverless.map((name, i) =>
      stubItem(`s${i}`, name, {
        sourceId: 'aws-agent-toolkit-for-aws',
        libraryPathRel: `cache/aws-agent-toolkit-for-aws/skills/specialized-skills/serverless-skills/${name}/SKILL.md`,
      }),
    ),
    ...db.map((name, i) =>
      stubItem(`db${i}`, name, {
        sourceId: 'aws-agent-toolkit-for-aws',
        libraryPathRel: `cache/aws-agent-toolkit-for-aws/skills/specialized-skills/database-skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:aws-serverless', 'fn:aws-database'])
})

test('github copilot name functions split gtm vs mcp; path kinds skipped when all skills', () => {
  const gtm = ['gtm-0-to-1-launch', 'gtm-positioning-strategy', 'gtm-product-led-growth', 'gtm-operating-cadence']
  const mcp = ['python-mcp-server-generator', 'go-mcp-server-generator', 'mcp-cli', 'mcp-security-audit']
  const items = [
    ...gtm.map((name, i) =>
      stubItem(`g${i}`, name, {
        sourceId: 'github-awesome-copilot',
        libraryPathRel: `cache/github-awesome-copilot/skills/${name}/SKILL.md`,
      }),
    ),
    ...mcp.map((name, i) =>
      stubItem(`m${i}`, name, {
        sourceId: 'github-awesome-copilot',
        libraryPathRel: `cache/github-awesome-copilot/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:copilot-gtm', 'fn:copilot-mcp'])
})

test('inference-sh media paths split image vs video; no source chip', () => {
  const images = ['flux-pro', 'flux-schnell', 'ideogram-v3', 'recraft-v3']
  const videos = ['kling-video', 'runway-gen3', 'luma-ray', 'minimax-video']
  const items = [
    ...images.map((name, i) =>
      stubItem(`img${i}`, name, {
        sourceId: 'inference-sh-skills',
        libraryPathRel: `cache/inference-sh-skills/tools/image/${name}/SKILL.md`,
      }),
    ),
    ...videos.map((name, i) =>
      stubItem(`vid${i}`, name, {
        sourceId: 'inference-sh-skills',
        libraryPathRel: `cache/inference-sh-skills/tools/video/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:media-image', 'fn:media-video'])
})

test('trail of bits plugins split contracts vs engineering; no source chip', () => {
  const contracts = [
    'slither-scanner',
    'echidna-fuzzer',
    'foundry-invariants',
    'solodit-search',
  ]
  const eng = ['git-cleanup', 'devcontainer-setup', 'gh-cli', 'modern-python']
  const items = [
    ...contracts.map((name, i) =>
      stubItem(`c${i}`, name, {
        sourceId: 'trailofbits-skills',
        libraryPathRel: `cache/trailofbits-skills/plugins/building-secure-contracts/skills/${name}/SKILL.md`,
      }),
    ),
    ...eng.map((name, i) =>
      stubItem(`e${i}`, name, {
        sourceId: 'trailofbits-skills',
        libraryPathRel: `cache/trailofbits-skills/plugins/${name}/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:tob-contracts', 'fn:tob-eng'])
})

test('gsd namespaces split workflow vs context; no 拆任务 source chip', () => {
  const workflow = ['gsd-plan-phase', 'gsd-execute-phase', 'gsd-verify-work', 'gsd-discuss-phase']
  const context = ['gsd-map-codebase', 'gsd-graphify', 'gsd-mempalace-capture', 'gsd-extract-learnings']
  const items = [
    ...workflow.map((name, i) =>
      stubItem(`w${i}`, name, {
        sourceId: 'open-gsd-gsd-core',
        libraryPathRel: `cache/open-gsd-gsd-core/skills/${name}/SKILL.md`,
      }),
    ),
    ...context.map((name, i) =>
      stubItem(`x${i}`, name, {
        sourceId: 'open-gsd-gsd-core',
        libraryPathRel: `cache/open-gsd-gsd-core/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:gsd-workflow', 'fn:gsd-context'])
})

test('phuryn pm dirs split execution vs discovery; no source chip', () => {
  const exec = ['weekly-review', 'standup-notes', 'priority-stack', 'stakeholder-update']
  const disc = ['problem-interview', 'opportunity-solution-tree', 'assumption-map', 'prototype-test']
  const items = [
    ...exec.map((name, i) =>
      stubItem(`e${i}`, name, {
        sourceId: 'phuryn-pm-skills',
        libraryPathRel: `cache/phuryn-pm-skills/pm-execution/${name}/SKILL.md`,
      }),
    ),
    ...disc.map((name, i) =>
      stubItem(`d${i}`, name, {
        sourceId: 'phuryn-pm-skills',
        libraryPathRel: `cache/phuryn-pm-skills/pm-product-discovery/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:pm-exec', 'fn:pm-discover'])
})

test('jeffallan catalog dirs split language vs backend; no source chip', () => {
  const lang = ['python-pro', 'javascript-pro', 'golang-pro', 'rust-engineer']
  const backend = ['fastapi-expert', 'nestjs-expert', 'django-expert', 'rails-expert']
  const items = [
    ...lang.map((name, i) =>
      stubItem(`l${i}`, name, {
        sourceId: 'jeffallan-claude-skills',
        libraryPathRel: `cache/jeffallan-claude-skills/skills/${name}/SKILL.md`,
      }),
    ),
    ...backend.map((name, i) =>
      stubItem(`b${i}`, name, {
        sourceId: 'jeffallan-claude-skills',
        libraryPathRel: `cache/jeffallan-claude-skills/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:jeff-lang', 'fn:jeff-backend'])
})

test('huggingface prefixes split hub vs cloud; no whole-catalog 机器学习 source', () => {
  const hub = ['hf-cli', 'huggingface-best', 'huggingface-tool-builder', 'hf-mem']
  const cloud = [
    'hf-cloud-sagemaker-deployment-planner',
    'hf-cloud-sagemaker-iam-preflight',
    'hf-cloud-aws-context-discovery',
    'hf-cloud-python-env-setup',
  ]
  const items = [
    ...hub.map((name, i) =>
      stubItem(`h${i}`, name, {
        sourceId: 'huggingface-skills',
        libraryPathRel: `cache/huggingface-skills/skills/${name}/SKILL.md`,
      }),
    ),
    ...cloud.map((name, i) =>
      stubItem(`c${i}`, name, {
        sourceId: 'huggingface-skills',
        libraryPathRel: `cache/huggingface-skills/skills/${name}/SKILL.md`,
      }),
    ),
  ]
  const chips = partitionRefine(items, new Set())
  assertFunctionSplit(chips, items.length, ['fn:hf-hub', 'fn:hf-cloud'])
})

test('无障碍 is software-frontend sw-front', () => {
  const it = stubItem('a11y', 'wcag-audit', { summary: 'a11y accessibility wcag' })
  assert.equal(it.personaId, 'software-frontend')
  assert.ok(it.personaSubs.includes('sw-front'))
  assert.ok(it.personaPhrases.includes('无障碍'))
})

test('cudf nvidia skill is software-backend not 科学计算', () => {
  const d = derivePersona({
    entryId: 'net:nv:cudf-join',
    displayName: 'cudf-join',
    summary: 'GPU dataframe joins',
    sourceId: 'nvidia-skills',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.equal(d.phrases.includes('科学计算'), false)
})

test('numpy still learning 科学计算', () => {
  const d = derivePersona({
    entryId: 'net:demo:numpy-fft',
    displayName: 'numpy-fft',
    summary: 'numpy matlab simulation',
  })
  assert.equal(d.personaId, 'learning')
  assert.ok(d.phrases.includes('科学计算'))
})

test('expo SOURCE_THEME is software-frontend 移动应用', () => {
  const d = derivePersona({
    entryId: 'net:expo:xyz-unknown',
    displayName: 'xyz-unknown-widget',
    summary: 'A miscellaneous helper with no domain words',
    sourceId: 'expo-skills',
  })
  assert.equal(d.personaId, 'software-frontend')
  assert.ok(d.phrases.includes('移动应用'))
})

test('huggingface SOURCE_THEME is software-backend without 机器学习 phrase', () => {
  const d = derivePersona({
    entryId: 'net:hf:xyz-unknown',
    displayName: 'xyz-unknown-widget',
    summary: 'A miscellaneous helper with no domain words',
    sourceId: 'huggingface-skills',
  })
  assert.equal(d.personaId, 'software-backend')
  assert.equal(d.phrases.includes('机器学习'), false)
})

test('funnelSearchHay covers persona sub phrase and fn domain labels', () => {
  const a11y = stubItem('a11y', 'wcag-audit', { summary: 'a11y accessibility wcag' })
  assert.ok(a11y.funnelSearchHay.includes('software-frontend'))
  assert.ok(a11y.funnelSearchHay.includes('软件前端'))
  assert.ok(a11y.funnelSearchHay.includes('frontend'))
  assert.ok(a11y.funnelSearchHay.includes('sw-front'))
  assert.ok(a11y.funnelSearchHay.includes('无障碍'))
  assert.ok(a11y.funnelSearchHay.includes('accessibility'))

  const hub = stubItem('hf', 'hf-cli', {
    sourceId: 'huggingface-skills',
    libraryPathRel: 'cache/huggingface-skills/skills/hf-cli/SKILL.md',
    summary: 'huggingface hub cli',
  })
  assert.ok(hub.funnelSearchHay.includes('fn:hf-hub'))
  assert.ok(hub.funnelSearchHay.includes('hub命令'))
  assert.ok(hub.funnelSearchHay.includes('path:skills'))
  assert.ok(hub.funnelSearchHay.includes('技能包'))
})

test('funnelTaxonomyLabels is persona · sub · primary phrase', () => {
  const i18n = annotateFunnelItem(
    {
      entryId: 'lib:L0-i18n',
      displayName: 'L0-i18n',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: true,
      summary: 'desktop i18n locale zh-CN',
      sourceId: '',
    },
    'library',
  )
  const zh = funnelTaxonomyLabels(i18n, 'zh-CN')
  assert.equal(zh.persona, '软件前端')
  assert.equal(zh.sub, '前端')
  assert.equal(zh.fn, '国际化')
  const en = funnelTaxonomyLabels(i18n, 'en')
  assert.equal(en.persona, 'Frontend dev')
  assert.equal(en.sub, 'Frontend')
  assert.equal(en.fn, 'i18n')

  const unknown = annotateFunnelItem(
    {
      entryId: 'lib:zzzz-unknown-xyz',
      displayName: 'zzzz-unknown-xyz',
      groupName: '',
      kindLabel: '技能',
      subtitle: '',
      isInContainerList: true,
      summary: '',
      sourceId: '',
    },
    'library',
  )
  const u = funnelTaxonomyLabels(unknown, 'zh-CN')
  assert.equal(u.persona, '未归类')
  assert.equal(u.sub, '—')
  assert.equal(u.fn, '—')
})

test('ten personas plus unclassified; no software parent chip', () => {
  const ids = PERSONA_CHIPS.map((c) => c.id)
  assert.equal(ids.filter((id) => id !== 'unclassified').length, 10)
  assert.ok(ids.includes('software-frontend'))
  assert.ok(ids.includes('software-backend'))
  assert.ok(!(ids as string[]).includes('software'))
  const cjk = /[\u4e00-\u9fff]/
  for (const c of PERSONA_CHIPS) {
    assert.ok(c.label.zh.length > 0, c.id)
    assert.ok(c.label.en.length > 0, c.id)
    assert.ok(!cjk.test(c.label.en), `${c.id} en=${c.label.en}`)
  }
})

test('clicking path:skills chip filters by assignment same as rescan', () => {
  const packs = Array.from({ length: 8 }, (_, i) =>
    stubItem(`pack-${i}`, `pack-${i}`, {
      libraryPathRel: `cache/demo/skills/pack-${i}/SKILL.md`,
    }),
  )
  const prompt = stubItem('prompt-1', 'prompt-1', {
    libraryPathRel: 'cache/demo/prompts/prompt-1/SKILL.md',
  })
  const items = [...packs, prompt]
  const { chips, assignment } = partitionRefineResult(items, new Set())
  const packChip = chips.find((c) => c.id === 'path:skills')
  assert.ok(packChip, `chips=${chips.map((c) => c.id).join(',')}`)
  const viaAssign = filterByAssignment(items, assignment, 'path:skills')
  const viaRescan = filterByPartition(items, new Set(), 'path:skills')
  assert.equal(viaAssign.length, viaRescan.length)
  assert.equal(viaAssign.length, packChip.count)
  assert.ok(viaAssign.length < items.length)
  assert.ok(viaAssign.every((it) => it.entryId.startsWith('pack-')))
})

