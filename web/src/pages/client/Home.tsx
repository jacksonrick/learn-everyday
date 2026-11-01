import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Flame, Sparkles, Star } from 'lucide-react'
import { useSession } from '@/lib/hooks'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { SUBJECT_META, cn, fmtDuration } from '@/lib/utils'
import type { Subject } from '@/lib/types'
import { FoxCheer, FoxWave, WavyLine, TrophyArt } from '@/components/client/art'

function greeting() {
  const h = new Date().getHours()
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

function Ring({ percent }: { percent: number }) {
  const r = 36
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 88 88" className="h-24 w-24 shrink-0">
      <circle cx="44" cy="44" r={r} fill="none" stroke="hsl(var(--paper-deep))" strokeWidth="9" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke="hsl(var(--persimmon))"
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * percent) / 100}
        transform="rotate(-90 44 44)"
        style={{ transition: 'stroke-dashoffset .7s cubic-bezier(.22,1,.36,1)' }}
      />
      <text
        x="44"
        y="50"
        textAnchor="middle"
        fontSize="19"
        fontWeight="600"
        fill="hsl(var(--persimmon-deep))"
        style={{ fontFeatureSettings: 'tnum' }}
      >
        {percent}%
      </text>
    </svg>
  )
}

function SubjectCard({ item, index }: { item: any; index: number }) {
  const meta = SUBJECT_META[item.subject as Subject]
  const done = item.status === 'done'
  const doing = item.status === 'doing'
  return (
    <Link
      to={`/c/${item.subject}`}
      className="animate-slide-up block"
      style={{ animationDelay: `${80 + index * 70}ms` }}
    >
      <Card
        className={cn(
          'group relative overflow-hidden p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-warm-lg',
          done && 'ring-1 ring-grass/25',
        )}
      >
        <div className="flex items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-xl transition-transform duration-200 group-hover:-rotate-3 group-hover:scale-105"
            style={{ background: `hsl(${meta.color} / 0.14)`, color: `hsl(${meta.color})` }}
          >
            {meta.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap font-round text-lg font-semibold">{meta.label}</span>
              {done ? (
                <Badge variant="success">已完成</Badge>
              ) : doing ? (
                <Badge variant="warn">进行中</Badge>
              ) : (
                <Badge variant="outline">未开始</Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
              {done
                ? `得分 ${item.score} · 用时 ${fmtDuration(item.duration_sec)}`
                : item.subject === 'math'
                  ? '每日计算题，做完自动判分'
                  : item.subject === 'chinese'
                    ? '认读 + 补字 + 古诗'
                    : '单词 + 音标 + 句子'}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-line transition-transform duration-200 group-hover:translate-x-1" />
        </div>
        {doing && (
          <span className="absolute inset-x-0 bottom-0 h-1 overflow-hidden bg-paper-deep">
            <span className="block h-full w-1/3 animate-sweep rounded-full bg-honey" />
          </span>
        )}
      </Card>
    </Link>
  )
}

export default function HomePage() {
  const { data, isLoading } = useSession()

  const percent = useMemo(() => {
    if (!data) return 0
    return Math.round((data.done_count / 3) * 100)
  }, [data])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-3xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
          <Skeleton className="h-28 rounded-3xl" />
        </div>
      </div>
    )
  }

  if (data?.need_setup || !data?.child) {
    return (
      <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <FoxWave className="h-28 w-28" />
        <p className="font-round text-lg font-semibold">还没有孩子档案</p>
        <p className="max-w-md text-sm text-ink-soft">先在后台添加孩子的姓名、年级和学期，客户端才会开始出题。</p>
        <Button asChild className="mt-4">
          <Link to="/admin/children">去后台设置</Link>
        </Button>
      </Card>
    )
  }

  const child = data.child

  return (
    <div className="space-y-7">
      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <Card className="relative overflow-hidden p-6 sm:p-7">
          <span className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-persimmon-soft/60" />
          <div className="relative flex items-start gap-5">
            <FoxCheer className="h-20 w-20 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-ink-soft">{greeting()}，今天也要一点点地进步</p>
              <h1 className="mt-1 font-round text-3xl font-semibold leading-tight">{child.name} 的学习时间</h1>
              <p className="mt-1 text-sm text-ink-soft">
                {child.grade_name}
                {child.term ? ` · ${child.term}学期` : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge variant="warn" className="gap-1">
                  <Flame className="h-3 w-3" /> 连续 {data.checkin.streak} 天
                </Badge>
                <Badge variant="secondary" className="gap-1">
                  <Star className="h-3 w-3" /> {data.points_balance} 积分
                </Badge>
                {data.checkin.done && <Badge variant="success">今日已打卡</Badge>}
              </div>
            </div>
          </div>
        </Card>

        <Card className="flex items-center gap-5 p-6">
          <Ring percent={percent} />
          <div className="min-w-0">
            <p className="font-round text-lg font-semibold">今日进度</p>
            <p className="mt-0.5 text-sm text-ink-soft">
              已完成 <span className="font-num text-base font-semibold text-persimmon-deep">{data.done_count}</span> / 3 科
            </p>
            <p className="mt-2 text-xs text-ink-soft">
              {data.checkin.done ? '今天已经打卡啦，真棒！' : '三科都完成就能打卡'}
            </p>
          </div>
        </Card>
      </div>

      <section>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-round text-lg font-semibold">今天的科目</h2>
          <WavyLine className="h-2 flex-1 text-line" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.subjects.map((item: any, index: number) => (
            <SubjectCard key={item.subject} item={item} index={index} />
          ))}
        </div>
      </section>

      {data.checkin.done && (
        <Card className="relative flex flex-col items-center gap-4 overflow-hidden border-honey/40 bg-gradient-to-br from-honey/18 via-paper-card to-persimmon-soft/40 p-6 sm:flex-row">
          <span className="pointer-events-none absolute -left-10 -top-12 h-36 w-36 rounded-full bg-honey/12" />
          <TrophyArt className="relative h-24 w-24 shrink-0 sm:h-28 sm:w-28" />
          <div className="relative text-center sm:text-left">
            <p className="flex items-center justify-center gap-2 font-round text-xl font-semibold text-persimmon-deep sm:justify-start">
              今日打卡成功
            </p>
            <p className="mt-1 text-sm text-ink-soft">
              连续 <span className="font-num text-base font-semibold text-persimmon-deep">{data.checkin.streak}</span> 天，这个奖杯是你的啦
            </p>
            <p className="mt-1 text-xs text-ink-soft">明天的任务已经排好啦</p>
          </div>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/me?tab=calendar">
          <Card className="flex items-center gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-honey/15 text-honey">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium">打卡日历</p>
              <p className="text-xs text-ink-soft">看看这个月坚持了几天</p>
            </div>
          </Card>
        </Link>
        <Link to="/me?tab=wrong">
          <Card className="flex items-center gap-3 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-chinese/12 text-chinese">
              <Star className="h-5 w-5" />
            </span>
            <div>
              <p className="font-medium">我的错题</p>
              <p className="text-xs text-ink-soft">错过的题会自动安排重练</p>
            </div>
          </Card>
        </Link>
      </div>
    </div>
  )
}
