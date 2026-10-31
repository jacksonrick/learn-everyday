import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function todayStr(d = new Date()) {
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function currentMonth() {
  return todayStr().slice(0, 7)
}

export function fmtDuration(seconds: number) {
  if (!seconds) return '0 秒'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`
}

export function fmtDate(date: string) {
  const [, m, d] = date.split('-')
  return `${Number(m)}月${Number(d)}日`
}

export function weekdayOf(date: string) {
  const d = new Date(`${date}T00:00:00`)
  return ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
}

export const SUBJECT_META = {
  chinese: { label: '语文', emoji: '📖', color: 'var(--chinese)' },
  math: { label: '数学', emoji: '🔢', color: 'var(--math)' },
  english: { label: '英语', emoji: '🔤', color: 'var(--english)' },
} as const

export type Subject = keyof typeof SUBJECT_META
