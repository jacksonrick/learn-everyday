import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function RewardsPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)

  const rewards = useQuery({
    queryKey: ['admin-rewards'],
    queryFn: () => api.get<any[]>('/admin/rewards', true),
  })
  const redemptions = useQuery({
    queryKey: ['admin-redemptions'],
    queryFn: () => api.get<any[]>('/admin/redemptions?status=all', true),
  })

  const handle = async (id: number, action: 'approve' | 'reject') => {
    try {
      await api.post(`/admin/redemptions/${id}/${action}`, {}, true)
      toast.success(action === 'approve' ? '已通过，积分已扣除' : '已驳回')
      qc.invalidateQueries({ queryKey: ['admin-redemptions'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    }
  }

  const remove = async (id: number) => {
    if (!confirm('删除这个奖励？')) return
    try {
      await api.del(`/admin/rewards/${id}`, true)
      qc.invalidateQueries({ queryKey: ['admin-rewards'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">奖励与兑换</h1>
          <p className="mt-1 text-sm text-muted-foreground">孩子用积分申请，家长在这里审批</p>
        </div>
        <Button onClick={() => { setEditing(null); setOpen(true) }}>
          <Plus className="h-4 w-4" /> 新增奖项
        </Button>
      </div>

      <Card>
        <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">奖励清单</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>奖励</TableHead>
              <TableHead>所需积分</TableHead>
              <TableHead>库存</TableHead>
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(rewards.data ?? []).length === 0 ? (
              <TableEmpty colSpan={4}>还没有奖励，先加一个「周末多看 30 分钟动画」试试</TableEmpty>
            ) : (
              (rewards.data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="mr-2 text-lg">{r.icon}</span>
                    {r.name}
                  </TableCell>
                  <TableCell className="text-primary">{r.cost}</TableCell>
                  <TableCell>{r.stock < 0 ? '不限' : r.stock}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" onClick={() => { setEditing(r); setOpen(true) }}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500" onClick={() => remove(r.id)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <div className="border-b border-border/60 px-4 py-3 text-sm font-medium">兑换申请</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>奖励</TableHead>
              <TableHead>消耗</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>时间</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(redemptions.data ?? []).length === 0 ? (
              <TableEmpty colSpan={4}>暂无兑换申请</TableEmpty>
            ) : (
              (redemptions.data ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {r.reward_icon} {r.reward_name || `#${r.reward_id}`}
                  </TableCell>
                  <TableCell>{r.cost}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warn' : 'outline'}>
                      {r.status === 'pending' ? '待审批' : r.status === 'approved' ? '已通过' : '已驳回'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.created_at?.slice(0, 16).replace('T', ' ')}</TableCell>
                  <TableCell className="text-right">
                    {r.status === 'pending' && (
                      <div className="flex justify-end gap-1">
                        <button className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" onClick={() => handle(r.id, 'approve')}>
                          <Check className="h-4 w-4" />
                        </button>
                        <button className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" onClick={() => handle(r.id, 'reject')}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <RewardForm
        open={open}
        onOpenChange={setOpen}
        row={editing}
        onSaved={() => {
          setOpen(false)
          qc.invalidateQueries({ queryKey: ['admin-rewards'] })
        }}
      />
    </div>
  )
}

function RewardForm({
  open,
  onOpenChange,
  row,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  row: any | null
  onSaved: () => void
}) {
  const [values, setValues] = useState<any>({})

  useEffect(() => {
    if (!open) return
    setValues({
      name: row?.name ?? '',
      cost: row?.cost ?? 100,
      icon: row?.icon ?? '🎁',
      stock: row?.stock ?? -1,
    })
  }, [open, row])

  const save = async () => {
    if (!values.name?.trim()) {
      toast.error('请填写奖励名称')
      return
    }
    try {
      const payload = {
        ...values,
        cost: Number(values.cost) || 0,
        stock: Number(values.stock) || -1,
      }
      if (row?.id) await api.put(`/admin/rewards/${row.id}`, payload, true)
      else await api.post('/admin/rewards', payload, true)
      toast.success('已保存')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.id ? '编辑奖励' : '新增奖励'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[72px_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>图标</Label>
              <Input value={values.icon ?? '🎁'} onChange={(e) => setValues({ ...values, icon: e.target.value })} className="text-center text-lg" />
            </div>
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input placeholder="如：周末多看 30 分钟动画" value={values.name ?? ''} onChange={(e) => setValues({ ...values, name: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>所需积分</Label>
              <Input type="number" value={values.cost ?? 100} onChange={(e) => setValues({ ...values, cost: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>库存（-1 不限）</Label>
              <Input type="number" value={values.stock ?? -1} onChange={(e) => setValues({ ...values, stock: e.target.value })} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={save}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
