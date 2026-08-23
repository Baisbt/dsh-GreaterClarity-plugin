/**
 * dsh-greater-clarity —— Host 半：webServer 路由 + 设置持久化 + Markdown 导出。
 *
 * 路由（全部挂 ctx.effect，卸载即净）：
 *   GET  /dsh-greater-clarity/avatar          → 头像图片字节
 *   GET  /dsh-greater-clarity/settings        → 读设置
 *   POST /dsh-GreaterClarity/settings         → 写设置（部分 patch）
 *   POST /dsh-greater-clarity/avatar-upload   → 上传头像（dataUrl base64 落盘）
 *   POST /dsh-greater-clarity/export          → { sessionId } → { ok, markdown, filename }
 *   POST /dsh-greater-clarity/uninstall       → 清除数据目录 + 写入停用标记（软卸载）
 *
 * 软卸载语义：uninstalled.flag 存在时插件对外表现为停用且数据已清空，
 * 重启后仍保持停用；在设置中重新「启用」即删除标记恢复。
 * 从 profile 彻底移除仍需官方命令：dsh plugin --profile <name> remove <pkg>。
 *
 * 设置持久化在 $DSH_HOME/greater-clarity/settings.json（自建文件，
 * 不依赖 DSH settings provider 是否挂载，与 whale-widget/super-injector 先例一致）。
 */
import type { Context } from 'cordis'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from 'node:fs'
import { join, resolve, extname, dirname, sep } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const GC_DIR = join(DSH_HOME, 'greater-clarity')
const GC_DIR_ABS = resolve(GC_DIR)
const SETTINGS_FILE = join(GC_DIR, 'settings.json')
const UNINSTALLED_FLAG = join(GC_DIR, 'uninstalled.flag')
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
interface PluginSettings {
  enabled: boolean
}
interface UiSettings {
  /** 思考链/工具链全局折叠状态，跨页面与跨服务重启持久。 */
  foldGlobal: 'expanded' | 'folded'
}
interface Settings {
  plugin: PluginSettings
  ui: UiSettings
  export: ExportSettings
  ai: AiSettings
}

const DEFAULT_SETTINGS: Settings = {
  plugin: { enabled: true },
  ui: { foldGlobal: 'expanded' },
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
  'Cache-Control': 'no-store',
}

// 本插件路由的信任判据：Host 必须是本机回环地址（防 DNS rebinding）；
// 浏览器发起的请求其 Origin 还须与 Host 同源（防跨站 CSRF）。非浏览器客户端无 Origin，直接放行。
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i

function trustedRequest(req: any): boolean {
  const headers = req.headers || {}
  const host = typeof headers.host === 'string' ? headers.host : ''
  if (!LOCAL_HOST_RE.test(host)) return false
  const origin = typeof headers.origin === 'string' ? headers.origin : ''
  if (origin === '') return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function rejectUntrusted(res: any): void {
  res.writeHead(403, JSON_HEADERS)
  res.end(JSON.stringify({ ok: false, error: 'untrusted request origin' }))
}

/** 统一错误响应：413 保留状态码；对已销毁套接字的二次写异常就地吞掉。 */
function respondError(res: any, err: unknown): void {
  const code = (err as any)?.statusCode === 413 ? 413 : 400
  try {
    res.writeHead(code, JSON_HEADERS)
    res.end(JSON.stringify({ ok: false, error: String((err as any)?.message ?? err) }))
  } catch {
    // socket already gone
  }
}

function readSettings(): Settings {
  try {
    const raw = JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'))
    const plg = raw && typeof raw.plugin === 'object' ? raw.plugin : {}
    const ui = raw && typeof raw.ui === 'object' ? raw.ui : {}
    const exp = raw && typeof raw.export === 'object' ? raw.export : {}
    const ai = raw && typeof raw.ai === 'object' ? raw.ai : {}
    return {
      plugin: { ...DEFAULT_SETTINGS.plugin, ...plg },
      ui: { ...DEFAULT_SETTINGS.ui, ...ui },
      export: { ...DEFAULT_SETTINGS.export, ...exp },
      ai: { ...DEFAULT_SETTINGS.ai, ...ai },
    }
  } catch {
    // 损坏的配置不静默丢弃：留一份 .bak 再回默认值。
    try {
      if (existsSync(SETTINGS_FILE)) renameSync(SETTINGS_FILE, SETTINGS_FILE + '.bak')
    } catch {
      // 备份失败也继续
    }
    return DEFAULT_SETTINGS
  }
}

/** 软卸载标记存在 → 对外一律视为停用（跨重启持久）。 */
function softUninstalled(): boolean {
  return existsSync(UNINSTALLED_FLAG)
}

/** 对外呈现的生效设置：软卸载期间强制 enabled=false。 */
function effectiveSettings(): Settings {
  const s = readSettings()
  if (softUninstalled()) s.plugin.enabled = false
  return s
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
  const configured = s.ai.avatarPath
  if (configured) {
    // 仅接受 greater-clarity 目录内的图片文件，防止经 settings 写入任意路径读取机器文件。
    const p = resolve(configured)
    const inDir = p.toLowerCase().startsWith(GC_DIR_ABS.toLowerCase() + sep.toLowerCase())
    if (inDir && AVATAR_EXTS.includes(extname(p).toLowerCase()) && existsSync(p)) return p
  }
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
        // 暂停读取并携带 413 状态码拒绝，由 respondError 回应后再断开。
        const err = new Error(`body exceeds ${MAX_BODY_BYTES} bytes`) as Error & { statusCode?: number }
        err.statusCode = 413
        req.pause()
        reject(err)
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

/**
 * 用户文本全局严格转义，阻断 Markdown 注入（原理同 SQL 注入：不可信数据不得改变文档结构）。
 * 顺序固定：反斜杠加倍 → 反斜杠转义结构符号 → 实体化 & < >（消灭裸 HTML/HTML 注释/行首引用）
 * → 行首 - + = 与有序列表标记转义（消灭分隔线/Setext 标题/伪列表）。
 */
function escapeUserText(text: string): string {
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
function safeImageDest(name: string): string {
  return name.replace(/[<>\r\n]/g, '')
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

    turnNum += 1
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
  }

  for (const ev of events) {
    const data = ev.data
    switch (ev.type) {
      case 'turn/start':
        flush()
        break
      case 'user/message': {
        // 轮次语义：turn 边界定轮；user 开启输入，steering（中途引导）并入当前轮的用户区。
        const src = data && data.source
        if (src && (src.kind === 'user' || src.kind === 'steering')) {
          for (const b of (data.content ?? []) as BlockLike[]) {
            if (b.type === 'text' && typeof b.text === 'string') userTexts.push(escapeUserText(b.text))
            else if (b.type === 'image') userImages.push(escapeUserText(imageLabel(b.attachment)))
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
    handler: (req: any, res: any) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
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
        // 文件缺失/不可读：对已销毁套接字的写异常就地吞掉。
        try {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
          res.end('avatar unavailable')
        } catch {
          // socket already gone
        }
      }
    },
  }))

  // ── 设置（GET 读 / POST 写）──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/settings',
    handler: async (req: any, res: any) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        if (req.method === 'POST') {
          const patch = JSON.parse((await readBody(req)) || '{}')
          const cur = readSettings()
          // 逐字段类型净化：非法类型不落盘，可调数值统一 clamp。
          const plgIn = patch && typeof patch.plugin === 'object' ? patch.plugin : {}
          const uiIn = patch && typeof patch.ui === 'object' ? patch.ui : {}
          const expIn = patch && typeof patch.export === 'object' ? patch.export : {}
          const aiIn = patch && typeof patch.ai === 'object' ? patch.ai : {}
          const next: Settings = {
            plugin: {
              enabled: typeof plgIn.enabled === 'boolean' ? plgIn.enabled : cur.plugin.enabled,
            },
            ui: {
              foldGlobal: uiIn.foldGlobal === 'folded' || uiIn.foldGlobal === 'expanded' ? uiIn.foldGlobal : cur.ui.foldGlobal,
            },
            export: {
              showButton: typeof expIn.showButton === 'boolean' ? expIn.showButton : cur.export.showButton,
              mode: typeof expIn.mode === 'string' ? expIn.mode : cur.export.mode,
              targetDir: typeof expIn.targetDir === 'string' ? expIn.targetDir : cur.export.targetDir,
            },
            ai: {
              showAvatar: typeof aiIn.showAvatar === 'boolean' ? aiIn.showAvatar : cur.ai.showAvatar,
              avatarPath: typeof aiIn.avatarPath === 'string' ? aiIn.avatarPath : cur.ai.avatarPath,
              avatarSize: 'avatarSize' in aiIn ? clampSize(aiIn.avatarSize) : cur.ai.avatarSize,
              historyCount: 'historyCount' in aiIn ? clampHistoryCount(aiIn.historyCount) : cur.ai.historyCount,
            },
          }
          writeSettings(next)
          // 重新启用即解除软卸载标记。
          if (next.plugin.enabled && softUninstalled()) rmSync(UNINSTALLED_FLAG, { force: true })
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, settings: next }))
        } else {
          res.writeHead(200, JSON_HEADERS)
          res.end(JSON.stringify({ ok: true, settings: effectiveSettings() }))
        }
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── 上传头像（dataUrl base64）──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/avatar-upload',
    handler: async (req: any, res: any) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
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
        respondError(res, err)
      }
    },
  }))

  // ── 导出 Markdown ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/export',
    handler: async (req: any, res: any) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        const payload = JSON.parse((await readBody(req)) || '{}')
        const sessionId = payload && payload.sessionId
        if (typeof sessionId !== 'string' || sessionId === '') throw new Error('missing sessionId')
        const sq = ctx.get('sessionQuery') as SessionQueryLike | undefined
        if (!sq) throw new Error('sessionQuery unavailable')
        // 快照与标题并行读取，缩短服务端兜底路径的耗时。
        const [snapshot, titleSnap] = await Promise.all([
          sq.readSession(sessionId),
          sq.readTitle(sessionId).catch(() => undefined),
        ])
        const title = (titleSnap && titleSnap.title) || (typeof payload.title === 'string' ? payload.title : '') || '会话'
        const now = typeof payload.now === 'number' ? payload.now : Date.now()
        const tzOffsetMin = typeof payload.tzOffsetMin === 'number' ? payload.tzOffsetMin : -new Date().getTimezoneOffset()
        const markdown = buildMarkdown(snapshot.events, title, snapshot.session.createdAt, now, tzOffsetMin)
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, markdown, filename: safeFilename(title) }))
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  // ── 卸载（软）：清除数据目录 + 写停用标记，跨重启保持停用；彻底移除需官方 remove 命令 ──
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/dsh-greater-clarity/uninstall',
    handler: async (req: any, res: any) => {
      if (!trustedRequest(req)) return rejectUntrusted(res)
      try {
        if (req.method !== 'POST') throw new Error('method not allowed')
        await readBody(req)
        rmSync(GC_DIR, { recursive: true, force: true })
        mkdirSync(GC_DIR, { recursive: true })
        writeFileSync(UNINSTALLED_FLAG, JSON.stringify({ uninstalledAt: Date.now() }) + '\n', 'utf8')
        res.writeHead(200, JSON_HEADERS)
        res.end(JSON.stringify({ ok: true, pkg: name }))
      } catch (err) {
        respondError(res, err)
      }
    },
  }))

  ctx.effect(() => () => {
    for (const d of disposers) d()
  })
}
