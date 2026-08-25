/**
 * 会话快照 → 轮次采集与装配（Client 直出导出 + 轮次标签共享，纯函数）。
 * 节点形状依据 DSH 源码：user/steering 载荷在 data.content（type 判别），
 * assistant-step 载荷在 data.blocks（kind 判别，kind:reasoning=思考链不采集）。
 */
import {
  attachmentLabel,
  escapeTitle,
  escapeUserText,
  formatLocalTime,
  pad,
  roundsToMarkdown,
  safeImageDest,
  type BlockLike,
} from './markdown.js'

export interface Round {
  user: string[]
  ai: string[]
}

export const USER_KINDS = new Set(['user', 'steering'])

/** 节点载荷的内容块数组：user 在 data.content，assistant-step 在 data.blocks，兜底 data.message.content。 */
export function nodeBlocks(node: any): any[] {
  const d = (node && node.data) || {}
  if (Array.isArray(d.content)) return d.content
  if (Array.isArray(d.blocks)) return d.blocks
  const m = d.message
  if (m && Array.isArray(m.content)) return m.content
  return []
}

/** 内容块的文本判别：user 块用 type，assistant 块用 kind（reasoning=思考链，不采集）。 */
export function blockText(b: any): string | null {
  if (!b) return null
  const t = b.type ?? b.kind
  return t === 'text' && typeof b.text === 'string' ? b.text : null
}

/** user 节点的输入文本（历史窗口列表用）。 */
export function userNodeText(node: any): string {
  const data = node && node.data ? node.data : {}
  const content = Array.isArray(data.content) ? data.content : []
  return content
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
}

/** 图片块的展示名。 */
export function attachmentLabelOfBlock(b: any): string {
  return attachmentLabel(b && b.attachment ? b.attachment : null)
}

/**
 * 轮次映射：快照 order 中每条用户输入（user/steering）独立递增编号（A 语义）。
 * 依据 DSH 源码事实：仅开启新轮的输入是 kind==='user'，运行期插入的追问一律是
 * 'steering'——harness 场景下占多数，若仅对 user 计数会导致几乎全部同号。
 */
export function buildRoundMap(snapshot: any): Map<string, number> {
  const map = new Map<string, number>()
  if (!snapshot) return map
  const chat = snapshot.chat
  const order = chat && Array.isArray(chat.order) ? chat.order : []
  const nodes = chat && chat.nodes ? chat.nodes : null
  if (!nodes || order.length === 0) return map
  const get = (key: string): any => (typeof nodes.get === 'function' ? nodes.get(key) : nodes[key])
  let cur = 0
  for (const key of order) {
    const node = get(key)
    if (!node) continue
    const kind = typeof node.kind === 'string' ? node.kind : ''
    if (USER_KINDS.has(kind)) {
      cur += 1
      map.set(key, cur)
    }
  }
  return map
}

export interface SnapshotRounds {
  rounds: Array<{ user: string[]; ai: string[] }>
  firstRawUser: string | null
}

/** 快照 → 轮次采集（防御式读取）：无任何用户侧内容时返回 null（调用方走服务端兜底）。 */
export function snapshotToRounds(snapshot: any): SnapshotRounds | null {
  if (!snapshot) return null
  const chat = snapshot.chat
  const order = chat && Array.isArray(chat.order) ? chat.order : []
  const nodes = chat && chat.nodes ? chat.nodes : null
  if (!nodes || order.length === 0) return null
  const get = (key: string): any => (typeof nodes.get === 'function' ? nodes.get(key) : nodes[key])

  const rounds: Array<{ user: string[]; ai: string[] }> = []
  let cur: { user: string[]; ai: string[] } | null = null
  let firstRawUser: string | null = null
  let sawAny = false
  for (const key of order) {
    const node = get(key)
    if (!node) continue
    const kind = typeof node.kind === 'string' ? node.kind : ''
    if (!USER_KINDS.has(kind) && !/assistant/.test(kind)) continue
    sawAny = true
    if (USER_KINDS.has(kind)) {
      // 每条用户输入独立成轮（A 语义，与轮次映射一致）。
      cur = { user: [], ai: [] }
      rounds.push(cur)
      for (const b of nodeBlocks(node)) {
        if (!b) continue
        const text = blockText(b)
        if (text !== null) {
          if (firstRawUser === null && text.trim() !== '') firstRawUser = text
          cur.user.push(escapeUserText(text))
        } else if ((b.type ?? b.kind) === 'image') {
          cur.user.push(escapeUserText(attachmentLabelOfBlock(b)))
        }
      }
    } else if (cur) {
      // 仅采集 kind/type === 'text' 的最终输出；reasoning（思考链）与工具链天然跳过。
      for (const b of nodeBlocks(node)) {
        const text = blockText(b)
        if (text !== null) cur.ai.push(text)
      }
    }
  }
  if (!sawAny || rounds.length === 0) return null
  return { rounds, firstRawUser }
}

export interface RoundsMeta {
  title: string
  createdAt: number | null
  now: number
  tzOffsetMin: number
}

/** 快照 → Markdown 文档（Client 直出导出）。 */
export function snapshotToMarkdown(
  snapshot: any,
  now: number,
  tzOffsetMin: number,
  preferredTitle = '',
): { markdown: string; title: string } | null {
  const collected = snapshotToRounds(snapshot)
  if (collected === null) return null

  // 标题：侧栏工作区标题（displayTitle）→ 快照标题 → 首条用户输入截断 → 兜底「会话」。
  let title = preferredTitle.trim() !== '' ? preferredTitle.trim()
    : typeof snapshot.title === 'string' ? snapshot.title.trim() : ''
  if (title === '' && collected.firstRawUser !== null) title = collected.firstRawUser.replace(/[#>\r\n]/g, ' ').trim().slice(0, 24)
  if (title === '') title = '会话'

  const createdAt = snapshot.session && typeof snapshot.session.createdAt === 'number' ? snapshot.session.createdAt : null
  const markdown = roundsToMarkdown(collected.rounds, { title, createdAt, now, tzOffsetMin })
  return { markdown, title }
}

/** 导出文档头部（供测试与潜在复用）：与 roundsToMarkdown 的标题净化规则一致。 */
export function exportDocTitle(preferredTitle: string, snapshot: any, firstRawUser: string | null): string {
  let title = preferredTitle.trim() !== '' ? preferredTitle.trim()
    : typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
  if (title === '' && firstRawUser !== null) title = firstRawUser.replace(/[#>\r\n]/g, ' ').trim().slice(0, 24)
  return title === '' ? '会话' : escapeTitle(title)
}
