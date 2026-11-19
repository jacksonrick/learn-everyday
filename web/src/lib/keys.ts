import { useEffect, useRef } from 'react'

/**
 * 键盘层的公共部分：把物理按键归一到逻辑键名，再交给各页面注册的动作表。
 *
 * 只认 e.code 不认 e.key —— 中文输入法打开时，字母键的 key 会变成 'Process'，
 * 只有 code 能稳定拿到 KeyA / Digit1。组合输入（isComposing / keyCode 229）整体忽略。
 *
 * 键名约定（与提示条上写的一致）：
 *   a~z · 0~9 · enter · space · esc · backspace · dot · minus · slash · colon · question
 */

export type KeyAction = () => void
export type KeyMap = Record<string, KeyAction>

const CODE_ALIAS: Record<string, string> = {
  Enter: 'enter',
  NumpadEnter: 'enter',
  Space: 'space',
  Escape: 'esc',
  Backspace: 'backspace',
  Tab: 'tab',
  Period: 'dot',
  NumpadDecimal: 'dot',
  Minus: 'minus',
  NumpadSubtract: 'minus',
  Slash: 'slash',
  NumpadDivide: 'slash',
  Semicolon: 'colon',
}

/** 物理按键 → 逻辑键名；不认识的键返回 null（交回浏览器默认行为） */
export function keyOf(e: KeyboardEvent): string | null {
  if (e.isComposing || e.keyCode === 229) return null
  const code = e.code || ''
  if (code.length === 4 && code.startsWith('Key')) return code.slice(3).toLowerCase()
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return code.slice(6)
  // 输入法或老浏览器不给 code：单字符键退到 key
  if (!code && e.key.length === 1) return e.key.toLowerCase()
  // Shift + / 是「?」，用来唤出快捷键面板
  if (code === 'Slash' && e.shiftKey) return 'question'
  return CODE_ALIAS[code] ?? null
}

/** 光标在输入框里：除了 Esc，其余键都该交给输入法 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}

/* ---------------------------------------------------------------- 键盘锁 */

let locks = 0

/**
 * 临时锁住快捷键（非学习时段的全屏遮罩、快捷键面板）。
 *
 * 用计数而不是布尔：遮罩和面板可能同时存在，先释放的那个不能把另一个的锁一起解掉，
 * 否则孩子可以隔着「休息时间」的遮罩把题做了。
 */
export function acquireKeyboardLock(): () => void {
  locks += 1
  document.body.dataset.kbLock = '1'
  let released = false
  return () => {
    if (released) return
    released = true
    locks = Math.max(0, locks - 1)
    if (locks === 0) delete document.body.dataset.kbLock
  }
}

export function isKeyboardLocked() {
  return typeof document !== 'undefined' && document.body.dataset.kbLock === '1'
}

/* ---------------------------------------------------------------- 注册动作 */

type Options = {
  enabled?: boolean
  /** 自己就是锁的持有者（快捷键面板要用 Esc 关自己） */
  bypassLock?: boolean
}

export function useHotkeys(map: KeyMap, options: Options = {}) {
  const ref = useRef(map)
  ref.current = map
  const enabled = options.enabled ?? true
  const bypass = options.bypassLock ?? false

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      // 长按会连发：数字键会被刷成 111，一律只认第一次
      if (e.repeat || e.isComposing || e.keyCode === 229) return
      // 带修饰键的组合留给全局快捷键（Ctrl+1 切科目）
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (!bypass && isKeyboardLocked()) return

      const key = keyOf(e)
      if (!key) return
      const action = ref.current[key]
      if (!action) return
      // 输入框里只放行 Esc：Enter 由输入框自己的 onKeyDown 处理，避免提交两遍
      if (isTypingTarget(e.target) && key !== 'esc') return

      // capture 阶段就拦下来：否则焦点在按钮上时 Space 会再触发一次 click
      e.preventDefault()
      e.stopPropagation()
      action()
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled, bypass])
}
