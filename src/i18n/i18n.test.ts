import assert from 'node:assert/strict'
import test from 'node:test'
import { en } from './en.ts'
import { t, setLocale, translateContainerHeader, translateHeatLabel, translateLibraryHeader, translatePlaceSubtitle, translateStatusText } from './index.ts'
import { zhCN } from './zh-CN.ts'

test('has no empty strings in zh-CN or en', () => {
  for (const [k, v] of Object.entries(zhCN)) {
    assert.ok(v.length > 0, k)
  }
  for (const [k, v] of Object.entries(en)) {
    assert.ok(v.length > 0, k)
  }
})

test('keeps zh-CN and en key sets aligned', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zhCN).sort())
})

test('interpolates placeholders in both locales', () => {
  setLocale('zh-CN')
  assert.equal(t('status.selected', { n: 12 }), '已选 12 项')
  assert.equal(t('status.filterPoolOfAll', { pool: 800, total: 2094 }), '待筛选集合 800 / 全部条目 2094')
  setLocale('en')
  assert.equal(t('status.selected', { n: 12 }), '12 selected')
  assert.equal(t('status.filterPoolOfAll', { pool: 800, total: 2094 }), 'To filter 800 / all 2094')
  setLocale('zh-CN')
})

test('maps snapshot chrome in both locales', () => {
  setLocale('en')
  assert.equal(translatePlaceSubtitle('skills/foo · 当前容器'), 'skills/foo · Current container')
  assert.equal(translatePlaceSubtitle('[L0] rules/bar · 未部署'), '[L0] rules/bar · Not deployed')
  assert.equal(
    translatePlaceSubtitle('path · 台账有部署路径'),
    'path · Catalog has deploy path',
  )
  assert.equal(translateLibraryHeader('永久库'), 'Permanent library')
  assert.equal(translateContainerHeader('容器中'), 'In container')
  assert.equal(translateContainerHeader('容器中 · Cursor'), 'In container · Cursor')
  assert.equal(
    translateStatusText('容器 3'),
    'Container 3',
  )
  assert.equal(
    translateStatusText('永久库已配置；容器中 3，永久库 12。'),
    'Container 3',
  )
  setLocale('zh-CN')
  assert.equal(translatePlaceSubtitle('skills/foo · 当前容器'), 'skills/foo · 当前容器')
  assert.equal(translateLibraryHeader('永久库'), '永久库')
  assert.equal(translateContainerHeader('容器中 · Cursor'), '容器中 · Cursor')
  assert.equal(translateStatusText('容器 3'), '容器 3')
  assert.equal(t('status.containerN', { n: 17 }), '容器 17')
  assert.equal(t('status.libraryN', { n: 29 }), '永久库 29')
  assert.equal(t('status.shownN', { n: 18 }), '显示 18')
  assert.equal(t('status.filterShownN', { n: 5 }), '筛选 5')
  assert.equal(t('status.filterPoolOfAll', { pool: 800, total: 2094 }), '待筛选集合 800 / 全部条目 2094')
  assert.equal(t('status.grandTotal', { n: 108 }), '合计 108')
  assert.equal(t('status.networkN', { n: 40 }), '网络 40')
})

test('maps heat label suffixes in both locales', () => {
  setLocale('en')
  assert.equal(translateHeatLabel('★26.4k · 官方样例'), '★26.4k · official sample')
  assert.equal(translateHeatLabel('无默认官方仓'), 'no default official repo')
  assert.equal(translateHeatLabel('★264k · 框架'), '★264k · 框架')
  setLocale('zh-CN')
  assert.equal(translateHeatLabel('★26.4k · 官方样例'), '★26.4k · 官方样例')
  assert.equal(t('net.fetchUncachedN', { n: 3 }), '拉取未缓存（3）')
  setLocale('en')
  assert.equal(t('net.fetchUncachedN', { n: 3 }), 'Fetch uncached (3)')
  setLocale('zh-CN')
})
