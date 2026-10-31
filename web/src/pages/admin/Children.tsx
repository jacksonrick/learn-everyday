import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Child, Grade } from '@/lib/types'

const AVATARS = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐎', '🐑', '🐒', '🐔', '🐶', '🐷']

export default function ChildrenPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)

  const children = useQuery({
    queryKey: ['admin-children'],
    queryFn: () => api.get<Child[]>('/admin/children', true),
  })
  const grades = useQuery({
    queryKey: ['grades'],
    queryFn: () => api.get<Grade[]>('/admin/grades?all=1', true),
  })

  const remove = async (row: Child) => {
    if (!confirm(`删除「${row.name}」及其全部学习记录？此操作不可恢复。`)) return
    try {
      await api.del(`/admin/children/${row.id}`, true)
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['admin-children'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">孩子管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">年级和学期只影响数学出题；语文、英语从全库随机抽取</p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> 添加孩子
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>姓名</TableHead>
              <TableHead>年级</TableHead>
              <TableHead>学期</TableHead>
              <TableHead>年龄</TableHead>
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(children.data ?? []).length === 0 ? (
              <TableEmpty colSpan={5}>还没有孩子，点右上角添加</TableEmpty>
            ) : (
              (children.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <span className="mr-2 text-lg">{c.avatar}</span>
                    <span className="font-medium">{c.name}</span>
                  </TableCell>
                  <TableCell>{c.grade_name || '未设置'}</TableCell>
                  <TableCell>{c.term === '上' ? '上学期' : '下学期'}</TableCell>
                  <TableCell>{c.age ?? '-'}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                        onClick={() => {
                          setEditing(c)
                          setOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                        onClick={() => remove(c)}
                      >
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

      <ChildForm
        open={open}
        onOpenChange={setOpen}
        row={editing}
        grades={grades.data ?? []}
        onSaved={() => {
          setOpen(false)
          qc.invalidateQueries({ queryKey: ['admin-children'] })
          qc.invalidateQueries({ queryKey: ['bootstrap'] })
        }}
      />
    </div>
  )
}

function ChildForm({
  open,
  onOpenChange,
  row,
  grades,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  row: any | null
  grades: Grade[]
  onSaved: () => void
}) {
  const [values, setValues] = useState<any>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setValues({
      name: row?.name ?? '',
      gender: row?.gender ?? 'male',
      birthday: row?.birthday ?? '',
      grade_id: row?.grade_id ?? '',
      term: row?.term ?? '上',
      avatar: row?.avatar ?? '🐣',
    })
  }, [open, row])

  const save = async () => {
    if (!values.name?.trim()) {
      toast.error('请填写姓名')
      return
    }
    setSaving(true)
    const payload = {
      ...values,
      grade_id: values.grade_id ? Number(values.grade_id) : null,
      birthday: values.birthday || null,
    }
    try {
      if (row?.id) await api.put(`/admin/children/${row.id}`, payload, true)
      else await api.post('/admin/children', payload, true)
      toast.success('已保存')
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.id ? '编辑孩子' : '添加孩子'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>姓名</Label>
            <Input value={values.name ?? ''} onChange={(e) => setValues({ ...values, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>年级</Label>
              <Select
                options={grades.map((g) => ({ label: g.name, value: g.id }))}
                placeholder="请选择"
                value={values.grade_id ?? ''}
                onChange={(e) => setValues({ ...values, grade_id: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>学期</Label>
              <Select
                options={[
                  { label: '上学期', value: '上' },
                  { label: '下学期', value: '下' },
                ]}
                value={values.term ?? '上'}
                onChange={(e) => setValues({ ...values, term: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>性别</Label>
              <Select
                options={[
                  { label: '男孩', value: 'male' },
                  { label: '女孩', value: 'female' },
                ]}
                value={values.gender ?? 'male'}
                onChange={(e) => setValues({ ...values, gender: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>生日</Label>
              <Input
                type="date"
                value={values.birthday ?? ''}
                onChange={(e) => setValues({ ...values, birthday: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>头像</Label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  onClick={() => setValues({ ...values, avatar: a })}
                  className={
                    values.avatar === a
                      ? 'flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-xl ring-2 ring-primary'
                      : 'flex h-10 w-10 items-center justify-center rounded-xl bg-muted text-xl'
                  }
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
