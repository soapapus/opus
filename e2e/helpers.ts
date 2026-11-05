import { expect, type Page } from '@playwright/test'

/** 화면 테스트의 '오늘'은 항상 2026-11-05(목) 10:00 KST 로 고정 */
export const TODAY = new Date('2026-11-05T10:00:00+09:00')

/** 앱을 열고, 콘솔 오류·페이지 오류를 모은다. 테스트 끝에 assertNoErrors 로 확인 */
export async function openApp(page: Page): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    // 404 같은 자원 오류는 아래 response 에서 주소와 함께 따로 기록한다
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console: ${m.text()}`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()}: ${new URL(r.url()).pathname}`)
  })
  await page.clock.setFixedTime(TODAY)
  await page.goto('/index.html')
  await expect(page.locator('.app2')).toBeVisible()
  return errors
}

export function assertNoErrors(errors: string[]): void {
  expect(errors, '콘솔·페이지 오류가 없어야 함').toEqual([])
}

export async function goMemo(page: Page): Promise<void> {
  await page.locator('.rail-btn[aria-label="메모"]').click()
  await expect(page.locator('.memov')).toBeVisible()
}

/** 글자색과 바탕색의 명암비 (WCAG). 배경이 투명하면 부모를 따라 올라간다 */
export async function contrastOf(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? ['0', '0', '0', '0']).map(Number)
    const lum = ([r, g, b]: number[]): number => {
      const f = (v: number) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const fg = parse(getComputedStyle(el).color)
    let node: Element | null = el
    let bg = [255, 255, 255]
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c.length < 4 || c[3] > 0) {
        bg = c
        break
      }
      node = node.parentElement
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
    return (a + 0.05) / (b + 0.05)
  })
}
