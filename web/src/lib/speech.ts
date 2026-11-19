import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import { api } from './api'
import { phonemeAudioUrl } from './phoneme-audio'

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
/** 同一文本正在合成中的请求：连点两下只发一次，避免重复计费与竞态 */
const inFlight = new Map<string, Promise<string>>()

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

/**
 * 朗读文本。返回的 Promise 在「真正开始出声」或「失败」时才 resolve，
 * 调用方拿它做按钮的 loading/禁用态——后端合成期间一直转圈，防止连点重复请求。
 */
export async function speak(text: string, options: { lang?: string; rate?: number } = {}) {
  if (!enabled || !text) return
  const { lang = 'zh-CN', rate = 1 } = options

  if ((await voiceMode()) === 'api') {
    stopSpeaking()
    const langKey = lang.startsWith('zh') ? 'zh' : 'en'
    const cacheKey = `${langKey}|${rate}|${text}`
    let url = urlCache.get(cacheKey)
    if (!url) {
      let request = inFlight.get(cacheKey)
      if (!request) {
        request = api
          .post<{ url: string }>('/client/tts', { text, lang: langKey, speed: rate })
          .then((res) => {
            urlCache.set(cacheKey, res.url)
            return res.url
          })
          .finally(() => inFlight.delete(cacheKey))
        inFlight.set(cacheKey, request)
      }
      try {
        url = await request
      } catch (e) {
        // API 出问题就退回浏览器朗读，但要把原因告诉家长，别闷头失败
        toast.warning(e instanceof Error ? e.message : '语音合成失败，已改用浏览器发音')
        speakFallback(text, lang, rate)
        return
      }
    }
    await playUrl(url)
    return
  }
  speakFallback(text, lang, rate)
}

/**
 * 播一个音频地址，resolve 表示「已经出声」（或出错放弃）。
 * 加超时兜底：缓存命中时 playing 可能早于监听注册、或被浏览器拦下，
 * 不让按钮一直卡在转圈状态。
 */
function playUrl(url: string): Promise<void> {
  return new Promise((resolve) => {
    const audio = new Audio(url)
    currentAudio = audio
    let settled = false
    let timer = 0
    const done = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      audio.removeEventListener('playing', done)
      audio.removeEventListener('error', done)
      resolve()
    }
    audio.addEventListener('playing', done)
    audio.addEventListener('error', done)
    timer = window.setTimeout(done, 4000)
    audio.play().catch(done)
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

/**
 * 给播放按钮用的「正在出声」状态。
 * run() 返回前按钮应置灰：否则孩子连点时后端会被同一个文本打爆（合成器排队，越点越慢）。
 */
export function useSpeaker() {
  const [pending, setPending] = useState(false)
  const running = useRef(false)
  const run = useCallback(async (task: () => void | Promise<unknown>) => {
    if (running.current) return
    running.current = true
    setPending(true)
    try {
      await task()
    } catch {
      /* speak() 内部已提示，这里只负责收尾 */
    } finally {
      running.current = false
      setPending(false)
    }
  }, [])
  return { pending, run }
}

/**
 * 音标发音：直接播内置的本地单音音频（web/public/phonemes/），
 * 浏览器和 API 模式都走这里——IPA 符号 TTS 读不了。
 * 返回 false 表示没有对应的本地音频（调用方可自行退回例词朗读）。
 */
export function speakPhoneme(symbol: string): boolean {
  const url = phonemeAudioUrl(symbol)
  if (!enabled || !url) return false
  stopSpeaking()
  playUrl(url)
  return true
}

if (typeof window !== 'undefined' && speechSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    /* 触发一次以加载音色列表 */
  }
}
