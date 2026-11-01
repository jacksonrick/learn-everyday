import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eye, Loader2, Pencil, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { api, qs } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TagInput } from '@/components/ui/tag-input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/feedback'
import type { Grade } from '@/lib/types'

export type Field = {
  name: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'list' | 'json' | 'switch' | 'select'
  options?: { label: string; value: string | number }[]
  placeholder?: string
  span?: 1 | 2
  required?: boolean
  hint?: string
}

export type Column = {
  name: string
  label: string
  className?: string
  render?: (row: any) => ReactNode
}

/** 列表筛选下拉：name 会作为查询参数传给后端 */
export type FilterDef = {
  name: string
  label: string
  options: { label: string; value: string }[]
}

export type BankConfig = {
  key: string
  path: string
  endpoint: string
  title: string
  description?: string
  columns: Column[]
  fields: Field[]
  withGrade?: boolean
  withTerm?: boolean
  /** 列表筛选（等级、词性、音标类型…），name 直接作为查询参数 */
  filters?: FilterDef[]
  /** 支持 AI 批量生成的类型；不填则不显示 AI 入口 */
  aiKind?: 'poem' | 'word' | 'sentence' | 'math_rule' | 'math_question'
  aiCount?: number
  aiPlaceholder?: string
  /**
   * 表单里的「AI 补全」：家长填好 from 指定的字段后，让模型补全其它字段。
   * key 会作为生成类型传给后端（char / word / sentence）。
   */
  aiFill?: { from: string; key: 'char' | 'word' | 'sentence'; hint: string }
  allowCreate?: boolean
  allowDelete?: boolean
}

type GeneratorParam = {
  key: string
  label: string
  default: number | boolean
  min?: number
  max?: number
  step?: number
  type?: 'bool'
}

type GeneratorSpec = {
  key: string
  topic: string
  grade?: string
  params: GeneratorParam[]
}

const TERMS = [
  { label: '上学期', value: '上' },
  { label: '下学期', value: '下' },
]

const TERMS_WITH_ALL = [{ label: '全学年', value: '' }, ...TERMS]

// 列表筛选用：'' 会被 qs 忽略，所以「未指定」用 none 表示
const FILTER_TERMS_ALL = [
  { label: '上学期', value: '上' },
  { label: '下学期', value: '下' },
  { label: '全学年', value: 'none' },
]

const POS_OPTIONS = [
  { label: '名词（n.）', value: 'n.' },
  { label: '动词（v.）', value: 'v.' },
  { label: '形容词（adj.）', value: 'adj.' },
  { label: '副词（adv.）', value: 'adv.' },
  { label: '代词（pron.）', value: 'pron.' },
  { label: '介词（prep.）', value: 'prep.' },
  { label: '连词（conj.）', value: 'conj.' },
  { label: '数词（num.）', value: 'num.' },
  { label: '冠词（art.）', value: 'art.' },
  { label: '感叹词（int.）', value: 'int.' },
  { label: '短语（phr.）', value: 'phr.' },
]

const POS_TEXT: Record<string, string> = {
  'n.': '名词',
  'v.': '动词',
  'adj.': '形容词',
  'adv.': '副词',
  'pron.': '代词',
  'prep.': '介词',
  'conj.': '连词',
  'num.': '数词',
  'art.': '冠词',
  'int.': '感叹词',
  'phr.': '短语',
}

const LEVEL_OPTIONS = [
  { label: '容易', value: '容易' },
  { label: '较易', value: '较易' },
  { label: '中等', value: '中等' },
  { label: '较难', value: '较难' },
  { label: '困难', value: '困难' },
]

const PHONEME_TYPES = [
  { label: '元音', value: 'vowel' },
  { label: '辅音', value: 'consonant' },
]

export const BANK_CONFIGS: BankConfig[] = [
  {
    key: 'chars',
    path: 'chinese/chars',
    endpoint: '/admin/chars',
    title: '识字库',
    description: '全库随机出题；填好汉字后可用 AI 自动补全拼音、部首、笔画、结构和组词',
    aiFill: { from: 'char', key: 'char', hint: '请先在「汉字」一栏填写一个字' },
    filters: [{ name: 'level', label: '全部等级', options: LEVEL_OPTIONS }],
    columns: [
      { name: 'char', label: '汉字', render: (r) => <span className="text-lg font-medium">{r.char}</span> },
      { name: 'pinyin', label: '拼音' },
      { name: 'radical', label: '部首' },
      { name: 'strokes', label: '笔画' },
      { name: 'structure', label: '结构' },
      { name: 'words_json', label: '组词', render: (r) => <span className="text-xs text-muted-foreground">{parseList(r.words_json).join(' / ')}</span> },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'char', label: '汉字', required: true, placeholder: '晨' },
      { name: 'pinyin', label: '拼音', required: true, placeholder: 'chén' },
      { name: 'radical', label: '部首', placeholder: '日' },
      { name: 'strokes', label: '笔画数', type: 'number' },
      { name: 'structure', label: '结构', placeholder: '上下 / 左右 / 半包围' },
      { name: 'words_json', label: '组词', type: 'list', placeholder: '输入后按回车添加，如 早晨', span: 2, hint: '回车或逗号分隔可连续添加，点 × 删除' },
      { name: 'sentence', label: '例句', type: 'textarea', span: 2 },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '出题时按 10/40/30/15/5 抽取' },
    ],
  },
  {
    key: 'poems',
    path: 'chinese/poems',
    endpoint: '/admin/poems',
    title: '古诗库',
    description: '全库随机出题；正文按句换行，背诵题会根据句子自动生成',
    aiKind: 'poem',
    aiCount: 5,
    aiPlaceholder: '如：偏向写景的唐诗，或某位诗人的作品',
    filters: [{ name: 'level', label: '全部等级', options: LEVEL_OPTIONS }],
    columns: [
      { name: 'title', label: '标题', render: (r) => <span className="font-medium">{r.title}</span> },
      { name: 'author', label: '作者' },
      { name: 'dynasty', label: '朝代' },
      { name: 'genre', label: '类型' },
      {
        name: 'content',
        label: '正文',
        render: (r) => <span className="line-clamp-2 max-w-md text-xs text-muted-foreground">{String(r.content).replace(/\n/g, ' / ')}</span>,
      },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'title', label: '标题', required: true },
      { name: 'author', label: '作者' },
      { name: 'dynasty', label: '朝代' },
      { name: 'genre', label: '类型', placeholder: '诗 / 词 / 文言文 / 蒙学' },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '出题时按 10/40/30/15/5 抽取' },
      { name: 'content', label: '正文（每句换行）', type: 'textarea', required: true, span: 2 },
      { name: 'translation', label: '译文', type: 'textarea', span: 2 },
      { name: 'notes', label: '注释', type: 'textarea', span: 2 },
      { name: 'appreciation', label: '赏析', type: 'textarea', span: 2 },
    ],
  },
  {
    key: 'words',
    path: 'english/words',
    endpoint: '/admin/words',
    title: '单词库',
    description: '全库随机出题；填好单词后可用 AI 补全音标、词性、释义和例句',
    aiKind: 'word',
    aiCount: 10,
    aiPlaceholder: '如：文具类单词，或补充身体部位词',
    aiFill: { from: 'word', key: 'word', hint: '请先在「单词」一栏填写单词' },
    filters: [
      { name: 'level', label: '全部等级', options: LEVEL_OPTIONS },
      { name: 'pos', label: '全部词性', options: POS_OPTIONS },
    ],
    columns: [
      { name: 'word', label: '单词', render: (r) => <span className="font-medium">{r.word}</span> },
      { name: 'phonetic', label: '音标' },
      { name: 'pos', label: '词性', render: (r) => POS_TEXT[r.pos] ?? (r.pos || '—') },
      { name: 'meaning', label: '释义' },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'word', label: '单词', required: true },
      { name: 'phonetic', label: '音标', placeholder: '/ˈruːlə/' },
      { name: 'pos', label: '词性', type: 'select', options: POS_OPTIONS },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '出题时按 10/40/30/15/5 抽取' },
      { name: 'meaning', label: '中文释义', required: true },
      { name: 'example', label: '英文例句', span: 2 },
      { name: 'example_cn', label: '例句翻译', span: 2 },
    ],
  },
  {
    key: 'sentences',
    path: 'english/sentences',
    endpoint: '/admin/sentences',
    title: '句子库',
    description: '全库随机出题；填好句子后可用 AI 补全中文、重点词和朗读提示；句子会自动拆成单词，生成排序题',
    aiKind: 'sentence',
    aiCount: 5,
    aiPlaceholder: '如：围绕 "This is my…" 的句型',
    aiFill: { from: 'en', key: 'sentence', hint: '请先在「英文句子」一栏填写句子' },
    filters: [{ name: 'level', label: '全部等级', options: LEVEL_OPTIONS }],
    columns: [
      { name: 'en', label: '英文', render: (r) => <span className="font-medium">{r.en}</span> },
      { name: 'cn', label: '中文' },
      { name: 'key_words', label: '重点词' },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'en', label: '英文句子', required: true, span: 2 },
      { name: 'cn', label: '中文翻译', span: 2 },
      { name: 'key_words', label: '重点词（逗号分隔）', span: 2 },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '出题时按 10/40/30/15/5 抽取' },
      { name: 'phonetic_tip', label: '发音提示', type: 'textarea', span: 2 },
    ],
  },
  {
    key: 'phonemes',
    path: 'english/phonemes',
    endpoint: '/admin/phonemes',
    title: '音标库',
    description: '系统内置 48 个国际音标（20 元音 + 28 辅音），可直接编辑例词与口型提示',
    allowCreate: false,
    allowDelete: false,
    filters: [{ name: 'type', label: '全部类型', options: PHONEME_TYPES }],
    columns: [
      { name: 'symbol', label: '音标', render: (r) => <span className="text-base font-medium">{r.symbol}</span> },
      { name: 'type', label: '类型', render: (r) => (r.type === 'vowel' ? '元音' : '辅音') },
      { name: 'category', label: '分类' },
      {
        name: 'examples_json',
        label: '例词',
        render: (r) => <span className="text-xs text-muted-foreground">{parseList(r.examples_json).join(', ')}</span>,
      },
      { name: 'mouth_tip', label: '口型提示', render: (r) => <span className="line-clamp-1 max-w-xs text-xs text-muted-foreground">{r.mouth_tip}</span> },
    ],
    fields: [
      { name: 'symbol', label: '音标符号', required: true, placeholder: '/iː/' },
      { name: 'type', label: '类型', type: 'select', options: PHONEME_TYPES },
      { name: 'category', label: '分类', placeholder: '长元音 / 短元音 / 双元音' },
      { name: 'examples_json', label: '例词', type: 'list', placeholder: '输入后按回车添加，如 see', span: 2, hint: '回车或逗号分隔可连续添加，点 × 删除' },
      { name: 'mouth_tip', label: '口型提示', type: 'textarea', span: 2 },
    ],
  },
  {
    key: 'rules',
    path: 'math/rules',
    endpoint: '/admin/math/rules',
    title: '出题规则',
    description: '数学严格按「年级 + 学期」出题：只取同年级同学期的规则；参数区间可调、可预览',
    withGrade: true,
    withTerm: true,
    aiKind: 'math_rule',
    aiCount: 4,
    filters: [{ name: 'level', label: '全部等级', options: LEVEL_OPTIONS }],
    aiPlaceholder: '如：三年级上以多位数乘一位数为主，适当加入整十整百乘法',
    columns: [
      { name: 'name', label: '知识点', render: (r) => <span className="font-medium">{r.name}</span> },
      { name: 'generator', label: '出题器', render: (r) => <code className="text-xs text-muted-foreground">{r.generator}</code> },
      { name: 'params_json', label: '参数', render: (r) => <code className="line-clamp-1 max-w-xs text-xs text-muted-foreground">{r.params_json}</code> },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'name', label: '知识点名称', required: true },
      { name: 'generator', label: '出题器', type: 'select', options: [], required: true },
      { name: 'topic', label: '题目标签' },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '计算题也按 10/40/30/15/5 分配' },
    ],
  },
  {
    key: 'questions',
    path: 'math/questions',
    endpoint: '/admin/math/questions',
    title: '应用题',
    description: '人工录入或由 AI 生成的应用题，答案统一为纯数字，判分时按数值比对',
    withGrade: true,
    withTerm: true,
    aiKind: 'math_question',
    aiCount: 5,
    filters: [{ name: 'level', label: '全部等级', options: LEVEL_OPTIONS }],
    aiPlaceholder: '如：围绕"每盒 12 支，买 5 盒"这类乘法情境',
    columns: [
      { name: 'stem', label: '题干', render: (r) => <span className="line-clamp-2 max-w-lg">{r.stem}</span> },
      { name: 'answer', label: '答案' },
      { name: 'unit', label: '单位' },
      { name: 'topic', label: '知识点' },
      { name: 'level', label: '等级' },
    ],
    fields: [
      { name: 'stem', label: '题干', type: 'textarea', required: true, span: 2 },
      { name: 'answer', label: '答案', required: true, hint: '只填数字，如 60' },
      { name: 'unit', label: '单位', placeholder: '元 / 个 / 米' },
      { name: 'topic', label: '知识点' },
      { name: 'level', label: '等级', type: 'select', options: LEVEL_OPTIONS, hint: '应用题按 10/40/30/15/5 抽取' },
      { name: 'solution', label: '解析', type: 'textarea', span: 2 },
    ],
  },
]

function gradeTermText(row: any): string {
  const grade = String(row?.grade_name ?? '').trim()
  const term = String(row?.term ?? '').trim()
  const name = grade || '无'
  return term ? `${name}-${term}` : name
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[]
  try {
    const arr = JSON.parse(String(value ?? '[]'))
    return Array.isArray(arr) ? arr : []
  } catch {
    return String(value ?? '')
      .split(/[,，|]/)
      .filter(Boolean)
  }
}

function parseParams(value: unknown): Record<string, any> {
  try {
    const obj = JSON.parse(String(value ?? '{}'))
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

type AiStatus = {
  enabled: boolean
  provider: string
  provider_label: string
  model: string
  configured: boolean
}

export default function BankPage({ config }: { config: BankConfig }) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [term, setTerm] = useState('')
  // 各库自己的筛选（等级 / 词性 / 音标类型），键就是查询参数名
  const [extra, setExtra] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<any | null>(null)
  const [open, setOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)

  const canCreate = config.allowCreate !== false
  const canDelete = config.allowDelete !== false
  const isRule = config.key === 'rules'

  const gradesQuery = useQuery({
    queryKey: ['grades'],
    queryFn: () => api.get<Grade[]>('/admin/grades?all=1', true),
    enabled: Boolean(config.withGrade),
  })

  const specsQuery = useQuery({
    queryKey: ['math-generators'],
    queryFn: () => api.get<GeneratorSpec[]>('/admin/math/generators', true),
    enabled: isRule,
  })

  const aiQuery = useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AiStatus>('/admin/ai/status', true),
    enabled: Boolean(config.aiKind || config.aiFill),
  })

  const query = useQuery({
    queryKey: [config.key, page, q, gradeId, term, extra],
    queryFn: () =>
      api.get<any>(
        `${config.endpoint}${qs({ page, page_size: 20, q, grade_id: gradeId, term, ...extra })}`,
        true,
      ),
  })

  const gradeOptions = useMemo(
    () => (gradesQuery.data ?? []).map((g) => ({ label: `${g.name}（${g.stage}）`, value: g.id })),
    [gradesQuery.data],
  )

  const gradeFilterOptions = useMemo(
    () => [...gradeOptions, { label: '未指定', value: 'none' }],
    [gradeOptions],
  )

  const specs = specsQuery.data ?? []
  const aiReady = Boolean(aiQuery.data?.configured)

  const termOptions = FILTER_TERMS_ALL

  const fields = useMemo(() => {
    if (!isRule) return config.fields
    const genOptions = specs.map((s) => ({
      label: `${s.topic}（${s.key}）`,
      value: s.key,
    }))
    return config.fields.map((f) => (f.name === 'generator' ? { ...f, options: genOptions } : f))
  }, [config.fields, isRule, specs])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: [config.key] })
  }

  const remove = async (row: any) => {
    const label = row.char ?? row.title ?? row.word ?? row.name ?? row.stem ?? row.symbol ?? row.id
    if (!confirm(`确定删除「${label}」吗？`)) return
    try {
      await api.del(`${config.endpoint}/${row.id}`, true)
      toast.success('已删除')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const openAi = () => {
    if (!aiReady) {
      toast.error('还没有配置大模型 API Key，请先到「系统设置 → AI 智能助手」填写')
      return
    }
    setAiOpen(true)
  }

  const total = query.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{config.title}</h1>
          {config.description && <p className="mt-1 text-sm text-muted-foreground">{config.description}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {config.aiKind && (
            <Button variant="outline" onClick={openAi} title={aiReady ? '调用大模型批量生成' : '请先配置大模型'}>
              <Sparkles className="h-4 w-4" /> AI 生成
            </Button>
          )}
          {canCreate && (
            <Button
              onClick={() => {
                setEditing({})
                setOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> 新增
            </Button>
          )}
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="搜索…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </div>
          {config.withGrade && (
            <Select
              className="w-40"
              options={gradeFilterOptions}
              placeholder="全部年级"
              value={gradeId}
              onChange={(e) => {
                setGradeId(e.target.value)
                setPage(1)
              }}
            />
          )}
          {config.withTerm && (
            <Select
              className="w-32"
              options={termOptions}
              placeholder="全部学期"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value)
                setPage(1)
              }}
            />
          )}
          {(config.filters ?? []).map((f) => (
            <Select
              key={f.name}
              className="w-36"
              options={f.options}
              placeholder={f.label}
              value={extra[f.name] ?? ''}
              onChange={(e) => {
                setExtra((v) => ({ ...v, [f.name]: e.target.value }))
                setPage(1)
              }}
            />
          ))}
        </div>
      </Card>

      <Card>
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {config.columns.map((c) => (
                  <TableHead key={c.name}>{c.label}</TableHead>
                ))}
                {config.withGrade && <TableHead className="whitespace-nowrap">年级学期</TableHead>}
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(query.data?.items ?? []).length === 0 ? (
                <TableEmpty colSpan={config.columns.length + (config.withGrade ? 2 : 1)}>
                  还没有数据，点右上角「{canCreate ? '新增」' : 'AI 生成」'}
                </TableEmpty>
              ) : (
                (query.data?.items ?? []).map((row: any) => (
                  <TableRow key={row.id}>
                    {config.columns.map((c) => (
                      <TableCell key={c.name} className={c.className}>
                        {c.render ? c.render(row) : String(row[c.name] ?? '')}
                      </TableCell>
                    ))}
                    {config.withGrade && (
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {gradeTermText(row)}
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"
                          onClick={() => {
                            setEditing(row)
                            setOpen(true)
                          }}
                          title="编辑"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {canDelete && (
                          <button
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-500"
                            onClick={() => remove(row)}
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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

      <BankForm
        open={open}
        onOpenChange={setOpen}
        config={config}
        fields={fields}
        row={editing}
        grades={gradeOptions}
        specs={specs}
        aiReady={aiReady}
        onSaved={() => {
          setOpen(false)
          refresh()
        }}
      />

      {config.aiKind && (
        <AiGenerateDialog
          open={aiOpen}
          onOpenChange={setAiOpen}
          config={config}
          grades={gradeOptions}
          onDone={refresh}
        />
      )}
    </div>
  )
}

function BankForm({
  open,
  onOpenChange,
  config,
  fields,
  row,
  grades,
  specs,
  aiReady,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  config: BankConfig
  fields: Field[]
  row: any | null
  grades: { label: string; value: number }[]
  specs: GeneratorSpec[]
  aiReady: boolean
  onSaved: () => void
}) {
  const isRule = config.key === 'rules'
  const [values, setValues] = useState<Record<string, any>>({})
  const [params, setParams] = useState<Record<string, any>>({})
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [preview, setPreview] = useState<{ stem: string; answer: string }[] | null>(null)
  const [previewing, setPreviewing] = useState(false)

  const defaultTerm = '上' 

  useEffect(() => {
    if (!open) return
    const base: Record<string, any> = {}
    fields.forEach((f) => {
      const v = row?.[f.name]
      if (f.type === 'list') base[f.name] = parseList(v)
      else if (f.type === 'switch') base[f.name] = v === undefined ? true : !!v
      else if (f.name === 'level') base[f.name] = v || '中等'
      else base[f.name] = v ?? ''
    })
    base.grade_id = row?.grade_id ?? ''
    base.term = row?.term ?? defaultTerm
    if (isRule && !base.generator) base.generator = specs[0]?.key ?? ''
    setValues(base)

    if (isRule) {
      const raw = parseParams(row?.params_json)
      const spec = specs.find((s) => s.key === base.generator)
      const next: Record<string, any> = { ...raw }
      spec?.params.forEach((p) => {
        if (next[p.key] === undefined) next[p.key] = p.default
      })
      setParams(next)
    } else {
      setParams({})
    }
    setPreview(null)
  }, [open, row, config, fields, specs, isRule, defaultTerm])

  const currentSpec = useMemo(
    () => specs.find((s) => s.key === values.generator),
    [specs, values.generator],
  )

  const changeGenerator = (key: string) => {
    const spec = specs.find((s) => s.key === key)
    const next: Record<string, any> = {}
    spec?.params.forEach((p) => {
      next[p.key] = p.default
    })
    setParams(next)
    setPreview(null)
    setValues((v) => ({ ...v, generator: key, name: v.name || spec?.topic || '' }))
  }

  const aiFill = async () => {
    const fill = config.aiFill
    if (!fill) return
    const source = String(values[fill.from] ?? '').trim()
    if (!source) {
      toast.error(fill.hint)
      return
    }
    if (!aiReady) {
      toast.error('还没有配置大模型 API Key，请先到「系统设置 → AI 智能助手」填写')
      return
    }
    setAiBusy(true)
    try {
      const res = await api.post<{ items: any[] }>(
        '/admin/ai/suggest',
        { kind: fill.key, context: { [fill.key]: source } },
        true,
      )
      const item = res.items?.[0]
      if (!item) throw new Error('模型没有返回结果，请重试')
      setValues((v) => {
        const next = { ...v }
        fields.forEach((f) => {
          // 家长自己填的那个字段不覆盖，其余按模型结果回填
          if (f.name === fill.from) return
          const val = item[f.name]
          if (val === undefined || val === null || val === '') return
          next[f.name] = f.type === 'list' ? parseList(val) : val
        })
        return next
      })
      toast.success('已自动补全，检查一下再保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'AI 补全失败')
    } finally {
      setAiBusy(false)
    }
  }

  const runPreview = async () => {
    if (!values.generator) {
      toast.error('请先选择出题器')
      return
    }
    setPreviewing(true)
    try {
      const res = await api.post<{ stem: string; answer: string }[]>(
        '/admin/math/rules/test',
        { generator: values.generator, params: cleanParams(currentSpec, params) },
        true,
      )
      setPreview(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '预览失败')
    } finally {
      setPreviewing(false)
    }
  }

  const save = async () => {
    setSaving(true)
    const payload: Record<string, any> = {}
    fields.forEach((f) => {
      let v = values[f.name]
      if (f.type === 'list') {
        v = JSON.stringify(Array.isArray(v) ? v : parseList(v))
      }
      if (f.type === 'number') v = v === '' ? 0 : Number(v)
      if (f.type === 'switch') v = !!v
      payload[f.name] = v
    })
    if (isRule) payload.params_json = JSON.stringify(cleanParams(currentSpec, params))
    if (config.withGrade) payload.grade_id = values.grade_id ? Number(values.grade_id) : null
    if (config.withTerm) payload.term = values.term ?? defaultTerm

    try {
      if (row?.id) await api.put(`${config.endpoint}/${row.id}`, payload, true)
      else await api.post(config.endpoint, payload, true)
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <DialogTitle>
              {row?.id ? '编辑' : '新增'} · {config.title}
            </DialogTitle>
            {config.aiFill && (
              <Button
                size="sm"
                variant="outline"
                onClick={aiFill}
                disabled={aiBusy}
                title={aiReady ? config.aiFill.hint : '请先到「系统设置 → AI 智能助手」配置大模型'}
              >
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                AI 补全
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {config.withGrade && (
            <div className="space-y-1.5">
              <Label>年级</Label>
              <Select
                options={grades}
                placeholder="未指定"
                value={values.grade_id ?? ''}
                onChange={(e) => setValues({ ...values, grade_id: e.target.value })}
              />
            </div>
          )}
          {config.withTerm && (
            <div className="space-y-1.5">
              <Label>学期</Label>
              <Select
                options={TERMS_WITH_ALL}
                value={values.term ?? defaultTerm}
                onChange={(e) => setValues({ ...values, term: e.target.value })}
              />
            </div>
          )}

          {fields.map((f) => {
            if (f.type === 'switch') {
              return (
                <div
                  key={f.name}
                  className="col-span-2 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3"
                >
                  <div>
                    <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
                    {f.hint && <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>}
                  </div>
                  <Switch
                    id={`f-${f.name}`}
                    checked={!!values[f.name]}
                    onCheckedChange={(v) => setValues({ ...values, [f.name]: v })}
                  />
                </div>
              )
            }
            return (
              <div key={f.name} className={f.span === 2 ? 'col-span-2 space-y-1.5' : 'space-y-1.5'}>
                <Label>
                  {f.label}
                  {f.required && <span className="ml-0.5 text-red-500">*</span>}
                </Label>
                {f.type === 'select' ? (
                  <Select
                    options={f.options ?? []}
                    placeholder={f.placeholder ?? '请选择'}
                    value={values[f.name] ?? ''}
                    onChange={(e) =>
                      f.name === 'generator'
                        ? changeGenerator(e.target.value)
                        : setValues({ ...values, [f.name]: e.target.value })
                    }
                  />
                ) : f.type === 'textarea' || f.type === 'json' ? (
                  <textarea
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    placeholder={f.placeholder}
                    className="min-h-[84px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                ) : f.type === 'list' ? (
                  <TagInput
                    id={`f-${f.name}`}
                    value={Array.isArray(values[f.name]) ? values[f.name] : parseList(values[f.name])}
                    onChange={(next) => setValues({ ...values, [f.name]: next })}
                    placeholder={f.placeholder}
                  />
                ) : (
                  <Input
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={values[f.name] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                    placeholder={f.placeholder}
                  />
                )}
                {f.hint && (
                  <p className="text-xs text-muted-foreground">{f.hint}</p>
                )}
              </div>
            )
          })}
        </div>

        {isRule && (
          <div className="mt-5 rounded-xl border border-border bg-muted/20 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">出题器参数</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {currentSpec
                    ? `当前：${currentSpec.topic}${currentSpec.grade ? ` · 建议${currentSpec.grade}` : ''}`
                    : '先选择出题器'}
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={runPreview} disabled={previewing || !values.generator}>
                {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                预览 5 道
              </Button>
            </div>

            {currentSpec && currentSpec.params.length === 0 && (
              <p className="text-xs text-muted-foreground">这个出题器没有可调参数，题目会按教材常规范围随机生成。</p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {currentSpec?.params.map((p) => (
                <div key={p.key} className="space-y-1.5">
                  <Label className="text-xs">{p.label}</Label>
                  {p.type === 'bool' ? (
                    <div className="pt-1">
                      <Switch
                        checked={!!params[p.key]}
                        onCheckedChange={(v) => setParams({ ...params, [p.key]: v })}
                      />
                    </div>
                  ) : (
                    <Input
                      type="number"
                      step={p.step ?? 1}
                      min={p.min}
                      max={p.max}
                      value={params[p.key] ?? ''}
                      onChange={(e) => setParams({ ...params, [p.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>

            {preview && (
              <div className="mt-3 space-y-1 rounded-lg bg-card p-3 text-sm">
                <p className="text-xs text-muted-foreground">预览（答案仅供参考，保存后才会用于出题）</p>
                {preview.length === 0 && <p className="text-xs text-muted-foreground">没有生成出题目，请检查参数</p>}
                {preview.map((q, i) => (
                  <p key={i} className="font-mono text-sm">
                    {q.stem} <span className="text-muted-foreground">{q.answer}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

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

function cleanParams(spec: GeneratorSpec | undefined, params: Record<string, any>) {
  const out: Record<string, any> = {}
  spec?.params.forEach((p) => {
    const raw = params[p.key]
    if (p.type === 'bool') {
      out[p.key] = !!raw
      return
    }
    if (raw === '' || raw === null || raw === undefined) return
    const num = Number(raw)
    if (!Number.isNaN(num)) out[p.key] = num
  })
  return out
}

function AiGenerateDialog({
  open,
  onOpenChange,
  config,
  grades,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  config: BankConfig
  grades: { label: string; value: number }[]
  onDone: () => void
}) {
  const isRule = config.key === 'rules'
  const [gradeId, setGradeId] = useState('')
  const [term, setTerm] = useState('')
  const [count, setCount] = useState(config.aiCount ?? 5)
  const [requirement, setRequirement] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!open) return
    setCount(config.aiCount ?? 5)
    setTerm('')
    setRequirement('')
    setStatus('')
  }, [open, config.aiCount, isRule])

  const needGrade = config.key === 'rules' || config.key === 'questions'

  const run = async () => {
    if (needGrade && !gradeId) {
      toast.error('数学题需要先选择年级')
      return
    }
    setBusy(true)
    setStatus('正在请求大模型…')
    try {
      const res = await api.post<{ items: any[] }>(
        '/admin/ai/suggest',
        {
          kind: config.aiKind,
          context: {
            // 只有数学需要年级学期；语文/英语题库不关联这两项
            ...(needGrade ? { grade_id: Number(gradeId), term } : {}),
            count,
            requirement,
            topic: requirement,
          },
        },
        true,
      )
      const items = res.items ?? []
      if (items.length === 0) {
        setStatus('模型没有返回可用于新增的内容，可以换个描述再试。')
        toast.error('没有生成新内容（可能与现有数据重复）')
        return
      }
      let created = 0
      const skipped: string[] = []
      for (let i = 0; i < items.length; i += 1) {
        setStatus(`正在入库 ${i + 1}/${items.length}…`)
        const label = String(items[i].title ?? items[i].word ?? items[i].en ?? items[i].name ?? items[i].stem ?? `第 ${i + 1} 条`)
        try {
          await api.post(
            config.endpoint,
            {
              ...items[i],
              ...(needGrade ? { grade_id: gradeId ? Number(gradeId) : null, term } : {}),
            },
            true,
          )
          created += 1
        } catch (e) {
          skipped.push(e instanceof Error && e.message ? e.message : label)
        }
      }
      const tail = skipped.length ? `，跳过 ${skipped.length} 条` : ''
      setStatus(`完成：新增 ${created} 条${tail}${skipped.length ? `\n跳过：${skipped.join('、')}` : ''}`)
      if (created) {
        toast.success(`已新增 ${created} 条${tail}`)
        onDone()
        onOpenChange(false)
      } else {
        toast.error(`没有新增内容${skipped.length ? `：${skipped[0]}` : ''}`)
      }
    } catch (e) {
      setStatus('')
      toast.error(e instanceof Error ? e.message : 'AI 生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>AI 生成 · {config.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {needGrade && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>年级</Label>
                <Select
                  options={grades}
                  placeholder="请选择（必填）"
                  value={gradeId}
                  onChange={(e) => setGradeId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>学期</Label>
                <Select
                  options={isRule ? TERMS_WITH_ALL : TERMS}
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>生成数量</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
            />
            <p className="text-xs text-muted-foreground">
              一次最多 20 条；会自动避开库里已有的内容，重复的会被跳过
            </p>
          </div>

          {isRule ? (
            <div className="space-y-1.5">
              <Label>补充要求（可选）</Label>
              <textarea
                className="min-h-[72px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={config.aiPlaceholder ?? '如：以多位数乘一位数为主'}
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                模型只会从系统已有的出题器中选择，不会写代码，生成的规则可直接使用
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>补充要求（可选）</Label>
              <textarea
                className="min-h-[72px] w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={config.aiPlaceholder ?? '如：围绕某个主题'}
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
              />
            </div>
          )}

          {status && <p className="whitespace-pre-line text-xs text-muted-foreground">{status}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            取消
          </Button>
          <Button onClick={run} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {busy ? '生成中…' : '开始生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
