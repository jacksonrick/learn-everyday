import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useChildStore } from '@/stores/child'
import type { Bootstrap } from '@/lib/types'

export function useSession() {
  const childId = useChildStore((s) => s.childId)
  const setChildId = useChildStore((s) => s.setChildId)

  const query = useQuery({
    queryKey: ['bootstrap', childId],
    queryFn: () => api.get<Bootstrap>(`/client/bootstrap${childId ? `?child_id=${childId}` : ''}`),
  })

  useEffect(() => {
    const id = query.data?.child?.id
    if (id && id !== childId) setChildId(id)
  }, [query.data, childId, setChildId])

  return query
}

/**
 * 开当天的科目任务。
 *
 * 同一个孩子同一科目可能被并发调用两次（React StrictMode 会把 effect 挂载两遍、
 * 或者家长开了两个标签页、手抖双击），两条 /task/start 都会发现「还没任务」
 * 然后各插一条，第二条撞 daily_task 唯一约束直接 500。这里让并发的第二次
 * 复用第一次的请求，服务端那边也有兜底（get_or_create_task 撞了唯一约束就取已有的）。
 */
const starting = new Map<string, Promise<any>>()

export function startTask(subject: string, childId?: number | null) {
  const key = `${childId ?? 'default'}:${subject}`
  const pending = starting.get(key)
  if (pending) return pending
  const task = api
    .post<any>('/client/task/start', { subject, child_id: childId ?? undefined })
    .finally(() => starting.delete(key))
  starting.set(key, task)
  return task
}

export function useSubmitTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { subject: string; answers: unknown[] }) =>
      api.post<any>('/client/task/submit', {
        ...payload,
        child_id: useChildStore.getState().childId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bootstrap'] })
    },
  })
}
