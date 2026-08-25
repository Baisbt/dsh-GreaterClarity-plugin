/**
 * dsh-greater-clarity —— Client 半入口。
 * 职责：插件生命周期（样式注入/DOM 层装卸/slot 注册/设置加载）。
 * 各功能模块：state.ts（状态）/ styles.ts / dom-layer.ts / export-panel.ts /
 * history-panel.ts / settings-modal.ts / buttons.ts；纯逻辑在 src/pure/*。
 */
import { setClientCtx, setLayerSync, getSettings, loadSettings, notify } from './state.js'
import { startLayer, stopLayer, scheduleProcessRows } from './dom-layer.js'
import { STYLES } from './styles.js'
import { Buttons } from './buttons.js'

export const inject = ['slots']

export function apply(ctx: any): void {
  // 0) 捕获客户端 ctx（导出标题/会话服务等经此访问）
  setClientCtx(ctx)

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
  setLayerSync(() => {
    if (getSettings().plugin.enabled) {
      startLayer()
      scheduleProcessRows()
    } else {
      stopLayer()
    }
  })

  // 3) 注册按钮到会话头部 utilities（停用时仅渲染「启用」入口）
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-greater-clarity',
    order: 100,
  }, Buttons))

  // 4) 加载设置并同步层状态（默认 enabled=true 时立即激活，响应到达后按实际状态校正）
  loadSettings()
  notify()
}
