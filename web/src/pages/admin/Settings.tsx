import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Download, History, Library, Loader2, PlugZap, Save, Sparkles, Trash2, Volume2 } from 'lucide-react'
import { api, downloadFile } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/feedback'
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const NUMBERS: { key: string; label: string; hint?: string }[] = [
  // 语文
  { key: 'chinese_read', label: '认读字数', hint: '默认 5，认读卡不计分；0 为关闭' },
  { key: 'chinese_word', label: '组词题数', hint: '默认 5，补全词语选择题' },
  { key: 'chinese_pinyin', label: '看拼音选字', hint: '默认 3 道，判分；0 为关闭' },
  { key: 'chinese_poem', label: '古诗数量', hint: '默认 1 首背诵录音，一轮内不重复；0 为关闭' },
  // 数学
  { key: 'math_calc', label: '计算题数量', hint: '默认 15，按出题规则现算' },
  { key: 'math_app', label: '应用题数量', hint: '默认 2，从本年级学期题库抽取；0 为关闭' },
  // 英语
  { key: 'english_word_read', label: '单词朗读', hint: '默认 10，朗读卡不计分' },
  { key: 'english_phoneme_read', label: '音标朗读', hint: '默认 2 个，不计分；0 为关闭' },
  { key: 'english_phoneme_pick', label: '音标选词', hint: '默认 2 道；0 为关闭' },
  { key: 'english_word_choice', label: '看中文选英文', hint: '默认 2 道' },
  { key: 'english_meaning_choice', label: '看英文选中文', hint: '默认 2 道' },
  { key: 'english_sentence_count', label: '单词组句', hint: '默认 1 道；0 为关闭' },
  // 其它
  { key: 'retry_count', label: '额外错题重练', hint: '默认 2 道，插在当天任务最前面；0 为关闭' },
  { key: 'srs_backlog_threshold', label: '复习积压闸门', hint: '到期没复习的条数超过它，新字新词自动让位给复习；0 为不让位' },
  { key: 'srs_new_floor', label: '让位后保留新内容', hint: '积压严重时每天至少还教几个新字/新词' },
  { key: 'redeem_interval_days', label: '兑换间隔（天）', hint: '距上次兑换成功需隔几天才能再兑；0 为不限制' },
  { key: 'point_per_subject', label: '单科完成积分', hint: '正确率 ≥60%' },
  { key: 'point_per_excellent', label: '正确率优秀加分', hint: '≥90% 额外加' },
  { key: 'point_checkin', label: '打卡积分', hint: '三科完成' },
  { key: 'point_wrong_fix', label: '错题订正积分', hint: '重练答对一道给多少' },
  { key: 'streak_bonus_days', label: '连续打卡奖励天数', hint: '每连续完整打满 N 天额外加分；0 为关闭' },
  { key: 'streak_bonus_points', label: '连续打卡奖励积分', hint: '第 N 天打卡完成时直接入账' },
]

const TAB_FIELDS: { value: string; label: string; keys: string[] }[] = [
  { value: 'chinese', label: '语文', keys: ['chinese_read', 'chinese_word', 'chinese_pinyin', 'chinese_poem'] },
  { value: 'math', label: '数学', keys: ['math_calc', 'math_app'] },
  {
    value: 'english',
    label: '英语',
    keys: [
      'english_word_read',
      'english_phoneme_read',
      'english_phoneme_pick',
      'english_word_choice',
      'english_meaning_choice',
      'english_sentence_count',
    ],
  },
  {
    value: 'misc',
    label: '其它',
    keys: ['retry_count', 'srs_backlog_threshold', 'srs_new_floor', 'redeem_interval_days', 'streak_bonus_days', 'streak_bonus_points', 'point_per_subject', 'point_per_excellent', 'point_checkin', 'point_wrong_fix'],
  },
]

const SWITCHES: { key: string; label: string; hint: string }[] = [
  { key: 'srs_enabled', label: '遗忘曲线复习', hint: '按 1/2/4/7/15/30 天安排复习；关掉后每天全库随机，不再安排旧内容回访' },
  { key: 'instant_feedback', label: '答题即时反馈', hint: '每题提交后立刻显示对错；关掉则交卷后才看结果' },
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
  const [taskBusy, setTaskBusy] = useState(false)
  const [callsOpen, setCallsOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)

  useEffect(() => {
    if (data) setForm({ ...data, ai_api_key: '' })
  }, [data])

  const aiPayload = () => {
    const payload: Record<string, any> = {
      ai_provider: form.ai_provider || 'deepseek',
      ai_base_url: (form.ai_base_url || 'https://api.deepseek.com/v1').trim(),
      ai_model: (form.ai_model || 'deepseek-flash').trim(),
      ai_thinking: !!form.ai_thinking,
    }
    const key = String(form.ai_api_key ?? '').trim()
    if (key) payload.ai_api_key = key
    return payload
  }

  /** 只保存「每日任务量与积分」卡片：各题型数量、积分规则与开关 */
  const save = async () => {
    setTaskBusy(true)
    const payload: Record<string, any> = {}
    NUMBERS.forEach((n) => (payload[n.key] = Number(form[n.key]) || 0))
    SWITCHES.forEach((s) => (payload[s.key] = !!form[s.key]))
    payload.client_time_start = String(form.client_time_start ?? '').trim()
    payload.client_time_end = String(form.client_time_end ?? '').trim()
    try {
      await api.put('/admin/settings', payload, true)
      toast.success('设置已保存，明天的任务按新配置生成')
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setTaskBusy(false)
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
        <p className="mb-4 text-sm font-medium">每日任务量与积分</p>
        <Tabs defaultValue="chinese">
          <TabsList className="w-full sm:w-auto">
            {TAB_FIELDS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="flex-1 sm:flex-none">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {TAB_FIELDS.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tab.keys.map((key) => {
                  const field = NUMBERS.find((n) => n.key === key)
                  if (!field) return null
                  return (
                    <div key={key} className="space-y-1.5">
                      <Label>{field.label}</Label>
                      <Input
                        type="number"
                        min={0}
                        value={form[key] ?? 0}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      />
                      {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
                    </div>
                  )
                })}
              </div>
              {tab.value === 'misc' && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>客户端可用时间（开始）</Label>
                      <Input
                        type="time"
                        value={form.client_time_start ?? ''}
                        onChange={(e) => setForm({ ...form, client_time_start: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">
                        时间段之外客户端会被全屏遮罩盖住，孩子无法操作；两项留空 = 全天可用
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>客户端可用时间（结束）</Label>
                      <Input
                        type="time"
                        value={form.client_time_end ?? ''}
                        onChange={(e) => setForm({ ...form, client_time_end: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">如 21:00；开始时间晚于结束时间视为跨午夜（如 21:00 - 次日 7:00）</p>
                    </div>
                  </div>
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
              )}
            </TabsContent>
          ))}
        </Tabs>
        <p className="mt-4 rounded-xl bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          各题型数量填 0 表示当天不出该题型。新题难度按 10/40/30/15/5 的比例抽取，复习题与错题重练不按比例
          （该复习的必须复习）；开启「遗忘曲线复习」后，到期的旧字词会优先安排进每天的认读卡、朗读卡和选择题。
          朗读与认读只记录完成、不计入得分。
        </p>

        <div className="mt-4 flex justify-end">
          <Button onClick={save} disabled={taskBusy}>
            {taskBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存任务量与积分
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="text-sm font-medium">AI 智能助手</p>
              {form.ai_api_key_set ? <Badge variant="success">已配置</Badge> : <Badge variant="outline">未配置</Badge>}
            </div>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          配置好下方参数即可使用，没有单独的启停开关；不填 API Key 时题库页的 AI 功能会提示未配置。
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

      <VoiceCard form={form} setForm={setForm} />

      <BuiltinBankCard />

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium">数据备份</p>
        <p className="mb-3 text-xs text-muted-foreground">
          数据库是单文件，下载后随时可以替换回来；系统每天首次启动也会自动备份到 backups/ 目录
        </p>
        <Button variant="outline" onClick={() => downloadFile('/admin/backup/download', 'db.sqlite')}>
          <Download className="h-4 w-4" /> 下载数据库
        </Button>

        <div className="mt-5 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-red-600">数据重置</p>
              <p className="mt-1 max-w-xl text-xs text-muted-foreground">
                清空题库以外的全部学习数据：学习记录、背诵录音、打卡与连击、积分流水、错题本、兑换记录。
                题库、孩子资料、奖品配置和系统设置都会保留。执行前会自动备份当前数据库到 backups/ 目录。
              </p>
            </div>
            <Button variant="outline" className="text-red-600 hover:text-red-600" onClick={() => setResetOpen(true)}>
              <Trash2 className="h-4 w-4" /> 重置数据
            </Button>
          </div>
        </div>
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
      <ResetDataDialog open={resetOpen} onOpenChange={setResetOpen} />
    </div>
  )
}

function BuiltinBankCard() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<'chars' | 'poems' | 'words' | ''>('')

  const { data } = useQuery({
    queryKey: ['bank-builtin'],
    queryFn: () => api.get<any>('/admin/bank/builtin', true),
  })

  const rows = [
    { kind: 'chars' as const, label: '识字库', unit: '字' },
    { kind: 'poems' as const, label: '古诗库', unit: '首' },
    { kind: 'words' as const, label: '单词库', unit: '词' },
  ]

  const run = async (kind: 'chars' | 'poems' | 'words', label: string, total: number) => {
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
        随项目附带小学常用汉字、统编版课内古诗与人教 PEP 小学英语单词，一键导入就能开始，不用一条条录入。已存在的自动跳过，不会覆盖你改过的内容。
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
        导入后语文、英语题库从全库随机出题，不再按年级学期筛选；只有数学按孩子的年级学期出题。
      </p>
    </Card>
  )
}

/** 语音配置：浏览器语音或豆包 TTS（火山引擎 HTTP 一次性合成）。 */
function VoiceCard({
  form,
  setForm,
}: {
  form: any
  setForm: (updater: any) => void
}) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [callsOpen, setCallsOpen] = useState(false)

  const isApi = form.voice_mode === 'api'

  const payload = () => {
    const data: Record<string, any> = {
      voice_mode: isApi ? 'api' : 'browser',
      tts_app_id: String(form.tts_app_id ?? '').trim(),
      tts_cluster: String(form.tts_cluster ?? 'volcano_tts').trim() || 'volcano_tts',
      tts_voice_zh: String(form.tts_voice_zh ?? '').trim() || 'zh_female_cancan_mars_bigtts',
      tts_voice_en: String(form.tts_voice_en ?? '').trim() || 'en_female_amanda_mars_bigtts',
    }
    const token = String(form.tts_access_token ?? '').trim()
    if (token) data.tts_access_token = token
    return data
  }

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/admin/settings', payload(), true)
      toast.success('语音配置已保存')
      setForm((f: any) => ({ ...f, tts_access_token: '' }))
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-primary" />
          <p className="text-sm font-medium">语音配置</p>
          {isApi && (
            form.tts_access_token_set ? <Badge variant="success">已配置</Badge> : <Badge variant="outline">未配置</Badge>
          )}
        </div>
        <Button variant="outline" onClick={() => setCallsOpen(true)}>
          <History className="h-4 w-4" /> 调用详情
        </Button>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        语音只用在语文古诗朗读和英语朗读上。默认用浏览器自带发音（免费但效果一般）；
        启用 API 模式后走火山引擎豆包语音合成 1.0，效果更好但按字计费——相同文本自动走缓存不重复计费，
        超过 200 字只读前 200 字。
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>发音方式</Label>
          <Select
            options={[
              { label: '浏览器语音（默认，免费）', value: 'browser' },
              { label: '豆包语音合成 API（火山引擎）', value: 'api' },
            ]}
            value={form.voice_mode ?? 'browser'}
            onChange={(e) => setForm((f: any) => ({ ...f, voice_mode: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">
            API 模式需要在火山引擎控制台开通「语音合成大模型」，拿到 AppID 与 Access Token
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Cluster</Label>
          <Input
            placeholder="volcano_tts"
            value={form.tts_cluster ?? ''}
            onChange={(e) => setForm((f: any) => ({ ...f, tts_cluster: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">一般保持默认，控制台 FAQ 里有说明</p>
        </div>

        {isApi && (
          <>
            <div className="space-y-1.5">
              <Label>AppID</Label>
              <Input
                placeholder="火山引擎语音应用的 AppID"
                value={form.tts_app_id ?? ''}
                onChange={(e) => setForm((f: any) => ({ ...f, tts_app_id: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Access Token</Label>
              <Input
                type="password"
                placeholder={
                  form.tts_access_token_set
                    ? `已保存：${form.tts_access_token_masked}（留空表示不修改）`
                    : '火山引擎语音应用的 Access Token'
                }
                value={form.tts_access_token ?? ''}
                onChange={(e) => setForm((f: any) => ({ ...f, tts_access_token: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>中文音色（古诗朗读）</Label>
              <Input
                placeholder="zh_female_cancan_mars_bigtts"
                value={form.tts_voice_zh ?? ''}
                onChange={(e) => setForm((f: any) => ({ ...f, tts_voice_zh: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">音色代号见火山引擎「音色列表」文档</p>
            </div>
            <div className="space-y-1.5">
              <Label>英文音色（英语朗读）</Label>
              <Input
                placeholder="en_female_amanda_mars_bigtts"
                value={form.tts_voice_en ?? ''}
                onChange={(e) => setForm((f: any) => ({ ...f, tts_voice_en: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">英文朗读统一用这个音色</p>
            </div>
          </>
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存语音配置
        </Button>
      </div>

      <TtsCallsDialog open={callsOpen} onOpenChange={setCallsOpen} />
    </Card>
  )
}

function TtsCallsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tts-calls', page],
    queryFn: () => api.get<any>(`/admin/tts/calls?page=${page}&page_size=20`, true),
    enabled: open,
  })

  const items: any[] = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / 20))

  const fmtDuration = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} 秒` : `${ms} ms`)

  const clear = async () => {
    if (!confirm('清空全部语音调用记录？只删日志，不影响已缓存的音频')) return
    try {
      await api.del('/admin/tts/calls', true)
      toast.success('调用记录已清空')
      setPage(1)
      qc.invalidateQueries({ queryKey: ['tts-calls'] })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '清空失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>语音合成调用详情</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 mb-2">
          {[
            { label: '调用次数', value: data?.total_calls ?? 0 },
            { label: '累计字数', value: data?.total_chars ?? 0 },
            { label: '累计音频时长', value: fmtDuration(data?.total_duration_ms ?? 0) },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {typeof s.value === 'number' ? Number(s.value).toLocaleString() : s.value}
              </p>
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
                  <TableHead>文本</TableHead>
                  <TableHead className="w-20 text-right whitespace-nowrap">字数</TableHead>
                  <TableHead className="w-28 text-right whitespace-nowrap">音频时长</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableEmpty colSpan={4}>还没有调用记录，客户端在 API 模式下播放语音会产生</TableEmpty>
                ) : (
                  items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {String(row.created_at ?? '').replace('T', ' ').slice(0, 19)}
                      </TableCell>
                      <TableCell>
                        <span className="line-clamp-2 text-xs">{row.text}</span>
                        {row.ok === false && row.message && (
                          <span className="ml-1 text-xs text-red-500">失败：{row.message}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">{row.char_count}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {row.ok === false ? '—' : fmtDuration(row.duration_ms ?? 0)}
                      </TableCell>
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

function ResetDataDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (!password || busy) return
    if (!confirm('确认重置？学习记录、录音、打卡、积分、错题、兑换记录将被清空，且无法撤销！')) return
    setBusy(true)
    try {
      await api.post('/admin/reset', { password }, true)
      toast.success('数据已重置，题库与配置保持不变')
      setPassword('')
      onOpenChange(false)
      qc.invalidateQueries()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '重置失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>重置学习数据</DialogTitle>
        </DialogHeader>

        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs leading-relaxed text-red-700">
          将清空：学习记录、每日任务、背诵录音、打卡与连击、积分流水、错题本、兑换记录。
          <br />
          将保留：题库、孩子资料、奖品配置、系统设置。重置前会自动备份当前数据库。
        </div>

        <div className="space-y-1.5">
          <Label>管理员密码</Label>
          <Input
            type="password"
            placeholder="输入管理员密码以确认"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run()
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-700"
            disabled={!password || busy}
            onClick={run}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            确认重置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
