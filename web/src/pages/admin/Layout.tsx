import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Coins,
  FileText,
  Gift,
  Hash,
  Languages,
  LayoutGrid,
  LogOut,
  Menu,
  Mic,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { setToken } from '@/lib/api'
import { cn } from '@/lib/utils'

type NavItem = { to: string; label: string; icon: typeof BarChart3; end?: boolean }
type NavGroup = { group: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { group: '总览', items: [{ to: '/admin', label: '数据概览', icon: BarChart3, end: true }] },
  {
    group: '语文题库',
    items: [
      { to: '/admin/chinese/chars', label: '识字库', icon: BookOpen },
      { to: '/admin/chinese/poems', label: '古诗库', icon: FileText },
    ],
  },
  {
    group: '数学题库',
    items: [
      { to: '/admin/math/rules', label: '出题规则', icon: Hash },
      { to: '/admin/math/questions', label: '应用题', icon: Sparkles },
    ],
  },
  {
    group: '英语题库',
    items: [
      { to: '/admin/english/words', label: '单词库', icon: Languages },
      { to: '/admin/english/sentences', label: '句子库', icon: FileText },
      { to: '/admin/english/phonemes', label: '音标库', icon: LayoutGrid },
    ],
  },
  {
    group: '学习数据',
    items: [
      { to: '/admin/records', label: '学习记录', icon: FileText },
      { to: '/admin/recitations', label: '背诵录音', icon: Mic },
      { to: '/admin/checkins', label: '打卡记录', icon: CalendarCheck },
      { to: '/admin/points', label: '积分管理', icon: Coins },
      { to: '/admin/rewards', label: '奖励与兑换', icon: Gift },
    ],
  },
  {
    group: '系统',
    items: [
      { to: '/admin/children', label: '孩子管理', icon: Users },
      { to: '/admin/settings', label: '系统设置', icon: Settings },
    ],
  },
]

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  const logout = () => {
    setToken('')
    navigate('/admin/login')
  }

  const current = NAV.flatMap((n) => n.items).find((i) =>
    i.end ? location.pathname === i.to : location.pathname.startsWith(i.to),
  )

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-card px-4 lg:hidden">
        <button onClick={() => setOpen(true)} className="rounded-lg p-1.5 hover:bg-muted">
          <Menu className="h-5 w-5" />
        </button>
        <span className="text-sm font-medium">{current?.label ?? '管理后台'}</span>
        <button onClick={logout} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted">
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 overflow-y-auto bg-card p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">管理后台</span>
              <button onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <Nav onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 overflow-y-auto border-r border-border bg-card p-3 lg:block">
          <div className="mb-4 px-2 pt-2">
            <p className="text-sm font-semibold">每日打卡</p>
            <p className="text-xs text-muted-foreground">家长管理后台</p>
          </div>
          <Nav />
          <button
            onClick={logout}
            className="mt-4 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </aside>

        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-4">
      {NAV.map((group) => (
        <div key={group.group}>
          <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {group.group}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition',
                      isActive
                        ? 'bg-primary/10 font-medium text-primary'
                        : 'text-foreground/70 hover:bg-muted',
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
