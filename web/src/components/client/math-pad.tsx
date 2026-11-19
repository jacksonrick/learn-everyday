import { Delete } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from './key-hints'

/**
 * 数学答案的输入规则，打卡页与错题订正共用一份，别各写一套：
 * 小数点 / 分数线 / 比号各自只出现一次（六年级 fraction_* 出 `3/4`、ratio_simplify 出 `3:4`），
 * 负号只贴在最前面。
 */
export function applyMathKey(prev: string, ch: string) {
  if (ch === '.' || ch === '/' || ch === ':') {
    if (!prev || prev.includes(ch)) return prev
    return prev + ch
  }
  if (ch === '-') return prev.startsWith('-') ? prev : `-${prev}`
  return prev + ch
}

/**
 * 数字键盘：4 列布局（1-9 + 删除 / 分数线 / 比号 + 点 / 0）。
 * 手机上不可能弹系统数字键盘给 `3/4` 这种答案，桌面端孩子也更愿意点大按钮。
 */
export function MathPad({
  value,
  onChange,
  onSubmit,
  unit,
  disabled,
  busy,
  submitLabel = '确认答案',
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  unit?: string
  disabled?: boolean
  busy?: boolean
  submitLabel?: string
}) {
  const append = (ch: string) => onChange(applyMathKey(value, ch))

  return (
    <div className="space-y-4">
      <div className="flex h-16 items-center justify-center rounded-2xl border-2 border-border bg-card text-3xl font-medium tracking-wide">
        {value || <span className="text-base text-muted-foreground">输入答案</span>}
        {unit ? <span className="ml-1 text-lg text-muted-foreground">{unit}</span> : null}
      </div>

      <div className="grid grid-cols-4 gap-2">
        {['1', '2', '3'].map((k) => (
          <button key={k} className="num-pad-btn" disabled={disabled} onClick={() => append(k)}>
            {k}
          </button>
        ))}
        <button
          className="num-pad-btn"
          disabled={disabled}
          onClick={() => onChange(value.slice(0, -1))}
          aria-label="删除"
        >
          <Delete className="h-5 w-5 text-muted-foreground" />
        </button>

        {['4', '5', '6'].map((k) => (
          <button key={k} className="num-pad-btn" disabled={disabled} onClick={() => append(k)}>
            {k}
          </button>
        ))}
        <button
          className="num-pad-btn text-muted-foreground"
          disabled={disabled}
          onClick={() => append('/')}
          aria-label="分数线"
        >
          /
        </button>

        {['7', '8', '9'].map((k) => (
          <button key={k} className="num-pad-btn" disabled={disabled} onClick={() => append(k)}>
            {k}
          </button>
        ))}
        <button
          className="num-pad-btn text-muted-foreground"
          disabled={disabled}
          onClick={() => append(':')}
          aria-label="比号"
        >
          :
        </button>

        <button className="num-pad-btn col-span-2" disabled={disabled} onClick={() => append('.')}>
          .
        </button>
        <button className="num-pad-btn col-span-2" disabled={disabled} onClick={() => append('0')}>
          0
        </button>
      </div>

      <Button size="xl" className="w-full" disabled={!value || disabled || busy} onClick={onSubmit}>
        {submitLabel}
        <Kbd>Enter</Kbd>
      </Button>
    </div>
  )
}
