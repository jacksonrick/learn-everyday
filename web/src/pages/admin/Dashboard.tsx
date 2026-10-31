import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, CheckCircle2, Clock, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/feedback'
import { SUBJECT_META, cn } from '@/lib/utils'
import type { Subject } from '@/lib/types'

export default function Dashboard() {
  const overview = useQuery({
    queryKey: ['stats-overview'],
    queryFn: () => api.get<any>('/admin/stats/overview', true),
  })
  const summary = useQuery({
    queryKey: ['stats-summary'],
    queryFn: () => api.get<any>('/admin/stats/summary', true),
  })
  const trend = useQuery({
    queryKey: ['stats-trend'],
    queryFn: () => api.get<any[]>('/admin/stats/trend?days=14', true),
  })

  if (overview.isLoading) return <Skeleton className="h-64 w-full" />

  const data = overview.data
  const maxAccuracy = 100

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">数据概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          今天 {data?.today?.length ?? 0} 个孩子 · {data?.today?.filter((t: any) => t.checkin).length ?? 0} 人已打卡
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4" />} label="孩子" value={summary.data?.children ?? 0} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="本周打卡" value={data?.week?.full_days ?? 0} suffix="次" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="近 30 天正确率" value={data?.month?.accuracy ?? 0} suffix="%" />
        <StatCard icon={<Clock className="h-4 w-4" />} label="待审批兑换" value={data?.pending_redemptions ?? 0} suffix="条" />
      </div>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">今日学习状态</p>
        <div className="space-y-3">
          {(data?.today ?? []).map((row: any) => (
            <div key={row.child_id} className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 p-3">
              <span className="text-xl">{row.avatar}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {row.name} <span className="text-xs font-normal text-muted-foreground">{row.grade_name}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.done_subjects.length ? `已完成 ${row.done_subjects.length} 科` : '今天还没开始'}
                </p>
              </div>
              <div className="flex gap-1.5">
                {(['chinese', 'math', 'english'] as Subject[]).map((s) => (
                  <span
                    key={s}
                    className={cn(
                      'rounded-lg px-2 py-1 text-[11px]',
                      row.done_subjects.includes(s)
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-card text-muted-foreground',
                    )}
                  >
                    {SUBJECT_META[s].label}
                  </span>
                ))}
              </div>
              <Badge variant={row.checkin ? 'success' : 'outline'}>{row.checkin ? '已打卡' : '未打卡'}</Badge>
              <span className="text-sm font-medium text-primary">{row.points} 分</span>
            </div>
          ))}
          {(data?.today ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有孩子档案</p>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">近 14 天正确率</p>
        <div className="flex h-40 items-end gap-1.5">
          {(trend.data ?? []).map((t) => (
            <div key={t.date} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-32 w-full items-end justify-center rounded-md bg-muted/40">
                <div
                  className="w-full rounded-md bg-primary/75"
                  style={{ height: `${Math.max(2, (t.accuracy / maxAccuracy) * 120)}px` }}
                  title={`${t.date} ${t.accuracy}%`}
                />
              </div>
              <span className="text-[9px] text-muted-foreground">{Number(t.date.slice(8))}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium">题库规模</p>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <Row label="识字" value={summary.data?.chars ?? 0} />
            <Row label="古诗" value={summary.data?.poems ?? 0} />
            <Row label="英语单词" value={summary.data?.words ?? 0} />
            <Row label="数学规则" value={summary.data?.rules ?? 0} />
          </div>
        </Card>
        <Card className="p-5">
          <p className="mb-3 text-sm font-medium">错题分布（未掌握）</p>
          {(data?.wrong_distribution ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无错题</p>
          ) : (
            <div className="space-y-2">
              {data.wrong_distribution.map((w: any) => (
                <div key={w.subject} className="flex items-center gap-2 text-sm">
                  <span className="w-10 text-muted-foreground">{SUBJECT_META[w.subject as Subject]?.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-rose-400"
                      style={{ width: `${Math.min(100, w.count * 8)}%` }}
                    />
                  </div>
                  <span className="w-6 text-right text-xs text-muted-foreground">{w.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: ReactNode
  label: string
  value: number | string
  suffix?: string
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">
        {value}
        {suffix && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
