import { useEffect, useState, type ComponentType } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Flame, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/hooks'
import { Skeleton } from '@/components/ui/feedback'
import { Badge } from '@/components/ui/badge'
import { IconChinese, IconEnglish, IconMath, IconMe, IconToday, FoxWave } from './art'

const NAV = [
  { to: '/', label: '今日', Icon: IconToday },
  { to: '/c/chinese', label: '语文', Icon: IconChinese },
  { to: '/c/math', label: '数学', Icon: IconMath },
  { to: '/c/english', label: '英语', Icon: IconEnglish },
  { to: '/me', label: '我的', Icon: IconMe },
] as { to: string; label: string; Icon: ComponentType<{ className?: string }> }[]

/** 侧栏 logo：坐着挥手的小狐狸，静态不闪，避免孩子在答题时被侧栏吸引 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('grid place-items-center rounded-xl bg-persimmon', className)}>
      <FoxWave className="h-8 w-8" motion={false} />
    </span>
  )
}

/** 侧栏底部的当天日期：平板长时间不关也不会停在昨天，每分钟校一次 */
function TodayBadge({ compact = false }: { compact?: boolean }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()]
  const month = now.getMonth() + 1
  const day = now.getDate()

  if (compact) {
    return (
      <div className="mt-auto flex w-full flex-col items-center gap-1 pt-4 text-ink-soft">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-line/80 bg-paper-card">
          <IconToday className="h-5 w-5 text-persimmon" />
        </span>
        <p className="font-num text-xs font-semibold text-ink">
          {month}/{day}
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line/70 bg-white/60 px-3 py-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-persimmon-soft">
        <IconToday className="h-5 w-5 text-persimmon-deep" />
      </span>
      <div className="min-w-0">
        <p className="font-num text-sm font-semibold leading-tight">
          {month} 月 {day} 日
        </p>
        <p className="text-[11px] text-ink-soft">
          {now.getFullYear()} 年 · {week}
        </p>
      </div>
    </div>
  )
}

export default function ClientLayout() {
  const location = useLocation()
  const { data } = useSession()
  const child = data?.child
  const leftCount = (data?.subjects ?? []).filter((s) => s.status !== 'done').length

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'group relative flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-all duration-200',
      isActive ? 'bg-paper-card text-persimmon-deep shadow-warm' : 'text-ink-soft hover:bg-white/70 hover:text-ink',
    )

  const iconWrap = cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors', 'bg-white/70 group-hover:bg-white')

  return (
    <div className="client-shell client-paper min-h-screen bg-paper font-sans text-ink">
      {/* 宽桌面：完整侧栏 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[236px] flex-col border-r border-line/70 bg-paper-deep/80 px-4 py-5 backdrop-blur lg:flex">
        <div className="flex items-center gap-2.5 px-1">
          <BrandMark className="h-10 w-10" />
          <span className="font-round text-[15px] font-semibold tracking-tight">每日学习</span>
        </div>

        <div className="mt-5 rounded-2xl border border-line/80 bg-paper-card p-3 shadow-warm">
          {child ? (
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-persimmon-soft text-xl">
                {child.avatar || '🙂'}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{child.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {child.grade_name}
                  {child.term ? ` · ${child.term}学期` : ''}
                </p>
              </div>
            </div>
          ) : (
            <Skeleton className="h-11 w-full rounded-xl" />
          )}
          {child && (
            <div className="mt-3 flex items-center gap-2">
              <Badge variant="warn" className="gap-1">
                <Flame className="h-3 w-3" /> 连续 {data?.checkin?.streak ?? 0} 天
              </Badge>
              <Badge variant="secondary" className="gap-1">
                {data?.points_balance ?? 0} 分
              </Badge>
            </div>
          )}
        </div>

        <nav className="mt-5 flex-1 space-y-1.5">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={linkClass}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="nav-mark" />}
                  <span className={cn(iconWrap, isActive && 'bg-white')}>
                    <Icon className="h-5 w-5 transition-transform duration-200 group-hover:-rotate-6" />
                  </span>
                  <span className="flex-1 text-sm font-medium">{label}</span>
                  {to === '/' && leftCount > 0 && (
                    <span className="rounded-full bg-persimmon/12 px-2 py-0.5 text-xs font-medium text-persimmon-deep">
                      {leftCount} 科待练
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <TodayBadge />
      </aside>

      {/* 平板竖屏：图标条 */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[84px] flex-col items-center border-r border-line/70 bg-paper-deep/80 py-5 backdrop-blur md:flex lg:hidden">
        <BrandMark className="h-10 w-10" />
        {child && (
          <span className="mt-4 grid h-11 w-11 place-items-center rounded-full bg-persimmon-soft text-xl">
            {child.avatar || '🙂'}
          </span>
        )}
        <nav className="mt-6 flex flex-1 flex-col items-center gap-2">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} title={label} className={({ isActive }) => cn('group relative grid h-12 w-12 place-items-center rounded-2xl transition-all', isActive ? 'bg-paper-card text-persimmon shadow-warm' : 'text-ink-soft hover:bg-white/70')}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="nav-mark" />}
                  <Icon className="h-5 w-5 transition-transform duration-200 group-hover:-rotate-6" />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <TodayBadge compact />
      </aside>

      <main className="min-h-screen pb-24 md:pb-0 md:pl-[84px] lg:pl-[236px]">
        <div key={location.pathname} className="mx-auto w-full max-w-[1080px] animate-slide-up px-5 py-6 lg:px-10 lg:py-9 xl:max-w-[1240px]">
          <Outlet />
        </div>
      </main>

      {/* 手机：底部导航兜底 */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-paper-card/95 backdrop-blur md:hidden">
        <div className="grid grid-cols-5">
          {NAV.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors', isActive ? 'text-persimmon-deep' : 'text-ink-soft')}
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn('h-5 w-5 transition-transform', isActive && 'scale-110')} />
                  <span className={cn(isActive && 'font-medium')}>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
