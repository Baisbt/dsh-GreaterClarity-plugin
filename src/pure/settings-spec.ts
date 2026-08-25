/**
 * 设置模型单一事实源（Host 净化与 Client 合并共享同一实现，消除多触点漂移）。
 * 纯函数：无 node:/DOM 依赖。
 */
import { dateStamp, safeFilename } from './markdown.js'

export interface PluginSettings {
  enabled: boolean
}
export interface UiSettings {
  /** 思考链/工具链全局折叠状态，跨页面与跨服务重启持久。 */
  foldGlobal: 'expanded' | 'folded'
}
export interface ExportSettings {
  showButton: boolean
}
export interface AiSettings {
  showAvatar: boolean
  avatarPath: string
  avatarSize: number
  historyCount: number
}
export interface Settings {
  plugin: PluginSettings
  ui: UiSettings
  export: ExportSettings
  ai: AiSettings
}

export const AVATAR_MIN = 16
export const AVATAR_MAX = 128
export const HISTORY_COUNT_MIN = 5
export const HISTORY_COUNT_MAX = 30

export const DEFAULT_SETTINGS: Settings = {
  plugin: { enabled: true },
  ui: { foldGlobal: 'expanded' },
  export: { showButton: true },
  ai: { showAvatar: true, avatarPath: '', avatarSize: 32, historyCount: 10 },
}

export function clampSize(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.ai.avatarSize
  return Math.min(AVATAR_MAX, Math.max(AVATAR_MIN, Math.round(num)))
}

export function clampHistoryCount(n: unknown): number {
  const num = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(num)) return DEFAULT_SETTINGS.ai.historyCount
  return Math.min(HISTORY_COUNT_MAX, Math.max(HISTORY_COUNT_MIN, Math.round(num)))
}

/**
 * 逐字段类型净化（Host POST 权威路径）：非法类型回落 current，可调数值统一 clamp。
 * 纯函数：不落盘、不触副作用。
 */
export function sanitizeSettings(patch: unknown, current: Settings): Settings {
  const p = patch && typeof patch === 'object' ? (patch as Record<string, any>) : {}
  const plgIn = p.plugin && typeof p.plugin === 'object' ? p.plugin : {}
  const uiIn = p.ui && typeof p.ui === 'object' ? p.ui : {}
  const expIn = p.export && typeof p.export === 'object' ? p.export : {}
  const aiIn = p.ai && typeof p.ai === 'object' ? p.ai : {}
  return {
    plugin: {
      enabled: typeof plgIn.enabled === 'boolean' ? plgIn.enabled : current.plugin.enabled,
    },
    ui: {
      foldGlobal: uiIn.foldGlobal === 'folded' || uiIn.foldGlobal === 'expanded' ? uiIn.foldGlobal : current.ui.foldGlobal,
    },
    export: {
      showButton: typeof expIn.showButton === 'boolean' ? expIn.showButton : current.export.showButton,
    },
    ai: {
      showAvatar: typeof aiIn.showAvatar === 'boolean' ? aiIn.showAvatar : current.ai.showAvatar,
      avatarPath: typeof aiIn.avatarPath === 'string' ? aiIn.avatarPath : current.ai.avatarPath,
      avatarSize: 'avatarSize' in aiIn ? clampSize(aiIn.avatarSize) : current.ai.avatarSize,
      historyCount: 'historyCount' in aiIn ? clampHistoryCount(aiIn.historyCount) : current.ai.historyCount,
    },
  }
}

/** 客户端设置合并：按节浅合并（信任宿主返回的完整结构）。 */
export function mergeSettings(base: Settings, incoming: unknown): Settings {
  const inc = incoming && typeof incoming === 'object' ? (incoming as Record<string, any>) : {}
  return {
    plugin: { ...base.plugin, ...(inc.plugin ?? {}) },
    ui: { ...base.ui, ...(inc.ui ?? {}) },
    export: { ...base.export, ...(inc.export ?? {}) },
    ai: { ...base.ai, ...(inc.ai ?? {}) },
  }
}

/** 导出文件名：[未加载完全历史对话_]日期_标题.md（日期点分、按客户端时区）。 */
export function exportFilename(opts: { partial: boolean; now: number; tzOffsetMin: number; title: string }): string {
  const prefix = opts.partial ? '未加载完全历史对话_' : ''
  return prefix + dateStamp(opts.now, opts.tzOffsetMin) + '_' + safeFilename(opts.title)
}

export { safeFilename, dateStamp }
