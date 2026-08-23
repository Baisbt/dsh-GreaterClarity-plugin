/**
 * dsh-greater-clarity —— Client 半。
 * 本轮：头像锚定到 user 行底部（每轮 1 个）、纯全局折叠（含上下文注入）、
 * 点击头像弹出「用户历史输入记录」窗口（React useSession 快照）、导出触发、设置弹窗。
 */
import { createElement as h, useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'

const API = '/dsh-greater-clarity'

interface Settings {
  export: { showButton: boolean; mode: string; targetDir: string }
  ai: { showAvatar: boolean; avatarPath: string; avatarSize: number; historyCount: number }
}

// ── 模块级共享状态（跨渲染/会话切换存活）──
let settings: Settings = {
  export: { showButton: true, mode: 'download', targetDir: '' },
  ai: { showAvatar: true, avatarPath: '', avatarSize: 32, historyCount: 10 },
}
let foldGlobal: 'expanded' | 'folded' = 'expanded'
let settingsOpen = false
let busyExport = false
let avatarVersion = 0
let historyOpen = false
let lastAvatarRect = { left: 0, top: 0 }

const listeners = new Set<() => void>()
function notify(): void {
  listeners.forEach((fn) => fn())
}
function useStore(): { settings: Settings; foldGlobal: 'expanded' | 'folded'; settingsOpen: boolean; busyExport: boolean; historyOpen: boolean } {
  const [, force] = useState(0)
  const forceRef = useRef<() => void>(() => {})
  forceRef.current = () => { force((n) => n + 1) }
  useEffect(() => {
    const fn = () => { forceRef.current() }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return { settings, foldGlobal, settingsOpen, busyExport, historyOpen }
}

function fetchJson(path: string, init?: RequestInit): Promise<any> {
  return fetch(API + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  }).then((r) => r.json())
}

function loadSettings(): void {
  fetchJson('/settings')
    .then((d) => {
      if (d && d.ok && d.settings) {
        settings = {
          export: { ...settings.export, ...(d.settings.export ?? {}) },
          ai: { ...settings.ai, ...(d.settings.ai ?? {}) },
        }
        notify()
        scheduleProcessRows()
      }
    })
    .catch(() => {})
}

function saveSettings(patch: Partial<Settings>): void {
  settings = {
    export: { ...settings.export, ...(patch.export ?? {}) },
    ai: { ...settings.ai, ...(patch.ai ?? {}) },
  }
  notify()
  scheduleProcessRows()
  fetchJson('/settings', { method: 'POST', body: JSON.stringify(patch) })
    .then((d) => {
      if (d && d.ok && d.settings) {
        settings = {
          export: { ...settings.export, ...(d.settings.export ?? {}) },
          ai: { ...settings.ai, ...(d.settings.ai ?? {}) },
        }
        notify()
      }
    })
    .catch(() => {})
}

function triggerDownload(markdown: string, filename: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}

// ════════════════════════════════════════════════════════════════════
// CSS（主题 token + data-* 锚点）
// ════════════════════════════════════════════════════════════════════
const STYLES = `
.dsh-gc-btns{display:inline-flex;gap:6px;align-items:center}
.dsh-gc-btn{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-label-primary,#ddd);font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap}
.dsh-gc-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-btn[aria-pressed="true"]{background:var(--dsw-alias-brand-primary,#4a9eff);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.dsh-gc-btn:disabled{opacity:.45;cursor:not-allowed}
[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]{position:relative}
.dsh-gc-avatar{position:absolute;top:100%;right:calc(100% + 8px);border-radius:50%;object-fit:cover;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);box-shadow:0 1px 3px rgba(0,0,0,.2);z-index:1}
@container (max-width:900px){
  .dsh-gc-avatar{position:static;float:left;margin:2px 8px 4px 0}
}
.dsh-gc-sticky{position:fixed;top:8px;z-index:90;border-radius:50%;object-fit:cover;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);box-shadow:0 2px 8px rgba(0,0,0,.3)}
[data-dsh-gc-hidden]{display:none !important}
[data-dsh-gc-folded] [data-variant="think"]{display:none !important}
.dsh-gc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99990;
  display:flex;align-items:center;justify-content:center}
.dsh-gc-modal{width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#333);
  border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
  border-bottom:1px solid var(--dsw-alias-border-l1,#555);font-size:14px;font-weight:600}
.dsh-gc-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#888);
  font-size:22px;line-height:1;cursor:pointer;padding:0 4px}
.dsh-gc-close:hover{color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-modal-body{display:flex;flex:1;min-height:0}
.dsh-gc-nav{width:150px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,#555);padding:8px}
.dsh-gc-nav-item{display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;border:none;
  border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#777);font-size:13px;cursor:pointer}
.dsh-gc-nav-item:hover{background:var(--dsw-alias-bg-layer-1,#eee)}
.dsh-gc-nav-item.active{background:var(--dsw-alias-bg-layer-1,#eee);color:var(--dsw-alias-label-primary,#222);font-weight:600}
.dsh-gc-content{flex:1;min-width:0;padding:14px 16px;overflow:auto;font-size:13px}
.dsh-gc-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1,#555)}
.dsh-gc-row:last-child{border-bottom:none}
.dsh-gc-label{color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-hint{color:var(--dsw-alias-label-secondary,#888);font-size:12px;margin-top:2px}
.dsh-gc-toggle{position:relative;width:38px;height:22px;flex:none;cursor:pointer}
.dsh-gc-toggle input{opacity:0;width:0;height:0}
.dsh-gc-toggle .track{position:absolute;inset:0;border-radius:11px;
  background:var(--dsw-alias-label-tertiary,#8a8a8a);border:1px solid var(--dsw-alias-border-l1,#666);
  transition:background .16s}
.dsh-gc-toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-bg-overlay,#f2f2f2);transition:left .16s;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.dsh-gc-toggle input:checked + .track{background:var(--dsw-alias-brand-primary,#4a9eff);border-color:transparent}
.dsh-gc-toggle input:checked + .track::after{left:18px}
.dsh-gc-toggle input:focus-visible + .track{outline:2px solid var(--dsw-alias-brand-primary,#4a9eff);outline-offset:2px}
.dsh-gc-range{width:110px;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-num{width:64px;background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);
  border:1px solid var(--dsw-alias-border-l1,#555);border-radius:6px;padding:4px 8px;font-size:12px;text-align:right}
.dsh-gc-size-val{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary,#888)}
.dsh-gc-upload-btn{display:inline-block;padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#555);
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);cursor:pointer;font-size:12px}
.dsh-gc-history{position:fixed;z-index:99980;width:300px;max-width:calc(100vw - 16px);max-height:60vh;
  display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);
  border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.3);overflow:hidden;color:var(--dsw-alias-label-primary,#222);font-size:12px}
.dsh-gc-history-search{flex:none;margin:8px 8px 4px;padding:6px 10px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);
  border:1px solid var(--dsw-alias-border-l1,#555);font-size:12px}
.dsh-gc-history-list{flex:1;min-height:0;overflow-y:auto;padding:0 4px 8px}
.dsh-gc-history-item{padding:6px 8px;border-radius:6px;cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-gc-history-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-gc-history-empty{padding:12px 8px;color:var(--dsw-alias-label-secondary,#888)}
`

// ════════════════════════════════════════════════════════════════════
// 头像 + 折叠 DOM 层
// ════════════════════════════════════════════════════════════════════
const BOUNDARY_KINDS = new Set(['user', 'steering'])
const AVATAR_ROW_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]'
let observer: MutationObserver | null = null
let processTimer: number | null = null

function scheduleProcessRows(): void {
  if (processTimer !== null) return
  processTimer = window.setTimeout(() => {
    processTimer = null
    processRows()
  }, 120)
}

function clampAvatarSize(n: number): number {
  const num = Number.isFinite(n) ? n : 32
  return Math.min(128, Math.max(16, Math.round(num)))
}
function clampHistoryCount(n: number): number {
  const num = Number.isFinite(n) ? n : 10
  return Math.min(30, Math.max(5, Math.round(num)))
}

function processRows(): void {
  ensureAvatars()
  applyFold()
  ensureStickyAvatar()
}

function ensureAvatars(): void {
  const userRows = document.querySelectorAll<HTMLElement>(AVATAR_ROW_SELECTOR)
  if (!settings.ai.showAvatar) {
    document.querySelectorAll('.dsh-gc-avatar').forEach((el) => el.remove())
    return
  }
  const size = clampAvatarSize(settings.ai.avatarSize)
  for (let i = 0; i < userRows.length; i++) {
    const row = userRows[i]
    let img = row.querySelector<HTMLElement>(':scope > .dsh-gc-avatar')
    if (!img) {
      img = document.createElement('img')
      img.className = 'dsh-gc-avatar'
      img.alt = 'AI 头像'
      img.draggable = false
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        openHistory(rect)
      })
      row.insertBefore(img, row.firstChild)
    }
    img.style.width = size + 'px'
    img.style.height = size + 'px'
    img.src = `${API}/avatar?v=${avatarVersion}`
  }
  // 清理挂在非用户侧行上的残留头像
  document.querySelectorAll('.dsh-gc-avatar').forEach((el) => {
    const p = el.parentElement
    if (!p || !BOUNDARY_KINDS.has(p.getAttribute('data-chat-flow-kind') || '')) el.remove()
  })
}

function applyFold(): void {
  const folded = foldGlobal === 'folded'
  document.querySelectorAll('[data-dsh-gc-hidden], [data-dsh-gc-folded]').forEach((el) => {
    el.removeAttribute('data-dsh-gc-hidden')
    el.removeAttribute('data-dsh-gc-folded')
  })
  if (!folded) return
  // 以用户侧消息为边界分组；轮内非末条 assistant-step 及 tool-call/context/turn-tail 等整行隐藏。
  const rows = document.querySelectorAll<HTMLElement>('[data-chat-flow-kind]')
  const turns: HTMLElement[][] = []
  let current: HTMLElement[] | null = null
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const kind = row.getAttribute('data-chat-flow-kind') || ''
    if (BOUNDARY_KINDS.has(kind)) {
      current = null
      continue
    }
    if (current === null) {
      current = []
      turns.push(current)
    }
    current.push(row)
  }
  for (const turn of turns) {
    const steps = turn.filter((r) => r.getAttribute('data-chat-flow-kind') === 'assistant-step')
    const last = steps[steps.length - 1]
    for (const row of turn) {
      if (row === last) continue
      row.setAttribute('data-dsh-gc-hidden', '')
    }
    if (!last) continue
    last.setAttribute('data-dsh-gc-folded', '')
    const hasVisible = last.innerText.trim() !== '' || last.querySelector('img:not(.dsh-gc-avatar)') !== null
    if (!hasVisible) {
      last.removeAttribute('data-dsh-gc-folded')
      last.setAttribute('data-dsh-gc-hidden', '')
    }
  }
}

function openHistory(rect: DOMRect): void {
  lastAvatarRect = { left: rect.left, top: rect.top }
  historyOpen = true
  notify()
}

function toggleGlobalFold(): void {
  foldGlobal = foldGlobal === 'folded' ? 'expanded' : 'folded'
  notify()
  scheduleProcessRows()
}

// ════════════════════════════════════════════════════════════════════
// 顶部固定头像（视口内头像覆盖率 <25% 时显示，点击打开历史窗口）
// ════════════════════════════════════════════════════════════════════
let stickyEl: HTMLImageElement | null = null

function ensureStickyAvatar(): void {
  if (!settings.ai.showAvatar) {
    removeSticky()
    return
  }
  if (!stickyEl) {
    stickyEl = document.createElement('img')
    stickyEl.className = 'dsh-gc-sticky'
    stickyEl.alt = 'AI 头像'
    stickyEl.draggable = false
    stickyEl.addEventListener('click', (e) => {
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      openHistory(rect)
    })
    document.body.appendChild(stickyEl)
  }
  const size = clampAvatarSize(settings.ai.avatarSize)
  stickyEl.style.width = size + 'px'
  stickyEl.style.height = size + 'px'
  stickyEl.src = `${API}/avatar?v=${avatarVersion}`
  positionSticky()
  updateStickyVisibility()
}

function removeSticky(): void {
  if (stickyEl) { stickyEl.remove(); stickyEl = null }
}

function positionSticky(): void {
  if (!stickyEl) return
  let left = 8
  const sample = document.querySelector('.dsh-gc-avatar')
  if (sample) {
    left = Math.max(8, sample.getBoundingClientRect().left)
  } else {
    const anchor = document.querySelector('[data-chat-flow-kind]')
    if (anchor) left = Math.max(8, anchor.getBoundingClientRect().left - clampAvatarSize(settings.ai.avatarSize) - 8)
  }
  // 垂直：挂在会话滚动区 [data-conversation-scroll] 顶部下方（避开全局 header）。
  let top = 8
  const scrollCtx = document.querySelector('[data-conversation-scroll]')
  if (scrollCtx) {
    const r = scrollCtx.getBoundingClientRect()
    if (r.top > 0) top = Math.max(32, r.top + 4)
  }
  stickyEl.style.left = left + 'px'
  stickyEl.style.top = top + 'px'
}

function updateStickyVisibility(): void {
  if (!stickyEl) return
  // 视口内存在任一普通头像 → 隐藏；否则显示。
  const vh = window.innerHeight
  const avatars = document.querySelectorAll('.dsh-gc-avatar')
  let anyVisible = false
  for (let i = 0; i < avatars.length; i++) {
    const r = (avatars[i] as HTMLElement).getBoundingClientRect()
    if (r.bottom > 0 && r.top < vh) { anyVisible = true; break }
  }
  stickyEl.style.display = anyVisible ? 'none' : ''
}

function clearAvatarLayer(): void {
  document.querySelectorAll('.dsh-gc-avatar').forEach((el) => el.remove())
  document.querySelectorAll('[data-dsh-gc-hidden]').forEach((el) => el.removeAttribute('data-dsh-gc-hidden'))
  document.querySelectorAll('[data-dsh-gc-folded]').forEach((el) => el.removeAttribute('data-dsh-gc-folded'))
  removeSticky()
}

// ════════════════════════════════════════════════════════════════════
// React 组件
// ════════════════════════════════════════════════════════════════════
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return h('label', { className: 'dsh-gc-toggle' },
    h('input', { type: 'checkbox', checked, onChange: (e: any) => onChange(e.target.checked) }),
    h('span', { className: 'track' }),
  )
}

function ExportPane() {
  const s = useStore().settings
  return h('div', null,
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '显示导出按钮'),
        h('div', { className: 'dsh-gc-hint' }, '在会话头部显示「导出」按钮'),
      ),
      h(Toggle, {
        checked: s.export.showButton,
        onChange: (v) => saveSettings({ export: { ...s.export, showButton: v } }),
      }),
    ),
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '导出路径'),
        h('div', { className: 'dsh-gc-hint' }, '浏览器默认下载目录（浏览器安全限制，无法自定义）'),
      ),
    ),
  )
}

function AiPane() {
  const s = useStore().settings
  const fileRef = useRef<HTMLInputElement | null>(null)
  const onFile = (e: any): void => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      fetchJson('/avatar-upload', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) })
        .then((d) => {
          if (d && d.ok) {
            avatarVersion += 1
            scheduleProcessRows()
          }
        })
        .catch(() => {})
    }
    reader.readAsDataURL(file)
  }
  const commitSize = (v: number): void => {
    saveSettings({ ai: { ...s.ai, avatarSize: clampAvatarSize(v) } })
  }
  const commitCount = (v: number): void => {
    saveSettings({ ai: { ...s.ai, historyCount: clampHistoryCount(v) } })
  }
  return h('div', null,
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '显示头像'),
        h('div', { className: 'dsh-gc-hint' }, '在每条 AI 回复左侧显示头像'),
      ),
      h(Toggle, {
        checked: s.ai.showAvatar,
        onChange: (v) => saveSettings({ ai: { ...s.ai, showAvatar: v } }),
      }),
    ),
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '上传头像'),
        h('div', { className: 'dsh-gc-hint' }, 'PNG / JPG / WebP / GIF'),
      ),
      h('span', { className: 'dsh-gc-upload-btn', onClick: () => { fileRef.current && fileRef.current.click() } }, '选择图片'),
      h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: { display: 'none' }, onChange: onFile }),
    ),
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '头像大小'),
        h('div', { className: 'dsh-gc-hint' }, '16 – 128 px，可直接输入数字'),
      ),
      h('input', {
        className: 'dsh-gc-range', type: 'range', min: 16, max: 128, step: 1,
        value: clampAvatarSize(s.ai.avatarSize),
        onChange: (e: any) => commitSize(Number(e.target.value)),
      }),
      h('input', {
        className: 'dsh-gc-num', type: 'number', min: 16, max: 128, step: 1,
        value: clampAvatarSize(s.ai.avatarSize),
        onChange: (e: any) => { const v = Number(e.target.value); if (Number.isFinite(v)) commitSize(v) },
      }),
      h('span', { className: 'dsh-gc-size-val' }, clampAvatarSize(s.ai.avatarSize) + ' px'),
    ),
    h('div', { className: 'dsh-gc-row' },
      h('div', null,
        h('div', { className: 'dsh-gc-label' }, '历史记录条数'),
        h('div', { className: 'dsh-gc-hint' }, '历史窗口可见行数，5 – 30'),
      ),
      h('input', {
        className: 'dsh-gc-num', type: 'number', min: 5, max: 30, step: 1,
        value: clampHistoryCount(s.ai.historyCount),
        onChange: (e: any) => { const v = Number(e.target.value); if (Number.isFinite(v)) commitCount(v) },
      }),
    ),
  )
}

function userNodeText(node: any): string {
  const data = node && node.data ? node.data : {}
  const content = Array.isArray(data.content) ? data.content : []
  return content
    .filter((b: any) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('')
}

function HistoryPanel({ useSession, onClose }: { useSession: any; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const snapshot = useSession((s: any) => s)
  const items = useMemo(() => {
    const list: { key: string; text: string }[] = []
    if (!snapshot) return list
    const chat = snapshot.chat
    const order = chat && Array.isArray(chat.order) ? chat.order : []
    const nodes = chat && chat.nodes ? chat.nodes : null
    for (const key of order) {
      const node = nodes ? (nodes.get ? nodes.get(key) : undefined) : undefined
      if (node && (node.kind === 'user' || node.kind === 'steering')) {
        const text = userNodeText(node)
        if (text.trim() !== '') list.push({ key, text })
      }
    }
    return list
  }, [snapshot])

  const q = query.trim().toLowerCase()
  const filtered = q === '' ? items : items.filter((it) => it.text.toLowerCase().includes(q))
  const rowH = 30
  const n = clampHistoryCount(settings.ai.historyCount)
  const listHeight = Math.max(5, Math.min(n, filtered.length || 1)) * rowH

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('.dsh-gc-history') || target.closest('.dsh-gc-avatar')) return
      if ((searchRef.current && searchRef.current.value.trim()) === '') onClose()
    }
    document.addEventListener('click', onDocClick, true)
    return () => { document.removeEventListener('click', onDocClick, true) }
  }, [onClose])

  const jump = (key: string): void => {
    const rows = document.querySelectorAll('[data-chat-anchor-key]')
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-chat-anchor-key') === key) {
        ;(rows[i] as HTMLElement).scrollIntoView({ block: 'center', behavior: 'smooth' })
        return
      }
    }
  }

  const PANEL_W = 300
  const left = Math.max(8, Math.min(lastAvatarRect.left - PANEL_W - 8, window.innerWidth - PANEL_W - 8))
  const top = Math.max(8, Math.min(lastAvatarRect.top, window.innerHeight - 200))

  return h('div', { className: 'dsh-gc-history', style: { left: left + 'px', top: top + 'px' } },
    h('input', {
      className: 'dsh-gc-history-search',
      ref: searchRef,
      value: query,
      onChange: (e: any) => setQuery(e.target.value),
      placeholder: '搜索用户输入…',
    }),
    h('div', { className: 'dsh-gc-history-list', style: { maxHeight: listHeight + 'px' } },
      filtered.length === 0
        ? h('div', { className: 'dsh-gc-history-empty' }, '无匹配记录')
        : filtered.map((it) => h('div', {
          className: 'dsh-gc-history-item',
          key: it.key,
          onClick: () => jump(it.key),
          title: it.text,
        }, it.text)),
    ),
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'export' | 'ai'>('export')
  return h('div', { className: 'dsh-gc-modal-backdrop', onClick: (e: any) => { if (e.target === e.currentTarget) onClose() } },
    h('div', { className: 'dsh-gc-modal' },
      h('div', { className: 'dsh-gc-modal-head' },
        h('span', null, 'GreaterClarity 设置'),
        h('button', { className: 'dsh-gc-close', onClick: onClose, 'aria-label': '关闭' }, '×'),
      ),
      h('div', { className: 'dsh-gc-modal-body' },
        h('div', { className: 'dsh-gc-nav' },
          h('button', { className: 'dsh-gc-nav-item' + (tab === 'export' ? ' active' : ''), onClick: () => setTab('export') }, '导出'),
          h('button', { className: 'dsh-gc-nav-item' + (tab === 'ai' ? ' active' : ''), onClick: () => setTab('ai') }, 'AI 设置'),
        ),
        h('div', { className: 'dsh-gc-content' },
          tab === 'export' ? h(ExportPane) : h(AiPane),
        ),
      ),
    ),
  )
}

function Buttons({ sessionId, useSession }: { sessionId?: string; useSession?: any }) {
  const store = useStore()
  const folded = store.foldGlobal === 'folded'

  const doExport = (): void => {
    if (!sessionId || busyExport) return
    busyExport = true
    notify()
    fetchJson('/export', { method: 'POST', body: JSON.stringify({ sessionId, now: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset() }) })
      .then((d) => {
        if (d && d.ok && d.markdown) {
          triggerDownload(d.markdown, d.filename || '会话.md')
        } else {
          window.alert('导出失败：' + ((d && d.error) || '未知错误'))
        }
      })
      .catch((e) => { window.alert('导出失败：' + String(e)) })
      .finally(() => {
        busyExport = false
        notify()
      })
  }

  const openSettings = (): void => {
    settingsOpen = true
    notify()
  }

  return h(Fragment, null,
    h('div', { className: 'dsh-gc-btns' },
      h('button', {
        className: 'dsh-gc-btn',
        onClick: toggleGlobalFold,
        title: folded ? '展开思考链与工具链' : '折叠思考链与工具链',
        'aria-pressed': folded,
      }, folded ? '展开' : '折叠'),
      store.settings.export.showButton
        ? h('button', {
          className: 'dsh-gc-btn',
          onClick: doExport,
          disabled: !sessionId || store.busyExport,
          title: '导出 Markdown',
        }, store.busyExport ? '导出中…' : '导出')
        : null,
      h('button', { className: 'dsh-gc-btn', onClick: openSettings, title: '设置' }, '设置'),
    ),
    store.settingsOpen
      ? createPortal(h(SettingsModal, { onClose: () => { settingsOpen = false; notify() } }), document.body)
      : null,
    store.historyOpen && useSession
      ? createPortal(h(HistoryPanel, { useSession, onClose: () => { historyOpen = false; notify() } }), document.body)
      : null,
  )
}

// ════════════════════════════════════════════════════════════════════
// 插件主体
// ════════════════════════════════════════════════════════════════════
export const inject = ['slots']

export function apply(ctx: any): void {
  // 1) 注入样式
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-greater-clarity'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // 2) 启动头像/折叠 DOM 层
  ctx.effect(() => {
    observer = new MutationObserver(() => {
      scheduleProcessRows()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    scheduleProcessRows()
    return () => {
      if (observer) { observer.disconnect(); observer = null }
      if (processTimer !== null) { window.clearTimeout(processTimer); processTimer = null }
      clearAvatarLayer()
    }
  })

  // 2b) 顶部固定头像：滚动/缩放时重算位置与显隐
  ctx.effect(() => {
    const onScrollResize = (): void => {
      positionSticky()
      updateStickyVisibility()
    }
    document.addEventListener('scroll', onScrollResize, true)
    window.addEventListener('resize', onScrollResize)
    return () => {
      document.removeEventListener('scroll', onScrollResize, true)
      window.removeEventListener('resize', onScrollResize)
      removeSticky()
    }
  })

  // 3) 注册按钮到会话头部 utilities
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-greater-clarity',
    order: 100,
  }, Buttons))

  // 4) 加载设置
  loadSettings()
}
