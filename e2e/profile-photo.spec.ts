import { expect, test } from '@playwright/test'
import { assertNoErrors, openApp } from './helpers'

// 2x2 빨간 PNG (지어낸 예시 이미지)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
)

test('프로필 사진을 고르면 설치본 보안 정책(CSP) 아래에서도 사진이 들어간다', async ({ page }) => {
  const errors = await openApp(page)
  await page.getByRole('button', { name: '프로필 편집' }).click()
  const dlg = page.getByRole('dialog', { name: '프로필' })
  await dlg.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
  await expect(dlg.locator('.av img')).toHaveAttribute('src', /^data:image\/jpeg/)
  await expect(dlg.getByText('사진을 읽지 못했어요')).toHaveCount(0)
  await dlg.getByRole('button', { name: '저장' }).click()
  await expect(page.locator('.ws-card .av img')).toBeVisible()
  assertNoErrors(errors)
})
