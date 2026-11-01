import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import { useSession, startTask } from '@/lib/hooks'
import { resumeHint, resumeItems, type SavedAnswer } from '@/lib/resume'
import { Quiz, type Answer } from '@/components/client/quiz'
import { PoemPlayer } from '@/components/client/poem-player'
import { ResultView } from '@/components/client/result'
import { LoadingStack, DoneNotice, EmptyNotice, PageLead, QuizAside } from '@/components/client/notice'
import type { QuizItem, SubmitResult } from '@/lib/types'

export default function ChinesePage() {
  const navigate = useNavigate()
  const childId = useChildStore((s) => s.childId)
  useSession()
  const [chars, setChars] = useState<QuizItem[]>([])
  const [poem, setPoem] = useState<any>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [phase, setPhase] = useState<'quiz' | 'poem'>('quiz')
  const [loading, setLoading] = useState(true)
  const [doneScore, setDoneScore] = useState<number | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [resumed, setResumed] = useState(0)
  const [total, setTotal] = useState(0)
  const submitting = useRef(false)

  const submitAll = useCallback(
    async (all: Answer[]) => {
      if (submitting.current) return
      submitting.current = true
      try {
        const res = await api.post<SubmitResult>('/client/task/submit', {
          subject: 'chinese',
          answers: all,
          child_id: childId,
        })
        setResult(res)
      } catch (e) {
        submitting.current = false
        toast.error(e instanceof Error ? e.message : '提交失败')
      }
    },
    [childId],
  )

  useEffect(() => {
    if (!childId) return
    let alive = true
    startTask('chinese', childId)
      .then((res) => {
        if (!alive) return
        if (res.status === 'done' && (!res.items || res.items.length === 0)) {
          setDoneScore(res.score ?? 0)
          return
        }
        const list: QuizItem[] = res.items ?? []
        const saved: SavedAnswer[] = res.answered ?? []
        const allChars = list.filter((i) => i.kind === 'char')
        const poemItem = list.find((i) => i.kind === 'poem') ?? null
        const { remaining, answeredIds } = resumeItems(allChars, saved)

        setChars(remaining)
        setPoem(poemItem)
        setResumed(Number(res.answered_count ?? saved.length))
        setTotal(remaining.length + (poemItem ? 1 : 0))

        const poemLeft = poemItem ? !answeredIds.has(Number(poemItem.item_id)) : false
        // 之前答完但没收工（退出了），这次进来直接补提交；题库为空时不能走这条
        if (list.length > 0 && !remaining.length && !poemLeft) {
          submitAll([])
          return
        }
        setPhase(remaining.length ? 'quiz' : 'poem')
      })
      .catch((e) => toast.error(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [childId, submitAll])

  const handleCharsDone = (charAnswers: Answer[]) => {
    setAnswers(charAnswers)
    if (poem) setPhase('poem')
    else submitAll(charAnswers)
  }

  const handlePoemDone = () => {
    // 古诗不判分，服务端已经按「已背诵」存档，这里只负责收工
    submitAll(answers)
  }

  if (loading) return <LoadingStack />

  if (result) return <ResultView result={result} label="语文" />

  if (doneScore !== null) return <DoneNotice subject="chinese" score={doneScore} />

  if (!chars.length && !poem) {
    // submitting 只用于「补提交中」，不能挡住已经拿到的结果
    if (submitting.current) return <LoadingStack />
    return (
      <EmptyNotice
        title="语文的题库还是空的"
        tip="到后台「识字库」加几个生字，或「古诗库」加一首诗，明天就能开始啦。"
        to="/admin/chinese/chars"
      />
    )
  }

  const hint =
    resumeHint(total + resumed, resumed) ||
    (phase === 'quiz' ? `第 1 步 · 认读与补字 ${chars.length} 题` : '第 2 步 · 古诗背诵')

  return (
    <div>
      <PageLead subject="chinese" title="语文" hint={hint} />

      {phase === 'quiz' && chars.length > 0 && (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_268px]">
          <Quiz
            subject="chinese"
            items={chars}
            doneCount={resumed}
            onFinish={handleCharsDone}
            onExit={() => navigate('/')}
          />
          <QuizAside subject="chinese" count={total + resumed} />
        </div>
      )}

      {phase === 'poem' && poem && (
        <PoemPlayer
          poem={poem}
          childId={childId}
          onUploaded={handlePoemDone}
          onSkip={() => submitAll(answers)}
        />
      )}
    </div>
  )
}
