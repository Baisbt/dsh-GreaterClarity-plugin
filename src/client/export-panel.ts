/**
 * 导出面板：客户端快照直出（主路径，零网络/磁盘往返）+ 服务端兜底。
 */
import { createElement as h } from 'react'
import { getBusyExport, setBusyExport, notify, getClientCtx, fetchJson } from './state.js'
import { exportFilename } from '../pure/settings-spec.js'
import { snapshotToMarkdown } from '../pure/rounds.js'

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
export function exportViaServer(sessionId: string | undefined, partial: boolean, title?: string): void {
  if (!sessionId || getBusyExport()) return
  setBusyExport(true)
  notify()
  fetchJson('/export', { method: 'POST', body: JSON.stringify({ sessionId, now: Date.now(), tzOffsetMin: -new Date().getTimezoneOffset(), partial, title }) })
    .then((d) => {
      if (d && d.ok && d.markdown) {
        triggerDownload(d.markdown, d.filename || '会话.md')
      } else {
        window.alert('导出失败：' + ((d && d.error) || '未知错误'))
      }
    })
    .catch((e) => { window.alert('导出失败：' + String(e)) })
    .finally(() => {
      setBusyExport(false)
      notify()
    })
}

/**
 * 导出按钮：订阅会话快照，点击时优先本地直出（毫秒级），
 * 快照缺失/构建异常时回退服务端路径。
 */
export function ExportButton({ sessionId, useSession, busy }: { sessionId?: string; useSession: any; busy: boolean }) {
  const snapshot = useSession((s: any) => s)
  const onClick = (): void => {
    if (!sessionId || getBusyExport()) return
    setBusyExport(true)
    notify()
    const partial = !!snapshot?.hasMore
    // 标题优先取侧栏工作区显示的 displayTitle（sessions 列表 store 投影）。
    let listTitle = ''
    try {
      const entry: any = sessionId && getClientCtx()?.sessions?.list?.getSnapshot?.()
        ? getClientCtx().sessions.list.getSnapshot().byId?.[sessionId]
        : null
      if (entry && typeof entry.displayTitle === 'string' && entry.displayTitle.trim() !== '') listTitle = entry.displayTitle
    } catch {
      // 列表 store 不可用时回退快照标题链
    }
    try {
      const tz = -new Date().getTimezoneOffset()
      const direct = snapshotToMarkdown(snapshot, Date.now(), tz, listTitle)
      if (direct) {
        const filename = exportFilename({ partial, now: Date.now(), tzOffsetMin: tz, title: direct.title })
        triggerDownload(direct.markdown, filename)
        setBusyExport(false)
        notify()
        return
      }
    } catch {
      // 快照结构不符合预期 → 服务端兜底
    }
    exportViaServer(sessionId, partial, listTitle)
  }
  return h('button', {
    className: 'dsh-gc-btn',
    onClick,
    disabled: !sessionId || busy,
    title: '导出 Markdown',
  }, busy ? '导出中…' : '导出')
}
