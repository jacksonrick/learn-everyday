import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Loader2, Mic, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, getToken, qs } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/feedback'

type Recitation = {
  id: number
  child_id: number
  child_name: string
  date: string
  subject: string
  title: string
  duration_ms: number
  size: number
  has_audio: boolean
  /** 后台给出的 url 已经带 /api/v1 前缀；<audio> 标签带不上 Authorization，先抓成 blob 再播 */
  url: string
  created_at: string
}

/** <audio> 标签带不上 Authorization，所以先带着 token 把文件抓成 blob 再播 */
function useAudioBlob(row: Recitation | null) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!row || !row.has_audio) {
      setUrl(null)
      return
    }
    let alive = true
    setLoading(true)
    fetch(row.url, { headers: { Authorization: `Bearer ${getToken()}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('读取失败'))))
      .then((blob) => {
        if (!alive) return
        setUrl(URL.createObjectURL(blob))
      })
      .catch(() => alive && setUrl(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [row?.id, row?.has_audio, row?.url])

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [url])

  return { url, loading }
}

export default function RecitationsPage() {
  const qc = useQueryClient()
  const [childId, setChildId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [page, setPage] = useState(1)
  const [active, setActive] = useState<Recitation | null>(null)

  const children = useQuery({
    queryKey: ['admin-children'],
    queryFn: () => api.get<any[]>('/admin/children', true),
  })

  const list = useQuery({
    queryKey: ['admin-recitations', childId, start, end, page],
    queryFn: () =>
      api.get<any>(
        `/admin/recitations${qs({ child_id: childId, start, end, page, page_size: 20 })}`,
        true,
      ),
  })

  const rows: Recitation[] = useMemo(() => list.data?.items ?? [], [list.data])
  const total = list.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 20))
  const { url: activeUrl, loading: audioLoading } = useAudioBlob(active)

  const remove = async (row: Recitation) => {
    if (!confirm('删掉这条背诵录音？删掉后这一天的古诗要重新背一遍才会再有记录。')) return
    try {
      await api.del(`/admin/recitations/${row.id}`, true)
      if (active?.id === row.id) setActive(null)
      toast.success('已删除')
      qc.invalidateQueries({ queryKey: ['admin-recitations'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">背诵录音</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          孩子在客户端录的古诗背诵。不判对错也不给分，只留一份声音的痕迹
        </p>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <Select
            className="w-40"
            placeholder="全部孩子"
            options={(children.data ?? []).map((c) => ({ label: c.name, value: c.id }))}
            value={childId}
            onChange={(e) => {
              setChildId(e.target.value)
              setPage(1)
            }}
          />
          <Input
            type="date"
            className="w-40"
            value={start}
            onChange={(e) => {
              setStart(e.target.value)
              setPage(1)
            }}
          />
          <Input
            type="date"
            className="w-40"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </Card>

      {active && (
        <Card className="border-persimmon/30 bg-persimmon-soft/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">
                《{active.title || '未命名'}》· {active.child_name} · {active.date}
              </p>
              <p className="text-xs text-muted-foreground">
                时长 {Math.max(1, Math.round(active.duration_ms / 1000))} 秒 ·{' '}
                {Math.round((active.size || 0) / 1024)} KB
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setActive(null)}>
              收起
            </Button>
          </div>
          <div className="mt-3">
            {audioLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> 正在取录音
              </p>
            ) : activeUrl ? (
              <audio src={activeUrl} controls autoPlay className="w-full" />
            ) : (
              <p className="text-sm text-red-600">录音文件不在了，可能是数据目录被换过</p>
            )}
          </div>
        </Card>
      )}

      <Card>
        {list.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                还没有背诵录音。孩子在客户端点「背诵」录一段，这里就能听到了
              </p>
            ) : (
              rows.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                      active?.id === r.id ? 'bg-persimmon text-white' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Mic className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">《{r.title || '未命名'}》</p>
                    <p className="text-xs text-muted-foreground">
                      {r.child_name} · {r.date} · {Math.max(1, Math.round(r.duration_ms / 1000))} 秒 ·{' '}
                      {Math.round((r.size || 0) / 1024)} KB
                    </p>
                  </div>
                  {!r.has_audio && <Badge variant="warn">文件缺失</Badge>}
                  <Button variant="outline" size="sm" onClick={() => setActive(r)}>
                    <Download className="h-4 w-4" /> 试听
                  </Button>
                  <button
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                    onClick={() => remove(r)}
                    aria-label="删除录音"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          <span>共 {total} 条</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </Button>
            <span>
              {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              下一页
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
