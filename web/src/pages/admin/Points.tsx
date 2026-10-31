import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { api, qs } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// 手动调整的快捷项：点一下就把分值 + 原因填进表单。
// 想增减条目直接改这里，不涉及接口。
const QUICK_PRESETS: { title: string; tone: 'reward' | 'penalty'; items: { label: string; delta: number }[] }[] = [
  {
    title: '奖励类',
    tone: 'reward',
    items: [
      { label: '打扫卫生', delta: 5 },
      { label: '洗碗', delta: 5 },
      { label: '拿快递', delta: 5 },
      { label: '考试A', delta: 20 },
      { label: '作业A', delta: 10 },
    ],
  },
  {
    title: '惩罚类',
    tone: 'penalty',
    items: [
      { label: '看电视超时', delta: -10 },
      { label: '说脏话', delta: -20 },
      { label: '顶嘴', delta: -20 },
    ],
  },
]

export default function PointsPage() {
  const qc = useQueryClient()
  const [childId, setChildId] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ child_id: '', delta: '', note: '' })

  const children = useQuery({
    queryKey: ['admin-children'],
    queryFn: () => api.get<any[]>('/admin/children', true),
  })

  const ledger = useQuery({
    queryKey: ['admin-points', childId, page],
    queryFn: () => api.get<any>(`/admin/points${qs({ child_id: childId, page, page_size: 30 })}`, true),
  })

  const adjust = async () => {
    if (!form.child_id || !form.delta) {
      toast.error('请选择孩子并填写分值')
      return
    }
    try {
      await api.post(
        '/admin/points/adjust',
        { child_id: Number(form.child_id), delta: Number(form.delta), note: form.note },
        true,
      )
      toast.success('已调整')
      setOpen(false)
      setForm({ child_id: '', delta: '', note: '' })
      qc.invalidateQueries({ queryKey: ['admin-points'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '调整失败')
    }
  }

  const balances = ledger.data?.balances ?? {}
  const total = ledger.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 30))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">积分管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">流水只增不改，手动调整会写入一条新记录</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> 手动积分
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(children.data ?? []).map((c: any) => (
          <Card key={c.id} className="flex items-center gap-3 p-4">
            <span className="text-2xl">{c.avatar}</span>
            <div>
              <p className="text-sm text-muted-foreground">{c.name}</p>
              <p className="text-xl font-semibold text-primary">{balances[c.id] ?? 0}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-3">
        <Select
          className="w-40"
          placeholder="全部孩子"
          options={(children.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
          value={childId}
          onChange={(e) => { setChildId(e.target.value); setPage(1) }}
        />
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">日期</TableHead>
              <TableHead className="w-24">孩子</TableHead>
              <TableHead>原因</TableHead>
              <TableHead>备注</TableHead>
              <TableHead className="w-20">变动</TableHead>
              <TableHead className="w-24">余额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(ledger.data?.items ?? []).length === 0 ? (
              <TableEmpty colSpan={6} />
            ) : (
              ledger.data.items.map((p: any) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs text-muted-foreground">{p.date}</TableCell>
                  <TableCell className="text-sm">{p.child_name || '—'}</TableCell>
                  <TableCell className="text-sm">{p.reason_label ?? p.reason}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{p.note || '—'}</TableCell>
                  <TableCell className={p.delta > 0 ? 'text-emerald-600' : 'text-red-500'}>
                    {p.delta > 0 ? '+' : ''}
                    {p.delta}
                  </TableCell>
                  <TableCell>{p.balance_after}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <span>{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>手动调整积分</DialogTitle>
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
            <div className="space-y-2">
              <Label>快捷选择</Label>
              {QUICK_PRESETS.map((group) => (
                <div key={group.title} className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{group.title}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.items.map((item) => {
                      const active = form.delta === String(item.delta) && form.note === item.label
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => setForm({ ...form, delta: String(item.delta), note: item.label })}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition',
                            'hover:border-primary/60 hover:bg-accent',
                            active
                              ? 'border-primary bg-accent font-medium text-foreground'
                              : 'border-border bg-card text-muted-foreground',
                          )}
                        >
                          <span>{item.label}</span>
                          <span
                            className={cn(
                              'font-semibold',
                              item.delta > 0 ? 'text-emerald-600' : 'text-red-500',
                            )}
                          >
                            {item.delta > 0 ? `+${item.delta}` : item.delta}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>分值（可为负数）</Label>
              <Input
                type="number"
                placeholder="如 50 或 -20"
                value={form.delta}
                onChange={(e) => setForm({ ...form, delta: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>原因</Label>
              <Input
                placeholder="如：主动帮妈妈做家务"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={adjust}>确认</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
