import { expect, test } from '@playwright/test'
import { assertNoErrors, contrastOf, goMemo, openApp } from './helpers'

// 주인이 실제로 겪은 문제와 지켜야 할 화면 규칙을 그대로 시나리오로 만든 것.
// 새 화면 기능을 만들면 여기에 시나리오를 추가한다 (AGENTS.md 'QA').

test.describe('캘린더', () => {
  test('월 보기가 오류 없이 뜨고 오늘이 표시된다', async ({ page }) => {
    const errors = await openApp(page)
    await expect(page.locator('.calv-title h1')).toContainText('2026년 11월')
    expect(await page.locator('.mcell').count()).toBeGreaterThanOrEqual(35)
    await expect(page.locator('.mcell.today .dn')).toHaveText('5')
    assertNoErrors(errors)
  })

  test('월·주·일 보기를 오가도 오류가 없다', async ({ page }) => {
    const errors = await openApp(page)
    const views = page.locator('.seg2.views button')
    await views.nth(1).click()
    await expect(page.locator('.wgrid')).toBeVisible()
    await views.nth(2).click()
    await expect(page.locator('.dgrid')).toBeVisible()
    await views.nth(0).click()
    await expect(page.locator('.mgrid')).toBeVisible()
    assertNoErrors(errors)
  })

  test('한국 공휴일이 보인다 (12월 25일 기독탄신일)', async ({ page }) => {
    const errors = await openApp(page)
    await page.locator('.navgrp .icon-btn').nth(1).click()
    await expect(page.locator('.calv-title h1')).toContainText('2026년 12월')
    await expect(page.locator('.mcell .hol', { hasText: '기독탄신일' })).toBeVisible()
    assertNoErrors(errors)
  })
})

test.describe('메모', () => {
  test('펼친 메모 카드는 글이 길어져도 높이가 그대로고, 본문만 안에서 스크롤된다', async ({ page }) => {
    const errors = await openApp(page)
    await goMemo(page)
    await page.locator('.arow-b').first().click()
    const card = page.locator('.agenda-open')
    await expect(card).toBeVisible()
    const before = await card.boundingBox()

    await page.locator('.agenda-open .tiptap').click()
    await page.keyboard.press('Control+End')
    for (let i = 0; i < 40; i++) {
      await page.keyboard.type(`긴 메모 줄 ${i}`)
      await page.keyboard.press('Enter')
    }

    const after = await card.boundingBox()
    expect(after!.height, '카드 높이 고정').toBeCloseTo(before!.height, 0)

    // 제목·저장 줄이 카드 안에 그대로 보인다 (0.3.0 버그: 편집기 전체가 스크롤돼 저장 줄이 글 위로 겹치고 글이 카드 밖으로 넘침)
    const box = after!
    const inside = async (sel: string, what: string) => {
      const b = (await page.locator(sel).boundingBox())!
      expect(b.y, `${what}: 카드 위로 넘침`).toBeGreaterThanOrEqual(box.y - 1)
      expect(b.y + b.height, `${what}: 카드 아래로 넘침`).toBeLessThanOrEqual(box.y + box.height + 1)
      return b
    }
    await inside('.agenda-open .ed-title', '제목')
    const foot = await inside('.agenda-open .ed-foot', '저장 줄')
    const body = await inside('.agenda-open .ed-body', '본문 영역')
    expect(body.y + body.height, '본문은 저장 줄 위에서 끝남').toBeLessThanOrEqual(foot.y + 1)

    // 스크롤은 본문(.ed-body)만 한다. 편집기 전체는 스크롤되지 않는다
    const s = await page.evaluate(() => {
      const ed = document.querySelector('.agenda-open .card.editor') as HTMLElement
      const bd = document.querySelector('.agenda-open .ed-body') as HTMLElement
      return { edTop: ed.scrollTop, bodyH: bd.clientHeight, bodyS: bd.scrollHeight, bodyOverflow: getComputedStyle(bd).overflowY }
    })
    expect(s.edTop, '편집기 전체는 스크롤되지 않음').toBe(0)
    expect(s.bodyOverflow).toBe('auto')
    expect(s.bodyS, '본문은 안에서 스크롤').toBeGreaterThan(s.bodyH)
    assertNoErrors(errors)
  })

  test('메모 제목에 맞춤법 빨간 줄이 없다', async ({ page }) => {
    await openApp(page)
    await goMemo(page)
    await page.locator('.arow-b').first().click()
    await expect(page.locator('.agenda-open .ed-title')).toHaveAttribute('spellcheck', 'false')
  })
})

test.describe('화면 규칙', () => {
  test('강조색을 Graphite 로 바꿔도 오늘 표시·종류 칩 글자가 보인다', async ({ page }) => {
    const errors = await openApp(page)
    await page.locator('.rail-btn[aria-label="설정"]').click()
    await page.locator('.acc', { hasText: 'Graphite' }).click()
    await page.locator('.rail-btn[aria-label="캘린더"]').click()
    expect(await contrastOf(page, '.mcell.today .dn')).toBeGreaterThanOrEqual(3)
    await goMemo(page)
    await page.locator('.arow-b').first().click()
    expect(await contrastOf(page, '.agenda-open .kind-chip')).toBeGreaterThanOrEqual(4.5)
    expect(await contrastOf(page, '.mini-g .md.today')).toBeGreaterThanOrEqual(3)
    assertNoErrors(errors)
  })

  test('사이드바·오른쪽 패널을 단축키로 접고 편다', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('Control+Backslash')
    await expect(page.locator('.app2')).toHaveClass(/ws-closed/)
    await page.keyboard.press('Control+Backslash')
    await expect(page.locator('.app2')).not.toHaveClass(/ws-closed/)
    await page.keyboard.press('Control+Period')
    await expect(page.locator('.day-closed')).toHaveCount(1)
  })

  for (const width of [1024, 1280, 1920]) {
    test(`창 너비 ${width}px 에서 가로로 넘치지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await openApp(page)
      for (const menu of ['캘린더', '메모', '설정']) {
        await page.locator(`.rail-btn[aria-label="${menu}"]`).click()
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        expect(over, `${menu} 화면 가로 넘침`).toBeLessThanOrEqual(0)
      }
    })
  }
})

test.describe('설정', () => {
  test('백업 안내가 "지우지 않고 모두 보관"이고 30개 제한 문구가 없다', async ({ page }) => {
    const errors = await openApp(page)
    await page.locator('.rail-btn[aria-label="설정"]').click()
    await expect(page.getByText('지우지 않고 모두 보관').first()).toBeVisible()
    await expect(page.getByText('최근 30개')).toHaveCount(0)
    assertNoErrors(errors)
  })
})

// 집·회사 PC가 Google Drive 폴더를 같이 쓸 때 (화면에서는 가짜 데이터의 __otherPcEdit 로 다른 PC를 흉내 낸다)
test.describe('두 PC 동기화', () => {
  const otherPc = (page: import('@playwright/test').Page, title: string, body: string) =>
    page.evaluate(([t, b]) => (window as unknown as { __otherPcEdit: (x: string, y: string) => void }).__otherPcEdit(t, b), [title, body])

  test('다른 PC에서 고친 메모를 저장 안 한 글이 없으면 바로 다시 불러온다', async ({ page }) => {
    const errors = await openApp(page)
    await goMemo(page)
    await page.locator('.arow-b').first().click()
    const title = await page.locator('.agenda-open .ed-title').inputValue()
    await otherPc(page, title, '회사 PC에서 적은 내용')
    await expect(page.locator('.agenda-open .tiptap')).toContainText('회사 PC에서 적은 내용')
    await expect(page.getByText('다른 PC에서 고친 내용을 불러왔어요')).toBeVisible()
    assertNoErrors(errors)
  })

  test('같은 메모를 양쪽에서 고치면 내 글은 그대로 저장되고, 다른 PC 내용은 사본으로 남는다', async ({ page }) => {
    const errors = await openApp(page)
    await goMemo(page)
    await page.locator('.arow-b').first().click()
    const title = await page.locator('.agenda-open .ed-title').inputValue()
    await page.locator('.agenda-open .tiptap').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('집 PC에서 쓰는 중')
    await otherPc(page, title, '회사 PC에서 먼저 저장한 내용')
    // 쓰는 중인 글은 덮어쓰지 않는다
    await expect(page.locator('.agenda-open .tiptap')).toContainText('집 PC에서 쓰는 중')
    await expect(page.getByText(/다른 PC에서 고친 내용은 '.*' 메모로 남겼어요/)).toBeVisible()
    await expect(page.locator('.agenda-open .tiptap')).toContainText('집 PC에서 쓰는 중')
    await expect(page.getByText(`${title} (다른 PC에서 고친 내용`).first()).toBeVisible()
    assertNoErrors(errors)
  })

  test('설정에 두 PC 같이 쓰는 방법 안내가 있고, 1024px에서도 넘치지 않는다', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    const errors = await openApp(page)
    await page.locator('.rail-btn[aria-label="설정"]').click()
    const guide = page.locator('.sync-guide')
    await guide.scrollIntoViewIfNeeded()
    await expect(guide).toContainText('Google Drive 데스크톱')
    await expect(guide.locator('.sync-state')).toHaveText('이 PC 안 폴더')
    const over = await page.evaluate(() => {
      const g = document.querySelector('.sync-guide') as HTMLElement
      const card = g.closest('.srow') as HTMLElement
      return g.getBoundingClientRect().right - card.getBoundingClientRect().right
    })
    expect(over, '안내가 카드 밖으로 넘침').toBeLessThanOrEqual(0)
    assertNoErrors(errors)
  })
})
