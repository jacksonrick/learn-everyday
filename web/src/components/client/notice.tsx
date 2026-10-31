import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Flame } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/hooks'
import { SUBJECT_META } from '@/lib/utils'
import { FoxCheer, FoxSleep, FoxWave } from './art'

/** 加载骨架：三条起伏的书本条，代替原来的灰方块 */
export function LoadingStack() {
  return (
    <div className="space-y-3" aria-live="polite" aria-busy="true">
      <div className="h-7 w-40 rounded-full bg-paper-deep/80" />
      <Card className="p-6">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-paper-deep/80" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded-full bg-paper-deep/80" />
            <div className="h-3 w-1/2 rounded-full bg-paper-deep/60" />
          </div>
        </div>
      </Card>
      <Card className="p-6">
        <div className="h-24 rounded-2xl bg-paper-deep/60" />
      </Card>
    </div>
  )
}

const NEXT_SUBJECT = { chinese: 'math', math: 'english', english: 'chinese' } as const

/** 今天的科目已经做完：给正反馈，并指向下一个还没完成的科目 */
export function DoneNotice({ subject, score }: { subject: 'chinese' | 'math' | 'english'; score: number }) {
  const next = NEXT_SUBJECT[subject]
  const nextMeta = SUBJECT_META[next]
  return (
    <Card className="mx-auto max-w-3xl overflow-hidden p-0">
      <div className="flex flex-col items-center gap-1 bg-persimmon-soft/70 px-6 py-8 text-center sm:flex-row sm:gap-6 sm:text-left">
        <FoxCheer className="h-28 w-28 shrink-0 animate-bounce-gentle" />
        <div>
          <p className="font-round text-xl font-semibold text-persimmon-deep">今天的{SUBJECT_META[subject].label}全部完成</p>
          <p className="mt-1 text-sm text-ink-soft">
            得分 <span className="font-num text-lg font-semibold text-persimmon-deep">{score}</span> 分，明天再来继续
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t border-line/70 p-5 sm:flex-row">
        <Button asChild variant="outline" className="flex-1">
          <Link to="/">回到今日</Link>
        </Button>
        <Button asChild className="flex-1">
          <Link to={`/c/${next}`}>接着练{nextMeta.label}</Link>
        </Button>
      </div>
    </Card>
  )
}

/** 题库没配好：不打「空」的标签，直接告诉家长去哪里补 */
export function EmptyNotice({ title, tip, to }: { title: string; tip: string; to: string }) {
  return (
    <Card className="mx-auto flex max-w-2xl flex-col items-center gap-2 px-6 py-12 text-center">
      <FoxSleep className="h-28 w-28" />
      <p className="font-round text-lg font-semibold">{title}</p>
      <p className="max-w-md text-sm text-ink-soft">{tip}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button asChild variant="outline">
          <Link to="/">回到今日</Link>
        </Button>
        <Button asChild>
          <Link to={to}>去整理题库</Link>
        </Button>
      </div>
    </Card>
  )
}

/** 科目页统一页头：左侧图标砖 + 标题，右侧可以塞进度提示 */
export function PageLead({
  subject,
  title,
  hint,
  extra,
}: {
  subject: 'chinese' | 'math' | 'english'
  title: string
  hint: string
  extra?: ReactNode
}) {
  const meta = SUBJECT_META[subject]
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <span
        className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl shadow-warm animate-tilt"
        style={{ background: `hsl(${meta.color} / 0.14)`, color: `hsl(${meta.color})` }}
      >
        <span className="text-xl">{meta.emoji}</span>
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="font-round text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>
      </div>
      {extra}
    </div>
  )
}

/** 宽屏答题页右侧的学习伙伴栏：把超宽屏幕的空间用起来，同时给孩子一点陪伴感 */
export function QuizAside({ subject, count }: { subject: 'chinese' | 'math' | 'english'; count: number }) {
  const { data } = useSession()
  const meta = SUBJECT_META[subject]
  const streak = data?.checkin?.streak ?? 0
  return (
    <aside className="hidden xl:block">
      <div className="sticky top-8 space-y-4 rounded-3xl border border-line/70 bg-paper-card p-5 shadow-warm">
        <div className="flex items-center gap-3">
          <span
            className="grid h-12 w-12 place-items-center rounded-2xl text-xl"
            style={{ background: `hsl(${meta.color} / 0.14)`, color: `hsl(${meta.color})` }}
          >
            {meta.emoji}
          </span>
          <div>
            <p className="font-round text-base font-semibold">今天{meta.label}</p>
            <p className="text-xs text-ink-soft">共 {count} 题</p>
          </div>
        </div>
        <FoxWave className="mx-auto h-28 w-28 animate-bounce-gentle" />
        <p className="rounded-2xl bg-paper-deep/70 px-4 py-3 text-sm text-ink-soft">
          答错的题明天还会再来找你，做一半退出也没关系，回来接着做
        </p>
        {streak > 0 && (
          <p className="flex items-center justify-center gap-1 text-sm text-persimmon-deep">
            <Flame className="h-4 w-4" /> 已连续打卡 {streak} 天
          </p>
        )}
      </div>
    </aside>
  )
}
