import assert from 'node:assert/strict'
import test from 'node:test'
import type { LibraryListItemDto } from '../../shared/ipc'
import { filterItemsByQuery, matchesSearchQuery } from './searchFilter.ts'

function stub(partial: Partial<LibraryListItemDto> & Pick<LibraryListItemDto, 'entryId'>): LibraryListItemDto {
  return {
    displayName: partial.displayName ?? partial.entryId,
    groupName: '',
    kindLabel: '技能',
    subtitle: '',
    isInContainerList: false,
    ...partial,
  }
}

test('empty query matches every item', () => {
  const it = stub({ entryId: 'a', displayName: 'foo' })
  assert.equal(matchesSearchQuery(it, ''), true)
})

test('matches displayName and searchText', () => {
  const it = stub({ entryId: 'id-1', displayName: 'Cold Email', searchText: 'remark notes' })
  assert.equal(matchesSearchQuery(it, 'cold'), true)
  assert.equal(matchesSearchQuery(it, 'notes'), true)
  assert.equal(matchesSearchQuery(it, 'missing'), false)
})

test('matches kindLabel levelKey intendedLevel', () => {
  const local = stub({ entryId: 'lib:x', displayName: 'i18n', kindLabel: '规则', levelKey: 'L0' })
  assert.equal(matchesSearchQuery(local, 'l0'), true)
  assert.equal(matchesSearchQuery(local, '规则'), true)
  assert.equal(matchesSearchQuery(local, 'l1'), false)

  const net = stub({ entryId: 'net:x', displayName: 'widget', intendedLevel: 'L1' })
  assert.equal(matchesSearchQuery(net, 'l1'), true)
  assert.equal(matchesSearchQuery(net, 'l2'), false)
})

test('matches extraHay persona and phrase labels', () => {
  const it = stub({ entryId: 'net:a11y', displayName: 'wcag-audit' })
  const hay = 'software-frontend 软件前端 frontend dev sw-front 前端 无障碍 accessibility'
  assert.equal(matchesSearchQuery(it, '软件前端', hay), true)
  assert.equal(matchesSearchQuery(it, 'accessibility', hay), true)
  assert.equal(matchesSearchQuery(it, '营销', hay), false)
})

test('multi-word query is AND across hay', () => {
  const it = stub({
    entryId: 'lib:L0-i18n',
    displayName: 'L0-i18n',
    levelKey: 'L0',
  })
  const hay = 'software-frontend 软件前端 frontend 无障碍'
  assert.equal(matchesSearchQuery(it, '前端 l0', hay), true)
  assert.equal(matchesSearchQuery(it, '前端 l1', hay), false)
  assert.equal(matchesSearchQuery(it, '营销 l0', hay), false)
})

test('filterItemsByQuery uses extraHay map', () => {
  const a = stub({ entryId: 'a', displayName: 'alpha' })
  const b = stub({ entryId: 'b', displayName: 'beta' })
  const extra = new Map([['a', '软件前端'], ['b', '软件后端']])
  const hit = filterItemsByQuery([a, b], '前端', extra)
  assert.deepEqual(hit.map((x) => x.entryId), ['a'])
})
