import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, RotateCcw, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import { speak, speakPhoneme, stopSpeaking, useSpeaker } from '@/lib/speech'
import { cn } from '@/lib/utils'
import { useHotkeys, type KeyMap } from '@/lib/keys'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { KeyHints, Kbd, type KeyHint } from './key-hints'
import { MathPad, applyMathKey } from './math-pad'
import type { QuizItem } from '@/lib/types'

export type Answer = { item_id: number; answer: string; duration_ms: number }

/** 朗读/认读卡的题型；服务端不判分，按空格即完成 */
const READ_TYPES = ['word_read', 'phoneme_read', 'char_read']
/** 与后端 taskgen.READ_ANSWER 保持一致 */
const READ_ANSWER = '__read__'
/** 朗读/认读卡至少停留的秒数：防止无脑按空格刷完 */
const READ_MIN_SECONDS = 20

/**
 * 朗读按钮：点下去到真正出声之间置灰转圈。
 * 后端合成本身要几百毫秒到一两秒，不锁住就会被连点出一串重复请求。
 */
function SpeakButton({
  on,
  label = '播放读音',
  className,
  iconClassName,
}: {
  on: () => void | Promise<unknown>
  label?: string
  className?: string
  iconClassName?: string
}) {
  const { pending, run } = useSpeaker()
  return (
    <button
      type="button"
      onClick={() => void run(on)}
      disabled={pending}
      aria-label={pending ? '正在准备读音' : label}
      aria-busy={pending}
      className={cn(
        'rounded-full bg-muted p-1.5 text-muted-foreground transition hover:text-primary disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      {pending ? (
        <Loader2 className={cn('h-4 w-4 animate-spin', iconClassName)} />
      ) : (
        <Volume2 className={cn('h-4 w-4', iconClassName)} />
      )}
    </button>
  )
}

/** 补全词语题的空框，跟题字一样高，摆左还是摆右由 blank 决定 */
function FillBlank() {
  return (
    <span className="flex h-[68px] w-[68px] items-center justify-center rounded-2xl border-2 border-dashed border-border text-2xl text-muted-foreground">
      ?
    </span>
  )
}

type Props = {
  subject: string
  items: QuizItem[]
  /** 之前已经做过的题数（中途退出续做），只影响题号展示 */
  doneCount?: number
  onFinish: (answers: Answer[]) => void
  onExit?: () => void
}

export function Quiz({ subject, items, doneCount = 0, onFinish, onExit }: Props) {
  const childId = useChildStore((s) => s.childId)
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const [feedback, setFeedback] = useState<{ correct: boolean; answer: string } | null>(null)
  const [busy, setBusy] = useState(false)
  // 朗读/认读卡的倒计时（秒）：到 0 才允许翻页
  const [readLeft, setReadLeft] = useState(0)
  const answers = useRef<Answer[]>([])
  const startedAt = useRef(Date.now())
  const autoNext = useRef<number | null>(null)
  // busy 的 ref 版：连续两次提交（点完接着回回车）会在同一个闭包里都通过 busy 检查
  const sending = useRef(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const item = items[index]
  const total = items.length
  const isOrder = item?.type === 'order' && Array.isArray(item?.tokens)
  const isChoice = Array.isArray(item?.options) && (item?.options as string[]).length > 0
  const isMath = item?.kind === 'math'
  // 看中文选英文：题干就是答案的译文，不能把单词、音标、读音摆出来，否则答案直接印在题目上。
  // 语文的组词题也是 word_choice，但它的题干里没有答案，照常走「大字 + 题干」的排版。
  const isWordChoice = item?.type === 'word_choice' && item?.kind === 'word'
  // 朗读/认读卡：只展示信息 + 发音，按空格进入下一张
  const isRead = READ_TYPES.includes(String(item?.type ?? ''))
  // 语文补全词语：题字 + 空框，选项是单字，答案在词里的另一头
  const isFillChar = item?.type === 'fill_char'
  // 语文看拼音选字：题干是拼音，选项是字，不能把答案字当大字摆在上面
  const isPinyinChoice = item?.type === 'pinyin_choice'

  const clearAutoNext = () => {
    if (autoNext.current !== null) {
      window.clearTimeout(autoNext.current)
      autoNext.current = null
    }
  }

  useEffect(() => {
    setValue('')
    setPicked([])
    setFeedback(null)
    clearAutoNext()
    startedAt.current = Date.now()
    if (!READ_TYPES.includes(String(item?.type ?? ''))) setReadLeft(0)
  }, [index])

  // 换题后把焦点收回答题区：焦点留在按钮上时，空格会同时触发按钮和快捷键
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true })
  }, [index])

  // 朗读/认读卡倒计时：切到下一张卡重新计时；到 0 自动停表
  useEffect(() => {
    if (!isRead) return
    const deadline = Date.now() + READ_MIN_SECONDS * 1000
    setReadLeft(READ_MIN_SECONDS)
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setReadLeft(left)
      if (left <= 0) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [index, isRead])

  useEffect(() => {
    return () => {
      clearAutoNext()
      stopSpeaking()
    }
  }, [])

  const orderText = useMemo(() => {
    if (!isOrder || !item) return ''
    const tokens = item.tokens as string[]
    return picked.map((i) => tokens[i]).join(' ')
  }, [isOrder, item, picked])

  const advance = () => {
    clearAutoNext()
    if (index + 1 >= total) {
      onFinish(answers.current)
      return
    }
    setIndex(index + 1)
  }

  const submitAnswer = async (raw: string) => {
    if (sending.current || busy || feedback || !item) return
    sending.current = true
    setBusy(true)
    try {
      const res = await api.post<{ correct: boolean | null; answer: string; deferred?: boolean }>(
        '/client/task/answer',
        {
          child_id: childId,
          subject,
          item_id: item.item_id,
          answer: raw,
        },
      )
      answers.current.push({
        item_id: item.item_id,
        answer: raw,
        duration_ms: Date.now() - startedAt.current,
      })
      // 朗读卡不判对错，也不弹反馈条，一下就直接下一张
      if (isRead) {
        advance()
        return
      }
      if (res.correct === null) {
        // 后台关掉了即时反馈：不告诉对错，直接进入下一题
        autoNext.current = window.setTimeout(() => advance(), 300)
        return
      }
      setFeedback({ correct: Boolean(res.correct), answer: res.answer })
      if (res.correct) autoNext.current = window.setTimeout(() => advance(), 900)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '判定失败')
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  /* ---------------------------------------------------------- 动作 */

  const chooseOption = (i: number) => {
    const opt = (item?.options as string[] | undefined)?.[i]
    if (opt == null) return
    setValue(opt)
    void submitAnswer(opt)
  }

  /** 数学答案：小数点/分数线/比号只能出现一次，负号只能贴在最前面（规则在 math-pad 里） */
  const appendMath = (ch: string) => setValue((prev) => applyMathKey(prev, ch))

  const pickToken = (i: number) => {
    setPicked((prev) => (prev.includes(i) ? prev : [...prev, i]))
  }

  const undoToken = () => setPicked((prev) => prev.slice(0, -1))

  const nextCard = () => {
    if (readLeft > 0) {
      toast(`要跟读满 ${READ_MIN_SECONDS} 秒才能翻页，还有 ${readLeft} 秒`)
      return
    }
    void submitAnswer(READ_ANSWER)
  }

  /**
   * 重放当前题的读音：音标走内置单音，音标缺失时退到第一个例词。
   * 必须把 speak 的 Promise 透出去——播放按钮靠它判断「还在等后端合成」，
   * `void speak()` 会让按钮立刻恢复可点，连点就重复请求了。
   */
  const replay = () => {
    if (!item) return
    const isPhoneme = item.kind === 'phoneme' || String(item.type ?? '').startsWith('phoneme')
    if (isPhoneme) {
      if (!speakPhoneme(String(item.symbol ?? ''))) {
        const ex = Array.isArray(item.examples) ? (item.examples as string[])[0] : undefined
        if (ex) return speak(ex, { lang: 'en-US' })
      }
      return
    }
    const text = (item.word as string) || (item.char as string) || (item.en as string) || ''
    if (text) return speak(text, { lang: item.kind === 'char' ? 'zh-CN' : 'en-US' })
  }

  const replayAnswer = () => {
    if (!feedback) return
    if (String(item?.kind) === 'phoneme') {
      if (!speakPhoneme(feedback.answer)) return speak(feedback.answer, { lang: 'en-US' })
      return
    }
    if (['word', 'sentence'].includes(String(item?.kind))) return speak(feedback.answer, { lang: 'en-US' })
  }

  const canListen = !!feedback && ['word', 'sentence', 'phoneme'].includes(String(item?.kind))
  // 选择题只有题干本身可播时才给 R：看中文选英文的题干就藏着答案，不能播
  const canReplay = !!item && (item.kind === 'phoneme' || (!isWordChoice && Boolean(item.word || item.en)))

  // 按键表随题目/状态重建，鼠标点击和键盘走同一批函数，行为不会分叉
  const actions: KeyMap = {}
  if (item) {
    if (feedback) {
      actions.enter = advance
      actions.space = advance
      if (canListen) actions.l = replayAnswer
    } else if (isRead) {
      actions.space = nextCard
      actions.r = replay
      if (item.type === 'phoneme_read') {
        const examples = Array.isArray(item.examples) ? (item.examples as string[]) : []
        examples.slice(0, 9).forEach((ex, i) => {
          actions[String(i + 1)] = () => void speak(ex, { lang: 'en-US' })
        })
      }
    } else if (isChoice) {
      ;((item.options as string[]) ?? []).slice(0, 6).forEach((_, i) => {
        // 数字键选第 n 项：孩子认数字比认字母快，键盘和数字键盘都能按
        actions[String(i + 1)] = () => chooseOption(i)
      })
      if (canReplay) actions.r = replay
    } else if (isOrder) {
      ;((item.tokens as string[]) ?? []).slice(0, 10).forEach((_, i) => {
        // 10 个词用 1~9 + 0；超出的没有快捷键，提示条会写清楚
        actions[String((i + 1) % 10)] = () => pickToken(i)
      })
      actions.backspace = undoToken
      actions.enter = () => {
        if (picked.length) void submitAnswer(orderText)
      }
    } else if (isMath) {
      '0123456789'.split('').forEach((d) => {
        actions[d] = () => appendMath(d)
      })
      actions.dot = () => appendMath('.')
      actions.minus = () => appendMath('-')
      actions.slash = () => appendMath('/')
      actions.colon = () => appendMath(':')
      actions.backspace = () => setValue((v) => v.slice(0, -1))
      actions.esc = () => setValue('')
      actions.enter = () => {
        if (value) void submitAnswer(value)
      }
    } else {
      actions.esc = () => setValue('')
    }
  }

  useHotkeys(actions)

  const hints: KeyHint[] = (() => {
    if (feedback) {
      const list: KeyHint[] = [{ keys: ['Enter', 'Space'], label: '下一题' }]
      if (canListen) list.push({ keys: 'L', label: '听一遍' })
      return list
    }
    if (isRead) {
      const list: KeyHint[] = [{ keys: 'Space', label: readLeft > 0 ? `跟读中，还有 ${readLeft} 秒` : '下一个' }]
      list.push({ keys: 'R', label: '听一遍' })
      if (item?.type === 'phoneme_read') list.push({ keys: '1-9', label: '例词' })
      return list
    }
    if (isChoice) {
      const nums = ((item?.options as string[]) ?? [])
        .slice(0, 6)
        .map((_, i) => String(i + 1))
        .join(' ')
      const list: KeyHint[] = [{ keys: nums, label: '按键提交' }]
      if (canReplay) list.push({ keys: 'R', label: '听一遍' })
      return list
    }
    if (isOrder) {
      return [
        { keys: '1-0', label: '按顺序选词' },
        { keys: 'Backspace', label: '撤销' },
        { keys: 'Enter', label: '确认' },
      ]
    }
    if (isMath) {
      return [
        { keys: '0-9 . - / :', label: '输入' },
        { keys: 'Backspace', label: '删一位' },
        { keys: 'Esc', label: '清空' },
        { keys: 'Enter', label: '提交' },
      ]
    }
    return [
      { keys: 'Enter', label: '提交' },
      { keys: 'Esc', label: '清空' },
    ]
  })()

  if (!item) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        暂无题目
        {onExit && (
          <Button variant="outline" className="mt-4" onClick={onExit}>
            返回
          </Button>
        )}
      </div>
    )
  }

  const progress = Math.round(((doneCount + index) / Math.max(1, doneCount + total)) * 100)

  return (
    <div ref={boxRef} tabIndex={-1} className="flex min-h-[calc(100vh-10rem)] flex-col outline-none">
      <div className="space-y-2 pb-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="flex items-center gap-2">
            {doneCount > 0 ? `第 ${doneCount + index + 1} / ${doneCount + total} 题 · 接着上次` : `第 ${index + 1} / ${total} 题`}
            {item.retry ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                <RotateCcw className="h-3 w-3" /> 错题重练
              </span>
            ) : null}
          </span>
          {onExit && (
            <button className="text-muted-foreground underline-offset-4 hover:underline" onClick={onExit}>
              退出
            </button>
          )}
        </div>
        <Progress value={progress} />
      </div>

      <div className="flex-1">
        {item.kind === 'char' && !isRead && !isFillChar && !isPinyinChoice && (
          <div className="mb-4 flex flex-col items-center gap-2">
            <div className="text-[76px] font-medium leading-none tracking-widest text-foreground">
              {item.char as string}
            </div>
          </div>
        )}

        {/* 补全词语：「花 ＿」选“朵”。空框左右取决于题字在词里的位置 */}
        {isFillChar && (
          <div className="mb-5 flex flex-col items-center gap-3">
            <div className="flex items-center justify-center gap-2">
              {item.blank === 'left' && <FillBlank />}
              <span className="text-[68px] font-medium leading-none tracking-widest text-foreground">
                {String(item.char ?? '')}
              </span>
              {item.blank !== 'left' && <FillBlank />}
            </div>
            <span className="text-sm text-muted-foreground">补一个字，组成词语</span>
          </div>
        )}

        {item.kind === 'word' && !isWordChoice && !isRead && (
          <div className="mb-4 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-semibold">{item.word as string}</span>
              <SpeakButton on={replay} />
            </div>
            <span className="text-sm text-muted-foreground">{item.phonetic as string}</span>
          </div>
        )}

        {isWordChoice && (
          <div className="mb-4 flex flex-col items-center gap-1 text-center">
            <span className="text-4xl font-semibold leading-snug">{(item.meaning as string) || item.stem}</span>
            <span className="text-sm text-muted-foreground">选出它对应的英文单词</span>
          </div>
        )}

        {item.kind === 'phoneme' && !isRead && (
          <div className="mb-4 flex flex-col items-center">
            <div className="flex items-center gap-3">
              <div className="text-4xl font-semibold text-english">{item.symbol as string}</div>
              <SpeakButton on={replay} label="播放音标发音" />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.category as string}</div>
          </div>
        )}

        {/* 朗读/认读卡：一次把信息看全、听够，按空格到下一张 */}
        {isRead && (
          <div className="mx-auto mb-5 w-full max-w-xl rounded-3xl border border-border bg-card p-6">
            <p className="mb-4 text-center text-xs text-muted-foreground">
              听一听，跟读一遍，停留 {READ_MIN_SECONDS} 秒后可继续
            </p>

            {item.type === 'char_read' && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-[76px] font-medium leading-none tracking-widest">{String(item.char ?? '')}</span>
                  <SpeakButton
                    on={replay}
                    label="播放这个字的读音"
                    className="bg-primary/10 p-2.5 text-primary hover:bg-primary/15"
                    iconClassName="h-6 w-6"
                  />
                </div>
                <span className="text-lg text-muted-foreground">{String(item.pinyin ?? '')}</span>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {item.radical ? <span>部首 {String(item.radical)}</span> : null}
                  {item.strokes ? <span>{String(item.strokes)} 画</span> : null}
                  {item.structure ? <span>{String(item.structure)}结构</span> : null}
                </div>
                {Array.isArray(item.words) && (item.words as string[]).length > 0 && (
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {(item.words as string[]).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => void speak(w, { lang: 'zh-CN' })}
                        title="点一下听这个词"
                        className="rounded-xl border border-border bg-muted/60 px-3 py-1 text-sm transition hover:border-primary/50 hover:text-primary"
                      >
                        {w}
                      </button>
                    ))}
                  </div>
                )}
                {item.sentence ? (
                  <div className="mt-2 flex items-center justify-center gap-2">
                    <p className="text-center text-sm text-muted-foreground">{String(item.sentence)}</p>
                    <SpeakButton
                      on={() => speak(String(item.sentence), { lang: 'zh-CN' })}
                      label="播放例句读音"
                      className="shrink-0"
                    />
                  </div>
                ) : null}
              </div>
            )}

            {item.type === 'word_read' && (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-3">
                  <span className="text-4xl font-semibold">{String(item.word ?? '')}</span>
                  <SpeakButton on={() => speak(String(item.word ?? ''), { lang: 'en-US' })} />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{String(item.phonetic ?? '')}</span>
                  {item.pos ? <span>· {String(item.pos)}</span> : null}
                </div>
                <p className="text-lg font-medium">{String(item.meaning ?? '')}</p>
                {item.example ? (
                  <div className="mt-1 w-full rounded-2xl bg-muted/60 px-4 py-3 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm">{String(item.example)}</p>
                      <SpeakButton on={() => speak(String(item.example), { lang: 'en-US' })} label="播放例句读音" />
                    </div>
                    {item.example_cn ? (
                      <p className="mt-1 text-xs text-muted-foreground">{String(item.example_cn)}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}

            {item.type === 'phoneme_read' && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-6xl font-semibold leading-none text-english">{String(item.symbol ?? '')}</span>
                  <SpeakButton on={replay} label="播放音标发音" />
                </div>
                <span className="text-xs text-muted-foreground">{String(item.category ?? '')}</span>
                {Array.isArray(item.examples) && (item.examples as string[]).length > 0 && (
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {(item.examples as string[]).map((ex, i) => (
                      <button
                        key={ex}
                        onClick={() => speak(ex, { lang: 'en-US' })}
                        className="rounded-xl border border-border bg-muted/60 px-3 py-1 text-sm"
                      >
                        {ex}
                        {i < 9 && <span className="ml-1 font-num text-[10px] text-muted-foreground">{i + 1}</span>}
                      </button>
                    ))}
                  </div>
                )}
                {item.mouth_tip ? (
                  <p className="mt-2 rounded-2xl bg-muted/60 px-4 py-2 text-center text-sm text-muted-foreground">
                    发音要点：{String(item.mouth_tip)}
                  </p>
                ) : null}
              </div>
            )}

            <Button size="xl" className="mt-6 w-full" disabled={busy || readLeft > 0} onClick={nextCard}>
              {readLeft > 0 ? (
                `跟读中…（${readLeft}s）`
              ) : (
                <>
                  下一个
                  <Kbd>Space</Kbd>
                </>
              )}
            </Button>
          </div>
        )}

        {/* 看中文选英文、补全词语的题干已经在上面卡片里了，不再重复一遍 */}
        {!isWordChoice && !isRead && !isFillChar && (
          <p className="mb-5 text-center text-lg font-medium leading-relaxed">{item.stem}</p>
        )}

        {isChoice && (
          <div className="grid grid-cols-2 gap-3">
            {(item.options as string[]).map((opt, i) => {
              const chosen = value === opt
              const showCorrect = feedback && feedback.answer === opt
              const showWrong = feedback && chosen && !feedback.correct
              return (
                <button
                  key={opt}
                  disabled={!!feedback || busy}
                  onClick={() => chooseOption(i)}
                  className={cn(
                    'relative flex min-h-[64px] items-center justify-center rounded-2xl border-2 bg-card px-3 py-3 text-center transition active:scale-[0.98]',
                    // 补全题和拼音选字的选项都是单个汉字，字号放大才看得清
                    isFillChar || isPinyinChoice ? 'min-h-[76px] text-3xl font-medium' : 'text-lg',
                    chosen ? 'border-primary' : 'border-border',
                    showCorrect && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                    showWrong && 'border-red-400 bg-red-50 text-red-600',
                  )}
                >
                  {i < 6 && (
                    <span className="absolute left-3 top-1.5 font-num text-[12px] text-muted-foreground">{i + 1}</span>
                  )}
                  {opt}
                </button>
              )
            })}
          </div>
        )}

        {isOrder && (
          <div className="space-y-4">
            <div className="min-h-[72px] rounded-2xl border-2 border-dashed border-border bg-card p-3 text-center text-lg">
              {orderText || <span className="text-sm text-muted-foreground">点击下面的单词组句</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {(item.tokens as string[]).map((token, i) => (
                <button
                  key={`${token}-${i}`}
                  disabled={picked.includes(i) || !!feedback}
                  onClick={() => pickToken(i)}
                  className={cn('rounded-xl border border-border bg-card px-3 py-2 text-sm', picked.includes(i) && 'opacity-30')}
                >
                  {i < 10 && <span className="mr-1 font-num text-[10px] text-muted-foreground">{(i + 1) % 10}</span>}
                  {token}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={!picked.length || !!feedback} onClick={undoToken}>
                撤销
                <Kbd>⌫</Kbd>
              </Button>
              <Button
                className="flex-1"
                disabled={!picked.length || !!feedback || busy}
                onClick={() => submitAnswer(orderText)}
              >
                确认
                <Kbd>Enter</Kbd>
              </Button>
            </div>
          </div>
        )}

        {!isChoice && !isOrder && isMath && (
          <MathPad
            value={value}
            onChange={setValue}
            unit={item.unit ? String(item.unit) : undefined}
            onSubmit={() => void submitAnswer(value)}
            disabled={!!feedback}
            busy={busy}
          />
        )}

        {!isChoice && !isOrder && !isMath && !isRead && (
          <div className="space-y-4">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={!!feedback}
              placeholder="在这里作答"
              className="h-16 w-full rounded-2xl border-2 border-border bg-card px-4 text-center text-2xl focus:border-primary focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value) submitAnswer(value)
              }}
            />
            {item.line ? (
              <p className="text-center text-sm text-muted-foreground">原句：{String(item.content ?? '').replace(/\n/g, ' ')}</p>
            ) : null}
            <Button size="xl" className="w-full" disabled={!value || !!feedback || busy} onClick={() => submitAnswer(value)}>
              确认
              <Kbd>Enter</Kbd>
            </Button>
          </div>
        )}

        {/* 数学没有「跳过」：算不出来就先把想法写下来，家长要求每道题都过 */}
        {!feedback && !isChoice && !isMath && !isRead && (
          <button
            className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => submitAnswer('')}
          >
            不会，跳过我
          </button>
        )}

        {/* 常驻按键提示：孩子不知道有快捷键，等于没做 */}
        <KeyHints hints={hints} />
      </div>

      {feedback && (
        <div className="sticky bottom-[50px] z-10 mt-4 rounded-2xl border border-border bg-card p-4 shadow-lg">
          <div className="flex items-start gap-2">
            {feedback.correct ? (
              <>
                <Check className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <p className="font-medium text-emerald-700">答对了！</p>
                  <p className="text-sm text-muted-foreground">继续保持</p>
                </div>
              </>
            ) : (
              <>
                <X className="mt-0.5 h-5 w-5 text-red-500" />
                <div className="flex-1">
                  <p className="font-medium text-red-600">
                    正确答案：<span className="text-lg">{feedback.answer || '（空）'}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">记住它，下次就会啦</p>
                </div>
              </>
            )}
          </div>
          {!feedback.correct && (
            <div className="mt-3 flex gap-2">
              {/* 语音只支持古诗与英文朗读：反馈条上只有英文题给「听一遍」；音标播内置单音音频 */}
              {String(item.kind) === 'phoneme' ? (
                <Button variant="outline" className="flex-1" onClick={replayAnswer}>
                  <Volume2 className="h-4 w-4" /> 听一遍
                  <Kbd>L</Kbd>
                </Button>
              ) : (
                ['word', 'sentence'].includes(String(item.kind)) && (
                  <Button variant="outline" className="flex-1" onClick={replayAnswer}>
                    <Volume2 className="h-4 w-4" /> 听一遍
                    <Kbd>L</Kbd>
                  </Button>
                )
              )}
              <Button className="flex-1" onClick={advance}>
                下一题
                <Kbd>Enter</Kbd>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
