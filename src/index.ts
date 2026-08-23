/**
 * dsh-greater-clarity —— Host 半：webServer 路由 + 设置持久化 + Markdown 导出。
 *
 * 路由（全部挂 ctx.effect，卸载即净）：
 *   GET  /dsh-greater-clarity/avatar          → 头像图片字节
 *   GET  /dsh-greater-clarity/settings        → 读设置
 *   POST /dsh-greater-clarity/settings        → 写设置（部分 patch）
 *   POST /dsh-greater-clarity/avatar-upload   → 上传头像（dataUrl base64 落盘）
 *   POST /dsh-greater-clarity/export          → { sessionId } → { ok, markdown, filename }
 *
 * 设置持久化在 $DSH_HOME/greater-clarity/settings.json（自建文件，
 * 不依赖 DSH settings provider 是否挂载，与 whale-widget/super-injector 先例一致）。
 */
import type { Context } from 'cordis'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GC_DIR = join(DSH_HOME, 'greater-clarity')
const SETTINGS_FILE = join(GC_DIR, 'settings.json')
const DEFAULT_AVATAR = join(PACKAGE_ROOT, 'assets', 'DSH_Avatar.png')

const AVATAR_MIN = 16
const AVATAR_MAX = 128
const AVATAR_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
const HISTORY_COUNT_MIN = 5
const HISTORY_COUNT_MAX = 30
const MAX_BODY_BYTES = 20 * 1024 * 1024

interface ExportSettings {
  showButton: boolean
  mode: string
  targetDir: string
}
interface AiSettings {
  showAvatar: boolean
  avatarPath: string
  avatarSize: number
  historyCount: number
}
interface Settings {
  export: ExportSettings
  ai: AiSettings
}

const DEFAULT_SETTINGS: Settings = {
  export: { showButton: true, mode: 'download', targetDir: '' },
  ai: { showAvatar: true, avatarPath: '', avatarSize: 32, historyCount: 10 },
}

/** sessionQuery 的最小接口（运行时经 ctx.get 获取，仅类型标注，不打进 bundle）。 */
interface SessionQueryLike {
  readSession(id: string): Promise<{ session: { id: string; createdAt: number; cwd?: string }; events: EventLike[] }>
  readTitle(id: string): Promise<{ title: string } | undefined>
}
interface EventLike {
  type: string
  time?: number
  seq?: number
  data?: Record<string, any>
}
interface BlockLike {
  type?: string
  text?: string
  attachment?: { name?: string; attachmentId?: string }
}

interface RouteOpts {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: any, res: any) => void
}
interface WebServerLike {
  register(opts: RouteOpts): () => void
}

type AppContext = Context & { webServer: WebServerLike }

export const name = 'dsh-greater-clarity'
export const inject = ['webServer']

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
}

function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const exp = raw && typeof raw.export === 'object' ? raw.export : {}
    const ai = raw && typeof raw.ai === 'object' ? raw.ai : {}
    return {
      export: { ...DEFAULT_SETTINGS.export, ...exp },
      ai: { ...DEFAULT_SETTINGS.ai, ...ai },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function writeSettings(s: Settings): void {
  mkdirSync(GC_DIR, { recursive: true })
  writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8')
}

function clampSize(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.ai.avatarSize
  return Math.min(AVATAR_MAX, Math.max(AVATAR_MIN, Math.round(num)))
}

function clampHistoryCount(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.ai.historyCount
  return Math.min(HISTORY_COUNT_MAX, Math.max(HISTORY_COUNT_MIN, Math.round(num)))
}

function resolveAvatarPath(s: Settings): string {
  if (s.ai.avatarPath && existsSync(s.ai.avatarPath)) return s.ai.avatarPath
  for (const ext of AVATAR_EXTS) {
    const up = join(GC_DIR, 'avatar' + ext)
    if (existsSync(up)) return up
  }
  return DEFAULT_AVATAR
}

function contentTypeFor(p: string): string {
  switch (extname(p).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg': case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/png'
  }
}

function readBody(req: any): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function imageLabel(attachment: any): string {
  const nm = attachment && typeof attachment.name === 'string' ? attachment.name : ''
  if (nm) return nm
  const id = attachment && typeof attachment.attachmentId === 'string' ? attachment.attachmentId : ''
  if (id) return id.replace(/^sha256:/, '') + '.bin'
  return '附件'
}

function textOf(blocks: readonly BlockLike[] | undefined): string {
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('')
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
/** 按客户端提供的时区偏移（分钟，东为正）格式化本地时间。 */
function formatLocalTime(ms: number, tzOffsetMin: number): string {
  const off = Number.isFinite(tzOffsetMin) ? tzOffsetMin : 0
  const d = new Date(ms + off * 60000)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

function escapeTitle(t: string): string {
  const s = t.replace(/[#>\r\n]/g, ' ').trim()
  return s || '会话'
}

function buildMarkdown(events: readonly EventLike[], title: string, createdAt: number, now: number, tzOffsetMin: number): string {
  let turnCount = 0
  for (const ev of events) if (ev.type === 'turn/start') turnCount += 1

  const out: string[] = []
  out.push(`# ${escapeTitle(title)}`)
  out.push('')
  out.push(`> **创建时间** · ${formatLocalTime(createdAt, tzOffsetMin)}`)
  out.push(`> **导出时间** · ${formatLocalTime(now, tzOffsetMin)}`)
  out.push(`> **对话轮数** · ${turnCount}`)
  out.push('')

  let turnNum = 0
  let inTurn = false
  let userTexts: string[] = []
  let userImages: string[] = []
  let aiTexts: string[] = []

  const flush = (): void => {
    if (!inTurn) return
    turnNum += 1
    const userParts = [...userTexts]
    if (userImages.length > 0) userParts.push(userImages.map((i) => `![${i}](${i})`).join(' '))
    const user = userParts.filter((s) => s.trim() !== '').join('\n\n').trim()
    const ai = aiTexts.join('\n\n').trim()

    out.push(`## 第 ${pad(turnNum)} 轮`)
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
    userTexts = []
    userImages = []
    aiTexts = []
  }

  for (const ev of events) {
    const data = ev.data
    switch (ev.type) {
      case 'turn/start':
        flush()
        inTurn = true
        break
      case 'user/message': {
        const src = data && data.source
        if (src && src.kind === 'user') {
          for (const b of (data.content ?? []) as BlockLike[]) {
            if (b.type === 'text' && typeof b.text === 'string') userTexts.push(b.text)
            else if (b.type === 'image') userImages.push(imageLabel(b.attachment))
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
        inTurn = false
        break
      default:
        break
    }
  }
  flush()
  return out.join('\n').trimEnd() + '\n'
}

function safeFilename(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return (cleaned || '会话') + '.md'
}

export function apply(ctx: AppContext): void {
  mkdirSync(GC_DIR, { recursive: true })
  const disposers: Array<() => void> = []

  // ── 头像 ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/avatar',
    handler: (_req: any, res: any) => {
      try {
        const p = resolveAvatarPath(readSettings())
        const bytes = readFileSync(p)
        res.writeHead(200, {
          'Content-Type': contentTypeFor(p),
          'Cache-Control': 'no-store',
          'Content-Length': String(bytes.length),
        })
        res.end(bytes)
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('avatar unavailable')
      }
    },
  }))

  // ── 设置（GET 读 / POST 写）──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/settings',
    handler: async (req: any, res: any) => {
      try {
        if (req.method === 'POST') {
          const patch = JSON.parse((await readBody(req)) || '{}')
          const current = readSettings()
          const next: Settings = {
            export: { ...current.export, ...(patch && typeof patch.export === 'object' ? patch.export : {}) },
            ai: { ...current.ai, ...(patch && typeof patch.ai === 'object' ? patch.ai : {}) },
          }
          if (typeof next.ai.avatarSize === 'number') next.ai.avatarSize = clampSize(next.ai.avatarSize)
          if (typeof next.ai.historyCount === 'number') next.ai.historyCount = clampHistoryCount(next.ai.historyCount)
          writeSettings(next)
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, settings: next }))
        } else {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, settings: readSettings() }))
        }
      } catch (err) {
        res.writeHead(400, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    },
  }))

  // ── 上传头像（dataUrl base64）──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/avatar-upload',
    handler: async (req: any, res: any) => {
      try {
        const payload = JSON.parse((await readBody(req)) || '{}')
        const dataUrl = payload && payload.dataUrl
        if (typeof dataUrl !== 'string') throw new Error('missing dataUrl')
        const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
        if (!m) throw new Error('invalid dataUrl')
        const sub = m[1].split('/')[1]
        const ext = sub === 'jpeg' ? 'jpg' : sub
        const bytes = Buffer.from(m[2], 'base64')
        for (const e of AVATAR_EXTS) {
          const old = join(GC_DIR, 'avatar' + e)
          if (existsSync(old)) rmSync(old)
        }
        mkdirSync(GC_DIR, { recursive: true })
        writeFileSync(join(GC_DIR, 'avatar.' + ext), bytes)
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, ext }))
      } catch (err) {
        res.writeHead(400, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    },
  }))

  // ── 导出 Markdown ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/export',
    handler: async (req: any, res: any) => {
      try {
        const payload = JSON.parse((await readBody(req)) || '{}')
        const sessionId = payload && payload.sessionId
        if (typeof sessionId !== 'string' || sessionId === '') throw new Error('missing sessionId')
        const sq = ctx.get('sessionQuery') as SessionQueryLike | undefined
        if (!sq) throw new Error('sessionQuery unavailable')
        const snapshot = await sq.readSession(sessionId)
        const titleSnap = await sq.readTitle(sessionId).catch(() => undefined)
        const title = (titleSnap && titleSnap.title) || (typeof payload.title === 'string' ? payload.title : '') || '会话'
        const now = typeof payload.now === 'number' ? payload.now : Date.now()
        const tzOffsetMin = typeof payload.tzOffsetMin === 'number' ? payload.tzOffsetMin : -new Date().getTimezoneOffset()
        const markdown = buildMarkdown(snapshot.events, title, snapshot.session.createdAt, now, tzOffsetMin)
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, markdown, filename: safeFilename(title) }))
      } catch (err) {
        res.writeHead(400, JSON_HEADERS)
        res.end(JSON.stringify({ ok: false, error: String(err) }))
      }
    },
  }))

  ctx.effect(() => () => {
    for (const d of disposers) d()
  })
}
