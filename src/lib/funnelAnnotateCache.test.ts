import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotateItemsCached,
  FUNNEL_ANNOTATE_CACHE_VERSION,
  funnelAnnotateKey,
  pruneAnnotateCache,
} from './funnelAnnotateCache.ts'
import type { LibraryListItemDto } from '../../shared/ipc'

function stub(entryId: string, extra: Partial<LibraryListItemDto> = {}): LibraryListItemDto {
  return {
    entryId,
    displayName: extra.displayName ?? entryId,
    groupName: extra.groupName ?? '',
    kindLabel: extra.kindLabel ?? '技能',
    subtitle: extra.subtitle ?? '',
    isInContainerList: extra.isInContainerList ?? false,
    isInActiveUse: extra.isInActiveUse,
    levelKey: extra.levelKey,
    summary: extra.summary ?? 'n8n zapier automation',
    sourceId: extra.sourceId ?? 'src',
  }
}

test('annotate cache key includes version suffix', () => {
  const item = stub('net:a:one')
  const k = funnelAnnotateKey(item, 'network')
  assert.ok(k.endsWith(`\0${FUNNEL_ANNOTATE_CACHE_VERSION}`))
})

test('annotate cache reuses the same object when live fields are unchanged', () => {
  const cache = new Map()
  const item = stub('net:a:one')
  const [a] = annotateItemsCached(cache, [item], 'network')
  const [b] = annotateItemsCached(cache, [item], 'network')
  assert.equal(a, b)
  assert.equal(a.personaId, b.personaId)
  assert.deepEqual(a.personaPhrases, b.personaPhrases)
  assert.equal(cache.size, 1)
})

test('annotate cache keeps current container flags on hit', () => {
  const cache = new Map()
  const idle = stub('lib:acquire', {
    displayName: 'acquire-codebase-knowledge',
    summary: '',
    sourceId: '',
    isInContainerList: false,
  })
  const [first] = annotateItemsCached(cache, [idle], 'library')
  assert.equal(first.isInContainerList, false)
  assert.equal(first.isInActiveUse, undefined)

  const live = stub('lib:acquire', {
    displayName: 'acquire-codebase-knowledge',
    summary: '',
    sourceId: '',
    isInContainerList: true,
    isInActiveUse: true,
    levelKey: 'L1',
    subtitle: '当前容器',
  })
  const [second] = annotateItemsCached(cache, [live], 'library')
  assert.notEqual(second, first)
  assert.equal(second.isInContainerList, true)
  assert.equal(second.isInActiveUse, true)
  assert.equal(second.levelKey, 'L1')
  assert.equal(second.subtitle, '当前容器')
  assert.equal(second.funnelOrigin, 'library')
  assert.equal(second.personaId, first.personaId)
  assert.deepEqual(second.personaPhrases, first.personaPhrases)
  assert.equal(cache.size, 1)
})

test('annotate cache misses when summary changes', () => {
  const cache = new Map()
  const a = stub('net:a:one', { summary: 'n8n automation' })
  const b = stub('net:a:one', { summary: 'azure graphql webhook' })
  const [rowA] = annotateItemsCached(cache, [a], 'network')
  const [rowB] = annotateItemsCached(cache, [b], 'network')
  assert.notEqual(rowA, rowB)
  assert.equal(cache.size, 2)
})

test('prune drops stale network keys only', () => {
  const cache = new Map()
  const keepItem = stub('net:a:keep')
  const dropItem = stub('net:a:drop')
  const local = stub('lib:local')
  annotateItemsCached(cache, [keepItem, dropItem], 'network')
  annotateItemsCached(cache, [local], 'library')
  const keep = new Set([funnelAnnotateKey(keepItem, 'network')])
  pruneAnnotateCache(cache, keep, 'network')
  assert.equal(cache.has(funnelAnnotateKey(keepItem, 'network')), true)
  assert.equal(cache.has(funnelAnnotateKey(dropItem, 'network')), false)
  assert.equal(cache.has(funnelAnnotateKey(local, 'library')), true)
})
