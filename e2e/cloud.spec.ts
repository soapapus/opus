import { test, expect } from '@playwright/test'
import { openApp, assertNoErrors, contrastOf } from './helpers'

async function settings(page: import('@playwright/test').Page) {
  await page.locator('.rail-btn[aria-label="설정"]').click()
  await page.locator('.ws-scroll').getByRole('button', { name: /Google 연동$/ }).click()
  await expect(page.getByRole('button', { name: 'Google 설정 저장' })).toBeVisible()
}

async function openBackup(page: import('@playwright/test').Page) {
  await settings(page)
  await page.getByText('Drive 백업 목록 · 기록 병합', { exact: true }).click()
  await expect(page.locator('.drive-backup-panel')).toBeVisible()
}

test('한 설정에서 Google 권한 선택·Drive 백업·Gemini 키를 관리한다', async ({ page }) => {
  const errors = await openApp(page); await settings(page)
  await expect(page.getByRole('switch', { name: 'Google 캘린더 쓰기 권한' })).toHaveAttribute('aria-checked', 'false')
  await page.getByLabel('Google 클라이언트 ID', { exact: true }).fill('preview-client')
  await page.getByLabel('Google 클라이언트 보안 비밀', { exact: true }).fill('preview-secret')
  await page.getByLabel('Gemini API 키', { exact: true }).fill('preview-key')
  await page.getByRole('button', { name: 'Google 설정 저장' }).click()
  await expect(page.getByLabel('Gemini API 키', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Google 클라이언트 보안 비밀', { exact: true })).toHaveValue('')
  await page.getByRole('switch', { name: 'Google 캘린더 쓰기 권한' }).click()
  await page.getByRole('switch', { name: 'Google Drive 읽기·쓰기 권한' }).click()
  await page.getByRole('button', { name: /선택한 권한으로 (Google 연결|다시 연결)/ }).click()
  await expect(page.locator('.cloud-status')).toContainText('쓰기 허용됨 · Drive 연결됨 · Gemini 키 저장됨')
  await page.getByRole('button', { name: 'Drive 폴더 조회' }).click()
  await page.getByLabel('Drive 백업 폴더').selectOption('preview-opus')
  await page.getByRole('button', { name: '백업 폴더 적용' }).click()
  await page.getByRole('switch', { name: 'Drive 자동 백업', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Drive 자동 백업', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: '다른 PC 백업 자동 병합', exact: true }).click()
  await expect(page.getByRole('switch', { name: '다른 PC 백업 자동 병합', exact: true })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('button', { name: '지금 Drive 백업' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Drive 백업을 완료했어요' })).toBeVisible()
  await openBackup(page)
  await expect(page.getByText('연결 폴더: Opus 미리보기', { exact: true })).toBeVisible()
  await page.locator('.rail-btn[aria-label="AI"]').click()
  await page.getByLabel('Gemini에게 질문', { exact: true }).fill('이번 주 목표를 정리해 줘')
  await page.getByRole('button', { name: 'Gemini에 전송' }).click()
  await expect(page.locator('.ai-message.user')).toContainText('이번 주 목표를 정리해 줘')
  await expect(page.locator('.ai-message.model')).toContainText('미리보기 응답')
  await page.locator('.rail-btn[aria-label="메모"]').click()
  await page.locator('.rail-btn[aria-label="AI"]').click()
  await expect(page.locator('.ai-message.user')).toContainText('이번 주 목표를 정리해 줘')
  assertNoErrors(errors)
})

for (const width of [1024, 1280, 1920]) {
  test(`${width}px에서 통합 설정·자료실·AI는 넘치지 않고 어두운 강조색도 읽힌다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    const errors = await openApp(page)
    await page.evaluate(async () => { await window.api.prefsSet({ accent: '#222621' }) })
    await page.reload(); await settings(page)
    await expect(page.getByRole('button', { name: 'Google 설정 저장' })).toBeVisible()
    expect(await contrastOf(page, '.cloud-settings .btn-accent')).toBeGreaterThan(4.5)
    for (const name of ['자료실', 'AI']) {
      await page.locator(`.rail-btn[aria-label="${name}"]`).click()
      await expect(page.locator('.main2 > section')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await expect(page.getByRole('button', { name: 'Gemini에 전송' })).toBeDisabled()
    await page.locator('.rail-btn[aria-label="자료실"]').click()
    await expect(page.getByText('등록한 폴더가 없어요. 계정이나 API 키 없이 PC 폴더를 선택하면 돼요.', { exact: true })).toBeVisible()
    assertNoErrors(errors)
  })
}

test('자료실의 긴 파일 이름·검색 결과 없음·오류를 표시한다', async ({ page }) => {
  const errors = await openApp(page)
  await page.evaluate(async () => {
    await window.api.cloudSaveKeys('id', 'secret'); await window.api.driveConnect(); await window.api.driveSelectFolder('folder')
    window.api.driveFiles = async () => [{ id: 'file', name: '아주긴자료이름'.repeat(80) + '.zip', mimeType: 'application/zip' }]
  })
  await openBackup(page)
  await expect(page.locator('.cloud-files li')).toHaveCount(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByLabel('자료 검색').fill('없는자료')
  await expect(page.getByText('검색한 자료가 없어요.')).toBeVisible()
  await page.evaluate(() => { window.api.driveFiles = async () => { throw new Error('연결 확인 필요') } })
  await page.getByRole('button', { name: '새로고침', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('연결 확인 필요')
  assertNoErrors(errors)
})

test('백업 병합을 미리 확인하고 적용하며 갈라진 AI 대화를 다시 열 수 있다', async ({ page }) => {
  const errors = await openApp(page)
  await page.evaluate(async () => {
    await window.api.cloudSaveKeys('id', 'secret'); await window.api.driveConnect(); await window.api.driveSelectFolder('folder')
    window.api.driveFiles = async () => [{ id: 'backup', name: 'Opus-백업.zip', mimeType: 'application/zip' }]
    window.api.aiArchives = async () => [{ id: 'other-pc', messages: [{ role: 'user', text: '회사 PC에서 갈라진 질문', created: '2026-11-06T10:00:00+09:00' }, { role: 'model', text: '보존된 답변', created: '2026-11-06T10:01:00+09:00' }] }]
  })
  await openBackup(page)
  await page.getByRole('button', { name: '기록 합치기 미리보기' }).click()
  const preview = page.getByRole('region', { name: '백업 병합 미리보기' })
  await expect(preview).toContainText('새 기록 2개 · 이어서 갱신 1개 · 충돌 사본 1개')
  await page.getByRole('button', { name: '미리보기대로 기록 합치기' }).click()
  await expect(page.locator('.drive-backup-panel').getByRole('status')).toContainText('기록을 합쳤어요')
  await page.locator('.rail-btn[aria-label="AI"]').click()
  await page.getByLabel('AI 대화 선택').selectOption('other-pc')
  await expect(page.locator('.ai-message.user')).toContainText('회사 PC에서 갈라진 질문')
  await expect(page.locator('.ai-message.model')).toContainText('보존된 답변')
  await expect(page.getByLabel('Gemini에게 질문', { exact: true })).toBeDisabled()
  await page.getByLabel('AI 대화 선택').selectOption('')
  await expect(page.getByLabel('Gemini에게 질문', { exact: true })).toBeEnabled()
  assertNoErrors(errors)
})
