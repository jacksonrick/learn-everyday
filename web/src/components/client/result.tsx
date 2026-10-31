import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Flame, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { fmtDuration } from '@/lib/utils'
import type { SubmitResult } from '@/lib/types'

export function ResultView({ result, label }: { result: SubmitResult; label: string }) {
  const navigate = useNavigate()
  const good = result.score >= 90
  const pass = result.score >= 60

  return (
    <div className="space-y-4 py-4">
      <div className="flex flex-col items-center gap-2 animate-pop">
        <div
          className={
            good
              ? 'flex h-24 w-24 items-center justify-center rounded-full bg-emerald-50 text-3xl font-bold text-emerald-600'
              : pass
                ? 'flex h-24 w-24 items-center justify-center rounded-full bg-amber-50 text-3xl font-bold text-amber-600'
                : 'flex h-24 w-24 items-center justify-center rounded-full bg-red-50 text-3xl font-bold text-red-500'
          }
        >
          {result.score}
        </div>
        <p className="text-lg font-semibold">
          {good ? '太厉害了！' : pass ? '完成得不错' : '再练一次会更好'}
        </p>
        <p className="text-sm text-muted-foreground">
          {label} · 答对 {result.correct} / {result.total} 题 · 用时 {fmtDuration(result.duration_sec ?? 0)}
        </p>
      </div>

      <Card className="divide-y divide-border/60">
        <div className="flex items-center justify-between p-4">
          <span className="flex items-center gap-2 text-sm">
            <Star className="h-4 w-4 text-amber-500" /> 本次获得积分
          </span>
          <span className="text-lg font-semibold text-primary">+{result.points?.earned ?? 0}</span>
        </div>
        {(result.points?.detail ?? []).map((d) => (
          <div key={d.reason} className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
            <span>{d.reason}</span>
            <span>+{d.points}</span>
          </div>
        ))}
        {result.checkin?.done && (
          <div className="flex items-center justify-between p-4">
            <span className="flex items-center gap-2 text-sm">
              <Flame className="h-4 w-4 text-orange-500" /> 已打卡
            </span>
            <Badge variant="success">连续 {result.checkin.streak} 天</Badge>
          </div>
        )}
      </Card>

      {result.wrong?.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">需要再看一眼</p>
          <ul className="space-y-2">
            {result.wrong.slice(0, 8).map((w) => (
              <li key={w.item_id} className="rounded-xl bg-muted/60 px-3 py-2 text-sm">
                <p className="text-foreground/80">{w.stem}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  你的答案：{w.user_answer || '（空）'} ｜ 正确答案：
                  <span className="font-medium text-emerald-700">{w.correct_answer}</span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={() => navigate('/')}>
          回到首页
        </Button>
        <Button className="flex-1" onClick={() => navigate('/me?tab=wrong')}>
          看错题本
        </Button>
      </div>

      {result.checkin?.newly_done && (
        <div className="flex items-center justify-center gap-2 pt-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" /> 今天三科都完成了，打卡成功！
        </div>
      )}
    </div>
  )
}
