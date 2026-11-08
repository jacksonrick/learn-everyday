import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Delete, RotateCcw, Volume2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import { speak, speakPhoneme } from '@/lib/speech'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { QuizItem } from '@/lib/types'
import { FoxCheer, FoxWave } from './art'

export type Answer = { item_id: number; answer: string; duration_ms: number }

/** 朗读/认读卡的题型；服务端不判分，点「下一个」即完成 */
const READ_TYPES = ['word_read', 'phoneme_read', 'char_read']
/** 与后端 taskgen.READ_ANSWER 保持一致 */
const READ_ANSWER = '__read__'
/** 朗读/认读卡至少停留的秒数：防止无脑连点「下一个」刷完 */
const READ_MIN_SECONDS = 20

function SpeakButton({ onClick, label = '播放读音' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="rounded-full bg-muted p-1.5 text-muted-foreground" aria-label={label}>
      <Volume2 className="h-4 w-4" />
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
  // 朗读/认读卡的倒计时（秒）：到 0 才允许点「下一个」
  const [readLeft, setReadLeft] = useState(0)
  const answers = useRef<Answer[]>([])
  const startedAt = useRef(Date.now())

  const item = items[index]
  const total = items.length
  const isOrder = item?.type === 'order' && Array.isArray(item?.tokens)
  const isChoice = Array.isArray(item?.options) && (item?.options as string[]).length > 0
  const isMath = item?.kind === 'math'
  // 看中文选英文：题干就是答案的译文，不能把单词、音标、读音摆出来，否则答案直接印在题目上。
  // 语文的组词题也是 word_choice，但它的题干里没有答案，照常走「大字 + 题干」的排版。
  const isWordChoice = item?.type === 'word_choice' && item?.kind === 'word'
  // 朗读/认读卡：只展示信息 + 发音，点「下一个」即可
  const isRead = READ_TYPES.includes(String(item?.type ?? ''))
  // 语文补全词语：题字 + 空框，选项是单字，答案在词里的另一头
  const isFillChar = item?.type === 'fill_char'
  // 语文看拼音选字：题干是拼音，选项是字，不能把答案字当大字摆在上面
  const isPinyinChoice = item?.type === 'pinyin_choice'

  useEffect(() => {
    setValue('')
    setPicked([])
    setFeedback(null)
    startedAt.current = Date.now()
    if (!READ_TYPES.includes(String(item?.type ?? ''))) setReadLeft(0)
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

  const orderText = useMemo(() => {
    if (!isOrder || !item) return ''
    const tokens = item.tokens as string[]
    return picked.map((i) => tokens[i]).join(' ')
  }, [isOrder, item, picked])

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

  const submitAnswer = async (raw: string) => {
    if (busy || feedback) return
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
      // 朗读卡不判对错，也不弹反馈条，点一下就直接下一张
      if (isRead) {
        next()
        return
      }
      if (res.correct === null) {
        // 后台关掉了即时反馈：不告诉对错，直接进入下一题
        window.setTimeout(() => next(), 300)
        return
      }
      setFeedback({ correct: Boolean(res.correct), answer: res.answer })
      if (res.correct) window.setTimeout(() => next(), 900)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '判定失败')
    } finally {
      setBusy(false)
    }
  }

  const next = () => {
    if (index + 1 >= total) {
      onFinish(answers.current)
      return
    }
    setIndex(index + 1)
  }

  const speakCurrent = () => {
    const text = (item.word as string) || (item.char as string) || (item.en as string) || ''
    if (text) speak(text, { lang: 'en-US' })
  }

  const progress = Math.round(((doneCount + index) / Math.max(1, doneCount + total)) * 100)

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
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
              <button
                onClick={speakCurrent}
                className="rounded-full bg-muted p-1.5 text-muted-foreground"
                aria-label="播放读音"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
            <span className="text-sm text-muted-foreground">{item.phonetic as string}</span>
          </div>
        )}

        {isWordChoice && (
          <div className="mb-4 flex flex-col items-center gap-1 text-center">
            <span className="text-4xl font-semibold leading-snug">
              {(item.meaning as string) || item.stem}
            </span>
            <span className="text-sm text-muted-foreground">选出它对应的英文单词</span>
          </div>
        )}

        {item.kind === 'phoneme' && !isRead && (
          <div className="mb-4 flex flex-col items-center">
            <div className="flex items-center gap-3">
              <div className="text-4xl font-semibold text-english">{item.symbol as string}</div>
              <SpeakButton
                onClick={() => {
                  if (!speakPhoneme(String(item.symbol ?? ''))) {
                    // 没有内置音频的兜底：读第一个例词
                    const ex = Array.isArray(item.examples) ? (item.examples as string[])[0] : undefined
                    if (ex) speak(ex, { lang: 'en-US' })
                  }
                }}
                label="播放音标发音"
              />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{item.category as string}</div>
          </div>
        )}

        {/* 朗读/认读卡：一次把信息看全、听够，点「下一个」就过去 */}
        {isRead && (
          <div className="mx-auto mb-5 w-full max-w-xl rounded-3xl border border-border bg-card p-6">
            <p className="mb-4 text-center text-xs text-muted-foreground">
              听一听，跟读一遍，停留 {READ_MIN_SECONDS} 秒后可继续
            </p>

            {item.type === 'char_read' && (
              <div className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-[76px] font-medium leading-none tracking-widest">{String(item.char ?? '')}</span>
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
                      <span key={w} className="rounded-xl border border-border bg-muted/60 px-3 py-1 text-sm">
                        {w}
                      </span>
                    ))}
                  </div>
                )}
                {item.sentence ? (
                  <p className="mt-2 text-center text-sm text-muted-foreground">{String(item.sentence)}</p>
                ) : null}
              </div>
            )}

            {item.type === 'word_read' && (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="flex items-center gap-3">
                  <span className="text-4xl font-semibold">{String(item.word ?? '')}</span>
                  <SpeakButton onClick={() => speak(String(item.word ?? ''), { lang: 'en-US' })} />
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
                      <SpeakButton
                        onClick={() => speak(String(item.example), { lang: 'en-US' })}
                        label="播放例句读音"
                      />
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
                  <SpeakButton
                    onClick={() => {
                      if (!speakPhoneme(String(item.symbol ?? ''))) {
                        const ex = Array.isArray(item.examples) ? (item.examples as string[])[0] : undefined
                        if (ex) speak(ex, { lang: 'en-US' })
                      }
                    }}
                    label="播放音标发音"
                  />
                </div>
                <span className="text-xs text-muted-foreground">{String(item.category ?? '')}</span>
                {Array.isArray(item.examples) && (item.examples as string[]).length > 0 && (
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {(item.examples as string[]).map((ex) => (
                      <button
                        key={ex}
                        onClick={() => speak(ex, { lang: 'en-US' })}
                        className="rounded-xl border border-border bg-muted/60 px-3 py-1 text-sm"
                      >
                        {ex}
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

            <Button
              size="xl"
              className="mt-6 w-full"
              disabled={busy || readLeft > 0}
              onClick={() => submitAnswer(READ_ANSWER)}
            >
              {readLeft > 0 ? `跟读中…（${readLeft}s）` : '下一个'}
            </Button>
          </div>
        )}

        {/* 看中文选英文、补全词语的题干已经在上面卡片里了，不再重复一遍 */}
        {!isWordChoice && !isRead && !isFillChar && (
          <p className="mb-5 text-center text-lg font-medium leading-relaxed">{item.stem}</p>
        )}

        {isChoice && (
          <div className="grid grid-cols-2 gap-3">
            {(item.options as string[]).map((opt) => {
              const chosen = value === opt
              const showCorrect = feedback && feedback.answer === opt
              const showWrong = feedback && chosen && !feedback.correct
              return (
                <button
                  key={opt}
                  disabled={!!feedback || busy}
                  onClick={() => {
                    setValue(opt)
                    submitAnswer(opt)
                  }}
                  className={cn(
                    'flex min-h-[64px] items-center justify-center rounded-2xl border-2 bg-card px-3 py-3 text-center transition active:scale-[0.98]',
                    // 补全题和拼音选字的选项都是单个汉字，字号放大才看得清
                    isFillChar || isPinyinChoice ? 'min-h-[76px] text-3xl font-medium' : 'text-lg',
                    chosen ? 'border-primary' : 'border-border',
                    showCorrect && 'border-emerald-500 bg-emerald-50 text-emerald-700',
                    showWrong && 'border-red-400 bg-red-50 text-red-600',
                  )}
                >
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
                  onClick={() => setPicked([...picked, i])}
                  className={cn(
                    'rounded-xl border border-border bg-card px-3 py-2 text-sm',
                    picked.includes(i) && 'opacity-30',
                  )}
                >
                  {token}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={!picked.length || !!feedback}
                onClick={() => setPicked(picked.slice(0, -1))}
              >
                撤销
              </Button>
              <Button
                className="flex-1"
                disabled={!picked.length || !!feedback || busy}
                onClick={() => submitAnswer(orderText)}
              >
                确认
              </Button>
            </div>
          </div>
        )}

        {!isChoice && !isOrder && isMath && (
          <div className="space-y-4">
            <div className="flex h-16 items-center justify-center rounded-2xl border-2 border-border bg-card text-3xl font-medium tracking-wide">
              {value || <span className="text-base text-muted-foreground">输入答案</span>}
              {item.unit ? <span className="ml-1 text-lg text-muted-foreground">{item.unit as string}</span> : null}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                <button key={k} className="num-pad-btn" disabled={!!feedback} onClick={() => setValue(value + k)}>
                  {k}
                </button>
              ))}
              <button className="num-pad-btn" disabled={!!feedback} onClick={() => setValue(value.includes('.') ? value : value + '.')}>
                .
              </button>
              <button className="num-pad-btn" disabled={!!feedback} onClick={() => setValue(value + '0')}>
                0
              </button>
              <button
                className="num-pad-btn"
                disabled={!!feedback}
                onClick={() => setValue(value.slice(0, -1))}
                aria-label="删除"
              >
                <Delete className="h-5 w-5 text-muted-foreground" />
              </button>
            </div>
            <Button
              size="xl"
              className="w-full"
              disabled={!value || !!feedback || busy}
              onClick={() => submitAnswer(value)}
            >
              确认答案
            </Button>
          </div>
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
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      if (!speakPhoneme(feedback.answer)) speak(feedback.answer, { lang: 'en-US' })
                    }}
                  >
                    <Volume2 className="h-4 w-4" /> 听一遍
                  </Button>
                ) : (
                  ['word', 'sentence'].includes(String(item.kind)) && (
                    <Button variant="outline" className="flex-1" onClick={() => speak(feedback.answer, { lang: 'en-US' })}>
                      <Volume2 className="h-4 w-4" /> 听一遍
                    </Button>
                  )
                )}
              <Button className="flex-1" onClick={next}>
                下一题
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
