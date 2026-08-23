/**
 * dsh-greater-clarity —— Client 半。
 * 本轮：头像锚定到 user 行底部（每轮 1 个）、纯全局折叠（含上下文注入）、
 * 点击头像弹出「用户历史输入记录」窗口（React useSession 快照）、导出触发、设置弹窗。
 */
import { createElement as h, useState, useEffect, useRef, useMemo, Fragment } from 'react'
import { createPortal } from 'react-dom'

const API = '/dsh-greater-clarity'

interface Settings {
  plugin: { enabled: boolean }
  ui: { foldGlobal: 'expanded' | 'folded' }
  export: { showButton: boolean; mode: string; targetDir: string }
  ai: { showAvatar: boolean; avatarPath: string; avatarSize: number; historyCount: number }
}

// ── 模块级共享状态（跨渲染/会话切换存活）──
let settings: Settings = {
  plugin: { enabled: true },
  ui: { foldGlobal: 'expanded' },
  export: { showButton: true, mode: 'download', targetDir: '' },
  ai: { showAvatar: true, avatarPath: '', avatarSize: 32, historyCount: 10 },
}
let foldGlobal: 'expanded' | 'folded' = 'expanded'
let settingsOpen = false
let busyExport = false
let avatarVersion = 0
let historyOpen = false
// 锚点几何（含右边界）：面板左侧放不下时可翻转 到锚点右侧 展开。
let lastAvatarRect = { left: 0, top: 0, right: 0 }
// 快速定位跳转的辅助状态。
let jumpGen = 0 // 跳转代际：新跳转让旧的停稳回调作废，杜绝连点错乱
let panelAnimPending = false // 仅跳转重吸附时启用一次平滑过渡；打开瞬间不播动画
let panelH = 320 // 实测面板高度缓存（渲染后测量，参与垂直边界钳制）
const JUMP_TOP_PAD = 12 // 跳转后行首距滚动容器顶部的留白

const listeners = new Set<() => void>()
// 层同步钩子：由 apply 注册，使每次状态刷新都把 DOM 层对齐到 enabled 开关。
let layerSync: (() => void) | null = null
function notify(): void {
  listeners.forEach((fn) => fn())
  if (layerSync) layerSync()
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
          plugin: { ...settings.plugin, ...(d.settings.plugin ?? {}) },
          ui: { ...settings.ui, ...(d.settings.ui ?? {}) },
          export: { ...settings.export, ...(d.settings.export ?? {}) },
          ai: { ...settings.ai, ...(d.settings.ai ?? {}) },
        }
        // 还原持久化的全局折叠状态（跨页面/服务重启）。
        foldGlobal = settings.ui.foldGlobal === 'folded' ? 'folded' : 'expanded'
        notify()
      }
    })
    .catch(() => {})
}

function saveSettings(patch: Partial<Settings>): void {
  settings = {
    plugin: { ...settings.plugin, ...(patch.plugin ?? {}) },
    ui: { ...settings.ui, ...(patch.ui ?? {}) },
    export: { ...settings.export, ...(patch.export ?? {}) },
    ai: { ...settings.ai, ...(patch.ai ?? {}) },
  }
  notify()
  fetchJson('/settings', { method: 'POST', body: JSON.stringify(patch) })
    .then((d) => {
      if (d && d.ok && d.settings) {
        settings = {
          plugin: { ...settings.plugin, ...(d.settings.plugin ?? {}) },
          ui: { ...settings.ui, ...(d.settings.ui ?? {}) },
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

/** 服务端兜底导出：Host 读盘构建完整文档（客户端快照不可用时走这里）。 */
function exportViaServer(sessionId: string | undefined): void {
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
.dsh-gc-avatarwrap{position:absolute;top:100%;right:calc(100% + 8px);display:flex;flex-direction:column;align-items:center;gap:2px;z-index:1}
.dsh-gc-avatar{display:block;border-radius:50%;object-fit:cover;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);box-shadow:0 1px 3px rgba(0,0,0,.2)}
.dsh-gc-round{font-size:10px;line-height:1.3;padding:1px 6px;border-radius:8px;white-space:nowrap;cursor:default;user-select:none;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-secondary,#bbb);border:1px solid var(--dsw-alias-border-l1,#555)}
@container (max-width:900px){
  .dsh-gc-avatarwrap{position:static;float:left;margin:2px 8px 4px 0}
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
.dsh-gc-modal-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;
  border-top:1px solid var(--dsw-alias-border-l1,#555)}
.dsh-gc-danger{padding:5px 12px;border-radius:6px;border:1px solid var(--dsw-alias-state-error-primary,#e05252);
  background:transparent;color:var(--dsw-alias-state-error-primary,#e05252);cursor:pointer;font-size:12px;white-space:nowrap}
.dsh-gc-danger:hover{background:var(--dsw-alias-state-error-primary,#e05252);color:#fff}
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
.dsh-gc-history-topbar{flex:none;padding:8px 8px 0}
.dsh-gc-top-btn{display:block;width:100%;padding:6px;border-radius:6px;font-size:12px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-top-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-hist-no{display:inline-block;min-width:24px;margin-right:6px;padding:1px 5px;border-radius:6px;text-align:center;
  background:var(--dsw-alias-button-info-fill,#4a9eff);color:#fff;font-weight:600}
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
let scrollCleanup: (() => void) | null = null
let layerActive = false

/**
 * DOM 层（头像/折叠/sticky）随「启用」开关动态装卸；
 * 停用时仅保留会话头部的「启用」入口，其余资源全部释放。
 */
function startLayer(): void {
  if (layerActive) return
  layerActive = true
  observer = new MutationObserver(() => {
    scheduleProcessRows()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const onScroll = (): void => {
    positionSticky()
    updateStickyVisibility()
  }
  const onResize = (): void => {
    positionSticky()
    updateStickyVisibility()
    notify()
  }
  document.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
  scrollCleanup = () => {
    document.removeEventListener('scroll', onScroll, true)
    window.removeEventListener('resize', onResize)
  }
  scheduleProcessRows()
}

function stopLayer(): void {
  if (!layerActive) return
  layerActive = false
  if (observer) { observer.disconnect(); observer = null }
  if (processTimer !== null) { window.clearTimeout(processTimer); processTimer = null }
  if (scrollCleanup) { scrollCleanup(); scrollCleanup = null }
  clearAvatarLayer()
}

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
    document.querySelectorAll('.dsh-gc-avatarwrap').forEach((el) => el.remove())
    return
  }
  const size = clampAvatarSize(settings.ai.avatarSize)
  for (let i = 0; i < userRows.length; i++) {
    const row = userRows[i]
    let wrap = row.querySelector<HTMLElement>(':scope > .dsh-gc-avatarwrap')
    if (!wrap) {
      wrap = document.createElement('div')
      wrap.className = 'dsh-gc-avatarwrap'
      const img = document.createElement('img')
      img.className = 'dsh-gc-avatar'
      img.alt = 'AI 头像'
      img.draggable = false
      img.addEventListener('click', (e) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        openHistory(rect)
      })
      const label = document.createElement('div')
      label.className = 'dsh-gc-round'
      wrap.appendChild(img)
      wrap.appendChild(label)
      row.insertBefore(wrap, row.firstChild)
    }
    const img = wrap.querySelector<HTMLElement>('.dsh-gc-avatar')
    const label = wrap.querySelector<HTMLElement>('.dsh-gc-round')
    if (!img || !label) continue
    img.style.width = size + 'px'
    img.style.height = size + 'px'
    img.src = `${API}/avatar?v=${avatarVersion}`
    // 轮次标签：随映射刷新保持正确；无号（映射未就绪）时隐藏。
    const text = roundLabelForRow(row)
    label.textContent = text
    label.style.display = text === '' ? 'none' : ''
  }
  // 清理挂在非用户侧行上的残留包装层
  document.querySelectorAll('.dsh-gc-avatarwrap').forEach((el) => {
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
    // 该轮没有最终回答行时保持原样可见，绝不整轮隐藏。
    if (!last) continue
    for (const row of turn) {
      if (row === last) continue
      row.setAttribute('data-dsh-gc-hidden', '')
    }
    last.setAttribute('data-dsh-gc-folded', '')
    const hasVisible = last.innerText.trim() !== '' || last.querySelector('img:not(.dsh-gc-avatar)') !== null
    if (!hasVisible) {
      last.removeAttribute('data-dsh-gc-folded')
      last.setAttribute('data-dsh-gc-hidden', '')
    }
  }
}

function openHistory(rect: DOMRect): void {
  lastAvatarRect = { left: rect.left, top: rect.top, right: rect.right }
  historyOpen = true
  notify()
}

function toggleGlobalFold(): void {
  foldGlobal = foldGlobal === 'folded' ? 'expanded' : 'folded'
  // 持久化全局折叠状态（跨页面/服务重启还原）。
  saveSettings({ ui: { foldGlobal: foldGlobal } })
  notify()
  scheduleProcessRows()
}

/**
 * 等待滚动停稳：捕获阶段监听全文档 scroll，静默 150ms 视为停稳，1200ms 兜底超时。
 * 相比轮询固定容器，可覆盖任何实际发生滚动的祖先容器。
 * 快速连续触发时，新等待会取消尚未完成的旧等待——只认最后一次。
 */
let cancelActiveSettle: (() => void) | null = null

function waitForScrollSettle(onSettle: () => void): void {
  if (cancelActiveSettle) cancelActiveSettle()
  let done = false
  let quietTimer: number | null = null
  let hardTimer: number
  const cancelThis = (): void => {
    if (done) return
    done = true
    if (quietTimer !== null) window.clearTimeout(quietTimer)
    window.clearTimeout(hardTimer)
    document.removeEventListener('scroll', onScroll, true)
  }
  const finish = (): void => {
    if (done) return
    done = true
    if (quietTimer !== null) window.clearTimeout(quietTimer)
    window.clearTimeout(hardTimer)
    document.removeEventListener('scroll', onScroll, true)
    if (cancelActiveSettle === cancelThis) cancelActiveSettle = null
    onSettle()
  }
  const onScroll = (): void => {
    if (quietTimer !== null) window.clearTimeout(quietTimer)
    quietTimer = window.setTimeout(finish, 150)
  }
  hardTimer = window.setTimeout(finish, 1200)
  document.addEventListener('scroll', onScroll, true)
  cancelActiveSettle = cancelThis
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

/** 单采样点可见：在视口内且命中测试返回头像自身（未被 session log 等浮层遮挡）。 */
function avatarPointVisible(img: HTMLElement, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false
  return document.elementFromPoint(x, y) === img
}

/**
 * 头像可见性：中心 + 四个内对角采样点（圆形头像的几何角点在圆外，不可用），
 * 任一采样点未遮挡即在视口内 → 可见（隐藏 sticky）；全部被遮挡/出视口 → 显示 sticky。
 */
function avatarVisible(img: HTMLElement): boolean {
  const r = img.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return false
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth) return false
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const d = Math.min(r.width, r.height) * 0.35
  const samples: Array<[number, number]> = [
    [cx, cy],
    [cx - d, cy - d], [cx + d, cy - d],
    [cx - d, cy + d], [cx + d, cy + d],
  ]
  for (const [x, y] of samples) {
    if (avatarPointVisible(img, x, y)) return true
  }
  return false
}

function updateStickyVisibility(): void {
  if (!stickyEl) return
  // 视口内存在任一未被遮挡的普通头像 → 隐藏；否则显示。
  const avatars = document.querySelectorAll<HTMLElement>('.dsh-gc-avatar')
  for (let i = 0; i < avatars.length; i++) {
    if (avatarVisible(avatars[i])) {
      stickyEl.style.display = 'none'
      return
    }
  }
  stickyEl.style.display = ''
}

function clearAvatarLayer(): void {
  document.querySelectorAll('.dsh-gc-avatarwrap').forEach((el) => el.remove())
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
        h('div', { className: 'dsh-gc-label' }, '启用 GreaterClarity'),
        h('div', { className: 'dsh-gc-hint' }, '关闭后停用全部功能，仅保留会话头部的「启用」按钮；不影响已保存的设置'),
      ),
      h(Toggle, {
        checked: s.plugin.enabled !== false,
        onChange: (v) => saveSettings({ plugin: { enabled: v } }),
      }),
    ),
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

// ════════════════════════════════════════════════════════════════════
// 导出：客户端快照直出（主路径，零网络/磁盘往返）
// 注意：mdEscapeUser / safeFilenameClient 等是 src/index.ts 同名逻辑的副本
// （bundle 纯净门禁禁止跨包值导入），修改转义规则时两处必须同步。
// ════════════════════════════════════════════════════════════════════

/** 与 Host 端 escapeUserText 保持一致的全局严格转义。 */
function mdEscapeUser(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/[`*_\[\]#!~|]/g, '\\$&')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^(\s*)([-+=])/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])/gm, '$1\\$2')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function fmtLocal(ms: number): string {
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function safeFilenameClient(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return (cleaned || '会话') + '.md'
}

function imageLabelOf(b: any): string {
  const att = b && b.attachment ? b.attachment : null
  const nm = att && typeof att.name === 'string' ? att.name : ''
  if (nm) return nm
  const id = att && typeof att.attachmentId === 'string' ? att.attachmentId : ''
  if (id) return id.replace(/^sha256:/, '') + '.bin'
  return '附件'
}

function nodeBlocks(node: any): any[] {
  const d = (node && node.data) || {}
  if (Array.isArray(d.content)) return d.content
  const m = d.message
  if (m && Array.isArray(m.content)) return m.content
  return []
}

// ── 轮次映射：每条用户输入（user/steering）独立递增（A 语义）──
// 依据 DSH 源码事实：仅开启新轮的输入是 kind==='user'，运行期插入的追问一律是
// 'steering'——harness 场景下占多数，若仅对 user 计数会导致几乎全部同号。
// 由 ExportButton / HistoryPanel 在持有最新快照时刷新；DOM 层（头像标签）据此取号。
const roundByNodeKey = new Map<string, number>()
const USER_KINDS = new Set(['user', 'steering'])

function rebuildRoundMap(snapshot: any): void {
  roundByNodeKey.clear()
  if (!snapshot) return
  const chat = snapshot.chat
  const order = chat && Array.isArray(chat.order) ? chat.order : []
  const nodes = chat && chat.nodes ? chat.nodes : null
  if (!nodes || order.length === 0) return
  const get = (key: string): any => (typeof nodes.get === 'function' ? nodes.get(key) : nodes[key])
  let cur = 0
  for (const key of order) {
    const node = get(key)
    if (!node) continue
    const kind = typeof node.kind === 'string' ? node.kind : ''
    if (kind === 'user' || kind === 'steering') {
      cur += 1
      roundByNodeKey.set(key, cur)
    }
  }
}

/** 头像下轮次标签文案：按行锚点 key 查映射，未知返回空串（不渲染标签）。 */
function roundLabelForRow(row: HTMLElement | null): string {
  const key = row?.getAttribute('data-chat-anchor-key') || ''
  const n = key !== '' ? roundByNodeKey.get(key) : undefined
  return n ? `第${n}轮` : ''
}

/**
 * 从会话对象层不可变快照直接构建导出文档。
 * 以 user/steering 节点为轮边界；assistant* 节点文本归入当前轮。
 * 结构防御式读取：任何缺失/变形都返回 null，由调用方回退服务端路径。
 */
function snapshotToMarkdown(snapshot: any, now: number): { markdown: string; filename: string } | null {
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
        if (b.type === 'text' && typeof b.text === 'string') {
          if (firstRawUser === null && b.text.trim() !== '') firstRawUser = b.text
          cur.user.push(mdEscapeUser(b.text))
        } else if (b.type === 'image') {
          cur.user.push(mdEscapeUser(imageLabelOf(b)))
        }
      }
    } else if (cur) {
      for (const b of nodeBlocks(node)) {
        if (b && b.type === 'text' && typeof b.text === 'string') cur.ai.push(b.text)
      }
    }
  }
  if (!sawAny || rounds.length === 0) return null

  // 标题：快照标题 → 首条用户输入截断 → 兜底「会话」。
  let title = typeof snapshot.title === 'string' ? snapshot.title.trim() : ''
  if (title === '' && firstRawUser !== null) title = firstRawUser.replace(/[#>\r\n]/g, ' ').trim().slice(0, 24)
  if (title === '') title = '会话'

  const out: string[] = []
  out.push(`# ${title}`)
  out.push('')
  const createdAt = snapshot.session && typeof snapshot.session.createdAt === 'number' ? snapshot.session.createdAt : null
  if (createdAt !== null) out.push(`> **创建时间** · ${fmtLocal(createdAt)}`)
  out.push(`> **导出时间** · ${fmtLocal(now)}`)
  out.push(`> **对话轮数** · ${rounds.length}`)
  out.push('')
  rounds.forEach((r, i) => {
    const user = r.user.filter((s) => s.trim() !== '').join('\n\n').trim()
    const ai = r.ai.join('\n\n').trim()
    out.push(`## 第 ${pad2(i + 1)} 轮`)
    out.push('')
    if (user !== '') {
      out.push('<!-- 用户消息 -->')
      out.push('<span style="color: #ffffff; background-color: #4a4a4a; padding: 2px 8px; border-radius: 4px; font-weight: 700;">用户</span>')
      out.push('')
      out.push(user)
      out.push('')
    }
    if (ai !== '') {
      out.push('<!-- AI 消息 -->')
      out.push('<span style="color: #ffffff; background-color: #4a4a4a; padding: 2px 8px; border-radius: 4px; font-weight: 700;">AI</span>')
      out.push('')
      out.push(ai)
      out.push('')
    }
    out.push('---')
    out.push('')
  })
  return { markdown: out.join('\n').trimEnd() + '\n', filename: safeFilenameClient(title) }
}

function HistoryPanel({ useSession, onClose }: { useSession: any; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const snapshot = useSession((s: any) => s)
  const items = useMemo(() => {
    const list: { key: string; text: string; round: number }[] = []
    if (!snapshot) return list
    // 面板可能先于 ExportButton 渲染：此处兜底刷新轮次映射。
    rebuildRoundMap(snapshot)
    const chat = snapshot.chat
    const order = chat && Array.isArray(chat.order) ? chat.order : []
    const nodes = chat && chat.nodes ? chat.nodes : null
    for (const key of order) {
      const node = nodes ? (nodes.get ? nodes.get(key) : undefined) : undefined
      if (node && (node.kind === 'user' || node.kind === 'steering')) {
        const text = userNodeText(node)
        if (text.trim() !== '') list.push({ key, text, round: roundByNodeKey.get(key) ?? 0 })
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
    let row: HTMLElement | null = null
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-chat-anchor-key') === key) {
        row = rows[i] as HTMLElement
        break
      }
    }
    if (!row) return
    const gen = ++jumpGen
    // 定位到输入第一行：行顶对齐滚动容器顶部下方少许，长输入不再垂直居中。
    const container = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (container) {
      const cTop = container.getBoundingClientRect().top
      const rTop = row.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + (rTop - cTop) - JUMP_TOP_PAD, behavior: 'smooth' })
    } else {
      row.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    // 停稳后重吸附：头像在视口内 → 与直接点击同几何；不在（长输入底部头像滚出屏）→ 锚定行首左侧。
    waitForScrollSettle(() => {
      if (gen !== jumpGen) return
      let anchorLeft = 0
      let anchorTop = 0
      let anchorRight = 0
      const img = row!.querySelector<HTMLElement>(':scope > .dsh-gc-avatarwrap .dsh-gc-avatar')
      if (img) {
        const r = img.getBoundingClientRect()
        if (r.width > 0 && r.top >= 8 && r.bottom <= window.innerHeight - 8) {
          anchorLeft = r.left
          anchorTop = r.top
          anchorRight = r.right
        }
      }
      if (anchorLeft === 0 && anchorTop === 0) {
        // 行首锚点视为零宽点：right 取左缘，翻转展开由边界钳制兜底。
        const rr = row!.getBoundingClientRect()
        anchorLeft = rr.left
        anchorTop = rr.top
        anchorRight = rr.left
      }
      panelAnimPending = true
      lastAvatarRect = { left: anchorLeft, top: anchorTop, right: anchorRight }
      notify()
    })
  }

  const PANEL_W = 300
  // 左侧展开优先（与直接点击头像的几何一致）；空间不足（如顶部 sticky 头像贴着屏幕左缘）
  // 时翻转到锚点右侧 8px 处展开，消除吸附后的水平偏移与遮挡。
  let left = lastAvatarRect.left - PANEL_W - 8
  if (left < 8) {
    const anchorRight = lastAvatarRect.right > lastAvatarRect.left ? lastAvatarRect.right : lastAvatarRect.left + 24
    left = anchorRight + 8
  }
  left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8))
  // 垂直边界：用实测面板高度钳制，保证完整可见。
  const maxTop = Math.max(8, window.innerHeight - panelH - 8)
  let top = Math.max(8, Math.min(lastAvatarRect.top, maxTop))
  // 避让顶部 sticky 头像：面板与其相交时下移到头像下方（放不下则上移到其上方），
  // 杜绝面板压住自动生成的顶部头像。
  const sticky = document.querySelector<HTMLElement>('.dsh-gc-sticky')
  if (sticky && sticky.style.display !== 'none') {
    const sr = sticky.getBoundingClientRect()
    if (sr.width > 0 && sr.height > 0) {
      const intersects = left < sr.right + 4 && left + PANEL_W > sr.left - 4 && top < sr.bottom + 4 && top + panelH > sr.top - 4
      if (intersects) {
        const below = sr.bottom + 8
        const above = sr.top - panelH - 8
        if (below + panelH <= window.innerHeight - 8) top = Math.max(8, below)
        else if (above >= 8) top = above
      }
    }
  }
  // 仅跳转重吸附时播放平移动画；打开瞬间瞬时定位。
  const anim = panelAnimPending ? 'left 0.26s ease, top 0.26s ease' : 'none'

  useEffect(() => {
    const el = panelRef.current
    if (el && el.offsetHeight > 100) panelH = el.offsetHeight
    if (!panelAnimPending) return
    const t = window.setTimeout(() => { panelAnimPending = false }, 320)
    return () => window.clearTimeout(t)
  })

  // 回到顶部：滚动容器置顶（全量历史已加载时即最早消息）；容器缺失回退首行定位。
  const scrollToTop = (): void => {
    const sc = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (sc) {
      sc.scrollTop = 0
      return
    }
    const first = document.querySelector('[data-chat-flow-kind]')
    if (first) first.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return h('div', { ref: panelRef, className: 'dsh-gc-history', style: { left: left + 'px', top: top + 'px', transition: anim } },
    h('div', { className: 'dsh-gc-history-topbar' },
      h('button', { className: 'dsh-gc-top-btn', onClick: scrollToTop, title: '定位到会话最顶部' }, '回到顶部'),
    ),
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
        },
        h('span', { className: 'dsh-gc-hist-no' }, '#' + (it.round > 0 ? it.round : '?')),
        it.text)),
    ),
  )
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'export' | 'ai'>('export')
  const doUninstall = (): void => {
    if (!window.confirm('卸载 GreaterClarity？\n将清除全部设置与上传的头像，插件随即停用（重启后仍保持停用）。')) return
    fetchJson('/uninstall', { method: 'POST', body: '{}' })
      .then((d) => {
        if (d && d.ok) {
          settings.plugin.enabled = false
          onClose()
          notify()
          window.alert('已清除本地数据并停用插件。\n如需从 profile 彻底移除，请在终端运行：\ndsh plugin --profile web remove ' + ((d && d.pkg) || '@dsh-external/dsh-greater-clarity'))
        } else {
          window.alert('卸载失败：' + ((d && d.error) || '未知错误'))
        }
      })
      .catch((e) => window.alert('卸载失败：' + String(e)))
  }
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
      h('div', { className: 'dsh-gc-modal-foot' },
        h('span', { className: 'dsh-gc-hint' }, '彻底移除：dsh plugin --profile web remove @dsh-external/dsh-greater-clarity'),
        h('button', { className: 'dsh-gc-danger', onClick: doUninstall }, '卸载插件…'),
      ),
    ),
  )
}

/**
 * 导出按钮：订阅会话快照，点击时优先本地直出（毫秒级），
 * 快照缺失/构建异常时回退服务端路径。
 */
function ExportButton({ sessionId, useSession, busy }: { sessionId?: string; useSession: any; busy: boolean }) {
  const snapshot = useSession((s: any) => s)
  // 常驻订阅快照：每次变化刷新 key→轮次 映射（历史窗口序号与头像标签的数据源）。
  useEffect(() => { rebuildRoundMap(snapshot) }, [snapshot])
  const onClick = (): void => {
    if (!sessionId || busyExport) return
    busyExport = true
    notify()
    try {
      const direct = snapshotToMarkdown(snapshot, Date.now())
      if (direct) {
        triggerDownload(direct.markdown, direct.filename)
        busyExport = false
        notify()
        return
      }
    } catch {
      // 快照结构不符合预期 → 服务端兜底
    }
    exportViaServer(sessionId)
  }
  return h('button', {
    className: 'dsh-gc-btn',
    onClick,
    disabled: !sessionId || busy,
    title: '导出 Markdown',
  }, busy ? '导出中…' : '导出')
}

function Buttons({ sessionId, useSession }: { sessionId?: string; useSession?: any }) {
  const store = useStore()
  const folded = store.foldGlobal === 'folded'
  const enabled = store.settings.plugin.enabled !== false

  // 停用态：只保留「启用」入口，其余功能与 DOM 层全部下线。
  if (!enabled) {
    return h('div', { className: 'dsh-gc-btns' },
      h('button', {
        className: 'dsh-gc-btn',
        onClick: () => saveSettings({ plugin: { enabled: true } }),
        title: '重新启用 GreaterClarity',
      }, '启用'),
    )
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
        ? (useSession
          ? h(ExportButton, { sessionId, useSession, busy: store.busyExport })
          : h('button', {
            className: 'dsh-gc-btn',
            onClick: () => exportViaServer(sessionId),
            disabled: !sessionId || store.busyExport,
            title: '导出 Markdown',
          }, store.busyExport ? '导出中…' : '导出'))
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
  // 1) 注入样式（停用态的「启用」入口按钮仍需要）
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'dsh-greater-clarity'
    style.textContent = STYLES
    document.head.appendChild(style)
    return () => { style.remove() }
  })

  // 2) DOM 层随「启用」开关动态装卸；插件卸载时兜底停层
  ctx.effect(() => () => stopLayer())
  const sync = (): void => {
    if (settings.plugin.enabled) {
      startLayer()
      scheduleProcessRows()
    } else {
      stopLayer()
    }
  }
  layerSync = sync

  // 3) 注册按钮到会话头部 utilities（停用时仅渲染「启用」入口）
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-greater-clarity',
    order: 100,
  }, Buttons))

  // 4) 加载设置并同步层状态（默认 enabled=true 时立即激活，响应到达后按实际状态校正）
  loadSettings()
  sync()
}
