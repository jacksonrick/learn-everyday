let current: SpeechSynthesisUtterance | null = null
let enabled = true

export function setSpeechEnabled(value: boolean) {
  enabled = value
  if (!value) stopSpeaking()
}

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
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

export function speak(text: string, options: { lang?: string; rate?: number; audioUrl?: string } = {}) {
  if (!enabled) return
  const { lang = 'zh-CN', rate = 1, audioUrl } = options

  if (audioUrl) {
    const audio = new Audio(audioUrl)
    audio.play().catch(() => speakFallback(text, lang, rate))
    return
  }
  speakFallback(text, lang, rate)
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
  if (!speechSupported()) return
  window.speechSynthesis.cancel()
  current = null
}

if (typeof window !== 'undefined' && speechSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    /* 触发一次以加载音色列表 */
  }
}
