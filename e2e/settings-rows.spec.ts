// 워크스페이스 · 메뉴 행 목록과 프로필 팝업 (2026-11-05 주인 확인 시안)
import { expect, test, type Page } from '@playwright/test'
import { assertNoErrors, contrastOf, openApp } from './helpers'

const openSettings = (page: Page) => page.locator('.rail-btn[aria-label="설정"]').click()
const row = (page: Page, name: string) => page.locator('.rows li', { has: page.locator('.row-t b', { hasText: new RegExp(`^${name}$`) }) })
const switcher = (page: Page) => page.getByRole('button', { name: '워크스페이스 전환' })

async function withWorkspaces(page: Page, ...names: string[]) {
  await page.evaluate(async (ns) => {
    for (const n of ns) await window.api.createWorkspace(n)
  }, names)
  await page.reload()
}

test.describe('워크스페이스 목록', () => {
  test('설정에서 전환 버튼을 누르면 그 공간으로 바뀌고, 현재 공간 표시가 옮겨 간다', async ({ page }) => {
    const errors = await openApp(page)
    await withWorkspaces(page, '업무')
    await openSettings(page)
    await expect(row(page, '개인 워크스페이스').locator('.chip.cur')).toHaveText('현재 공간')
    await row(page, '업무').getByRole('button', { name: '전환' }).click()
    await expect(switcher(page)).toContainText('업무')
    await openSettings(page)
    await expect(row(page, '업무').locator('.chip.cur')).toHaveText('현재 공간')
    await expect(row(page, '개인 워크스페이스').getByRole('button', { name: '전환' })).toBeEnabled()
    assertNoErrors(errors)
  })

  test('이름 변경: 저장하면 맨 위 이름도 바뀌고, Esc·취소는 그대로 둔다', async ({ page }) => {
    const errors = await openApp(page)
    await openSettings(page)
    const r = row(page, '개인 워크스페이스')
    await r.getByRole('button', { name: '이름 변경' }).click()
    await page.getByRole('textbox', { name: '새 이름' }).fill('개인')
    await page.keyboard.press('Escape')
    await expect(row(page, '개인 워크스페이스')).toHaveCount(1)

    await row(page, '개인 워크스페이스').getByRole('button', { name: '이름 변경' }).click()
    await page.getByRole('textbox', { name: '새 이름' }).fill('개인')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(row(page, '개인')).toHaveCount(1)
    await expect(switcher(page)).toContainText('개인')
    await expect(page.locator('.lst-note').first()).toHaveText('이름을 바꿨어요')
    assertNoErrors(errors)
  })

  test('같은 이름으로 바꾸려 하면 안내가 나오고 이름은 그대로다', async ({ page }) => {
    const errors = await openApp(page)
    await withWorkspaces(page, '업무')
    await openSettings(page)
    await row(page, '업무').getByRole('button', { name: '이름 변경' }).click()
    await page.getByRole('textbox', { name: '새 이름' }).fill('개인 워크스페이스')
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.locator('.lst-note').first()).toContainText('이미 사용 중인 이름')
    assertNoErrors(errors)
  })

  test('공간을 끄면 전환 목록에서 빠지고 전환 버튼이 잠기며, 다시 켜면 돌아온다. 지금 공간은 끌 수 없다', async ({ page }) => {
    const errors = await openApp(page)
    await withWorkspaces(page, '업무')
    await openSettings(page)
    await expect(row(page, '개인 워크스페이스').getByRole('switch')).toBeDisabled()

    const work = row(page, '업무')
    await work.getByRole('switch').click()
    await expect(work.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    await expect(work).toContainText('꺼져 있어요 · 기록은 보관 중')
    await expect(work.getByRole('button', { name: '전환' })).toBeDisabled()
    await switcher(page).click()
    await expect(page.getByRole('menuitemradio', { name: '업무' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await work.getByRole('switch').click()
    await expect(work.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    await switcher(page).click()
    await expect(page.getByRole('menuitemradio', { name: '업무' })).toHaveCount(1)
    assertNoErrors(errors)
  })

  test('아주 긴 공간 이름도 줄 밖으로 넘치지 않는다 (1024px)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 720 })
    const errors = await openApp(page)
    const long = '아주 긴 이름의 워크스페이스 프로젝트 기록 보관용 공간입니다'
    await withWorkspaces(page, long)
    await openSettings(page)
    const over = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.rows li')).map((li) => li.scrollWidth - li.clientWidth)
    )
    expect(Math.max(...over), '행 가로 넘침').toBeLessThanOrEqual(0)
    const docOver = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(docOver).toBeLessThanOrEqual(0)
    // 맨 위 전환 단추도 사이드바 안에 있다
    const box = (await switcher(page).boundingBox())!
    const side = (await page.locator('.ws').boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(side.x + side.width)
    assertNoErrors(errors)
  })
})

test.describe('메뉴 목록', () => {
  test('스위치로 메뉴를 숨기면 왼쪽 메뉴·아이콘 줄에서 빠지고, 설정은 숨길 수 없다', async ({ page }) => {
    const errors = await openApp(page)
    await openSettings(page)
    await page.getByRole('switch', { name: '메모 메뉴 보이기', exact: true }).click()
    await expect(page.locator('.rail-btn[aria-label="메모"]')).toHaveCount(0)
    await expect(page.locator('.ws-scroll > .ws-item', { hasText: /^메모/ })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: '설정 메뉴 보이기' })).toBeDisabled()
    await expect(page.getByRole('switch', { name: '설정 메뉴 보이기' })).toHaveAttribute('aria-checked', 'true')
    // 다시 켜면 돌아온다 (데이터는 그대로)
    await page.getByRole('switch', { name: '메모 메뉴 보이기', exact: true }).click()
    await expect(page.locator('.rail-btn[aria-label="메모"]')).toHaveCount(1)
    assertNoErrors(errors)
  })

  test('메뉴 이름을 그 줄에서 바로 바꾸면 왼쪽 메뉴에 반영된다', async ({ page }) => {
    const errors = await openApp(page)
    await openSettings(page)
    await page.getByRole('textbox', { name: '캘린더 메뉴 이름' }).fill('일정')
    await expect(page.locator('.ws-scroll > .ws-item').first()).toHaveText('일정')
    assertNoErrors(errors)
  })

  test('캘린더를 숨기면 다음에 열 때 보이는 첫 메뉴로 간다', async ({ page }) => {
    const errors = await openApp(page)
    await openSettings(page)
    await page.getByRole('switch', { name: '캘린더 메뉴 보이기' }).click()
    await page.reload()
    await expect(page.locator('.memov')).toBeVisible()
    await expect(page.locator('.rail-btn[aria-label="캘린더"]')).toHaveCount(0)
    assertNoErrors(errors)
  })
})

test.describe('프로필 팝업', () => {
  test('왼쪽 아래 카드를 누르면 팝업이 뜨고, 저장하면 이름·첫 글자가 바뀐다', async ({ page }) => {
    const errors = await openApp(page)
    const card = page.getByRole('button', { name: '프로필 편집' })
    await expect(card).toContainText('나')
    await card.click()
    const dlg = page.getByRole('dialog', { name: '프로필' })
    await expect(dlg).toBeVisible()
    await dlg.getByRole('textbox', { name: '이름' }).fill('민서')
    await dlg.getByRole('textbox', { name: '소속 · 직함' }).fill('기획팀 · 매니저')
    await dlg.getByRole('textbox', { name: '연락처' }).fill('010-0000-0000')
    await dlg.getByRole('button', { name: '저장' }).click()
    await expect(dlg).toHaveCount(0)
    await expect(card).toContainText('민서')
    await expect(card.locator('.av')).toHaveText('민')
    // 다시 열면 저장한 값이 들어 있다
    await card.click()
    await expect(dlg.getByRole('textbox', { name: '소속 · 직함' })).toHaveValue('기획팀 · 매니저')
    assertNoErrors(errors)
  })

  test('취소·Esc·바깥 클릭은 저장하지 않는다', async ({ page }) => {
    const errors = await openApp(page)
    const card = page.getByRole('button', { name: '프로필 편집' })
    const dlg = page.getByRole('dialog', { name: '프로필' })
    for (const close of ['취소', 'Escape', 'outside'] as const) {
      await card.click()
      await dlg.getByRole('textbox', { name: '이름' }).fill('바뀌면 안 됨')
      if (close === '취소') await dlg.getByRole('button', { name: '취소' }).click()
      else if (close === 'Escape') await page.keyboard.press('Escape')
      else await page.mouse.click(5, 400)
      await expect(dlg).toHaveCount(0)
      await expect(card).not.toContainText('바뀌면 안 됨')
    }
    assertNoErrors(errors)
  })

  test('팝업은 1024×640 창 안에 다 들어오고, 긴 이름은 카드에서 말줄임된다', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 640 })
    const errors = await openApp(page)
    const card = page.getByRole('button', { name: '프로필 편집' })
    await card.click()
    const dlg = page.getByRole('dialog', { name: '프로필' })
    const b = (await dlg.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.y + b.height).toBeLessThanOrEqual(640)
    // 사진 칸은 48px 안팎으로 제한
    const av = (await dlg.locator('.av').boundingBox())!
    expect(av.width).toBeLessThanOrEqual(48)
    await dlg.getByRole('textbox', { name: '이름' }).fill('아주아주 긴 이름을 가진 사람의 표시 이름 테스트')
    await dlg.getByRole('button', { name: '저장' }).click()
    const over = await card.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(over, '카드 가로 넘침').toBeLessThanOrEqual(0)
    const cav = (await card.locator('.av').boundingBox())!
    expect(cav.width).toBeLessThanOrEqual(32)
    assertNoErrors(errors)
  })
})

test('Graphite 강조색에서도 현재 공간 표시·공간 글자·켜진 스위치가 보인다', async ({ page }) => {
  const errors = await openApp(page)
  await openSettings(page)
  await page.locator('.acc', { hasText: 'Graphite' }).click()
  expect(await contrastOf(page, '.chip.cur')).toBeGreaterThanOrEqual(4.5)
  expect(await contrastOf(page, '.wss-mark')).toBeGreaterThanOrEqual(4.5)
  expect(await contrastOf(page, '.row.cur .row-mark')).toBeGreaterThanOrEqual(4.5)
  // 켜진 스위치: 손잡이(흰색)와 트랙(강조색)의 대비
  await expect
    .poll(() => page.locator('.tgl.on').first().evaluate((el) => getComputedStyle(el, '::before').backgroundColor))
    .toBe('rgb(34, 38, 33)')
  assertNoErrors(errors)
})
