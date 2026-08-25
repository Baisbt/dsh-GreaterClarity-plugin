import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRoundMap, snapshotToMarkdown, snapshotToRounds, USER_KINDS } from '../src/pure/rounds.js'

// 真实 DSH 节点形状：user/steering 载荷在 data.content（type 判别），
// assistant-step 载荷在 data.blocks（kind 判别，kind:reasoning=思考链）。
const nodes = new Map([
  ['u1', { kind: 'user', data: { content: [{ type: 'text', text: '第一问' }] } }],
  ['a1', { kind: 'assistant-step', data: { blocks: [{ kind: 'reasoning', text: '思考一' }, { kind: 'text', text: '最终回答一' }] } }],
  ['t1', { kind: 'tool-call', data: { content: [{ type: 'text', text: '工具输出不应出现' }] } }],
  ['s1', { kind: 'steering', data: { content: [{ type: 'text', text: '中途追问' }] } }],
  ['a2', { kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: '最终回答二' }] } }],
  ['u2', { kind: 'user', data: { content: [{ type: 'text', text: '第二问' }] } }],
])
const order = ['u1', 'a1', 't1', 's1', 'a2', 'u2']

test('buildRoundMap：每条用户输入独立递增', () => {
  const map = buildRoundMap({ chat: { order, nodes } })
  assert.equal(map.get('u1'), 1)
  assert.equal(map.get('s1'), 2)
  assert.equal(map.get('u2'), 3)
  assert.equal(map.get('a1'), undefined)
})

test('buildRoundMap：空快照安全', () => {
  assert.equal(buildRoundMap(null).size, 0)
  assert.equal(buildRoundMap({ chat: { order: [], nodes: new Map() } }).size, 0)
})

test('snapshotToMarkdown：真实形状抓取', () => {
  const r = snapshotToMarkdown({ title: 'T', session: {}, chat: { order, nodes } }, 0, 0, '')
  assert.ok(r)
  assert.ok(r.markdown.includes('最终回答一') && r.markdown.includes('最终回答二'))
  assert.ok(r.markdown.includes('第一问') && r.markdown.includes('中途追问'))
  assert.ok(!r.markdown.includes('思考一'))
  assert.ok(!r.markdown.includes('工具输出不应出现'))
  assert.ok(r.markdown.includes('## 第 01 轮') && r.markdown.includes('## 第 02 轮') && r.markdown.includes('## 第 03 轮'))
})

test('snapshotToMarkdown：标题优先级 displayTitle > 快照标题 > 首条输入 > 兜底', () => {
  const r1 = snapshotToMarkdown({ title: '快照标题', chat: { order: ['u'], nodes: new Map([['u', { kind: 'user', data: { content: [{ type: 'text', text: '问' }] } }]]) } }, 0, 0, '侧栏标题')
  assert.equal(r1?.title, '侧栏标题')
  const r2 = snapshotToMarkdown({ chat: { order: ['u'], nodes: new Map([['u', { kind: 'user', data: { content: [{ type: 'text', text: '首条输入' }] } }]]) } }, 0, 0, '')
  assert.equal(r2?.title, '首条输入')
  const r3 = snapshotToMarkdown({ title: 'T', chat: { order: [], nodes: new Map() } }, 0, 0, '')
  assert.equal(r3, null)
})

test('snapshotToMarkdown：旧形状兼容（data.content + type / message.content）', () => {
  const legacy = { title: '', chat: { order: ['u', 'a'], nodes: new Map([
    ['u', { kind: 'user', data: { content: [{ type: 'text', text: '问' }] } }],
    ['a', { kind: 'assistant-step', data: { content: [{ type: 'text', text: '旧形状回答' }] } }],
  ]) } }
  assert.ok(snapshotToMarkdown(legacy, 0, 0, '')?.markdown.includes('旧形状回答'))
  const viaMsg = { title: '', chat: { order: ['u', 'a'], nodes: new Map([
    ['u', { kind: 'user', data: { content: [{ type: 'text', text: '问' }] } }],
    ['a', { kind: 'assistant-step', data: { message: { content: [{ kind: 'text', text: 'message 形状回答' }] } } }],
  ]) } }
  assert.ok(snapshotToMarkdown(viaMsg, 0, 0, '')?.markdown.includes('message 形状回答'))
})

test('snapshotToRounds：注入转义保持', () => {
  const r = snapshotToRounds({ chat: { order: ['x'], nodes: new Map([['x', { kind: 'user', data: { content: [{ type: 'text', text: '## h' }] } }]]) } })
  assert.ok(r && r.rounds[0].user[0].includes('\\#\\# h'))
})

test('USER_KINDS：仅 user/steering', () => {
  assert.deepEqual([...USER_KINDS].sort(), ['steering', 'user'])
})
