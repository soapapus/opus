import { expect, test } from '@playwright/test'
import { assertNoErrors, goMemo, openApp } from './helpers'

test('워크스페이스를 만들고 전환하면 메모가 분리되고 선택이 유지된다', async ({ page }) => {
  const errors = await openApp(page)
  await goMemo(page)
  await expect(page.locator('.arow-b').first()).toBeVisible()
  const personalCount = await page.locator('.arow-b').count()
  // 맨 위 공간 이름 → 목록 → '워크스페이스 관리' 로 설정을 연다
  const switcher = page.getByRole('button', { name: '워크스페이스 전환' })
  const pick = async (name: string) => {
    await switcher.click()
    await page.getByRole('menuitemradio', { name }).click()
    await expect(switcher).toContainText(name)
  }
  await switcher.click()
  await page.getByRole('menuitem', { name: '워크스페이스 관리' }).click()
  await page.getByRole('textbox', { name: '새 워크스페이스 이름' }).fill('업무')
  await page.getByRole('button', { name: '+ 새 공간', exact: true }).click()
  await expect(page.locator('.lst-note')).toHaveText('워크스페이스를 만들었어요')
  await switcher.click()
  await expect(page.getByRole('menuitemradio', { name: '업무' })).toHaveCount(1)
  await page.keyboard.press('Escape')
  await pick('업무')
  await goMemo(page)
  await expect(page.locator('.arow-b')).toHaveCount(0)
  await page.evaluate(() => window.api.createNote({ kind: 'document', date: '', title: '업무 기록' }))
  await pick('개인 워크스페이스')
  await goMemo(page)
  await expect(page.locator('.arow-b')).toHaveCount(personalCount)
  await expect(page.locator('.arow-b', { hasText: '업무 기록' })).toHaveCount(0)
  await pick('업무')
  await goMemo(page)
  await expect(page.locator('.arow-b', { hasText: '업무 기록' })).toHaveCount(1)
  await page.reload()
  await expect(switcher).toContainText('업무')
  assertNoErrors(errors)
})

test('사이드바에는 중복 보기 버튼이 없고 캘린더 상단에서만 월·주·일을 바꾼다', async ({ page }) => {
  const errors = await openApp(page)
  await expect(page.locator('.ws').getByRole('button', { name: /월 보기|주 보기|일 보기/ })).toHaveCount(0)
  await expect(page.locator('.seg2.views button')).toHaveCount(3)
  await page.locator('.seg2.views button').nth(1).click()
  await expect(page.locator('.wgrid')).toBeVisible()
  assertNoErrors(errors)
})
