/**
 * 头像 + 折叠 DOM 层：MutationObserver 驱动的增量装饰层。
 * 随「启用」开关动态装卸；停用时仅保留会话头部的「启用」入口。
 * 轮次映射缓存也在此持有（头像标签的数据源）。
 */
import { API, getSettings, getAvatarVersion, getClientCtx } from './state.js'
import { clampSize } from '../pure/settings-spec.js'
import { buildRoundMap } from '../pure/rounds.js'

const BOUNDARY_KINDS = new Set(['user', 'steering'])
const AVATAR_ROW_SELECTOR = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]'
let observer: MutationObserver | null = null
let processTimer: number | null = null
let layerActive = false

// ── 轮次映射：由 pure/rounds.buildRoundMap 计算（A 语义），此处仅持有缓存 ──
// 依据 DSH 源码事实：仅开启新轮的输入是 kind==='user'，运行期插入的追问一律是
// 'steering'——harness 场景下占多数，若仅对 user 计数会导致几乎全部同号。
let roundByNodeKey: Map<string, number> = new Map()

export function refreshRoundMap(snapshot: any): void {
  roundByNodeKey = buildRoundMap(snapshot)
}

// 当前会话 id（Buttons 注入）：DOM 层自持刷新轮次映射的数据源，
// 不依赖任何 React 组件的渲染副作用。
let activeSessionId = ''
export function setActiveSession(id: string): void {
  activeSessionId = id
}

/** 经 sessions 服务自持刷新轮次映射；快照不可用时保留旧映射。 */
function refreshRoundMapFromSession(): void {
  if (!activeSessionId) return
  try {
    const session = getClientCtx()?.sessions?.binding?.(activeSessionId)?.session
    const snap: any = typeof session?.getSnapshot === 'function' ? session.getSnapshot() : null
    if (snap) roundByNodeKey = buildRoundMap(snap)
  } catch {
    // 快照不可用时保留旧映射
  }
}

/** 头像下轮次标签文案：按行锚点 key 查映射，未知返回空串（不渲染标签）。 */
function roundLabelForRow(row: HTMLElement | null): string {
  const key = row?.getAttribute('data-chat-anchor-key') || ''
  const n = key !== '' ? roundByNodeKey.get(key) : undefined
  return n ? `第${n}轮` : ''
}

/** 节点 key → 轮次号（历史面板序号徽章用），未知返回 0。 */
export function roundForNodeKey(key: string): number {
  return roundByNodeKey.get(key) ?? 0
}

export function startLayer(): void {
  if (layerActive) return
  layerActive = true
  observer = new MutationObserver(() => {
    scheduleProcessRows()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  scheduleProcessRows()
}

export function stopLayer(): void {
  if (!layerActive) return
  layerActive = false
  if (observer) { observer.disconnect(); observer = null }
  if (processTimer !== null) { window.clearTimeout(processTimer); processTimer = null }
  clearAvatarLayer()
}

export function scheduleProcessRows(): void {
  if (processTimer !== null) return
  processTimer = window.setTimeout(() => {
    processTimer = null
    processRows()
  }, 120)
}

function processRows(): void {
  refreshRoundMapFromSession()
  ensureAvatars()
  applyFold()
}

function ensureAvatars(): void {
  const userRows = document.querySelectorAll<HTMLElement>(AVATAR_ROW_SELECTOR)
  if (!getSettings().ai.showAvatar) {
    document.querySelectorAll('.dsh-gc-avatarwrap').forEach((el) => el.remove())
    return
  }
  const size = clampSize(getSettings().ai.avatarSize)
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
    img.src = `${API}/avatar?v=${getAvatarVersion()}`
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
  const folded = getSettings().ui.foldGlobal === 'folded'
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

function clearAvatarLayer(): void {
  document.querySelectorAll('.dsh-gc-avatarwrap').forEach((el) => el.remove())
  document.querySelectorAll('[data-dsh-gc-hidden]').forEach((el) => el.removeAttribute('data-dsh-gc-hidden'))
  document.querySelectorAll('[data-dsh-gc-folded]').forEach((el) => el.removeAttribute('data-dsh-gc-folded'))
}
