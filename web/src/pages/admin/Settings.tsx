import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, History, Library, Loader2, PlugZap, Save, Sparkles } from 'lucide-react'
import { api, downloadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const NUMBERS: { key: string; label: string; hint?: string }[] = [
  { key: 'english_word_read', label: '英语单词朗读数量', hint: '默认 10 个，朗读卡不计分' },
  { key: 'math_count', label: '数学每日题量', hint: '默认 20' },
  { key: 'daily_point_cap', label: '每日积分上限', hint: '默认 100，防刷' },
  { key: 'point_per_subject', label: '单科完成积分', hint: '正确率 ≥60%' },
  { key: 'point_per_excellent', label: '正确率优秀加分', hint: '≥90% 额外加' },
  { key: 'point_checkin', label: '打卡积分', hint: '三科完成' },
  { key: 'point_wrong_fix', label: '错题订正积分', hint: '重练答对一道给多少' },
  { key: 'point_wrong_fix_cap', label: '订正积分日上限', hint: '默认 20，防刷' },
]

const SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: 'english_phoneme', label: '每日音标练习', hint: '2 个音标朗读 + 2 道音标选词' },
  { key: 'english_sentence', label: '每日句子排序', hint: '1 道单词组句' },
  { key: 'srs_enabled', label: '遗忘曲线复习', hint: '按 1/2/4/7/15/30 天安排复习；关掉后每天全库随机' },
  { key: 'instant_feedback', label: '答题即时反馈', hint: '每题提交后立刻显示对错；关掉则交卷后才看结果' },
  { key: 'audio_enabled', label: '语音朗读', hint: '客户端显示「听读音 / 播放」按钮' },
]

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<any>('/admin/settings', true),
  })
  const [form, setForm] = useState<any>({})
  const [pwd, setPwd] = useState({ old_password: '', new_password: '' })
  const [aiBusy, setAiBusy] = useState<'save' | 'test' | ''>('')
  const [callsOpen, setCallsOpen] = useState(false)

  useEffect(() => {
    if (data) setForm({ ...data, ai_api_key: '' })
  }, [data])

  const aiPayload = () => {
    const payload: Record<string, any> = {
      ai_enabled: !!form.ai_enabled,
      ai_provider: form.ai_provider || 'deepseek',
      ai_base_url: (form.ai_base_url || 'https://api.deepseek.com/v1').trim(),
      ai_model: (form.ai_model || 'deepseek-flash').trim(),
      ai_thinking: !!form.ai_thinking,
    }
    const key = String(form.ai_api_key ?? '').trim()
    if (key) payload.ai_api_key = key
    return payload
  }

  const save = async () => {
    const payload: Record<string, any> = aiPayload()
    NUMBERS.forEach((n) => (payload[n.key] = Number(form[n.key]) || 0))
    SWITCHES.forEach((s) => (payload[s.key] = !!form[s.key]))
    try {
      await api.put('/admin/settings', payload, true)
      toast.success('设置已保存，明天的任务按新配置生成')
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  const saveAi = async (thenTest = false) => {
    setAiBusy(thenTest ? 'test' : 'save')
    try {
      await api.put('/admin/settings', aiPayload(), true)
      if (thenTest) {
        await api.post('/admin/ai/test', {}, true)
        toast.success('连接成功，模型已正常响应')
      } else {
        toast.success('AI 配置已保存')
      }
      setForm((f: any) => ({ ...f, ai_api_key: '' }))
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : thenTest ? '连接失败' : '保存失败')
    } finally {
      setAiBusy('')
    }
  }

  const changePassword = async () => {
    try {
      await api.post('/admin/password', pwd, true)
      toast.success('密码已修改')
      setPwd({ old_password: '', new_password: '' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '修改失败')
    }
  }

  if (isLoading) return <Skeleton className="h-72 w-full" />

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">系统设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          大模型、每日题量与积分规则；修改后对下一次生成的任务生效
        </p>
      </div>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">每日任务量</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {NUMBERS.map((n) => (
            <div key={n.key} className="space-y-1.5">
              <Label>{n.label}</Label>
              <Input
                type="number"
                value={form[n.key] ?? 0}
                onChange={(e) => setForm({ ...form, [n.key]: e.target.value })}
              />
              {n.hint && <p className="text-xs text-muted-foreground">{n.hint}</p>}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          语文每天固定：认读 5 字 + 组词 5 题 + 古诗 1 首；英语固定：音标朗读 2 + 音标选词 2 + 看中文选英文 2 +
          看英文选中文 2 + 组句 1；错题重练固定 2 道。朗读与认读只记录完成、不计入得分。
        </p>
      </Card>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">学习模块开关</p>
        <div className="space-y-4">
          {SWITCHES.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.hint}</p>
              </div>
              <Switch checked={!!form[s.key]} onCheckedChange={(v) => setForm({ ...form, [s.key]: v })} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium">AI 智能助手</p>
            {form.ai_api_key_set ? <Badge variant="success">已配置</Badge> : <Badge variant="outline">未配置</Badge>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">启用</span>
            <Switch
                checked={!!form.ai_enabled}
                onCheckedChange={(v) => setForm({ ...form, ai_enabled: v })}
            />
          </label>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          用于题库编辑页的「AI 补全」和「AI 生成」：自动补汉字拼音部首组词、批量生成古诗 / 单词 / 句子 / 应用题与出题规则。
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>服务商</Label>
            <Select
                options={[{ label: 'DeepSeek（深度求索）', value: 'deepseek' }]}
                value={form.ai_provider ?? 'deepseek'}
                onChange={(e) => setForm({ ...form, ai_provider: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">当前仅接入 DeepSeek，其它服务商后续按同一协议扩展</p>
          </div>
          <div className="space-y-1.5">
            <Label>模型</Label>
            <Input
                placeholder="deepseek-flash"
                value={form.ai_model ?? ''}
                onChange={(e) => setForm({ ...form, ai_model: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">deepseek-v4-pro / deepseek-flash</p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>API 地址</Label>
            <Input
                placeholder="https://api.deepseek.com/v1"
                value={form.ai_base_url ?? ''}
                onChange={(e) => setForm({ ...form, ai_base_url: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              兼容 OpenAI 协议即可，例如自建代理地址；一般填到 /v1 为止
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>API Key</Label>
            <Input
                type="password"
                placeholder={form.ai_api_key_set ? `已保存：${form.ai_api_key_masked}（留空表示不修改）` : 'sk-...'}
                value={form.ai_api_key ?? ''}
                onChange={(e) => setForm({ ...form, ai_api_key: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              在 platform.deepseek.com 的「API keys」里创建
            </p>
          </div>

          <div className="col-span-full flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
            <div>
              <Label>思考模式</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                DeepSeek 默认开启思考。题库生成是结构化抽取任务，关掉更快、更省 token；遇到需要推理的
                应用题配置再打开
              </p>
            </div>
            <Switch
                checked={!!form.ai_thinking}
                onCheckedChange={(v) => setForm({ ...form, ai_thinking: v })}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 justify-end">
          <Button variant="outline" onClick={() => saveAi(false)} disabled={!!aiBusy}>
            {aiBusy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存 AI 配置
          </Button>
          <Button variant="outline" onClick={() => saveAi(true)} disabled={!!aiBusy}>
            {aiBusy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            保存并测试连接
          </Button>
          <Button variant="outline" onClick={() => setCallsOpen(true)}>
            <History className="h-4 w-4" /> 调用详情
          </Button>
        </div>
      </Card>

      <div className="flex">
        <Button onClick={save}>
          <Save className="h-4 w-4" /> 保存以上设置
        </Button>
      </div>

      <BuiltinBankCard />

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">数据备份</p>
        <p className="mb-3 text-xs text-muted-foreground">
          数据库是单文件，下载后随时可以替换回来；系统每天首次启动也会自动备份到 backups/ 目录
        </p>
        <Button variant="outline" onClick={() => downloadFile('/admin/backup/download', 'db.sqlite')}>
          <Download className="h-4 w-4" /> 下载数据库
        </Button>
      </Card>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">修改密码</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>原密码</Label>
            <Input
              type="password"
              value={pwd.old_password}
              onChange={(e) => setPwd({ ...pwd, old_password: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>新密码（至少 6 位）</Label>
            <Input
              type="password"
              value={pwd.new_password}
              onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })}
            />
          </div>
        </div>
        <Button variant="outline" className="mt-3" onClick={changePassword}>
          修改密码
        </Button>
      </Card>

      <AiCallsDialog open={callsOpen} onOpenChange={setCallsOpen} />
    </div>
  )
}

function BuiltinBankCard() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'chars' | 'poems' | ''>('')

  const { data } = useQuery({
    queryKey: ['bank-builtin'],
    queryFn: () => api.get<any>('/admin/bank/builtin', true),
  })

  const rows = [
    { kind: 'chars' as const, label: '识字库', unit: '字' },
    { kind: 'poems' as const, label: '古诗库', unit: '首' },
  ]

  const run = async (kind: 'chars' | 'poems', label: string, total: number) => {
    if (!confirm(`导入内置${label}（共 ${total} 条）？已存在的会跳过，不会覆盖你改过的内容。`)) return
    setBusy(kind)
    try {
      const res = await api.post<any>('/admin/bank/import', { kinds: [kind] }, true)
      const r = res?.[kind] ?? { created: 0, skipped: 0 }
      if (r.created) {
        toast.success(`${label}新增 ${r.created} 条${r.skipped ? `，跳过 ${r.skipped} 条已有` : ''}`)
      } else {
        toast.success(`${label}已是最新，没有需要新增的内容`)
      }
      qc.invalidateQueries()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '导入失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center gap-2">
        <Library className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">内置题库</p>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        随项目附带小学常用汉字与统编版课内古诗，一键导入就能开始，不用一条条录入。已存在的自动跳过，不会覆盖你改过的内容。
        数据包里的年级会折算成等级：一、二年级容易，三年级较易，四年级中等，五年级较难，六年级困难。
      </p>
      <div className="space-y-2">
        {rows.map(({ kind, label, unit }) => {
          const info = data?.[kind]
          const available = info?.available ?? 0
          const total = info?.total ?? 0
          const levels = info?.levels ?? null
          return (
            <div
              key={kind}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {info
                    ? `内置 ${total} ${unit} · 库中已有 ${info.existing} ${unit}${
                        available ? ` · 还可导入 ${available} ${unit}` : ' · 已全部导入'
                      }`
                    : '读取中…'}
                </p>
                {levels && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    等级：{Object.entries(levels).map(([lv, n]) => `${lv} ${n}`).join(' · ')}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={!available || !!busy}
                onClick={() => run(kind, label, total)}
              >
                {busy === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                导入
              </Button>
            </div>
          )
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        导入后语文题库从全库随机出题，不再按年级学期筛选；只有数学按孩子的年级学期出题。
      </p>
    </Card>
  )
}

function AiCallsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-calls', page],
    queryFn: () => api.get<any>(`/admin/ai/calls?page=${page}&page_size=20`, true),
    enabled: open,
  })

  const items: any[] = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 20))

  const clear = async () => {
    if (!confirm('清空全部调用记录？只删日志，不影响题库数据')) return
    try {
      await api.del('/admin/ai/calls', true)
      toast.success('调用记录已清空')
      setPage(1)
      qc.invalidateQueries({ queryKey: ['ai-calls'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清空失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>大模型调用详情</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 mb-2">
          {[
            { label: '调用次数', value: data?.total_calls ?? 0 },
            { label: '累计输入 token', value: data?.total_input_tokens ?? 0 },
            { label: '累计输出 token', value: data?.total_output_tokens ?? 0 },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{Number(s.value).toLocaleString()}</p>
            </div>
          ))}
        </div>

        <div className="max-h-[52vh] overflow-auto rounded-xl border border-border">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40 whitespace-nowrap">时间</TableHead>
                  <TableHead className="w-32">模型</TableHead>
                  <TableHead>输入提示词</TableHead>
                  <TableHead className="w-24 text-right whitespace-nowrap">输入 token</TableHead>
                  <TableHead className="w-24 text-right whitespace-nowrap">输出 token</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableEmpty colSpan={5}>还没有调用记录，配置好后点「保存并测试连接」会产生一条</TableEmpty>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {String(row.created_at ?? '').replace('T', ' ').slice(0, 19)}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.model}
                        {row.ok === false && <span className="ml-1 text-red-500">失败</span>}
                      </TableCell>
                      <TableCell>
                        <details>
                          <summary className="line-clamp-2 cursor-pointer text-xs text-muted-foreground">
                            {String(row.prompt ?? '').replace(/\s+/g, ' ').slice(0, 120)}
                          </summary>
                          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-xs">
{row.prompt}
                          </pre>
                        </details>
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.input_tokens}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.output_tokens}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
          <div className="flex gap-2">
            <Button variant="outline" onClick={clear} disabled={total === 0}>
              清空记录
            </Button>
            <Button onClick={() => onOpenChange(false)}>关闭</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
