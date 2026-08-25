/**
 * 历史快速定位面板：用户输入记录列表（轮次徽章/搜索/跳转/回到顶部）。
 * 持续悬停：仅随「历史」按钮 toggle 开/关。位置锚定在按钮正下方。
 */
import { createElement as h, useState, useEffect, useRef, useMemo } from 'react'
import { getSettings, getPanelH, setPanelH, JUMP_TOP_PAD, notify } from './state.js'
import { clampHistoryCount } from '../pure/settings-spec.js'
import { userNodeText } from '../pure/rounds.js'
import { roundForNodeKey } from './dom-layer.js'

export function HistoryPanel({ anchorRef, useSession, onClose }: { anchorRef: { current: HTMLButtonElement | null }; useSession: any; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const snapshot = useSession((s: any) => s)
  const hasMore = useSession((s: any) => !!s?.hasMore)
  const items = useMemo(() => {
    const list: { key: string; text: string; round: number }[] = []
    if (!snapshot) return list
    const chat = snapshot.chat
    const order = chat && Array.isArray(chat.order) ? chat.order : []
    const nodes = chat && chat.nodes ? chat.nodes : null
    for (const key of order) {
      const node = nodes ? (nodes.get ? nodes.get(key) : undefined) : undefined
      if (node && (node.kind === 'user' || node.kind === 'steering')) {
        const text = userNodeText(node)
        if (text.trim() !== '') list.push({ key, text, round: roundForNodeKey(key) })
      }
    }
    return list
  }, [snapshot])

  const q = query.trim().toLowerCase()
  const filtered = q === '' ? items : items.filter((it) => it.text.toLowerCase().includes(q))
  const rowH = 30
  const n = clampHistoryCount(getSettings().ai.historyCount)
  const listHeight = Math.max(5, Math.min(n, filtered.length || 1)) * rowH

  // 面板持续悬停：不随点击外部关闭，仅随「历史」按钮 toggle 开/关。

  // 跳转定位到输入第一行：行顶对齐滚动容器顶部下方少许，长输入不再垂直居中。
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
    const container = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (container) {
      const cTop = container.getBoundingClientRect().top
      const rTop = row.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + (rTop - cTop) - JUMP_TOP_PAD, behavior: 'smooth' })
    } else {
      row.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  const PANEL_W = 300
  // 位置：锚定在「历史」按钮正下方（左缘对齐按钮左缘，顶 = 按钮底 + 8），越界钳制在屏幕内。
  const br = anchorRef.current ? anchorRef.current.getBoundingClientRect() : null
  let left = br ? br.left : 8
  let top = br ? br.bottom + 8 : 60
  left = Math.max(8, Math.min(left, window.innerWidth - PANEL_W - 8))
  top = Math.max(8, Math.min(top, window.innerHeight - getPanelH() - 8))

  useEffect(() => {
    const el = panelRef.current
    if (el && el.offsetHeight > 100) setPanelH(el.offsetHeight)
  })

  // 窗口缩放/屏幕变更时重算按钮锚定位置（面板随渲染即时校正）。
  useEffect(() => {
    const onResize = (): void => { notify() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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

  return h('div', { ref: panelRef, className: 'dsh-gc-history', style: { left: left + 'px', top: top + 'px' } },
    h('div', { className: 'dsh-gc-history-topbar' },
      h('button', { className: 'dsh-gc-top-btn', onClick: scrollToTop, title: '定位到会话最顶部' }, '回到顶部'),
      hasMore ? h('span', { className: 'dsh-gc-history-hint' }, '历史未加载完全') : null,
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
        h('span', { className: 'dsh-gc-hist-no' }, it.round > 0 ? `第${it.round}轮` : '第?轮'),
        it.text)),
    ),
  )
}
