import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import { useSession, startTask } from '@/lib/hooks'
import { resumeHint, resumeItems } from '@/lib/resume'
import { Quiz, type Answer } from '@/components/client/quiz'
import { ResultView } from '@/components/client/result'
import { LoadingStack, DoneNotice, EmptyNotice, PageLead, QuizAside } from '@/components/client/notice'
import type { QuizItem, SubmitResult } from '@/lib/types'

export default function MathPage() {
  const navigate = useNavigate()
  const childId = useChildStore((s) => s.childId)
  useSession()
  const [items, setItems] = useState<QuizItem[]>([])
  const [loading, setLoading] = useState(true)
  const [doneScore, setDoneScore] = useState<number | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)
  const [resumed, setResumed] = useState(0)
  const submitting = useRef(false)
  const totalCount = items.length + resumed

  const finish = useCallback(
    async (answers: Answer[]) => {
      if (submitting.current) return
      submitting.current = true
      try {
        const res = await api.post<SubmitResult>('/client/task/submit', {
          subject: 'math',
          answers,
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
    setLoading(true)
    startTask('math', childId)
      .then((res) => {
        if (!alive) return
        if (res.status === 'done' && (!res.items || res.items.length === 0)) {
          setDoneScore(res.score ?? 0)
          return
        }
        const list: QuizItem[] = res.items ?? []
        const { remaining } = resumeItems(list, res.answered ?? [])
        setItems(remaining)
        setResumed(Number(res.answered_count ?? 0))
        // 之前答完但没收工（退出了），这次进来直接补提交；题库为空时不能走这条
        if (list.length > 0 && !remaining.length) finish([])
      })
      .catch((e) => toast.error(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [childId, finish])

  if (loading) return <LoadingStack />

  if (result) return <ResultView result={result} label="数学" />

  if (doneScore !== null) return <DoneNotice subject="math" score={doneScore} />

  if (!items.length) {
    return (
      <EmptyNotice
        title="这个学期还没有出题规则"
        tip="到后台「出题规则」按年级学期加几条规则，每天就能自动出 20 题。"
        to="/admin/math/rules"
      />
    )
  }

  return (
    <div>
      <PageLead
        subject="math"
        title="数学 · 每日计算题"
        hint={resumeHint(totalCount, resumed) || '直接填最终答案，答完自动判分'}
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_268px]">
        <Quiz
          subject="math"
          items={items}
          doneCount={resumed}
          onFinish={finish}
          onExit={() => navigate('/')}
        />
        <QuizAside subject="math" count={totalCount} />
      </div>
    </div>
  )
}
