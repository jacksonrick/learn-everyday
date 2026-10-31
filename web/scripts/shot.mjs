import { chromium } from 'playwright-core'

const BASE = process.env.BASE || 'http://127.0.0.1:5001'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const targets = [
  { name: 'home-1920', path: '/', width: 1920, height: 1080 },
  { name: 'home-tablet', path: '/', width: 1024, height: 768 },
  { name: 'subject-1920', path: '/c/chinese', width: 1920, height: 1080 },
  { name: 'me-1920', path: '/me?tab=calendar', width: 1920, height: 1080 },
  { name: 'me-wrong-1920', path: '/me?tab=wrong', width: 1920, height: 1080 },
  { name: 'me-tablet', path: '/me?tab=calendar', width: 1024, height: 768 },
]

const browser = await chromium.launch({ executablePath: CHROME })
for (const t of targets) {
  // 关掉 Service Worker 与本地缓存，否则拿到的是上一个版本的离线包
  const context = await browser.newContext({
    viewport: { width: t.width, height: t.height },
    serviceWorkers: 'block',
    bypassCSP: true,
  })
  const page = await context.newPage()
  await page.route('**/*', (route) => route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } }))
  await page.goto(BASE + t.path, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `docs/screenshots/${t.name}.png` })
  await context.close()
  console.log('✓', t.name)
}
await browser.close()
