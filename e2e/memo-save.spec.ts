import { expect, test } from '@playwright/test'
import { openApp, goMemo } from './helpers'

test('저장 실패를 표시하고 다시 저장하면 본문이 보존된다', async ({ page }) => {
  await openApp(page)
  await goMemo(page)
  await page.locator('.arow-b').first().click()
  await page.evaluate(() => {
    const original = window.api.saveNote
    let fail = true
    window.api.saveNote = async input => {
      if (fail) { fail = false; throw new Error('테스트 저장 오류') }
      return original(input)
    }
  })
  await page.locator('.tiptap').fill('저장 실패 후에도 남아야 하는 본문')
  await expect(page.getByText(/저장하지 못했어요/)).toBeVisible()
  await page.getByRole('button', { name: '다시 저장', exact: true }).click()
  await expect(page.locator('.ed-foot')).toContainText('저장됨')
  expect(await page.evaluate(async () => {
    const docs = await window.api.documents()
    return (await Promise.all(docs.map(n => window.api.getNote(n.id)))).some(n => n?.body.includes('저장 실패 후에도 남아야 하는 본문'))
  })).toBe(true)
})

test('태그로 목록 위치가 바뀌어도 편집 중 본문을 잃지 않는다', async ({ page }) => {
  const errors = await openApp(page)
  await goMemo(page)
  await page.locator('.arow-b').first().click()
  await page.locator('.tiptap').fill('태그 변경 전 본문')
  await page.getByPlaceholder('+ 태그').fill('새 프로젝트')
  await page.getByPlaceholder('+ 태그').press('Enter')
  await expect(page.locator('.ed-foot')).toContainText('저장됨')
  await page.locator('.tiptap').press('End')
  await page.locator('.tiptap').pressSequentially(' 이어서 기록')
  await expect(page.locator('.ed-foot')).toContainText('저장됨')
  await expect(page.locator('.tiptap')).toContainText('이어서 기록')
  expect(errors).toEqual([])
})

test('저장 응답을 기다리는 중에는 다른 PC 내용으로 편집기를 덮어쓰지 않는다', async ({ page }) => {
  const errors = await openApp(page)
  await goMemo(page)
  await page.locator('.arow-b').first().click()
  const title = await page.locator('.ed-title').inputValue()
  await page.evaluate(() => {
    const save = window.api.saveNote
    window.api.saveNote = async input => {
      await new Promise(resolve => setTimeout(resolve, 1200))
      return save(input)
    }
  })
  await page.locator('.tiptap').fill('응답 대기 중인 내 본문')
  await page.locator('.tiptap').press('Control+s')
  await page.evaluate(t => (window as unknown as { __otherPcEdit: (title: string, body: string) => void }).__otherPcEdit(t, '다른 PC의 본문'), title)
  await expect(page.locator('.tiptap')).toContainText('응답 대기 중인 내 본문')
  await expect(page.locator('.ed-foot')).toContainText('저장됨')
  await expect(page.locator('.tiptap')).toContainText('응답 대기 중인 내 본문')
  expect(errors).toEqual([])
})
