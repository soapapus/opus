import { expect, test } from '@playwright/test'
import { goMemo, openApp, assertNoErrors } from './helpers'

test('검색 돋보기는 입력창 중앙에 맞고 입력 영역을 가리지 않는다', async ({ page }) => {
  await openApp(page)
  await goMemo(page)
  const icon = (await page.locator('.memo-list-search .s-icon').boundingBox())!
  const input = (await page.getByRole('textbox', { name: '메모 검색' }).boundingBox())!
  expect(Math.abs(icon.y + icon.height / 2 - input.y - input.height / 2)).toBeLessThanOrEqual(1)
  expect(icon.x).toBeGreaterThan(input.x)
  const padding = await page.getByRole('textbox', { name: '메모 검색' }).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))
  expect(input.x + padding).toBeGreaterThanOrEqual(icon.x + icon.width)
})

test('선택 체크박스는 진행 중 표시와 별개이고 확인한 메모만 지운다', async ({ page }, testInfo) => {
  const errors = await openApp(page)
  await goMemo(page)
  const rows = page.locator('.arow')
  const count = await rows.count()
  const first = await rows.nth(0).locator('.at').innerText()
  const second = await rows.nth(1).locator('.at').innerText()
  const keep = await rows.nth(2).locator('.at').innerText()
  const pinned = await page.locator('.pin.on').count()
  await expect(page.getByRole('button', { name: '선택한 메모 삭제' })).toBeDisabled()
  await rows.nth(0).getByRole('checkbox').check()
  await rows.nth(1).getByRole('checkbox').check()
  expect(await page.locator('.pin.on').count()).toBe(pinned)
  await page.screenshot({ path: testInfo.outputPath('selected-memos.png') })
  await page.getByRole('button', { name: '선택한 메모 삭제' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('2개')
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await expect(rows).toHaveCount(count)
  await expect(page.locator('.arow input:checked')).toHaveCount(2)
  await page.getByRole('button', { name: '선택한 메모 삭제' }).click()
  await page.getByRole('button', { name: '선택한 메모 지우기', exact: true }).click()
  await expect(rows).toHaveCount(count - 2)
  expect(await page.evaluate(async ([a, b, c]) => {
    const docs = await window.api.documents()
    return { removed: !docs.some(n => n.title === a || n.title === b), kept: docs.some(n => n.title === c) }
  }, [first, second, keep])).toEqual({ removed: true, kept: true })
  assertNoErrors(errors)
})

test('필터를 바꾸면 삭제 선택을 해제하고 다른 목록의 메모는 지우지 않는다', async ({ page }) => {
  await openApp(page)
  await goMemo(page)
  await page.locator('.arow').first().getByRole('checkbox').check()
  await page.locator('.ws-item', { hasText: '오늘' }).click()
  await expect(page.locator('.arow input:checked')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '선택한 메모 삭제' })).toBeDisabled()
})

test('일부 삭제가 실패하면 실패한 메모와 선택을 유지해 다시 시도할 수 있다', async ({ page }) => {
  const errors = await openApp(page)
  await goMemo(page)
  await page.evaluate(() => {
    const remove = window.api.deleteNote
    let first = true
    window.api.deleteNote = async id => {
      if (first) { first = false; throw new Error('파일 사용 중') }
      return remove(id)
    }
  })
  const count = await page.locator('.arow').count()
  await page.locator('.arow').nth(0).getByRole('checkbox').check()
  await page.locator('.arow').nth(1).getByRole('checkbox').check()
  await page.getByRole('button', { name: '선택한 메모 삭제' }).click()
  await page.getByRole('button', { name: '선택한 메모 지우기', exact: true }).click()
  await expect(page.locator('.arow')).toHaveCount(count - 1)
  await expect(page.getByRole('alert')).toContainText('일부 메모를 지우지 못했어요')
  await expect(page.locator('.arow input:checked')).toHaveCount(1)
  await page.getByRole('button', { name: '선택한 메모 삭제' }).click()
  await page.getByRole('button', { name: '선택한 메모 지우기', exact: true }).click()
  await expect(page.locator('.arow')).toHaveCount(count - 2)
  assertNoErrors(errors)
})
