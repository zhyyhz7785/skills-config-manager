import assert from 'node:assert/strict'
import test from 'node:test'
import type { NetworkNavNodeDto } from '../../shared/ipc'
import {
  isNetworkNavMainVisible,
  itemInStandbyLibrary,
  openEyeSourceIds,
} from './networkStandby.ts'

function nav(
  partial: Partial<NetworkNavNodeDto> & Pick<NetworkNavNodeDto, 'id' | 'pinned'>,
): NetworkNavNodeDto {
  return {
    kind: 'popular',
    displayName: partial.id,
    primaryRepoUrl: `https://github.com/acme/${partial.id}`,
    heatLabel: '',
    hasDefaultRepo: true,
    cachedCount: 0,
    inCandidatePool: true,
    isOfficialSample: false,
    ...partial,
  }
}

test('openEyeSourceIds is empty when all eyes are closed', () => {
  const popular = [nav({ id: 'a', pinned: false }), nav({ id: 'b', pinned: false })]
  assert.equal(openEyeSourceIds(popular).size, 0)
})

test('community closed-eye or out of candidate pool is not open-eye', () => {
  const hidden = nav({ id: 'hidden', pinned: false })
  const outOfPool = nav({ id: 'pool', pinned: true, inCandidatePool: false })
  const officialClosed = nav({
    id: 'official',
    pinned: false,
    isOfficialSample: true,
  })
  const userOpen = nav({ id: 'user-src', pinned: true, kind: 'user' })
  assert.equal(isNetworkNavMainVisible(hidden), false)
  assert.equal(isNetworkNavMainVisible(outOfPool), false)
  assert.equal(isNetworkNavMainVisible(officialClosed), false)
  assert.equal(isNetworkNavMainVisible(userOpen), true)
  const ids = openEyeSourceIds([hidden, outOfPool, officialClosed, userOpen])
  assert.deepEqual([...ids], ['user-src'])
})

test('itemInStandbyLibrary: all closed-eye yields empty', () => {
  const popular = [nav({ id: 'a', pinned: false }), nav({ id: 'b', pinned: false })]
  const open = openEyeSourceIds(popular)
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'a' }, open, new Set(), popular),
    false,
  )
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'b' }, open, new Set(), popular),
    false,
  )
})

test('itemInStandbyLibrary: one open eye only yields that source', () => {
  const popular = [nav({ id: 'keep', pinned: true }), nav({ id: 'hide', pinned: false })]
  const open = openEyeSourceIds(popular)
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'keep' }, open, new Set(), popular),
    true,
  )
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'hide' }, open, new Set(), popular),
    false,
  )
})

test('itemInStandbyLibrary: pick further narrows open-eye union', () => {
  const popular = [
    nav({ id: 'alpha', pinned: true }),
    nav({ id: 'beta', pinned: true }),
    nav({ id: 'gamma', pinned: false }),
  ]
  const open = openEyeSourceIds(popular)
  const picked = new Set(['beta'])
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'alpha' }, open, picked, popular),
    false,
  )
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'beta' }, open, picked, popular),
    true,
  )
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'gamma' }, open, picked, popular),
    false,
  )
})

test('itemInStandbyLibrary: pick of a closed-eye source is ignored', () => {
  const popular = [nav({ id: 'keep', pinned: true }), nav({ id: 'hide', pinned: false })]
  const open = openEyeSourceIds(popular)
  const picked = new Set(['hide'])
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'hide' }, open, picked, popular),
    false,
  )
  assert.equal(
    itemInStandbyLibrary({ sourceId: 'keep' }, open, picked, popular),
    false,
  )
})

test('itemInStandbyLibrary: matches URL-derived sourceId alias', () => {
  const popular = [
    nav({
      id: 'obra-superpowers',
      pinned: true,
      primaryRepoUrl: 'https://github.com/obra/superpowers',
    }),
  ]
  const open = openEyeSourceIds(popular)
  assert.equal(
    itemInStandbyLibrary(
      { sourceId: 'obra-superpowers' },
      open,
      new Set(),
      popular,
    ),
    true,
  )
})
