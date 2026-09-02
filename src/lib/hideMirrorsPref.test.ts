import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_HIDE_MIRRORS, loadHideMirrors, saveHideMirrors } from './hideMirrorsPref.ts'

test('hideMirrors pref defaults on and round-trips', () => {
  const mem = new Map<string, string>()
  const store: Storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
    clear: () => mem.clear(),
    key: () => null,
    get length() {
      return mem.size
    },
  }
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: store,
  })
  try {
    mem.clear()
    assert.equal(loadHideMirrors(), DEFAULT_HIDE_MIRRORS)
    saveHideMirrors(false)
    assert.equal(loadHideMirrors(), false)
    saveHideMirrors(true)
    assert.equal(loadHideMirrors(), true)
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
})
