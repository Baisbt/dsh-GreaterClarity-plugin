import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeUserText, buildMarkdown, safeImageDest, formatLocalTime, dateStamp, pad, escapeTitle, attachmentLabel } from '../src/pure/markdown.js'
import type { EventLike } from '../src/pure/markdown.js'

const U = (text: string): EventLike => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const S = (text: string): EventLike => ({ type: 'user/message', data: { source: { kind: 'steering' }, content: [{ type: 'text', text }] } })
const A = (text: string): EventLike => ({ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } })

test('escapeUserText：结构符号/行首标记/实体化', () => {
  assert.equal(escapeUserText('## 标题'), '\\#\\# 标题')
  assert.equal(escapeUserText('---'), '\\---')
  assert.equal(escapeUserText('1. 列表'), '1\\. 列表')
  assert.equal(escapeUserText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;')
  assert.equal(escapeUserText('**粗** _斜_ ~~删~~ |表|'), '\\*\\*粗\\*\\* \\_斜\\_ \\~\\~删\\~\\~ \\|表\\|')
  assert.equal(escapeUserText('反斜杠 C:\\x'), '反斜杠 C:\\\\x')
  assert.equal(escapeUserText('普通一行，含 - 中横线、(括号)、3.14'), '普通一行，含 - 中横线、(括号)、3.14')
})

test('escapeUserText：多行行首逐行处理', () => {
  const out = escapeUserText('第一行\n- 第二行\n# 第三行')
  assert.ok(out.includes('第一行'))
  assert.ok(out.includes('\\- 第二行'))
  assert.ok(out.includes('\\# 第三行'))
})

test('safeImageDest：去除破坏目的地址的字符', () => {
  assert.equal(safeImageDest('a<b>\r\nc'), 'abc')
})

test('formatLocalTime/dateStamp：时区折算', () => {
  const ms = Date.UTC(2026, 7, 24, 17, 0) // UTC+8 为 2026-08-25 01:00
  assert.equal(dateStamp(ms, 480), '2026.8.25')
  assert.ok(formatLocalTime(ms, 480).includes('2026年8月25日'))
})

test('pad/escapeTitle/attachmentLabel', () => {
  assert.equal(pad(3), '03')
  assert.equal(escapeTitle('# a\nb'), 'a b')
  assert.equal(escapeTitle(''), '会话')
  assert.equal(attachmentLabel({ name: '图.png' }), '图.png')
  assert.equal(attachmentLabel({ attachmentId: 'sha256:abc' }), 'abc.bin')
  assert.equal(attachmentLabel(null), '附件')
})

test('buildMarkdown：A 轮次语义 + steering 独立成轮 + 编号', () => {
  const events: EventLike[] = [
    { type: 'turn/start' }, U('问一'), A('答一'), S('引导一'), A('答二'), { type: 'turn/end' },
    { type: 'turn/start' }, U('问二'), A('答三'), { type: 'turn/end' },
  ]
  const md = buildMarkdown(events, 'T', 0, 0, 0)
  assert.ok(md.includes('## 第 01 轮') && md.includes('## 第 02 轮') && md.includes('## 第 03 轮') && !md.includes('## 第 04 轮'))
  assert.ok(md.includes('问一') && md.includes('引导一') && md.includes('问二'))
  assert.ok(md.indexOf('引导一') > md.indexOf('## 第 02 轮') && md.indexOf('引导一') < md.indexOf('## 第 03 轮'))
})

test('buildMarkdown：孤儿窗口（无 turn/start）不丢内容', () => {
  const md = buildMarkdown([U('孤儿输入'), A('孤儿回答')], 'T', 0, 0, 0)
  assert.ok(md.includes('孤儿输入') && md.includes('孤儿回答') && md.includes('## 第 01 轮'))
})

test('buildMarkdown：空轮不占号', () => {
  const md = buildMarkdown([{ type: 'turn/start' }, { type: 'turn/end' }, { type: 'turn/start' }, U('真实'), A('回答')], 'T', 0, 0, 0)
  assert.ok(md.includes('## 第 01 轮') && !md.includes('## 第 02 轮') && md.includes('真实'))
})

test('buildMarkdown：用户输入转义、AI 输出原样', () => {
  const md = buildMarkdown([U('## 注入'), A('**正常**')], 'T', 0, 0, 0)
  assert.ok(md.includes('\\#\\# 注入'))
  assert.ok(md.includes('**正常**'))
})
