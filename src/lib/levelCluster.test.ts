import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayLevelLabel,
  groupItemsByLevelBucket,
  levelBucketOf,
  sortItemsByLevelBucket,
  sortItemsInLevelBuckets,
  taxonomySourceParts,
} from './levelCluster.ts'
import type { FunnelListItem } from './personaPhrases.ts'

test('network rows always bucket as uncategorized', () => {
  assert.equal(levelBucketOf({ funnelOrigin: 'network', levelKey: 'L1' }), 'uncategorized')
  assert.equal(levelBucketOf({ funnelOrigin: 'network', levelKey: null }), 'uncategorized')
})

test('library rows follow L0/L1/L2 or uncategorized', () => {
  assert.equal(levelBucketOf({ funnelOrigin: 'library', levelKey: 'L0' }), 'L0')
  assert.equal(levelBucketOf({ funnelOrigin: 'library', levelKey: 'L2' }), 'L2')
  assert.equal(levelBucketOf({ funnelOrigin: 'library', levelKey: null }), 'uncategorized')
  assert.equal(levelBucketOf({ funnelOrigin: 'library', levelKey: 'x' }), 'uncategorized')
})

test('sortItemsByLevelBucket is L0 then L1 then L2 then uncategorized', () => {
  const items = [
    { id: 'n', funnelOrigin: 'network' as const, levelKey: 'L0' },
    { id: 'b', funnelOrigin: 'library' as const, levelKey: 'L1' },
    { id: 'a', funnelOrigin: 'library' as const, levelKey: 'L0' },
    { id: 'u', funnelOrigin: 'library' as const, levelKey: null },
  ]
  assert.deepEqual(
    sortItemsByLevelBucket(items).map((x) => x.id),
    ['a', 'b', 'n', 'u'],
  )
  const g = groupItemsByLevelBucket(items)
  assert.equal(g.L0.length, 1)
  assert.equal(g.uncategorized.length, 2)
})

test('within a level bucket rules come before skills', () => {
  const items = [
    {
      id: 's',
      funnelOrigin: 'library' as const,
      levelKey: 'L0' as const,
      kindLabel: '技能',
      displayName: 'L0-i18n',
    },
    {
      id: 'r',
      funnelOrigin: 'library' as const,
      levelKey: 'L0' as const,
      kindLabel: '规则',
      displayName: 'L0-01-thinking',
    },
    {
      id: 's2',
      funnelOrigin: 'library' as const,
      levelKey: 'L0' as const,
      kindLabel: 'Skill',
      displayName: 'L0-extreme-speed',
    },
  ]
  assert.deepEqual(
    sortItemsInLevelBuckets(items).L0.map((x) => x.id),
    ['r', 's2', 's'],
  )
})

test('displayLevelLabel hides network intended level', () => {
  assert.equal(
    displayLevelLabel({ funnelOrigin: 'network', levelKey: 'L2' }, '未分类'),
    '未分类',
  )
  assert.equal(
    displayLevelLabel({ funnelOrigin: 'library', levelKey: 'L1' }, '未分类'),
    'L1',
  )
})

test('taxonomySourceParts keeps persona sub fn source separate', () => {
  const item = {
    entryId: 'foo',
    displayName: 'foo',
    funnelOrigin: 'library',
    personaId: 'unclassified',
    personaPhrases: [],
  } as unknown as FunnelListItem
  const parts = taxonomySourceParts(item, 'zh-CN', '本地')
  assert.equal(parts.source, '本地')
  assert.equal(typeof parts.persona, 'string')
  assert.equal(typeof parts.sub, 'string')
  assert.equal(typeof parts.fn, 'string')
})
