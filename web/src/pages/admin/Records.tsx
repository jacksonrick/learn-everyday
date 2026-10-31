import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, qs } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/feedback'
import { SUBJECT_META } from '@/lib/utils'
import type { Subject } from '@/lib/types'

export default function RecordsPage() {
  const [childId, setChildId] = useState('')
  const [subject, setSubject] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [page, setPage] = useState(1)

  const children = useQuery({
    queryKey: ['admin-children'],
    queryFn: () => api.get<any[]>('/admin/children', true),
  })

  const records = useQuery({
    queryKey: ['admin-records', childId, subject, start, end, page],
    queryFn: () =>
      api.get<any>(
        `/admin/records${qs({ child_id: childId, subject, start, end, page, page_size: 30 })}`,
        true,
      ),
  })

  const total = records.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 30))

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">学习记录</h1>
        <p className="mt-1 text-sm text-muted-foreground">逐题作答明细，可用于复盘薄弱点</p>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-40"
            placeholder="全部孩子"
            options={(children.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
            value={childId}
            onChange={(e) => { setChildId(e.target.value); setPage(1) }}
          />
          <Select
            className="w-36"
            placeholder="全部科目"
            options={[
              { label: '语文', value: 'chinese' },
              { label: '数学', value: 'math' },
              { label: '英语', value: 'english' },
            ]}
            value={subject}
            onChange={(e) => { setSubject(e.target.value); setPage(1) }}
          />
          <Input type="date" className="w-40" value={start} onChange={(e) => { setStart(e.target.value); setPage(1) }} />
          <Input type="date" className="w-40" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1) }} />
        </div>
      </Card>

      <Card>
        {records.isLoading ? (
          <div className="p-4"><Skeleton className="h-40 w-full" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">日期</TableHead>
                <TableHead className="w-20">科目</TableHead>
                <TableHead>题目</TableHead>
                <TableHead className="w-28">作答</TableHead>
                <TableHead className="w-28">正确答案</TableHead>
                <TableHead className="w-20">结果</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(records.data?.items ?? []).length === 0 ? (
                <TableEmpty colSpan={6} />
              ) : (
                records.data.items.map((r: any) => {
                  // 古诗走「听读 → 背诵录音」，没有标准答案可比对，
                  // 交了录音就算完成（后端同样记 is_correct=true）
                  const isRecite = r.item_type === 'poem'
                  return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">{r.date}</TableCell>
                    <TableCell>{SUBJECT_META[r.subject as Subject]?.label ?? r.subject}</TableCell>
                    <TableCell className="max-w-md truncate text-sm">{r.stem}</TableCell>
                    <TableCell className="text-sm">{r.user_answer || '—'}</TableCell>
                    <TableCell className="text-sm text-emerald-700">
                      {r.correct_answer || (isRecite ? '以录音为准' : '—')}
                    </TableCell>
                    <TableCell>
                      {isRecite ? (
                        <Badge variant={r.is_correct ? 'success' : 'warn'}>
                          {r.is_correct ? '已背诵' : '未背诵'}
                        </Badge>
                      ) : (
                        <Badge variant={r.is_correct ? 'success' : 'danger'}>{r.is_correct ? '对' : '错'}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        )}
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <span>{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
