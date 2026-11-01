import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, RotateCcw, Square, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { api } from '@/lib/api'
import { speak, stopSpeaking } from '@/lib/speech'
import { cn } from '@/lib/utils'
import { FoxWave } from './art'

type PoemItem = {
  item_id: number
  kind: string
  title: string
  author: string
  dynasty: string
  content: string
  lines: string[]
  translation?: string
  poem_id?: number
}

/**
 * 古诗：先听读，再背诵录音。
 *
 * 「选择下一句 / 填空」这种题撤掉了——整首诗就摆在卡片上，问孩子其中一句是
 * 没有意义的。真正的考察是能不能背着说出来，所以流程改成：听熟 → 正文打码 →
 * 录一段自己的声音 → 上传给家长听。这里不判对错、也不给分。
 */
export function PoemPlayer({
  poem,
  childId,
  onUploaded,
  onSkip,
}: {
  poem: PoemItem
  childId: number | null
  onUploaded: (info: { duration_ms: number }) => void
  onSkip?: () => void
}) {
  const [tab, setTab] = useState('listen')
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [micError, setMicError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const tickRef = useRef<number | null>(null)
  const startedAt = useRef(Date.now())

  const masked = tab === 'recite'

  useEffect(() => {
    return () => {
      stopSpeaking()
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop())
      if (tickRef.current) window.clearInterval(tickRef.current)
    }
  }, [])

  // 只在换 URL 或卸载时回收上一个 blob，直接在 effect 里回收会把刚录好的音立刻废掉
  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const readAll = () =>
    speak(
      `《${poem.title}》，${poem.dynasty} ${poem.author}。${poem.content.replace(/\n/g, '，')}`,
      { lang: 'zh-CN', rate: 0.9 },
    )

  const startRecord = async () => {
    setMicError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      startedAt.current = Date.now()
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        setAudioUrl(URL.createObjectURL(blob))
        setDurationMs(Date.now() - startedAt.current)
        stream.getTracks().forEach((t) => t.stop())
      }
      recorder.start()
      recorderRef.current = recorder
      setSeconds(0)
      setRecording(true)
      tickRef.current = window.setInterval(() => {
        setSeconds(Math.round((Date.now() - startedAt.current) / 1000))
      }, 250)
    } catch {
      setMicError('没能打开麦克风，检查一下浏览器权限后再试')
    }
  }

  const stopRecord = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (tickRef.current) {
      window.clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const reset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioUrl(null)
    setDurationMs(0)
    setSeconds(0)
  }

  const upload = async () => {
    if (!audioUrl || uploading) return
    setUploading(true)
    try {
      const blob = await fetch(audioUrl).then((r) => r.blob())
      const form = new FormData()
      const ext = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm'
      form.append('audio', blob, `recite-${poem.item_id}.${ext}`)
      form.append('subject', 'chinese')
      form.append('item_id', String(poem.item_id))
      form.append('poem_id', String(poem.poem_id ?? ''))
      form.append('duration_ms', String(durationMs))
      form.append('child_id', String(childId ?? ''))
      await api.upload<{ id: number }>('/client/poem/recite', form, false)
      onUploaded({ duration_ms: durationMs })
    } catch (e) {
      setMicError(e instanceof Error ? e.message : '上传失败，请再试一次')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="overflow-hidden p-5 text-center">
        <h2 className="text-xl font-semibold">{poem.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {poem.dynasty} · {poem.author}
        </p>
        <div className="mt-4 space-y-2 text-lg leading-loose tracking-wide">
          {poem.lines.map((line) => (
            <p
              key={line}
              className={cn('rounded-lg transition duration-300 select-none', masked && 'blur-[7px]')}
              aria-hidden={masked}
            >
              {line}
            </p>
          ))}
        </div>
        <p
          className={cn(
            'mt-3 text-xs transition',
            masked ? 'text-persimmon-deep' : 'text-transparent',
          )}
        >
          已经藏起来了，试着自己背出来
        </p>
      </Card>

      <Tabs value={tab} onValueChange={(v) => { stopSpeaking(); setTab(v) }}>
        <TabsList className="w-full">
          <TabsTrigger value="listen">听读</TabsTrigger>
          <TabsTrigger value="recite">背诵</TabsTrigger>
        </TabsList>

        <TabsContent value="listen">
          <Card className="animate-slide-up space-y-4 p-5">
            <Button variant="outline" className="w-full" size="lg" onClick={readAll}>
              <Volume2 className="h-4 w-4" /> 整首朗读
            </Button>
            <div className="space-y-2 rounded-2xl bg-paper-deep/60 px-4 py-3 text-sm text-ink-soft">
              {poem.translation ? <p>{poem.translation}</p> : <p>点上面的「整首朗读」，听题目、诗人和全诗。</p>}
              <p className="text-xs">先听两遍，再小声跟着念，最后到「背诵」里录给爸爸妈妈听。</p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
              <FoxWave className="h-10 w-10 animate-bounce-gentle" />
              读完再到下一个标签，试试背出来
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="recite">
          <Card className="animate-slide-up space-y-4 p-5 text-center">
            {!audioUrl ? (
              <>
                <p className="text-sm text-ink-soft">
                  {recording ? '正在听你背……背完再点一下红色按钮' : '点一下开始录音，背完再点一下结束'}
                </p>
                <button
                  onClick={recording ? stopRecord : startRecord}
                  className={cn(
                    'mx-auto flex h-20 w-20 items-center justify-center rounded-full text-white shadow-warm transition',
                    recording ? 'animate-pulse bg-red-500' : 'bg-persimmon-deep',
                  )}
                  aria-label={recording ? '结束录音' : '开始录音'}
                >
                  {recording ? <Square className="h-7 w-7" /> : <Mic className="h-7 w-7" />}
                </button>
                <p className="font-num text-sm text-persimmon-deep">{recording ? `${seconds} 秒` : '准备好了就点'}</p>
              </>
            ) : (
              <div className="space-y-3">
                <audio src={audioUrl} controls className="w-full" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={reset}>
                    <RotateCcw className="h-4 w-4" /> 再录一次
                  </Button>
                  <Button className="flex-1" disabled={uploading} onClick={upload}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    上传，今天背完啦
                  </Button>
                </div>
              </div>
            )}

            {micError && (
              <div className="space-y-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">
                <p>{micError}</p>
                {onSkip && !audioUrl && (
                  <button className="text-xs underline underline-offset-4" onClick={onSkip}>
                    录音用不了？先跳过，去看今天的结果
                  </button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">录音会进行上传，爸爸妈妈在后台就能听到哦～</p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
