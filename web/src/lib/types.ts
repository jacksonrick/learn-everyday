export type Subject = 'chinese' | 'math' | 'english'

export interface Child {
  id: number
  name: string
  gender?: string
  birthday?: string | null
  grade_id: number | null
  grade_name: string
  term: string
  avatar: string
  age: number | null
  enabled?: boolean
}

export interface SubjectStatus {
  subject: Subject
  label: string
  status: 'pending' | 'doing' | 'done'
  score: number
  total: number
  correct: number
  duration_sec: number
}

export interface Bootstrap {
  child: Child | null
  need_setup: boolean
  subjects: SubjectStatus[]
  done_count: number
  checkin: { done: boolean; status: string; streak: number; points: number }
  points_balance: number
}

export interface QuizItem {
  item_id: number
  kind: string
  type: string
  stem: string
  ref_id?: number
  retry?: boolean
  wrong_id?: number
  options?: string[]
  tokens?: string[]
  [key: string]: unknown
}

export interface TaskPayload {
  task_id: number
  subject: Subject
  status: string
  score: number
  total: number
  items: QuizItem[]
}

export interface SubmitResult {
  score: number
  correct: number
  total: number
  duration_sec: number
  wrong: { item_id: number; stem: string; user_answer: string; correct_answer: string }[]
  retry_correct?: number
  points: { earned: number; detail: { reason: string; points: number }[]; balance: number }
  checkin: { done: boolean; newly_done: boolean; streak: number }
  already_done?: boolean
}

export interface Grade {
  id: number
  name: string
  stage: string
  created_at: string
}

export interface BankItem {
  id: number
  [key: string]: unknown
}

export interface PageResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}
