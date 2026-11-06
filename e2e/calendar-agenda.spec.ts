import { expect, test } from '@playwright/test'
import { assertNoErrors, openApp } from './helpers'

test.describe('월 보기 아래 이번 달 일정 카드', () => {
  test('달력 아래 별도 카드에 이번 달 일정을 날짜순으로 보여 주고, 누르면 그 일정이 열린다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    const errors = await openApp(page)
    const cal = page.locator('.calv')
    const agenda = page.getByRole('region', { name: '11월 일정' })
    await expect(agenda).toBeVisible()
    // 달력 카드가 위, 일정 카드가 아래
    const a = (await cal.boundingBox())!
    const b = (await agenda.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(a.y + a.height)
    const rows = agenda.locator('.ag-row')
    expect(await rows.count()).toBeGreaterThan(3)
    // 지난 일정은 흐리게
    expect(await agenda.locator('.ag-row.past').count()).toBeGreaterThan(0)
    // 아래 카드가 화면 안에 들어오고 페이지는 세로로 넘치지 않는다
    expect(b.y + b.height).toBeLessThanOrEqual(800)
    const row = rows.filter({ hasText: '주간회의' }).first()
    await row.click()
    await expect(row).toHaveClass(/on/)
    assertNoErrors(errors)
  })

  test('작아진 달력 칸은 일정 1개와 +개수만 보이고 칸 밖으로 넘치지 않는다', async ({ page }) => {
    for (const width of [1024, 1280, 1920]) {
      await page.setViewportSize({ width, height: 800 })
      const errors = await openApp(page)
      const over = await page.locator('.mcell').evaluateAll((cells) =>
        cells.filter((c) => c.scrollHeight > c.clientHeight + 1 || c.querySelectorAll('.chip2').length > 1).length
      )
      expect(over, `${width}px`).toBe(0)
      const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      expect(noHScroll).toBe(true)
      assertNoErrors(errors)
    }
  })

  test('주·일 보기에서는 일정 카드 없이 달력이 전체 높이를 쓴다', async ({ page }) => {
    const errors = await openApp(page)
    await page.locator('.views button', { hasText: '주' }).click()
    await expect(page.locator('.cal-agenda')).toHaveCount(0)
    await page.locator('.views button', { hasText: '월' }).click()
    await expect(page.locator('.cal-agenda')).toBeVisible()
    assertNoErrors(errors)
  })

  test('일정이 없는 달은 안내 문구를 보여 준다', async ({ page }) => {
    const errors = await openApp(page)
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: '다음' }).click()
    await expect(page.locator('.cal-agenda-empty')).toBeVisible()
    assertNoErrors(errors)
  })
})
