import { test } from 'node:test'
import assert from 'node:assert/strict'
import { exportFilename, sanitizeSettings, mergeSettings, DEFAULT_SETTINGS, clampSize, clampHistoryCount, type Settings } from '../src/pure/settings-spec.js'
import { safeFilename, dateStamp } from '../src/pure/markdown.js'

const base: Settings = sanitizeSettings({}, DEFAULT_SETTINGS)

test('sanitizeSettings：布尔/字符串/数值逐字段净化', () => {
  const next = sanitizeSettings({
    plugin: { enabled: 'yes' },
    ui: { foldGlobal: 'bogus' },
    export: { showButton: false },
    ai: { avatarSize: 'abc', historyCount: 99.6, avatarPath: 123 },
  }, base)
  assert.equal(next.plugin.enabled, base.plugin.enabled) // 非法布尔回落
  assert.equal(next.ui.foldGlobal, base.ui.foldGlobal)
  assert.equal(next.export.showButton, false)
  assert.equal(next.ai.avatarSize, base.ai.avatarSize) // 非法数值回落
  assert.equal(next.ai.historyCount, 30) // clamp 上限
  assert.equal(next.ai.avatarPath, base.ai.avatarPath) // 非字符串回落
})

test('sanitizeSettings：合法值生效、avatarSize clamp', () => {
  const next = sanitizeSettings({ ui: { foldGlobal: 'folded' }, ai: { avatarSize: 200, historyCount: 2 } }, base)
  assert.equal(next.ui.foldGlobal, 'folded')
  assert.equal(next.ai.avatarSize, 128)
  assert.equal(next.ai.historyCount, 5)
})

test('sanitizeSettings：缺省字段保留 current', () => {
  const next = sanitizeSettings({}, { ...base, plugin: { enabled: false } })
  assert.equal(next.plugin.enabled, false)
})

test('mergeSettings：按节浅合并', () => {
  const merged = mergeSettings(base, { ai: { avatarSize: 64 } })
  assert.equal(merged.ai.avatarSize, 64)
  assert.equal(merged.ai.showAvatar, base.ai.showAvatar)
  assert.equal(merged.plugin.enabled, base.plugin.enabled)
})

test('clampSize/clampHistoryCount 边界', () => {
  assert.equal(clampSize(0), 16)
  assert.equal(clampSize(999), 128)
  assert.equal(clampSize(NaN), 32)
  assert.equal(clampHistoryCount(0), 5)
  assert.equal(clampHistoryCount(999), 30)
})

test('exportFilename：未加载完全前缀 + 点分时间戳', () => {
  const now = new Date(2026, 7, 24, 12, 0).getTime() // 本地 2026-08-24 正午
  assert.equal(
    exportFilename({ partial: true, now, tzOffsetMin: -new Date(now).getTimezoneOffset(), title: 'DSH 插件开发方案架构' }),
    '未加载完全历史对话_2026.8.24_DSH 插件开发方案架构.md',
  )
  assert.equal(
    exportFilename({ partial: false, now, tzOffsetMin: -new Date(now).getTimezoneOffset(), title: 'DSH 插件开发方案架构' }),
    '2026.8.24_DSH 插件开发方案架构.md',
  )
})

test('exportFilename/dateStamp：跨时区用客户端本地日期', () => {
  const now = Date.UTC(2026, 7, 24, 17, 0) // UTC+8 为 8/25
  assert.ok(exportFilename({ partial: true, now, tzOffsetMin: 480, title: 'T' }).startsWith('未加载完全历史对话_2026.8.25_'))
  assert.equal(dateStamp(now, 480), '2026.8.25')
})

test('safeFilename：非法字符净化 + .md 去重 + 空标题兜底', () => {
  assert.equal(safeFilename('a/b:c*d?.md'), 'a_b_c_d_.md')
  assert.equal(safeFilename('   '), '会话.md')
})
