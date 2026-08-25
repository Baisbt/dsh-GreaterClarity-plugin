/** React 订阅钩子：任一状态通道变化即强制重渲染订阅组件。 */
import { useState, useEffect, useRef } from 'react'
import { subscribe, getSettings, getFold, getSettingsOpen, getBusyExport, getHistoryOpen, type Settings } from './state.js'

export function useStore(): { settings: Settings; foldGlobal: 'expanded' | 'folded'; settingsOpen: boolean; busyExport: boolean; historyOpen: boolean } {
  const [, force] = useState(0)
  const forceRef = useRef<() => void>(() => {})
  forceRef.current = () => { force((n) => n + 1) }
  useEffect(() => subscribe(() => { forceRef.current() }), [])
  return { settings: getSettings(), foldGlobal: getFold(), settingsOpen: getSettingsOpen(), busyExport: getBusyExport(), historyOpen: getHistoryOpen() }
}
