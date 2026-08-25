/**
 * 会话头部按钮区：折叠/导出/历史/设置（停用时仅渲染「启用」入口）。
 */
import { createElement as h, useEffect, useRef, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from './use-store.js'
import { saveSettings, notify, getFold, setFold, setSettingsOpen, setHistoryOpen, getHistoryOpen } from './state.js'
import { scheduleProcessRows, setActiveSession } from './dom-layer.js'
import { ExportButton, exportViaServer } from './export-panel.js'
import { HistoryPanel } from './history-panel.js'
import { SettingsModal } from './settings-modal.js'

function toggleGlobalFold(): void {
  const next = getFold() === 'folded' ? 'expanded' : 'folded'
  setFold(next)
  // 持久化全局折叠状态（跨页面/服务重启还原）。
  saveSettings({ ui: { foldGlobal: next } })
  notify()
  scheduleProcessRows()
}

export function Buttons({ sessionId, useSession }: { sessionId?: string; useSession?: any }) {
  const store = useStore()
  const folded = store.foldGlobal === 'folded'
  const enabled = store.settings.plugin.enabled !== false
  const historyBtnRef = useRef<HTMLButtonElement | null>(null)

  // 当前会话 id 注入 DOM 层：轮次映射由 DOM 层自持刷新（不依赖 React 渲染副作用）。
  useEffect(() => { setActiveSession(sessionId ?? '') }, [sessionId])

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
    setSettingsOpen(true)
    notify()
  }

  const toggleHistory = (): void => {
    setHistoryOpen(!getHistoryOpen())
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
            onClick: () => exportViaServer(sessionId, false),
            disabled: !sessionId || store.busyExport,
            title: '导出 Markdown',
          }, store.busyExport ? '导出中…' : '导出'))
        : null,
      h('button', {
        ref: historyBtnRef,
        className: 'dsh-gc-btn dsh-gc-history-btn',
        onClick: toggleHistory,
        title: '历史记录快速定位',
        'aria-pressed': store.historyOpen,
      }, '历史'),
      h('button', { className: 'dsh-gc-btn', onClick: openSettings, title: '设置' }, '设置'),
    ),
    store.settingsOpen
      ? createPortal(h(SettingsModal, { onClose: () => { setSettingsOpen(false); notify() } }), document.body)
      : null,
    store.historyOpen && useSession
      ? createPortal(h(HistoryPanel, { anchorRef: historyBtnRef, useSession, onClose: () => { setHistoryOpen(false); notify() } }), document.body)
      : null,
  )
}
