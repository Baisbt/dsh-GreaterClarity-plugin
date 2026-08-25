/**
 * Client 半共享状态、宿主通信（fetchJson）与设置同步。
 * 全部可变状态私有于本模块，外部经 getter/setter 访问；notify 同时驱动 layerSync。
 */
import { DEFAULT_SETTINGS, mergeSettings, type Settings } from '../pure/settings-spec.js'

export const API = '/dsh-greater-clarity'
export const JUMP_TOP_PAD = 12 // 跳转后行首距滚动容器顶部的留白

let settings: Settings = mergeSettings(DEFAULT_SETTINGS, {})
let foldGlobal: 'expanded' | 'folded' = 'expanded'
let settingsOpen = false
let busyExport = false
let avatarVersion = 0
let historyOpen = false
let panelH = 320 // 实测面板高度缓存（渲染后测量，用于边界钳制）
let clientCtx: any = null

const listeners = new Set<() => void>()
// 层同步钩子：由 apply 注册，使每次状态刷新都把 DOM 层对齐到 enabled 开关。
let layerSync: (() => void) | null = null

export function notify(): void {
  listeners.forEach((fn) => fn())
  if (layerSync) layerSync()
}

/** React 订阅：任一状态变化即强制重渲染订阅组件。 */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function setLayerSync(fn: (() => void) | null): void { layerSync = fn }

export function getSettings(): Settings { return settings }
export function updateSettings(fn: (s: Settings) => Settings): void { settings = fn(settings) }
export function getFold(): 'expanded' | 'folded' { return foldGlobal }
export function setFold(v: 'expanded' | 'folded'): void { foldGlobal = v }
export function getSettingsOpen(): boolean { return settingsOpen }
export function setSettingsOpen(v: boolean): void { settingsOpen = v }
export function getBusyExport(): boolean { return busyExport }
export function setBusyExport(v: boolean): void { busyExport = v }
export function getHistoryOpen(): boolean { return historyOpen }
export function setHistoryOpen(v: boolean): void { historyOpen = v }
export function getAvatarVersion(): number { return avatarVersion }
export function bumpAvatarVersion(): void { avatarVersion += 1 }
export function getPanelH(): number { return panelH }
export function setPanelH(v: number): void { panelH = v }
export function getClientCtx(): any { return clientCtx }
export function setClientCtx(ctx: any): void { clientCtx = ctx }

export function fetchJson(path: string, init?: RequestInit): Promise<any> {
  return fetch(API + path, {
    headers: { 'content-type': 'application/json' },
    ...init,
  }).then((r) => r.json())
}

export function loadSettings(): void {
  fetchJson('/settings')
    .then((d) => {
      if (d && d.ok && d.settings) {
        settings = mergeSettings(settings, d.settings)
        // 还原持久化的全局折叠状态（跨页面/服务重启）。
        foldGlobal = settings.ui.foldGlobal === 'folded' ? 'folded' : 'expanded'
        notify()
      }
    })
    .catch(() => {})
}

export function saveSettings(patch: Partial<Settings>): void {
  settings = mergeSettings(settings, patch)
  notify()
  fetchJson('/settings', { method: 'POST', body: JSON.stringify(patch) })
    .then((d) => {
      if (d && d.ok && d.settings) {
        settings = mergeSettings(settings, d.settings)
        notify()
      }
    })
    .catch(() => {})
}
