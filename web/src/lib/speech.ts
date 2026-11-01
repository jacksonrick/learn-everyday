import { toast } from 'sonner'
import { api } from './api'

/**
 * 语音朗读：浏览器 speechSynthesis 或 豆包 API 合成（后台「语音配置」里切换）。
 *
 * API 模式下相同文本在服务端落盘缓存（不重复计费），这里再做一层 URL 级
 * 缓存，重复播放连请求都不发。只支持语文古诗与英语朗读，其它地方不出现按钮。
 */

let current: SpeechSynthesisUtterance | null = null
let currentAudio: HTMLAudioElement | null = null
let enabled = true
let modePromise: Promise<string> | null = null
const urlCache = new Map<string, string>()

export function setSpeechEnabled(value: boolean) {
  enabled = value
  if (!value) stopSpeaking()
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

function voiceMode(): Promise<string> {
  if (!modePromise) {
    modePromise = api
      .get<{ voice_mode?: string }>('/client/prefs')
      .then((p) => p.voice_mode ?? 'browser')
      .catch(() => 'browser')
  }
  return modePromise
}

function pickVoice(lang: string) {
  const voices = window.speechSynthesis.getVoices()
  const prefix = lang.split('-')[0]
  const exact = voices.find((v) => v.lang === lang)
  if (exact) return exact
  const sameLang = voices.find((v) => v.lang.startsWith(prefix))
  if (sameLang) return sameLang
  if (lang.startsWith('zh')) {
    return voices.find((v) => /Chinese|Mandarin|Ting|Mei/i.test(v.name)) ?? null
  }
  return voices.find((v) => /English|Samantha|Daniel|Google US/i.test(v.name)) ?? null
}

export async function speak(text: string, options: { lang?: string; rate?: number } = {}) {
  if (!enabled || !text) return
  const { lang = 'zh-CN', rate = 1 } = options

  if ((await voiceMode()) === 'api') {
    stopSpeaking()
    const langKey = lang.startsWith('zh') ? 'zh' : 'en'
    const cacheKey = `${langKey}|${rate}|${text}`
    let url = urlCache.get(cacheKey)
    if (!url) {
      try {
        const res = await api.post<{ url: string }>('/client/tts', {
          text,
          lang: langKey,
          speed: rate,
        })
        url = res.url
      } catch (e) {
        // API 出问题就退回浏览器朗读，但要把原因告诉家长，别闷头失败
        toast.warning(e instanceof Error ? e.message : '语音合成失败，已改用浏览器发音')
        speakFallback(text, lang, rate)
        return
      }
      urlCache.set(cacheKey, url)
    }
    playUrl(url)
    return
  }
  speakFallback(text, lang, rate)
}

function playUrl(url: string) {
  const audio = new Audio(url)
  currentAudio = audio
  audio.play().catch(() => {
    /* 自动播放被拦等情况：静默失败，不打断做题 */
  })
}

function speakFallback(text: string, lang: string, rate: number) {
  if (!speechSupported()) return
  stopSpeaking()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = lang
  utter.rate = rate
  const voice = pickVoice(lang)
  if (voice) utter.voice = voice
  current = utter
  window.speechSynthesis.speak(utter)
}

export function stopSpeaking() {
  currentAudio?.pause()
  currentAudio = null
  if (speechSupported()) {
    window.speechSynthesis.cancel()
    current = null
  }
}

if (typeof window !== 'undefined' && speechSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    /* 触发一次以加载音色列表 */
  }
}
