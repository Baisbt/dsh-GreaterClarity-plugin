/**
 * 设置弹窗：插件总开关、导出按钮显隐、AI 头像设置、一键软卸载。
 */
import { createElement as h, useState, useRef } from 'react'
import { useStore } from './use-store.js'
import { saveSettings, updateSettings, notify, fetchJson, bumpAvatarVersion } from './state.js'
import { clampHistoryCount, clampSize } from '../pure/settings-spec.js'

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
        onChange: (v) => saveSettings({ export: { showButton: v } }),
      }),
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
            bumpAvatarVersion()
            notify()
          }
        })
        .catch(() => {})
    }
    reader.readAsDataURL(file)
  }
  const commitSize = (v: number): void => {
    saveSettings({ ai: { ...s.ai, avatarSize: clampSize(v) } })
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
        value: clampSize(s.ai.avatarSize),
        onChange: (e: any) => commitSize(Number(e.target.value)),
      }),
      h('input', {
        className: 'dsh-gc-num', type: 'number', min: 16, max: 128, step: 1,
        value: clampSize(s.ai.avatarSize),
        onChange: (e: any) => { const v = Number(e.target.value); if (Number.isFinite(v)) commitSize(v) },
      }),
      h('span', { className: 'dsh-gc-size-val' }, clampSize(s.ai.avatarSize) + ' px'),
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

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'export' | 'ai'>('export')
  const doUninstall = (): void => {
    if (!window.confirm('卸载 GreaterClarity？\n将清除全部设置与上传的头像，插件随即停用（重启后仍保持停用）。')) return
    fetchJson('/uninstall', { method: 'POST', body: '{}' })
      .then((d) => {
        if (d && d.ok) {
          updateSettings((s) => ({ ...s, plugin: { enabled: false } }))
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
