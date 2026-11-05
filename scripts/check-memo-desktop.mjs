// 실제 Electron IPC → 마크다운 저장 → 앱 재시작 복구 검사. npm run build 뒤 실행.
import { _electron as electron, expect } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'opus-memo-desktop-'))
const userData = join(root, 'settings')
const dataDir = join(root, 'data')
mkdirSync(userData, { recursive: true })
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ prefs: { holidayOnline: false } }))
const env = { ...process.env, OPUS_TEST_USER_DATA: userData, LD_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ args: [resolve('out/main/index.js')], env })
  const page = await app.firstWindow()
  await page.getByRole('button', { name: '메모', exact: true }).first().click()
  await page.getByRole('button', { name: '새 메모', exact: true }).first().click()
  await page.getByRole('textbox', { name: '메모 제목' }).fill('저장 검증 메모')
  await page.locator('.tiptap').fill('실제 파일에 저장되는 한글 본문')
  await page.locator('.tiptap').press('Control+s')
  await expect(page.locator('.ed-foot')).toContainText('저장됨')
  await page.getByRole('textbox', { name: '메모 제목' }).fill('수정한 저장 검증 메모')
  await page.locator('.tiptap').fill('종료 직전에도 보존되는 본문')
  const exited = new Promise(resolve => app.process().once('exit', resolve))
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await exited
  await app.close().catch(() => undefined)
  app = await electron.launch({ args: [resolve('out/main/index.js')], env })
  const reopened = await app.firstWindow()
  await reopened.getByRole('button', { name: '메모', exact: true }).first().click()
  await reopened.locator('.arow-b', { hasText: '수정한 저장 검증 메모' }).click()
  await expect(reopened.locator('.tiptap')).toContainText('종료 직전에도 보존되는 본문')
  const markdownFiles = []
  const collect = dir => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) collect(file)
    else if (file.endsWith('.md')) markdownFiles.push(readFileSync(file, 'utf8'))
  } }
  collect(dataDir)
  if (!markdownFiles.some(text => text.includes('종료 직전에도 보존되는 본문'))) throw new Error('마크다운 본문이 디스크에 없어요')
  mkdirSync('e2e-results', { recursive: true })
  await reopened.screenshot({ path: 'e2e-results/memo-desktop.png' })
  console.log('PASS: 실제 Electron IPC·마크다운 파일·종료 직전 저장·재시작 복구')
  console.log(`검증용 데이터: ${root}`)
} finally { await app?.close().catch(() => undefined) }
