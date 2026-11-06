import { BrowserWindow, WebContentsView, session } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { browserAddress, isWebAddress } from '../../shared/browser'
import type { BrowserBookmark, BrowserBounds, BrowserDeskState, BrowserTabState } from '../../shared/workspaceFeatures'
import { readJson, writeJson } from './jsonFile'

export async function openChrome(address: string): Promise<void> {
  const url = browserAddress(address)
  if (!isWebAddress(url)) throw new Error('Chrome에서 열 웹 주소를 입력해 주세요')
  const candidates = process.platform === 'win32' ? [
    join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['LOCALAPPDATA'] ?? '', 'Google/Chrome/Application/chrome.exe')
  ] : process.platform === 'darwin' ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'] : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  const executable = candidates.find(path => existsSync(path))
  if (!executable) throw new Error('이 PC에서 Chrome을 찾지 못했어요. Chrome을 설치한 뒤 다시 시도해 주세요')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['--new-tab', url], { shell: false, detached: true, stdio: 'ignore' })
    child.once('error', () => reject(new Error('Chrome을 열지 못했어요')))
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export class BrowserDesk {
  private tabs = new Map<string, { view: WebContentsView; state: BrowserTabState }>()
  private activeId = ''
  private bounds: BrowserBounds | null = null
  private bookmarks: BrowserBookmark[]
  private restoring = true
  private saveTimer?: ReturnType<typeof setTimeout>
  private disposed = false
  constructor(private win: BrowserWindow, private localDir: string) {
    this.bookmarks = readJson<BrowserBookmark[]>(join(localDir, 'browser-bookmarks.json'), () => [])
    if (!Array.isArray(this.bookmarks) || this.bookmarks.some(b => !b || !isWebAddress(b.url) || typeof b.title !== 'string' || typeof b.id !== 'string')) throw new Error('즐겨찾기 파일을 확인해 주세요. 원본은 유지했어요')
    const saved = readJson<{ urls: string[]; active: number }>(join(localDir, 'browser-tabs.json'), () => ({ urls: [], active: 0 }))
    if (!Array.isArray(saved.urls) || saved.urls.length > 20 || saved.urls.some(url => url !== 'about:blank' && !isWebAddress(url))) throw new Error('브라우저 탭 저장 파일을 확인해 주세요')
    for (const url of saved.urls) this.newTab(url)
    if (saved.urls.length) this.activeId = [...this.tabs.keys()][Math.max(0, Math.min(saved.urls.length - 1, saved.active || 0))]
    this.restoring = false; this.layout()
    win.once('closed', () => this.dispose())
  }
  private persist(): void {
    if (!this.restoring) writeJson(join(this.localDir, 'browser-tabs.json'), { urls: [...this.tabs.values()].map(t => t.state.url), active: [...this.tabs.keys()].indexOf(this.activeId) })
  }
  private notify(): void {
    if (this.disposed) return
    if (!this.win.isDestroyed()) this.win.webContents.send('app:browser-changed')
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => { try { this.persist() } catch { /* 다음 탭 작업 때 다시 저장 */ } }, 150)
  }
  state(): BrowserDeskState {
    if (!this.tabs.size) this.newTab()
    return { tabs: [...this.tabs.values()].map(t => ({ ...t.state })), activeId: this.activeId, bookmarks: [...this.bookmarks], embedded: true }
  }
  private tab(id: string) { const tab = this.tabs.get(id); if (!tab) throw new Error('브라우저 탭을 찾을 수 없어요'); return tab }
  newTab(address = ''): BrowserDeskState {
    if (this.tabs.size >= 20) throw new Error('탭은 20개까지 열 수 있어요')
    const url = browserAddress(address); const id = randomUUID()
    const partition = `persist:opus-browser-${createHash('sha256').update(this.localDir).digest('hex').slice(0, 16)}`
    const isolated = session.fromPartition(partition)
    isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    isolated.setPermissionCheckHandler(() => false)
    const view = new WebContentsView({ webPreferences: { partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false } })
    const state: BrowserTabState = { id, title: '새 탭', url, loading: false, back: false, forward: false }
    this.tabs.set(id, { view, state }); this.win.contentView.addChildView(view)
    const wc = view.webContents
    const update = () => {
      if (wc.isDestroyed()) return
      state.title = wc.getTitle() || '새 탭'; state.url = wc.getURL() || url
      state.loading = wc.isLoading(); state.back = wc.navigationHistory.canGoBack(); state.forward = wc.navigationHistory.canGoForward()
      this.notify()
    }
    wc.on('did-start-loading', update); wc.on('did-stop-loading', update); wc.on('did-navigate', update); wc.on('did-navigate-in-page', update); wc.on('page-title-updated', update)
    wc.on('did-fail-load', (_e, code, _description, _url, main) => { if (main && code !== -3) { state.error = '페이지를 열지 못했어요. 주소와 네트워크를 확인하거나 Chrome에서 열어 주세요'; update() } })
    const navigation = (event: Electron.Event, next: string) => { if (!isWebAddress(next) && next !== 'about:blank') { event.preventDefault(); state.error = '이 주소는 Chrome에서 직접 열어 주세요'; this.notify() } }
    wc.on('will-navigate', navigation); wc.on('will-redirect', navigation)
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebAddress(url)) { try { this.newTab(url) } catch (e) { state.error = (e as Error).message; this.notify() } }
      return { action: 'deny' }
    })
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta)) return
      const key = input.key.toLowerCase()
      if (key === 'l') { event.preventDefault(); this.win.webContents.focus(); this.win.webContents.send('app:browser-address') }
      if (key === 't') { event.preventDefault(); try { this.newTab() } catch { /* 탭 한도는 현재 화면 유지 */ } }
      if (key === 'w') { event.preventDefault(); this.close(id) }
    })
    wc.on('will-prevent-unload', event => event.preventDefault())
    wc.on('render-process-gone', () => { state.error = '페이지가 종료됐어요. 새로고침해 주세요'; state.loading = false; this.notify() })
    this.activeId = id; this.layout()
    if (url !== 'about:blank') void this.navigate(id, url)
    this.notify(); return { tabs: [...this.tabs.values()].map(t => ({ ...t.state })), activeId: id, bookmarks: [...this.bookmarks], embedded: true }
  }
  async navigate(id: string, address: string): Promise<BrowserDeskState> {
    const tab = this.tab(id); const url = browserAddress(address)
    tab.state.error = undefined; tab.state.url = url
    void tab.view.webContents.loadURL(url).catch(() => { if (this.tabs.has(id)) { tab.state.error = '페이지를 열지 못했어요. Chrome에서 열기로 다시 시도할 수 있어요'; this.layout(); this.notify() } })
    this.persist(); this.layout(); this.notify(); return this.state()
  }
  select(id: string): BrowserDeskState { this.tab(id); this.activeId = id; this.layout(); this.notify(); return this.state() }
  close(id: string): BrowserDeskState {
    const tab = this.tab(id); this.win.contentView.removeChildView(tab.view); tab.view.webContents.close({ waitForBeforeUnload: false }); this.tabs.delete(id)
    if (this.activeId === id) this.activeId = [...this.tabs.keys()].at(-1) ?? ''
    if (!this.tabs.size) return this.newTab()
    this.layout(); this.notify(); return this.state()
  }
  command(id: string, command: string): BrowserDeskState {
    const wc = this.tab(id).view.webContents
    if (command === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (command === 'reload') { this.tab(id).state.error = undefined; wc.reload() }
    else if (command === 'stop') wc.stop()
    else if (!['back', 'forward'].includes(command)) throw new Error('지원하지 않는 브라우저 동작이에요')
    return this.state()
  }
  setBounds(bounds: BrowserBounds | null): void {
    if (bounds && Object.values(bounds).some(v => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('브라우저 표시 영역이 올바르지 않아요')
    this.bounds = bounds; this.layout()
  }
  private layout(): void {
    if (this.win.isDestroyed()) return
    const [width, height] = this.win.getContentSize()
    for (const [id, tab] of this.tabs) {
      const visible = !!this.bounds && id === this.activeId && tab.state.url !== 'about:blank' && !tab.state.error
      tab.view.setVisible(visible)
      if (visible && this.bounds) {
        const x = Math.max(0, Math.min(width, Math.round(this.bounds.x))); const y = Math.max(0, Math.min(height, Math.round(this.bounds.y)))
        tab.view.setBounds({ x, y, width: Math.max(0, Math.min(width - x, Math.round(this.bounds.width))), height: Math.max(0, Math.min(height - y, Math.round(this.bounds.height))) })
      }
    }
  }
  bookmark(url: string, title: string): BrowserDeskState {
    const address = browserAddress(url)
    if (!isWebAddress(address)) throw new Error('즐겨찾기에 저장할 웹 주소를 입력해 주세요')
    if (this.bookmarks.length >= 500) throw new Error('즐겨찾기는 500개까지 등록할 수 있어요')
    if (!this.bookmarks.some(b => b.url === address)) this.bookmarks.push({ id: randomUUID(), url: address, title: title.trim().slice(0, 120) || address })
    writeJson(join(this.localDir, 'browser-bookmarks.json'), this.bookmarks); this.notify(); return this.state()
  }
  removeBookmark(id: string): BrowserDeskState { this.bookmarks = this.bookmarks.filter(b => b.id !== id); writeJson(join(this.localDir, 'browser-bookmarks.json'), this.bookmarks); this.notify(); return this.state() }
  hide(): void { this.bounds = null; this.layout() }
  dispose(): void { if (this.disposed) return; clearTimeout(this.saveTimer); this.persist(); this.disposed = true; for (const tab of this.tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close({ waitForBeforeUnload: false }); this.tabs.clear() }
}
