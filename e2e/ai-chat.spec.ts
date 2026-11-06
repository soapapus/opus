import { expect, test, type Page } from '@playwright/test'
import { assertNoErrors, contrastOf, openApp } from './helpers'

async function openAi(page: Page, key = true): Promise<string[]> {
  const errors = await openApp(page)
  if (key) await page.evaluate(async () => { await window.api.aiConfigure('preview-key', 'gemini-flash-latest') })
  await page.locator('.rail-btn[aria-label="AI"]').click()
  await expect(page.locator('.ai2')).toBeVisible()
  return errors
}

test.describe('AI 탭', () => {
  test('새 대화를 시작하면 목록 맨 위 오늘에 생기고, 답변은 서식(목록·코드)으로 보인다', async ({ page }) => {
    const errors = await openAi(page)
    await expect(page.getByText('아직 대화가 없어요.')).toBeVisible()
    await expect(page.getByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeVisible()
    const box = page.getByLabel('Gemini에게 질문', { exact: true })
    await box.fill('이 API는 무료 발급 키가 맞니?')
    await box.press('Enter')
    await expect(page.locator('.ai-message.user .bubble')).toHaveText('이 API는 무료 발급 키가 맞니?')
    const answer = page.locator('.ai-message.model').last()
    await expect(answer.locator('h4')).toHaveText('정리')
    await expect(answer.locator('ol > li')).toHaveCount(2)
    await expect(answer.locator('strong').first()).toHaveText('요청')
    await expect(answer.locator('.ai-code pre')).toContainText('print("안녕")')
    await expect(answer.locator('.ai-code-h')).toContainText('python')
    const today = page.getByRole('region', { name: '오늘' })
    await expect(today.getByRole('button', { name: '이 API는 무료 발급 키가 맞니?', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.ai-head h1')).toHaveText('이 API는 무료 발급 키가 맞니?')
    await expect(page.locator('.ai-tokens')).toContainText('이번 달 120 토큰')
    assertNoErrors(errors)
  })

  test('Shift+Enter는 줄바꿈, 대화를 바꿔 이어 쓰고, 다시 생성은 답을 덧붙인다', async ({ page }) => {
    const errors = await openAi(page)
    const box = page.getByLabel('Gemini에게 질문', { exact: true })
    await box.fill('첫 대화')
    await box.press('Shift+Enter')
    await expect(box).toHaveValue('첫 대화\n')
    await box.press('Enter')
    await expect(page.locator('.ai-message.model')).toHaveCount(1)
    await page.getByRole('button', { name: '새 대화' }).click()
    await expect(page.locator('.ai-message')).toHaveCount(0)
    await box.fill('둘째 대화')
    await page.getByRole('button', { name: 'Gemini에 전송' }).click()
    await expect(page.locator('.ai-chat-row')).toHaveCount(2)
    await page.getByRole('button', { name: '첫 대화', exact: true }).click()
    await expect(page.locator('.ai-message.user .bubble')).toHaveText('첫 대화')
    await page.getByRole('button', { name: '다시 생성' }).click()
    await expect(page.locator('.ai-message.model')).toHaveCount(2)
    await expect(page.locator('.ai-message.model').last()).toContainText('다시 받은')
    await page.getByLabel('대화 검색').fill('둘째')
    await expect(page.locator('.ai-chat-row')).toHaveCount(1)
    await page.getByLabel('대화 검색').fill('없는 대화')
    await expect(page.getByText('검색한 대화가 없어요.')).toBeVisible()
    assertNoErrors(errors)
  })

  test('대화 이름 바꾸기와 모델 선택', async ({ page }) => {
    const errors = await openAi(page)
    await page.getByLabel('Gemini에게 질문', { exact: true }).fill('이름 바꿀 대화')
    await page.getByRole('button', { name: 'Gemini에 전송' }).click()
    await page.locator('.ai-chat-row').hover()
    await page.getByRole('button', { name: '이름 바꿀 대화 이름 바꾸기' }).click()
    await page.getByLabel('대화 이름').fill('주간 업무 요약')
    await page.getByLabel('대화 이름').press('Enter')
    await expect(page.getByRole('button', { name: '주간 업무 요약', exact: true })).toBeVisible()
    await expect(page.locator('.ai-head h1')).toHaveText('주간 업무 요약')
    await page.getByLabel('Gemini 모델').selectOption('gemini-2.5-pro')
    await expect(page.getByLabel('Gemini 모델')).toHaveValue('gemini-2.5-pro')
    assertNoErrors(errors)
  })

  test('실패하면 원인을 보여 주고 질문은 대화에 남는다', async ({ page }) => {
    const errors = await openAi(page)
    await page.evaluate(() => {
      const orig = window.api.aiSend
      window.api.aiSend = async (id, text) => { await orig(id, text).catch(() => undefined); throw new Error("Error invoking remote method 'ld:aiSend': Error: Gemini 요청 실패 (404). 모델을 찾을 수 없어요") }
    })
    await page.getByLabel('Gemini에게 질문', { exact: true }).fill('실패할 질문')
    await page.getByRole('button', { name: 'Gemini에 전송' }).click()
    await expect(page.getByRole('alert')).toHaveText('Gemini 요청 실패 (404). 모델을 찾을 수 없어요')
    await expect(page.locator('.ai-message.user .bubble').first()).toHaveText('실패할 질문')
    assertNoErrors(errors)
  })

  test('답을 못 받은 질문은 다른 메뉴에 다녀와도 이유와 다시 보내기가 남고, 다시 보내면 답이 붙는다', async ({ page }) => {
    const errors = await openAi(page)
    await page.evaluate(() => {
      // 실제 앱처럼: 실패해도 질문은 저장되고 답은 없다
      const chat = { id: 'fail', title: 'HI , AI', created: '2026-11-05T01:00:00Z', messages: [] as { role: 'user' | 'model'; text: string; created: string }[] }
      let saved = false
      window.api.aiChats = async () => (saved ? [{ id: chat.id, title: chat.title, updated: '2026-11-05T01:00:00Z', count: chat.messages.length }] : [])
      window.api.aiChat = async () => structuredClone(chat)
      window.api.aiSend = async (_id, text) => {
        saved = true
        chat.messages.push({ role: 'user', text, created: '2026-11-05T01:00:00Z' })
        throw new Error("Error invoking remote method 'ld:aiSend': Error: Gemini 요청 실패 (403). API 키가 맞지 않아요")
      }
      window.api.aiRegenerate = async () => {
        chat.messages.push({ role: 'model', text: '안녕하세요!', created: '2026-11-05T01:00:05Z' })
        return structuredClone(chat)
      }
    })
    await page.getByLabel('Gemini에게 질문', { exact: true }).fill('HI , AI')
    await page.getByRole('button', { name: 'Gemini에 전송' }).click()
    await expect(page.getByRole('alert')).toHaveText('Gemini 요청 실패 (403). API 키가 맞지 않아요')
    await page.locator('.rail-btn[aria-label="메모"]').click()
    await page.locator('.rail-btn[aria-label="AI"]').click()
    await expect(page.locator('.ai-message.user .bubble')).toHaveText('HI , AI')
    await expect(page.getByRole('alert')).toHaveText('Gemini 요청 실패 (403). API 키가 맞지 않아요')
    await page.getByRole('button', { name: '다시 보내기' }).click()
    await expect(page.locator('.ai-message.model')).toContainText('안녕하세요!')
    await expect(page.getByRole('button', { name: '다시 보내기' })).toHaveCount(0)
    await expect(page.getByRole('alert')).toHaveCount(0)
    assertNoErrors(errors)
  })

  test('저장된 키가 맞지 않으면 대화 위에 키 확인 실패를 보여 준다', async ({ page }) => {
    const errors = await openApp(page)
    await page.evaluate(async () => {
      window.api.aiModels = async () => { throw new Error("Error invoking remote method 'ld:aiModels': Error: Gemini 요청 실패 (400). API 키가 맞지 않거나 이 키로 Gemini API를 쓸 수 없어요") }
      await window.api.aiConfigure('wrong-key', 'gemini-flash-latest')
    })
    await page.locator('.rail-btn[aria-label="AI"]').click()
    await expect(page.locator('.ai-keycheck')).toContainText('Gemini 키 확인 실패: Gemini 요청 실패 (400). API 키가 맞지 않거나')
    await expect(page.locator('.ai-keycheck').getByRole('button', { name: '설정 열기' })).toBeVisible()
    assertNoErrors(errors)
  })

  test('키가 없으면 입력창이 잠기고 설정으로 안내한다', async ({ page }) => {
    const errors = await openAi(page, false)
    await expect(page.getByLabel('Gemini에게 질문', { exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Google 연동 설정 열기' })).toBeVisible()
    assertNoErrors(errors)
  })

  for (const width of [1024, 1280, 1920]) {
    test(`${width}px: 아주 긴 질문·코드·제목도 가로로 넘치지 않고, 입력창은 아래에 있다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const errors = await openAi(page)
      await page.evaluate(() => {
        window.api.aiSend = async (_id, text) => ({ id: 'long', title: text.slice(0, 40), created: '2026-11-05T01:00:00Z', messages: [
          { role: 'user', text, created: '2026-11-05T01:00:00Z' },
          { role: 'model', text: '```\n' + 'x'.repeat(400) + '\n```\n\n| 이름 | 값 |\n|---|---|\n| ' + '가'.repeat(300) + ' | 1 |', created: '2026-11-05T01:00:01Z' }] })
      })
      await page.getByLabel('Gemini에게 질문', { exact: true }).fill('아주긴질문'.repeat(200))
      await page.getByRole('button', { name: 'Gemini에 전송' }).click()
      await expect(page.locator('.ai-code')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const thread = (await page.locator('.ai-thread').boundingBox())!
      const bubble = (await page.locator('.ai-message.user .bubble').boundingBox())!
      expect(bubble.x + bubble.width).toBeLessThanOrEqual(thread.x + thread.width + 1)
      const compose = (await page.locator('.ai-box').boundingBox())!
      expect(compose.y + compose.height).toBeLessThanOrEqual(800)
      expect(compose.y).toBeGreaterThan(600)
      assertNoErrors(errors)
    })
  }

  test('Graphite 강조색에서도 새 대화·보내기 버튼 글자가 보인다', async ({ page }) => {
    const errors = await openApp(page)
    await page.evaluate(async () => { await window.api.prefsSet({ accent: '#222621' }) })
    await page.reload()
    await page.evaluate(async () => { await window.api.aiConfigure('k', 'gemini-flash-latest') })
    await page.locator('.rail-btn[aria-label="AI"]').click()
    expect(await contrastOf(page, '.ai-new')).toBeGreaterThan(4.5)
    await page.getByLabel('Gemini에게 질문', { exact: true }).fill('질문')
    expect(await contrastOf(page, '.ai-send')).toBeGreaterThan(4.5)
    assertNoErrors(errors)
  })
})
