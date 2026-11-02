import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Lock } from 'lucide-react'
import { api } from '@/lib/api'
import { FoxWave } from './art'

/** 解析 HH:MM 为当天分钟数；格式非法返回 null（视为未限制） */
function toMinutes(value?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * 客户端可用时间段守卫：家长在后台配置了时间段（如 9:00-21:00）时，
 * 时间段之外用全屏遮罩盖住整个客户端，无法关闭；到点自动消失。
 *
 * 时间以服务器下发的 server_now 校准本机偏差（平板改时间也绕不过去多少），
 * 每 30 秒重查一次，到点自动放行，不需要刷新页面。
 */
export default function TimeGuard() {
  const { data } = useQuery({
    queryKey: ['client-prefs'],
    queryFn: () => api.get<any>('/client/prefs'),
    staleTime: 5 * 60 * 1000,
  })

  const start = toMinutes(data?.client_time_start)
  const end = toMinutes(data?.client_time_end)
  const restricted = start !== null && end !== null

  // 本机时间 - 服务器时间 的偏差（毫秒）
  const offsetRef = useRef(0)
  useEffect(() => {
    const serverNow = data?.server_now
    if (serverNow) {
      const t = new Date(serverNow).getTime()
      if (!Number.isNaN(t)) offsetRef.current = t - Date.now()
    }
  }, [data])

  const [nowMin, setNowMin] = useState(() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })

  useEffect(() => {
    if (!restricted) return
    const tick = () => {
      const d = new Date(Date.now() + offsetRef.current)
      setNowMin(d.getHours() * 60 + d.getMinutes())
    }
    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [restricted])

  if (!restricted) return null

  // 起点小于终点是正常窗口（9:00-21:00）；起点大于终点视为跨午夜（21:00-次日 9:00）
  const allowed = start <= end ? nowMin >= start && nowMin <= end : nowMin >= start || nowMin <= end
  if (allowed) return null

  // 距开放还有多少分钟：未到开始时间等开始；过了结束时间等明天的开始
  const waitMin = nowMin < start ? start - nowMin : 1440 - nowMin + start
  const waitText =
    waitMin >= 60 ? `${Math.floor(waitMin / 60)} 小时 ${waitMin % 60} 分钟` : `${waitMin} 分钟`
  const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-gradient-to-b from-persimmon-soft/70 via-paper to-paper-deep px-6 text-center">
      <FoxWave className="h-24 w-24" />
      <h1 className="mt-6 font-round text-2xl font-semibold text-ink">休息时间到啦</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        现在不是学习时间，先去玩会儿、看看窗外
        <br />
        眼睛也需要休息哦
      </p>

      <div className="mt-8 flex flex-col items-center gap-2 rounded-3xl border border-line/70 bg-paper-card/90 px-8 py-5 shadow-warm backdrop-blur">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Clock className="h-4 w-4 text-persimmon" />
          学习时间：{fmt(start)} - {fmt(end)}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <Lock className="h-3.5 w-3.5" />
          {waitMin > 0 ? `约 ${waitText}后开放` : '马上就开放啦'}
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-soft/70">有问题请找爸爸妈妈</p>
    </div>
  )
}
