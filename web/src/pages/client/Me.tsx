import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  ChevronLeft,
  ChevronRight,
  Flame,
  Gift,
  Star,
  CalendarCheck,
  Target,
  Sparkles,
  Check,
  CircleDashed,
  PenLine,
  FileQuestion
} from 'lucide-react'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import { useSession } from '@/lib/hooks'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton, EmptyState } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { SUBJECT_META, cn, currentMonth, fmtDate, todayStr } from '@/lib/utils'
import type { Subject } from '@/lib/types'
import { FoxCheer, TrophyArt } from '@/components/client/art'

export default function MePage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'calendar'
  useSession()
  const childId = useChildStore((s) => s.childId)

  return (
    <div className="space-y-4">
      <div className="pt-1">
        <h1 className="text-xl font-semibold">我的</h1>
        <p className="text-sm text-muted-foreground">记录每一天的小进步</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="calendar">日历</TabsTrigger>
          <TabsTrigger value="records">记录</TabsTrigger>
          <TabsTrigger value="points">积分</TabsTrigger>
          <TabsTrigger value="wrong">错题</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <CalendarTab childId={childId} />
        </TabsContent>
        <TabsContent value="records">
          <RecordsTab childId={childId} />
        </TabsContent>
        <TabsContent value="points">
          <PointsTab childId={childId} />
        </TabsContent>
        <TabsContent value="wrong">
          <WrongTab childId={childId} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type DayMark = {
  Icon: LucideIcon
  label: string
  tone: string
}

/**
 * 日历格子里的小图标：一眼看出当天是三科全完成、只完成部分、家长补录还是没做。
 * 未来的日子还没有发生，不显示图标，避免被误读成「未完成」。
 */
function dayMark(d: any): DayMark | null {
  if (d.status === 'full') {
    return d.is_makeup
      ? { Icon: PenLine, label: '家长补录', tone: 'opacity-95' }
      : { Icon: Check, label: '三科完成', tone: 'opacity-95' }
  }
  if (d.status === 'partial') {
    const done = (d.subjects ?? []).length
    return { Icon: CircleDashed, label: `部分完成 ${done}/3`, tone: '' }
  }
  if (d.is_future) return null
  return { Icon: FileQuestion, label: '未完成', tone: 'opacity-45' }
}

const CALENDAR_LEGEND: { Icon: LucideIcon; label: string; swatch: string }[] = [
  { Icon: Check, label: '三科完成', swatch: 'bg-persimmon-deep text-white' },
  { Icon: CircleDashed, label: '部分完成', swatch: 'bg-persimmon text-persimmon-deep' },
  { Icon: PenLine, label: '家长补录', swatch: 'bg-persimmon-deep text-white' },
  { Icon: FileQuestion, label: '未完成', swatch: 'border border-dashed border-line/80 text-ink-soft' },
]

function CalendarTab({ childId }: { childId: number | null }) {
  const [month, setMonth] = useState(currentMonth())
  const { data, isLoading } = useQuery({
    queryKey: ['calendar', childId, month],
    queryFn: () => api.get<any>(`/client/calendar?child_id=${childId}&month=${month}`),
    enabled: !!childId,
  })

  const offset = useMemo(() => new Date(`${month}-01T00:00:00`).getDay(), [month])

  const shift = (delta: number) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setMonth(`${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`)
  }

  if (isLoading) return <Skeleton className="h-72 w-full" />

  const stats = data?.stats ?? {}
  const days: any[] = data?.days ?? []
  const bestStreak = days.reduce((max, d) => Math.max(max, Number(d.streak) || 0), 0)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,660px)_minmax(0,1fr)] xl:items-start">
      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <button
            onClick={() => shift(-1)}
            className="rounded-xl border border-line/70 bg-paper-card p-1.5 text-ink-soft transition-colors hover:bg-persimmon-soft hover:text-persimmon-deep"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="text-center">
            <p className="font-round text-lg font-semibold">{month.replace('-', ' 年 ')} 月</p>
            <p className="text-xs text-ink-soft">
              已打卡 <span className="font-num font-semibold text-persimmon-deep">{stats.full_days ?? 0}</span> 天
            </p>
          </div>
          <button
            onClick={() => shift(1)}
            className="rounded-xl border border-line/70 bg-paper-card p-1.5 text-ink-soft transition-colors hover:bg-persimmon-soft hover:text-persimmon-deep"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 gap-1.5 text-center text-[11px] text-ink-soft">
          {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
            <div key={w} className={cn('py-0.5', i === 0 || i === 6 ? 'text-persimmon/70' : '')}>
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: offset }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}
          {(data?.days ?? []).map((d: any) => {
            const mark = dayMark(d)
            return (
              <div
                key={d.date}
                title={mark ? `${d.date} · ${mark.label}` : `${d.date} · 还没到`}
                className={cn(
                  'flex h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-sm transition-colors',
                  d.status === 'full' && 'bg-persimmon-deep font-semibold text-white shadow-sticker',
                  d.status === 'partial' && 'bg-persimmon font-medium text-persimmon-deep',
                  d.status === 'none' && 'border border-dashed border-line/80',
                  d.status === 'none' && d.is_future && 'text-ink-soft/35',
                  d.status === 'none' && !d.is_future && 'text-ink-soft/60',
                  d.is_today && 'ring-2 ring-persimmon-deep/60',
                )}
              >
                <span className="leading-none">{d.day}</span>
                {mark && <mark.Icon className={cn('h-3 w-3 shrink-0', mark.tone)} strokeWidth={3} />}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line/60 pt-3">
          {CALENDAR_LEGEND.map(({ Icon, label, swatch }) => (
            <span key={label} className="flex items-center gap-1 text-[11px] text-ink-soft">
              <span className={cn('grid h-4 w-4 place-items-center rounded', swatch)}>
                <Icon className="h-2.5 w-2.5" strokeWidth={3} />
              </span>
              {label}
            </span>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
        <StatCard
          Icon={CalendarCheck}
          label="本月打卡"
          value={`${stats.full_days ?? 0} 天`}
          hint={`本月已过 ${stats.elapsed_days ?? 0} 天`}
          tone="persimmon"
        />
        <StatCard
          Icon={Target}
          label="本月完成率"
          value={`${stats.rate ?? 0}%`}
          hint="三科全部完成算一次"
          tone="grass"
        />
        <StatCard
          Icon={Sparkles}
          label="本月积分"
          value={`${stats.points ?? 0} 分`}
          hint="学习和打卡攒下来的"
          tone="honey"
        />

        <Card className="flex items-center gap-2.5 p-3 sm:col-span-3 xl:col-span-1">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-persimmon-soft">
            <Flame className="h-4 w-4 text-persimmon-deep" />
          </span>
          <div className="min-w-0">
            <p className="text-sm">
              本月最长连续 <span className="font-num font-semibold text-persimmon-deep">{bestStreak}</span> 天
            </p>
            <p className="text-[11px] text-ink-soft">看左边格子下面的小图标就知道当天完成了没</p>
          </div>
        </Card>
      </div>
    </div>
  )
}

const TONES = {
  persimmon: 'bg-persimmon text-persimmon-deep',
  honey: 'bg-honey/16 text-honey',
  grass: 'bg-grass/14 text-grass',
} as const

function StatCard({
  Icon,
  label,
  value,
  hint,
  tone,
}: {
  Icon: ComponentType<{ className?: string }>
  label: string
  value: string
  hint: string
  tone: keyof typeof TONES
}) {
  return (
    <Card className="flex items-center gap-3 p-3.5">
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-2xl', TONES[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="font-num text-xl font-semibold leading-tight">{value}</p>
        <p className="text-xs font-medium text-ink">{label}</p>
        <p className="truncate text-[11px] text-ink-soft">{hint}</p>
      </div>
    </Card>
  )
}

function RecordsTab({ childId }: { childId: number | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['records', childId],
    queryFn: () => api.get<any>(`/client/records?child_id=${childId}&days=7`),
    enabled: !!childId,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />
  const trend = data?.trend ?? []
  const max = 100

  return (
    <div className="space-y-3">
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium">近 7 天正确率</p>
        <div className="flex h-32 items-end gap-2">
          {trend.map((t: any) => (
            <div key={t.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end justify-center rounded-lg bg-muted/50">
                <div
                  className="w-full rounded-lg bg-primary/80 transition-all"
                  style={{ height: `${Math.max(4, (t.accuracy / max) * 96)}px` }}
                  title={`${t.accuracy}%`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{Number(t.date.slice(8))}</span>
            </div>
          ))}
        </div>
      </Card>

      {(data?.summary ?? []).length === 0 ? (
        <EmptyState icon="📝" title="还没有学习记录" description="完成一次练习就会有记录啦" />
      ) : (
        <Card className="divide-y divide-border/60">
          {data.summary.map((s: any) => {
            const meta = SUBJECT_META[s.subject as Subject]
            const acc = s.total ? Math.round((s.correct / s.total) * 100) : 0
            return (
              <div key={`${s.date}-${s.subject}`} className="flex items-center gap-3 p-4">
                <span className="text-xl">{meta?.emoji ?? '📘'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {fmtDate(s.date)} · {meta?.label ?? s.subject}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.correct}/{s.total} 题正确 · {Math.round((s.duration_ms ?? 0) / 1000)} 秒
                  </p>
                </div>
                <Badge variant={acc >= 90 ? 'success' : acc >= 60 ? 'warn' : 'danger'}>{acc}%</Badge>
              </div>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function PointsTab({ childId }: { childId: number | null }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['client-points', childId],
    queryFn: () => api.get<any>(`/client/points?child_id=${childId}`),
    enabled: !!childId,
  })
  const rewardsQuery = useQuery({
    queryKey: ['client-rewards', childId],
    queryFn: () => api.get<any>(`/client/rewards?child_id=${childId}`),
    enabled: !!childId,
  })

  const redeem = async (rewardId: number, cost: number) => {
    try {
      await api.post('/client/redemptions', { child_id: childId, reward_id: rewardId, cost })
      toast.success('已提交给爸爸妈妈，等他们同意哦')
      qc.invalidateQueries({ queryKey: ['client-rewards'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '兑换失败')
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <Card className="bg-gradient-to-br from-primary/10 to-transparent p-5">
        <div className="flex items-center gap-3">
          <Star className="h-8 w-8 text-primary" />
          <div>
            <p className="text-3xl font-bold">{data?.balance ?? 0}</p>
            <p className="text-xs text-muted-foreground">可用积分 · 今天获得 {data?.today_earned ?? 0}</p>
          </div>
        </div>
      </Card>

      {(rewardsQuery.data?.items ?? []).length > 0 && (
        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-medium">
            <Gift className="h-4 w-4 text-rose-400" /> 可以兑换
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {rewardsQuery.data.items.map((r: any) => (
              <div
                key={r.id}
                className={cn(
                  'flex flex-col rounded-2xl border p-3 transition-colors',
                  r.affordable
                    ? 'border-persimmon/40 bg-paper-card shadow-sm'
                    : 'border-line/70 bg-paper-deep/50',
                )}
              >
                <div
                  className={cn(
                    'grid h-14 place-items-center rounded-xl text-3xl',
                    r.affordable ? 'bg-persimmon-soft' : 'bg-paper-deep opacity-70',
                  )}
                >
                  {r.icon}
                </div>
                <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{r.name}</p>
                <p
                  className={cn(
                    'mt-0.5 font-num text-xs',
                    r.affordable ? 'font-semibold text-persimmon-deep' : 'text-ink-soft',
                  )}
                >
                  {r.cost} 积分
                </p>
                <Button
                  size="sm"
                  variant={r.affordable ? 'default' : 'outline'}
                  className="mt-2.5 w-full"
                  disabled={!r.affordable}
                  onClick={() => redeem(r.id, r.cost)}
                >
                  {r.affordable ? '兑换' : `还差 ${r.gap}`}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="divide-y divide-border/60">
        {(data?.items ?? []).slice(0, 20).map((p: any) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <p>{reasonLabel(p.reason, p.note)}</p>
              <p className="text-xs text-muted-foreground">{p.date}</p>
            </div>
            <span className={p.delta > 0 ? 'font-medium text-emerald-600' : 'font-medium text-red-500'}>
              {p.delta > 0 ? '+' : ''}
              {p.delta}
            </span>
          </div>
        ))}
        {(data?.items ?? []).length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">还没有积分记录</p>
        )}
      </Card>
    </div>
  )
}

function reasonLabel(reason: string, note: string) {
  const map: Record<string, string> = {
    checkin: '每日打卡',
    redeem: '兑换奖励',
    manual: '家长调整',
    wrong_fix: '错题订正',
  }
  if (map[reason]) {
    if (note) {
      return map[reason] + ' · ' + note
    }
    return map[reason]
  }
  if (reason.startsWith('subject_')) {
    const s = reason.replace('subject_', '')
    return `${SUBJECT_META[s as Subject]?.label ?? s}完成`
  }
  if (reason.startsWith('excellent_')) return '正确率优秀'
  if (reason.startsWith('streak_')) return `连续打卡 ${reason.replace('streak_', '')} 天`
  return reason
}

function WrongTab({ childId }: { childId: number | null }) {
  const qc = useQueryClient()
  const [subject, setSubject] = useState<string>('all')
  const [queue, setQueue] = useState<any[] | null>(null)
  const query = subject === 'all' ? '' : `&subject=${subject}`

  const { data, isLoading } = useQuery({
    queryKey: ['wrong-items', childId, subject],
    queryFn: () => api.get<any[]>(`/client/wrong-items?child_id=${childId}${query}`),
    enabled: !!childId,
  })

  const { data: practice } = useQuery({
    queryKey: ['wrong-practice', childId, subject],
    queryFn: () => api.get<any>(`/client/wrong-practice?child_id=${childId}${query}`),
    enabled: !!childId,
  })

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const list: any[] = data ?? []
  const practiceMap = new Map((practice?.items ?? []).map((i: any) => [i.wrong_id, i]))
  const fixableCount = practiceMap.size

  if (queue) {
    return (
      <WrongPractice
        childId={childId}
        queue={queue}
        onExit={() => {
          setQueue(null)
          qc.invalidateQueries({ queryKey: ['wrong-items'] })
          qc.invalidateQueries({ queryKey: ['wrong-practice'] })
          qc.invalidateQueries({ queryKey: ['client-points', childId] })
        }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {['all', 'chinese', 'math', 'english'].map((s) => (
          <button
            key={s}
            onClick={() => setSubject(s)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs transition-colors',
              subject === s
                ? 'bg-persimmon-deep text-white'
                : 'bg-paper-deep text-ink-soft hover:bg-persimmon-soft',
            )}
          >
            {s === 'all' ? '全部' : SUBJECT_META[s as Subject].label}
          </button>
        ))}
        {list.length > 0 && (
          <Button
            size="sm"
            className="ml-auto"
            disabled={fixableCount === 0}
            onClick={() => setQueue(practice?.items ?? [])}
          >
            {fixableCount > 0 ? `订正这 ${fixableCount} 道` : '暂无可订正'}
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyState icon="✨" title="没有错题" description="答错的题会自动收进来" />
      ) : (
        <>
          <p className="px-1 text-xs text-ink-soft">错题要重新做一遍并且答对才会从这里毕业</p>
          <div className="space-y-2">
            {list.map((w: any) => {
              const item = practiceMap.get(w.id)
              const meta = SUBJECT_META[w.subject as Subject]
              return (
                <Card key={w.id} className="flex items-start gap-3 p-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-persimmon-soft text-lg">
                    {meta?.emoji ?? '📘'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{w.ref_text}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      错 {w.wrong_count} 次 · {w.last_wrong_at?.slice(0, 10)}
                      {w.correct_streak > 0 ? ` · 已答对 ${w.correct_streak} 次` : ''}
                      {!item && ' · 再做一次原题后就能订正'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={item ? 'default' : 'outline'}
                    disabled={!item}
                    onClick={() => setQueue([item])}
                  >
                    去订正
                  </Button>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/** 错题订正：一题一答，答错要重做，答对才关闭，不提供「直接标记已掌握」的捷径 */
function WrongPractice({
  childId,
  queue,
  onExit,
}: {
  childId: number | null
  queue: any[]
  onExit: () => void
}) {
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<any | null>(null)
  const [sending, setSending] = useState(false)
  const [fixed, setFixed] = useState(0)
  const [points, setPoints] = useState(0)
  const [again, setAgain] = useState(0)

  const total = queue.length
  const finished = index >= total
  const item = queue[index]
  const startedAt = useMemo(() => Date.now(), [index, again])

  const submit = async () => {
    if (!answer.trim() || sending) return
    setSending(true)
    try {
      const res = await api.post<any>('/client/wrong-practice/check', {
        child_id: childId,
        wrong_id: item.wrong_id,
        answer: answer.trim(),
        duration_ms: Date.now() - startedAt,
      })
      setFeedback(res)
      if (res.correct) setFixed((n) => n + 1)
      setPoints((n) => n + (res.points_earned ?? 0))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '提交失败')
    } finally {
      setSending(false)
    }
  }

  const next = () => {
    setIndex((i) => i + 1)
    setAnswer('')
    setFeedback(null)
  }

  const retry = () => {
    setAgain((n) => n + 1)
    setAnswer('')
    setFeedback(null)
  }

  if (finished) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <TrophyArt className="h-28 w-28" />
        <p className="font-round text-xl font-semibold text-persimmon-deep">订正完成</p>
        <p className="text-sm text-ink-soft">
          做对 <span className="font-num text-base font-semibold text-persimmon-deep">{fixed}</span> / {total} 道
          {points > 0 && (
            <>
              ，获得 <span className="font-num font-semibold text-persimmon-deep">{points}</span> 积分
            </>
          )}
        </p>
        <Button className="mt-2" onClick={onExit}>
          回到错题本
        </Button>
      </Card>
    )
  }

  const meta = SUBJECT_META[item.subject as Subject]
  const options: string[] = item.options ?? []

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onExit}>
          退出订正
        </Button>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-paper-deep">
          <div
            className="h-full rounded-full bg-persimmon-deep transition-all duration-500"
            style={{ width: `${Math.round((index / total) * 100)}%` }}
          />
        </div>
        <span className="font-num text-xs text-ink-soft">
          {index + 1}/{total}
        </span>
      </div>

      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-persimmon-soft text-sm">
            {meta?.emoji ?? '📘'}
          </span>
          {meta?.label ?? ''} · 之前错 {item.wrong_count} 次
        </div>
        <p className="mt-3 text-lg font-medium leading-relaxed">{item.stem}</p>

        {options.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {options.map((opt) => (
              <button
                key={opt}
                disabled={!!feedback}
                onClick={() => setAnswer(opt)}
                className={cn(
                  'rounded-2xl border px-4 py-3 text-left text-sm transition-all',
                  answer === opt
                    ? 'border-persimmon bg-persimmon-soft font-medium text-persimmon-deep'
                    : 'border-line/80 bg-paper-card hover:border-persimmon/50',
                  feedback && 'opacity-80',
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <Input
            className="mt-4"
            autoFocus
            value={answer}
            placeholder="把答案写在这里"
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={(e) => !feedback && e.key === 'Enter' && submit()}
          />
        )}

        {feedback && (
          <div
            className={cn(
              'mt-4 flex items-start gap-3 rounded-2xl p-4 animate-pop',
              feedback.correct ? 'bg-grass/12' : 'bg-persimmon/10',
            )}
          >
            <FoxCheer className="h-14 w-14 shrink-0" />
            <div className="min-w-0">
              <p className={cn('font-round text-base font-semibold', feedback.correct ? 'text-grass' : 'text-persimmon-deep')}>
                {feedback.correct ? '答对了，这道题毕业啦' : '还差一点点，再看一遍答案'}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                正确答案：<span className="font-medium text-ink">{feedback.correct_answer || '—'}</span>
              </p>
              {feedback.correct && feedback.points_earned > 0 && (
                <p className="mt-1 text-xs text-ink-soft">订正奖励 +{feedback.points_earned} 积分</p>
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          {!feedback ? (
            <Button disabled={!answer.trim() || sending} onClick={submit}>
              {sending ? '判分中…' : '提交答案'}
            </Button>
          ) : feedback.correct ? (
            <Button onClick={next}>{index + 1 >= total ? '完成订正' : '下一题'}</Button>
          ) : (
            <Button onClick={retry}>再做一次</Button>
          )}
          {feedback && !feedback.correct && answer && (
            <p className="self-center text-xs text-ink-soft">你的答案：{answer}</p>
          )}
        </div>
      </Card>
    </div>
  )
}
