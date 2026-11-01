/**
 * 音标发音用本地音频文件：IPA 符号（/iː/、/ʃ/ 这类）没法被浏览器 TTS 或
 * 豆包 API 正确读出来，所以内置 48 个音标的真人单音发音（0.6~1.6 秒），
 * 放在 web/public/phonemes/ 下，前端直接播放，不走任何 TTS、零成本。
 */
const PHONEME_FILES: Record<string, string> = {
  // 元音：单元音 12 + 双元音 8
  'iː': 'i',
  'ɪ': 'ih',
  e: 'e',
  æ: 'ae',
  'ɑː': 'ar',
  'ɒ': 'o',
  'ɔː': 'or',
  'ʊ': 'uu',
  'uː': 'oo',
  'ʌ': 'u',
  'ɜː': 'er',
  'ə': 'uh',
  'eɪ': 'ei',
  'aɪ': 'ai',
  'ɔɪ': 'oi',
  'aʊ': 'au',
  'əʊ': 'ou',
  'ɪə': 'ie',
  'eə': 'ea',
  'ʊə': 'ua',
  // 辅音：爆破 6 + 摩擦 9 + 破擦 6 + 鼻音 3 + 舌侧 1 + 半元音 3
  p: 'p',
  b: 'b',
  t: 't',
  d: 'd',
  k: 'k',
  g: 'g',
  f: 'f',
  v: 'v',
  θ: 'th',
  ð: 'dh',
  s: 's',
  z: 'z',
  ʃ: 'sh',
  ʒ: 'zh',
  h: 'h',
  'tʃ': 'ch',
  'dʒ': 'dj',
  tr: 'tr',
  dr: 'dr',
  ts: 'ts',
  dz: 'dz',
  m: 'm',
  n: 'n',
  ŋ: 'ng',
  l: 'l',
  r: 'r',
  j: 'y',
  w: 'w',
}

/** 把音标符号（带不带斜杠都行）转成本地音频 URL；不在 48 个内置音标里返回 null。 */
export function phonemeAudioUrl(symbol: string): string | null {
  const key = (symbol || '').trim().replace(/^\/+|\/+$/g, '')
  const file = PHONEME_FILES[key]
  if (!file) return null
  return `/phonemes/${file}.mp3`
}
