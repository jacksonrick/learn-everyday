import * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  value?: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  id?: string
  className?: string
  /** 单个标签最大长度，超出直接拒绝，避免误粘贴整段文字 */
  maxLength?: number
}

const SEPARATORS = /[,，、;；\n\r\t]+/

/**
 * 标签输入：回车或逗号生成一个标签，Backspace 删最后一个，点 × 删除。
 * 直接粘贴「早晨,清晨」会一次拆成多个标签。
 */
export function TagInput({ value, onChange, placeholder, id, className, maxLength = 20 }: Props) {
  const tags = React.useMemo(() => (Array.isArray(value) ? value : []), [value])
  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  const commit = (raw: string) => {
    const parts = raw
      .split(SEPARATORS)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (maxLength > 0 ? s.slice(0, maxLength) : s))
    if (!parts.length) {
      setDraft('')
      return
    }
    const next = [...tags]
    parts.forEach((p) => {
      if (next.includes(p)) return
      // 已存在则不重复添加，但把草稿清掉，避免用户以为没生效
      next.push(p)
    })
    onChange(next)
    setDraft('')
  }

  const remove = (index: number) => {
    const next = tags.filter((_, i) => i !== index)
    onChange(next)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(draft)
      return
    }
    if (e.key === 'Backspace' && !draft && tags.length) {
      e.preventDefault()
      onChange(tags.slice(0, -1))
      return
    }
    if (e.key === 'Escape') {
      // 只清掉当前草稿，不要把弹窗关掉
      if (draft) {
        e.stopPropagation()
        setDraft('')
      }
    }
  }

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text')
    if (!SEPARATORS.test(text)) return
    e.preventDefault()
    commit(`${draft}${text}`)
  }

  return (
    <div
      className={cn(
        'flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1.5 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
        className,
      )}
      onMouseDown={(e) => {
        // 点在容器空白处时把焦点交给输入框
        if (e.target === e.currentTarget) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="inline-flex max-w-full items-center gap-1 rounded-lg bg-muted px-2 py-1 leading-none text-foreground"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            onClick={() => remove(i)}
            className="shrink-0 rounded text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`删除 ${tag}`}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          // 输入逗号即视为分隔符，直接落成标签
          if (SEPARATORS.test(v)) commit(v)
          else setDraft(v)
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => commit(draft)}
        placeholder={tags.length ? '' : placeholder}
        className="h-7 min-w-[72px] flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground/70"
      />
    </div>
  )
}
