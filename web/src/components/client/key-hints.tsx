import { useEffect, type ReactNode } from 'react'
import { Keyboard, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { acquireKeyboardLock, useHotkeys } from '@/lib/keys'

/** 键帽。用 currentColor 派生，放在主色按钮上和白卡片上都能看清 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'ml-1 inline-flex min-w-[1.4rem] items-center justify-center rounded-[5px] border border-black/15 bg-black/5 px-1 py-[1px] font-sans text-[11px] font-normal leading-[1.4] tracking-normal',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

export type KeyHint = { keys: string | string[]; label: string }

/** 常驻在题底的按键提示条：孩子不知道有快捷键，等于没做 */
export function KeyHints({ hints, className }: { hints: KeyHint[]; className?: string }) {
  if (!hints.length) return null
  return (
    <div
      className={cn(
        'mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground',
        className,
      )}
    >
      {hints.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-1">
          {(Array.isArray(hint.keys) ? hint.keys : [hint.keys]).map((k) => (
            <Kbd key={k} className="ml-0">
              {k}
            </Kbd>
          ))}
          <span>{hint.label}</span>
        </span>
      ))}
    </div>
  )
}

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: '切换页面',
    rows: [
      ['Ctrl + 1 / 2 / 3', '语文 · 数学 · 英语'],
      ['Ctrl + 0', '回到今日'],
      ['Ctrl + 4', '我的 · 错题本'],
      ['?', '打开这张表'],
    ],
  },
  {
    title: '朗读 / 认读卡',
    rows: [
      ['Space', '下一个（跟读满 20 秒）'],
      ['R', '再听一遍'],
      ['1 ~ 9', '播放音标例词'],
    ],
  },
  {
    title: '选择题',
    rows: [
      ['1 ~ 6', '选第 n 项，立即提交'],
      ['R', '再听一遍题干'],
      ['Enter / Space', '答完看下一题'],
      ['L', '答错后听一遍正确答案'],
    ],
  },
  {
    title: '组句题',
    rows: [
      ['1 ~ 0', '按顺序选单词'],
      ['Backspace', '撤销一个'],
      ['Enter', '确认提交'],
    ],
  },
  {
    title: '计算题',
    rows: [
      ['0-9  .  -  /  :', '输入答案（/ 分数线、: 比号）'],
      ['Backspace', '删一位'],
      ['Esc', '清空'],
      ['Enter', '提交'],
    ],
  },
  {
    title: '古诗背诵',
    rows: [
      ['1 / 2', '听读 / 背诵'],
      ['Space', '开始录音 · 再按一次结束'],
      ['Space（录完）', '重录'],
      ['Enter', '提交（录音中按 = 先结束）'],
    ],
  },
]

/** 快捷键总表：`?` 唤出，Esc 或点右上角关闭 */
export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  useHotkeys({ esc: onClose, question: onClose }, { enabled: open, bypassLock: true })

  useEffect(() => {
    if (!open) return
    return acquireKeyboardLock()
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-3xl border border-line/70 bg-paper-card p-6 shadow-warm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-persimmon-deep" />
            <h2 className="font-round text-lg font-semibold">键盘就能做完今天的题</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-soft transition hover:bg-paper-deep"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-xs font-medium text-persimmon-deep">{group.title}</h3>
              <dl className="divide-y divide-line/50 overflow-hidden rounded-2xl border border-line/60 bg-white/60">
                {group.rows.map(([keys, label]) => (
                  <div key={keys + label} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <dt className="w-[8.5rem] shrink-0 font-num text-xs text-ink">{keys}</dt>
                    <dd className="text-ink-soft">{label}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="mt-4 text-center text-xs text-ink-soft">
          按 <Kbd>?</Kbd> 随时再看，<Kbd>Esc</Kbd> 关掉
        </p>
      </div>
    </div>
  )
}
