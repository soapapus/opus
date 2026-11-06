// 실제 Electron IPC, PC 파일, 보드 복구, 외부 웹 콘텐츠 격리 검사. 사용자 데이터와 분리한다.
import { _electron as electron, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'opus-workspace-desktop-'))
const userData = join(root, 'settings'), data = join(root, 'data'), left = join(root, 'left'), right = join(root, 'right')
for (const p of [userData, data, left, right]) mkdirSync(p)
writeFileSync(join(userData, 'settings.json'), JSON.stringify({ prefs: { holidayOnline: false } }))
writeFileSync(join(left, '기록.txt'), '실제 파일 원문')
const key = createHash('sha1').update(resolve(data).toLowerCase()).digest('hex').slice(0, 12)
const local = join(userData, 'local', key); mkdirSync(local, { recursive: true })
writeFileSync(join(local, 'local-folders.json'), JSON.stringify([{ id: 'left', name: '원본', path: await realpath(left) }, { id: 'right', name: '대상', path: await realpath(right) }]))
const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<html><head><title>격리 검사 ${req.url}</title></head><body><h1>외부 웹페이지 검사</h1><a href="/second">다음 페이지</a></body></html>`) })
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const url = `http://127.0.0.1:${server.address().port}/first`
const env = { ...process.env, OPUS_TEST_USER_DATA: userData, LD_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE
let instance
const launch = async () => { instance = await electron.launch({ args: [resolve('out/main/index.js')], env }); const page = await instance.firstWindow(); await expect(page.locator('.app2')).toBeVisible(); return page }
try {
  let page = await launch()
  const copied = await page.evaluate(async () => {
    const roots = await window.api.localRoots(); if (roots.length !== 2) throw new Error('폴더 등록 복구 실패')
    await window.api.localCreateFolder({ rootId: 'right', relativePath: '' }, '새 폴더')
    const result = await window.api.localTransfer([{ rootId: 'left', relativePath: '기록.txt' }], { rootId: 'right', relativePath: '' }, false)
    await window.api.localRename({ rootId: 'right', relativePath: '기록.txt' }, '이름 변경.txt')
    return result
  })
  expect(copied[0].ok).toBe(true)
  expect(readFileSync(join(left, '기록.txt'), 'utf8')).toBe('실제 파일 원문')
  expect(readFileSync(join(right, '이름 변경.txt'), 'utf8')).toBe('실제 파일 원문')
  expect(existsSync(join(right, '새 폴더'))).toBe(true)
  await page.evaluate(async () => {
    const b = await window.api.projectGet(); const now = new Date().toISOString()
    b.columns.push({ id: 'custom', name: '내 컬럼', statusId: b.statuses[0].id, archived: false })
    b.cards.push({ id: 'native-card', number: 0, title: '실제 IPC 카드', body: '재시작 후에도 남을 본문', columnId: 'custom', priority: 'normal', due: '', tags: [], created: now, updated: now, archived: false, comments: [], attachments: [] })
    await window.api.projectSave(b)
  })
  await page.locator('.rail-btn[aria-label="브라우저"]').click()
  const browser = await page.evaluate(() => window.api.browserGet())
  await page.evaluate(({ id, url }) => window.api.browserNavigate(id, url), { id: browser.activeId, url })
  await expect.poll(async () => (await page.evaluate(() => window.api.browserGet())).tabs.find(t => t.id === browser.activeId)?.title).toBe('격리 검사 /first')
  const isolation = await instance.evaluate(async ({ webContents }, prefix) => {
    const guest = webContents.getAllWebContents().find(w => w.getURL().startsWith(prefix))
    if (!guest) throw new Error('격리된 웹 탭이 없음')
    const prefs = guest.getLastWebPreferences()
    const values = await guest.executeJavaScript('({api:typeof window.api,node:typeof require,process:typeof process})')
    return { ...values, nodeIntegration: prefs.nodeIntegration, contextIsolation: prefs.contextIsolation, sandbox: prefs.sandbox, webSecurity: prefs.webSecurity }
  }, url)
  expect(isolation).toEqual({ api: 'undefined', node: 'undefined', process: 'undefined', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true })
  const invalid = await page.evaluate(async id => { try { await window.api.browserNavigate(id, 'file:///private.txt'); return '' } catch (e) { return String(e) } }, browser.activeId)
  expect(invalid).toContain('http')
  await page.getByRole('button', { name: '프로필 편집', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '프로필', exact: true })).toBeVisible()
  await expect.poll(() => instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap(w => w.contentView.children).filter(v => 'webContents' in v && v.webContents.getURL().startsWith('http://127.0.0.1:')).some(v => v.getVisible()))).toBe(false)
  await page.getByRole('button', { name: '취소', exact: true }).click()
  await page.evaluate(async id => { await window.api.browserBookmark((await window.api.browserGet()).tabs.find(t => t.id === id).url, '검사 페이지') }, browser.activeId)
  await instance.close(); instance = undefined
  page = await launch()
  const restored = await page.evaluate(async () => ({ roots: await window.api.localRoots(), board: await window.api.projectGet(), browser: await window.api.browserGet() }))
  expect(restored.roots).toHaveLength(2)
  expect(restored.board.cards[0].body).toBe('재시작 후에도 남을 본문')
  expect(restored.browser.bookmarks[0].title).toBe('검사 페이지')
  expect(restored.browser.tabs.some(t => t.url === url)).toBe(true)
  console.log('PASS: PC 파일 IPC·프로젝트 저장/복구·외부 페이지 Node/IPC 격리·모달 중 웹 탭 숨김·탭/즐겨찾기 복구')
  console.log(`검증 데이터: ${root}`)
} finally {
  await instance?.close().catch(() => undefined)
  await new Promise(ok => server.close(ok))
}
