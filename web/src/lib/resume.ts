import type { QuizItem } from '@/lib/types'

/** 服务端下发的「已经答过的题」 */
export type SavedAnswer = { item_id: number; answer: string; duration_ms: number }

/**
 * 按已答存档切出还没做的题。
 *
 * 孩子做到一半退出（平板息屏、被叫去吃饭），回来应该从第 11 题接着做，
 * 而不是重头再来——所以要先把答过的剔掉，剩下的才是这次要练的。
 */
export function resumeItems<T extends Pick<QuizItem, 'item_id'>>(
  items: T[],
  answered: SavedAnswer[] = [],
) {
  const ids = new Set(answered.map((a) => Number(a.item_id)))
  const remaining = items.filter((i) => !ids.has(Number(i.item_id)))
  return { remaining, answeredIds: ids, doneCount: ids.size }
}

/** 页头那句提示：直接说清进行到哪了。 */
export function resumeHint(total: number, doneCount: number, unit = '题') {
  if (doneCount <= 0) return ''
  return `上次做到第 ${doneCount} ${unit}，今天还剩 ${Math.max(0, total - doneCount)} ${unit}`
}
