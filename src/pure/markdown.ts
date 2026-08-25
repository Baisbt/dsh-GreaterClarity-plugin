/**
 * Markdown 导出纯函数（Host/Client 共享，单一事实源）。
 * 约束：禁止 import node: 与 DOM —— 保持双端 bundle 安全。
 */

export interface EventLike {
  type: string
  time?: number
  seq?: number
  data?: Record<string, any>
}

export interface BlockLike {
  type?: string
  kind?: string
  text?: string
  attachment?: { name?: string; attachmentId?: string }
}

export function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** 按时区偏移（分钟，东为正）格式化本地时间：2026年8月24日 20:41 */
export function formatLocalTime(ms: number, tzOffsetMin: number): string {
  const off = Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0
  const d = new Date(ms + off * 60000)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

/** 导出文件名的时间戳段（点分日期，按客户端时区）：2026.8.24 */
export function dateStamp(ms: number, tzOffsetMin: number): string {
  const off = Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0
  const d = new Date(ms + off * 60000)
  return `${d.getUTCFullYear()}.${d.getUTCMonth() + 1}.${d.getUTCDate()}`
}

export function escapeTitle(t: string): string {
  const s = t.replace(/[#>\r\n]/g, ' ').trim()
  return s || '会话'
}

/** 附件展示名：优先 name，其次 attachmentId 派生，兜底「附件」。 */
export function attachmentLabel(attachment: any): string {
  const nm = attachment && typeof attachment.name === 'string' ? attachment.name : ''
  if (nm) return nm
  const id = attachment && typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
  if (id) return id.replace(/^sha256:/, '') + '.bin'
  return '附件'
}

/**
 * 用户文本全局严格转义，阻断 Markdown 注入（原理同 SQL 注入：不可信数据不得改变文档结构）。
 * 顺序固定：反斜杠加倍 → 反斜杠转义结构符号 → 实体化 & < >（消灭裸 HTML/HTML 注释/行首引用）
 * → 行首 - + = 与有序列表标记转义（消灭分隔线/Setext 标题/伪列表）。
 */
export function escapeUserText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/[`*_\[\]#!~|]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^(\s*)([-+=])/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/gm, '$1\\$2')
}

/** 图片引用的 <> 包裹目标：去除会破坏目的地址的字符。 */
export function safeImageDest(name: string): string {
  return name.replace(/[<>\r\n]/g, '')
}

/** 会话标题 → 下载文件名（净化非法字符、去重 .md 尾缀）。 */
export function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/\.md$/i, '')
  return (cleaned || '会话') + '.md'
}

/**
 * 事件流 → Markdown（Host 服务端兜底导出）。
 * 轮次语义（A）：每条用户输入（user/steering）独立成轮；仅采集最终输出文本。
 */
export function buildMarkdown(
  events: readonly EventLike[],
  title: string,
  createdAt: number,
  now: number,
  tzOffsetMin: number,
): string {
  const collected: Array<{ user: string[]; ai: string[] }> = []
  let userTexts: string[] = []
  let userImages: string[] = []
  let aiTexts: string[] = []

  // 只要积累了内容就成轮输出，不依赖事件流以 turn/start 开头（部分快照/回放窗口可能缺头部事件）。
  const flush = (): void => {
    const userParts = [...userTexts]
    if (userImages.length > 0) userParts.push(userImages.map((i) => `![${i}](<${safeImageDest(i)}>)`).join(' '))
    const user = userParts.filter((s) => s.trim() !== '').join('\n\n').trim()
    const ai = aiTexts.join('\n\n').trim()
    userTexts = []
    userImages = []
    aiTexts = []
    if (user === '' && ai === '') return
    collected.push({ user: [user], ai: [ai] })
  }

  for (const ev of events) {
    const data = ev.data
    switch (ev.type) {
      case 'turn/start':
        flush()
        break
      case 'user/message': {
        const src = data && data.source
        if (src && (src.kind === 'user' || src.kind === 'steering')) {
          flush()
          for (const b of (data.content ?? []) as BlockLike[]) {
            if (b.type === 'text' && typeof b.text === 'string') userTexts.push(escapeUserText(b.text))
            else if (b.type === 'image') userImages.push(escapeUserText(attachmentLabel(b.attachment)))
          }
        }
        break
      }
      case 'assistant/message': {
        const content = (data && data.message && data.message.content) ?? []
        for (const b of content as BlockLike[]) {
          if (b.type === 'text' && typeof b.text === 'string') aiTexts.push(b.text)
        }
        break
      }
      case 'turn/end':
        flush()
        break
      default:
        break
    }
  }
  flush()
  return roundsToMarkdown(collected, { title, createdAt, now, tzOffsetMin })
}

/** 轮次集合 → Markdown 文档（双端共享装配段）。 */
export function roundsToMarkdown(
  rounds: Array<{ user: string[]; ai: string[] }>,
  meta: { title: string; createdAt: number | null; now: number; tzOffsetMin: number },
): string {
  const out: string[] = []
  out.push(`# ${escapeTitle(meta.title)}`)
  out.push('')
  if (meta.createdAt !== null && Number.isFinite(meta.createdAt)) {
    out.push(`> **创建时间** · ${formatLocalTime(meta.createdAt, meta.tzOffsetMin)}`)
  }
  out.push(`> **导出时间** · ${formatLocalTime(meta.now, meta.tzOffsetMin)}`)
  out.push(`> **对话轮数** · ${rounds.length}`)
  out.push('')
  rounds.forEach((r, i) => {
    const user = r.user.filter((s) => s.trim() !== '').join('\n\n').trim()
    const ai = r.ai.join('\n\n').trim()
    out.push(`## 第 ${pad(i + 1)} 轮`)
    out.push('')
    if (user) {
      out.push('<!-- 用户消息 -->')
      out.push('<span style="color: #ffffff; background-color: #4a4a4a; padding: 2px 8px; border-radius: 4px; font-weight: 700;">用户</span>')
      out.push('')
      out.push(user)
      out.push('')
    }
    if (ai) {
      out.push('<!-- AI 消息 -->')
      out.push('<span style="color: #ffffff; background-color: #4a4a4a; padding: 2px 8px; border-radius: 4px; font-weight: 700;">AI</span>')
      out.push('')
      out.push(ai)
      out.push('')
    }
    out.push('---')
    out.push('')
  })
  return out.join('\n').trimEnd() + '\n'
}
