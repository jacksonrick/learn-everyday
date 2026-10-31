import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Ban, CalendarPlus } from 'lucide-react'
import { api, qs } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { currentMonth, todayStr } from '@/lib/utils'

export default function CheckinsPage() {
  const qc = useQueryClient()
  const [childId, setChildId] = useState('')
  const [month, setMonth] = useState(currentMonth())
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ child_id: '', date: todayStr() })

  const children = useQuery({
    queryKey: ['admin-children'],
    queryFn: () => api.get<any[]>('/admin/children', true),
  })

  const checkins = useQuery({
    queryKey: ['admin-checkins', childId, month],
    queryFn: () => api.get<any[]>(`/admin/checkins${qs({ child_id: childId, month })}`, true),
  })

  const makeup = async () => {
    if (!form.child_id) {
      toast.error('请选择孩子')
      return
    }
    try {
      await api.post('/admin/checkins/makeup', { child_id: Number(form.child_id), date: form.date }, true)
      toast.success('已补卡')
      setOpen(false)
      qc.invalidateQueries({ queryKey: ['admin-checkins'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '补卡失败')
    }
  }

  const remove = async (c: any) => {
    const okGo = confirm(
      `作废 ${nameOf(c.child_id)} 在 ${c.date} 的打卡？\n当天学习记录、未完成的任务和这天挣的 ${c.points} 积分都会清除，且不可恢复。`,
    )
    if (!okGo) return
    try {
      await api.del(`/admin/checkins/${c.id}`, true)
      toast.success('已作废，当天记录与积分已清除')
      qc.invalidateQueries({ queryKey: ['admin-checkins'] })
      qc.invalidateQueries({ queryKey: ['admin-points'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '作废失败')
    }
  }

  const nameOf = (id: number) => children.data?.find((c) => c.id === id)?.name ?? `#${id}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">打卡记录</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            补卡不计入连续天数，只补总天数；作废会把当天的学习记录、任务和积分一起清掉
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <CalendarPlus className="h-4 w-4" /> 手动补卡
        </Button>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-40"
            placeholder="全部孩子"
            options={(children.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
            value={childId}
            onChange={(e) => setChildId(e.target.value)}
          />
          <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>孩子</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>完成科目</TableHead>
              <TableHead>连续天数</TableHead>
              <TableHead>积分</TableHead>
              <TableHead className="w-16 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(checkins.data ?? []).length === 0 ? (
              <TableEmpty colSpan={7}>本月还没有打卡记录</TableEmpty>
            ) : (
              [...(checkins.data ?? [])].reverse().map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="text-sm">{c.date}</TableCell>
                  <TableCell>{nameOf(c.child_id)}</TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'full' ? 'success' : 'warn'}>
                      {c.status === 'full' ? '已打卡' : '部分完成'}
                    </Badge>
                    {c.is_makeup && <Badge variant="outline" className="ml-1">补</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {JSON.parse(c.subjects_json || '[]').join('、') || '—'}
                  </TableCell>
                  <TableCell>{c.streak}</TableCell>
                  <TableCell className="text-primary">+{c.points}</TableCell>
                  <TableCell className="text-right">
                    <button
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-amber-50 hover:text-amber-600"
                      title="作废这一天的打卡"
                      onClick={() => remove(c)}
                    >
                      <Ban className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动补卡</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>孩子</Label>
              <Select
                placeholder="请选择"
                options={(children.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
                value={form.child_id}
                onChange={(e) => setForm({ ...form, child_id: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>日期</Label>
              <Input type="date" max={todayStr()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={makeup}>确认补卡</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
