import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, safeStorage, screen, shell, session } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { holidaysForYear, parseHolidayIcs, type Holiday } from '../shared/holidays'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { AppState } from './app'
import { requestFlush } from './flush'
import type { CreateNoteInput, NoteKind, Provider, SaveNoteInput, WindowAction } from '../shared/types'
import { ExternalService, type Vault } from './external/service'
import { CloudService } from './external/cloud'
import { createBackup } from './backup/backup'
import { LocalFiles } from './features/localFiles'
import { Projects } from './features/projects'
import { BrowserDesk, openChrome } from './features/browser'
import type { BrowserBounds, FileRef, ProjectBoard } from '../shared/workspaceFeatures'

// 설정 폴더는 %APPDATA%\\Opus. 예전 라임 다이어리를 쓰던 PC면 처음 한 번 설정·연결 키를 복사해 온다.
// (예전 폴더를 그대로 쓰면 라임 다이어리가 켜져 있을 때 Opus가 '이미 실행 중'으로 막힌다)
{
  // 데스크톱 통합 검사는 실제 사용자 설정·기록과 완전히 분리한다.
  const testUserData = !app.isPackaged ? process.env['OPUS_TEST_USER_DATA'] : undefined
  const opusDir = testUserData || join(app.getPath('appData'), 'Opus')
  const oldDir = join(app.getPath('appData'), 'LimeDiary')
  try {
    if (!testUserData && !existsSync(join(opusDir, 'settings.json')) && existsSync(join(oldDir, 'settings.json'))) {
      mkdirSync(opusDir, { recursive: true })
      for (const f of ['settings.json', 'secure.bin']) if (existsSync(join(oldDir, f))) copyFileSync(join(oldDir, f), join(opusDir, f))
    }
  } catch {
    /* 복사 실패는 무시 (새로 시작) */
  }
  app.setPath('userData', opusDir)
}

/** 실행이 안 될 때 원인을 찾기 위한 기록. exe 옆(없으면 임시 폴더)의 LimeDiary-log.txt */
const LOG_FILE = join(process.env['PORTABLE_EXECUTABLE_DIR'] || tmpdir(), 'Opus-log.txt')
function bootLog(msg: string): void {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`)
  } catch {
    /* 기록 실패는 무시 */
  }
}
bootLog(`시작 v${process.versions.electron} ${process.platform} ${process.arch}`)
process.on('uncaughtException', (e) => bootLog(`uncaughtException ${e instanceof Error ? e.stack : String(e)}`))
process.on('unhandledRejection', (e) => bootLog(`unhandledRejection ${e instanceof Error ? e.stack : String(e)}`))
app.on('render-process-gone', (_e, _w, d) => bootLog(`render-process-gone ${d.reason} ${d.exitCode}`))
app.on('child-process-gone', (_e, d) => bootLog(`child-process-gone ${d.type} ${d.reason} ${d.exitCode}`))

let win: BrowserWindow | null = null
let state: AppState
let closing = false
let scratchWin: BrowserWindow | null = null
let ext: ExternalService | null = null
let extDir = ''

/** 키·토큰은 이 PC의 안전 저장소(Windows는 DPAPI)로 암호화한다 */
const vault: Vault = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b)
}

/**
 * 외부 캘린더 서비스. 가져온 일정 임시 파일은 데이터 폴더 밖, 이 PC 안에만 둔다.
 * (회사 일정은 Opus에 보관·백업하지 않고, Google Drive로 동기화되지도 않게 — AGENTS.md 6장)
 */
function external(): ExternalService {
  if (!ext || extDir !== state.dataDir) {
    extDir = state.dataDir
    ext = new ExternalService({
      secureFile: state.workspace.id === 'personal' ? join(app.getPath('userData'), 'secure.bin') : join(app.getPath('userData'), 'workspaces', state.workspace.id, 'secure.bin'),
      cacheFile: join(state.localDir, 'external-cache.json'),
      vault,
      openUrl: (u) => shell.openExternal(u)
    })
  }
  return ext
}
const SCRATCH_KEY = 'CommandOrControl+Shift+Space'
const clouds = new Map<string, CloudService>()
function cloud(): CloudService {
  const key = state.localDir
  let service = clouds.get(key)
  if (!service) {
    const dataDir = state.dataDir
    const backupDir = state.backupDir
    const extService = external()
    service = new CloudService({ localDir: key, dataDir, vault, workspaceId: state.workspace.id,
      token: () => extService.driveToken(), connected: () => extService.hasDriveAccess(),
      configured: () => extService.state().google.configured,
      account: () => extService.state().google.account,
      snapshot: () => createBackup(dataDir, state.settings.get().workspaces?.find(w => w.dataDir === dataDir)?.backupDir ?? backupDir) })
    clouds.set(key, service)
  }
  return service
}
async function flushWindows(): Promise<void> {
  if (win && !win.isDestroyed()) await requestFlush(win, ipcMain)
  if (scratchWin && !scratchWin.isDestroyed()) await requestFlush(scratchWin, ipcMain)
}

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
const fileManagers = new Map<string, LocalFiles>()
const browsers = new Map<string, BrowserDesk>()
function localFiles(): LocalFiles {
  const key = state.localDir
  if (!fileManagers.has(key)) fileManagers.set(key, new LocalFiles(join(key, 'local-folders.json'), path => shell.trashItem(path)))
  return fileManagers.get(key)!
}
function projects(): Projects { return new Projects(state.dataDir) }
function browserDesk(): BrowserDesk {
  if (!win || win.isDestroyed()) throw new Error('Opus 창이 열려 있지 않아요')
  const key = state.localDir
  if (!browsers.has(key)) browsers.set(key, new BrowserDesk(win, key))
  return browsers.get(key)!
}

function notifyInfoChanged(): void {
  win?.webContents.send('app:info-changed')
}

// ---------- 한국 공휴일 (Google 공개 달력, 하루 한 번) ----------
const HOLIDAY_URL =
  'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics'
let holidayCache: Holiday[] | null = null
const holidayFile = (): string => join(app.getPath('userData'), 'holidays-kr.ics')
function holidayUpdated(): string | null {
  try {
    return existsSync(holidayFile()) ? statSync(holidayFile()).mtime.toISOString() : null
  } catch {
    return null
  }
}
function loadHolidays(): void {
  try {
    if (existsSync(holidayFile())) holidayCache = parseHolidayIcs(readFileSync(holidayFile(), 'utf8'))
  } catch {
    holidayCache = null
  }
}
async function refreshHolidays(force: boolean): Promise<{ source: 'google' | 'builtin'; updated: string | null; error?: string }> {
  const last = holidayUpdated()
  if (!force && last && Date.now() - new Date(last).getTime() < 24 * 3600 * 1000) {
    if (!holidayCache) loadHolidays()
  } else {
    try {
      const res = await net.fetch(HOLIDAY_URL)
      const text = res.ok ? await res.text() : ''
      if (!text.includes('BEGIN:VEVENT')) throw new Error(`응답 ${res.status}`)
      writeFileSync(holidayFile(), text, 'utf8')
      holidayCache = parseHolidayIcs(text)
    } catch (e) {
      if (!holidayCache) loadHolidays()
      return { source: holidayCache ? 'google' : 'builtin', updated: holidayUpdated(), error: e instanceof Error ? e.message : String(e) }
    }
  }
  return { source: holidayCache ? 'google' : 'builtin', updated: holidayUpdated() }
}

function registerIpc(): void {
  const h = (name: string, fn: (...args: any[]) => unknown): void => {
    ipcMain.handle(`ld:${name}`, (event, ...args) => {
      if ((event.sender !== win?.webContents && event.sender !== scratchWin?.webContents) || event.senderFrame !== event.sender.mainFrame) throw new Error('Opus 화면에서만 실행할 수 있어요')
      return fn(...args)
    })
  }
  h('localRoots', () => localFiles().roots())
  h('localChooseRoot', async () => {
    const files = localFiles()
    const result = await dialog.showOpenDialog(win!, { title: '자료실에 등록할 PC 폴더', properties: ['openDirectory'] })
    return result.canceled || !result.filePaths[0] ? null : files.register(result.filePaths[0])
  })
  h('localRemoveRoot', (id: string) => localFiles().remove(id))
  h('localRenameRoot', (id: string, name: string) => localFiles().renameRoot(id, name))
  h('localList', (ref: FileRef) => localFiles().list(ref))
  h('localResolveAddress', (address: string) => localFiles().address(address))
  h('localOpen', async (ref: FileRef) => { const error = await shell.openPath(await localFiles().openPath(ref)); if (error) throw new Error(error) })
  h('localReveal', async (ref: FileRef) => shell.showItemInFolder(await localFiles().openPath(ref)))
  h('localCreateFolder', (ref: FileRef, name: string) => localFiles().createFolder(ref, name))
  h('localRename', (ref: FileRef, name: string) => localFiles().rename(ref, name))
  h('localTransfer', (refs: FileRef[], target: FileRef, move: boolean) => localFiles().transfer(refs, target, !!move))
  h('localTrash', (refs: FileRef[]) => localFiles().trash(refs))
  h('projectGet', () => projects().get())
  h('projectSave', (board: ProjectBoard) => projects().save(board))
  h('projectAttach', async () => {
    const store = projects()
    const result = await dialog.showOpenDialog(win!, { title: '프로젝트 카드에 첨부할 파일', properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : store.attach(result.filePaths)
  })
  h('projectOpenAttachment', async (id: string) => { const error = await shell.openPath(projects().attachmentPath(id)); if (error) throw new Error(error) })
  h('browserGet', () => browserDesk().state())
  h('browserNew', (url?: string) => browserDesk().newTab(url))
  h('browserClose', (id: string) => browserDesk().close(id))
  h('browserSelect', (id: string) => browserDesk().select(id))
  h('browserNavigate', (id: string, url: string) => browserDesk().navigate(id, url))
  h('browserCommand', (id: string, command: string) => browserDesk().command(id, command))
  h('browserBounds', (bounds: BrowserBounds | null) => browserDesk().setBounds(bounds))
  h('browserChrome', (url: string) => openChrome(url))
  h('browserBookmark', (url: string, title: string) => browserDesk().bookmark(url, title))
  h('browserRemoveBookmark', (id: string) => browserDesk().removeBookmark(id))
  h('info', () => state.info())
  h('createWorkspace', (name: string) => state.createWorkspace(name))
  h('renameWorkspace', (id: string, name: string) => state.renameWorkspace(id, name))
  h('setWorkspaceEnabled', (id: string, enabled: boolean) => state.setWorkspaceEnabled(id, !!enabled))
  let switching = false
  h('switchWorkspace', async (id: string) => {
    if (switching) throw new Error('워크스페이스를 전환하고 있어요')
    switching = true
    try {
      if (scratchWin && !scratchWin.isDestroyed()) {
        const scratch = scratchWin
        await requestFlush(scratch, ipcMain)
        scratch.destroy()
        scratchWin = null
      }
      for (const browser of browsers.values()) browser.hide()
      const info = state.switchWorkspace(id)
      ext = null
      return info
    } finally { switching = false }
  })
  h('holidays', (year: number) => {
    if (!holidayCache) loadHolidays()
    return holidaysForYear(year, holidayCache)
  })
  h('holidayStatus', () => ({ source: holidayCache ? 'google' : 'builtin', updated: holidayUpdated() }))
  h('refreshHolidays', (force?: boolean) => refreshHolidays(!!force))
  h('useBuiltinHolidays', () => {
    holidayCache = null
    try {
      if (existsSync(holidayFile())) writeFileSync(holidayFile(), '', 'utf8')
    } catch {
      /* 무시 */
    }
    return { source: 'builtin', updated: null }
  })
  h('prefsGet', () => state.settings.get().prefs ?? {})
  h('prefsSet', (patch: Record<string, unknown>) => {
    const next = { ...(state.settings.get().prefs ?? {}), ...(patch ?? {}) }
    state.settings.update({ prefs: next })
    return next
  })
  h('notesByMonth', (m: string) => state.service.byMonth(m))
  h('notesByDate', (d: string) => state.service.byDate(d))
  h('documents', (tag?: string) => state.service.documents(tag))
  h('getNote', (id: string) => state.service.get(id))
  h('createNote', (input: CreateNoteInput) => state.service.create(input))
  h('saveNote', (input: SaveNoteInput) => state.service.save(input))
  h('deleteNote', (id: string) => state.service.remove(id))
  h('discardIfEmpty', (id: string) => state.service.discardIfEmpty(id))
  h('search', (q: string) => state.service.search(q))
  h('tags', () => state.service.tags('document'))
  h('setKind', (id: string, kind: NoteKind) => state.service.setKind(id, kind))
  h('link', (a: string, b: string) => state.service.link(a, b))
  h('unlink', (a: string, b: string) => state.service.unlink(a, b))
  h('linksOf', (id: string) => state.service.linksOf(id))
  h('scratchGet', () => state.service.scratch())
  h('scratchSave', (body: string) => {
    state.service.scratchSave(body)
    notifyInfoChanged()
  })
  h('scratchToDocument', () => {
    const doc = state.service.scratchToDocument()
    notifyInfoChanged()
    return doc
  })
  h('scratchHide', () => scratchWin?.hide())
  h('scratchOpen', () => showScratch())
  h('connections', () => external().state())
  h('cloudState', () => cloud().state())
  h('cloudSaveKeys', (id: string, secret: string) => {
    external().saveKeys('google', id, secret)
    return cloud().state()
  })
  h('driveConnect', async (write?: boolean) => {
    const c = cloud()
    const result = await external().connectGoogle(!!write, true)
    if (result.google.message) throw new Error(result.google.message)
    return c.state()
  })
  h('driveDisconnect', async () => {
    cloud().setAutoBackup(false)
    await external().disconnect('google')
    return cloud().state()
  })
  h('driveFolders', () => cloud().folders())
  h('driveSelectFolder', (id: string) => cloud().selectFolder(id))
  h('driveFiles', () => cloud().files())
  h('driveAutoBackup', (enabled: boolean) => cloud().setAutoBackup(!!enabled))
  h('driveAutoMerge', (enabled: boolean) => cloud().setAutoMerge(!!enabled))
  h('driveMergePreview', async (id: string) => {
    const c = cloud()
    await flushWindows()
    return c.previewMerge(id)
  })
  h('driveMergeApply', async (token: string) => {
    const c = cloud(); const dir = state.dataDir
    await flushWindows()
    const result = c.applyMerge(token)
    if (state.dataDir === dir) { state.service.refreshIndex(); win?.webContents.send('app:files-changed') }
    notifyInfoChanged()
    return result
  })
  h('driveBackup', async () => {
    const c = cloud()
    await flushWindows()
    return c.backup()
  })
  h('driveOpen', async (id: string) => {
    const file = await cloud().file(id)
    await shell.openExternal(`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`)
  })
  h('driveDownload', async (id: string) => {
    const c = cloud()
    const file = await c.file(id)
    const target = await dialog.showSaveDialog(win!, { title: '자료 내려받기', defaultPath: basename(file.name) })
    if (target.canceled || !target.filePath) return false
    const bytes = await c.download(id)
    writeFileSync(`${target.filePath}.tmp`, bytes)
    // 내려받는 도중 실패해도 기존 파일은 보존한다.
    const { renameSync } = await import('node:fs')
    renameSync(`${target.filePath}.tmp`, target.filePath)
    return true
  })
  h('aiConfigure', (key: string, model: string) => cloud().configureAi(key, model))
  h('aiMessages', () => cloud().messages())
  h('aiArchives', () => cloud().archives())
  h('aiSend', (text: string) => cloud().send(text))
  h('externalByMonth', (m: string) => external().externalByMonth(m))
  h('saveKeys', (p: Provider, id: string, secret: string) => external().saveKeys(p, id, secret))
  h('connect', async (p: Provider, write?: boolean) => {
    const r = p === 'google' ? await external().connectGoogle(!!write) : await external().connectNaver()
    notifyInfoChanged()
    return r
  })
  h('disconnect', (p: Provider) => external().disconnect(p))
  h('setCalendars', async (ids: string[]) => {
    const r = await external().setCalendars(ids)
    notifyInfoChanged()
    return r
  })
  h('syncExternal', async () => {
    const r = await external().syncExternal()
    notifyInfoChanged()
    return r
  })
  h('exportEvent', async (id: string, p: Provider) => {
    const note = state.service.get(id)
    if (!note) throw new Error('일정을 찾을 수 없어요')
    return external().exportEvent(note, p)
  })

  h('chooseDataDir', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '메모를 보관할 폴더 선택',
      defaultPath: state.dataDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    state.switchDataDir(r.filePaths[0])
    notifyInfoChanged()
    return state.info()
  })
  h('chooseBackupDir', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: '백업을 저장할 폴더 선택',
      defaultPath: state.backupDir,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return null
    state.setBackupDir(r.filePaths[0])
    return state.info()
  })
  h('runBackup', () => {
    state.backupNow()
    return state.info()
  })
  h('rebuildIndex', () => {
    state.service.rebuildIndex()
    return state.info()
  })
  h('openDataDir', async () => {
    await shell.openPath(state.dataDir)
  })
  h('windowControl', (action: WindowAction) => {
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else win.close()
  })
}

function loadRenderer(w: BrowserWindow, query?: Record<string, string>): void {
  const dev = process.env['ELECTRON_RENDERER_URL']
  if (dev && isDev) {
    const q = query ? `?${new URLSearchParams(query).toString()}` : ''
    void w.loadURL(dev + q)
  } else void w.loadFile(join(__dirname, '../renderer/index.html'), query ? { query } : undefined)
}

/** 글로벌 단축키로 뜨는 작은 빠른 메모 창 */
function showScratch(): void {
  if (scratchWin && !scratchWin.isDestroyed()) {
    scratchWin.show()
    scratchWin.focus()
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  const width = 400
  const height = 320
  scratchWin = new BrowserWindow({
    width,
    height,
    x: area.x + area.width - width - 24,
    y: area.y + area.height - height - 24,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minWidth: 300,
    minHeight: 220,
    backgroundColor: '#F5F4EE',
    show: false,
    title: '빠른 메모',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  scratchWin.once('ready-to-show', () => {
    scratchWin?.show()
    scratchWin?.focus()
  })
  // 닫아도 내용은 이미 저장돼 있으므로 숨기기만 한다 (다시 열면 바로 뜬다)
  scratchWin.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    scratchWin?.hide()
  })
  loadRenderer(scratchWin, { scratch: '1' })
}

function toggleScratch(): void {
  if (scratchWin && !scratchWin.isDestroyed() && scratchWin.isVisible() && scratchWin.isFocused()) {
    scratchWin.webContents.send('app:flush')
    setTimeout(() => scratchWin?.hide(), 120)
  } else showScratch()
}

/** 창을 닫기 전에 화면에서 저장하지 못한 글을 저장하게 한 뒤 닫는다. */
function setupCloseFlush(w: BrowserWindow): void {
  w.on('close', async (e) => {
    if (closing) { e.preventDefault(); return }
    e.preventDefault()
    closing = true
    try {
      const windows = [w, ...(scratchWin && !scratchWin.isDestroyed() ? [scratchWin] : [])]
      await Promise.all(windows.map(target => requestFlush(target, ipcMain)))
      w.destroy()
      scratchWin?.destroy()
      app.quit()
    } catch (error) {
      closing = false
      w.show()
      dialog.showErrorBox('저장을 마치지 못했어요', (error instanceof Error ? error.message : String(error)) + '\n창을 닫지 않았어요. 내용을 확인하고 다시 저장해 주세요.')
    }
  })
}

/** 다른 PC(동기화 폴더)에서 메모 파일이 바뀌었는지 보고, 바뀌었으면 화면에 알린다 */
function checkFilesChanged(): void {
  if (!state || !win || win.isDestroyed()) return
  try {
    const r = state.service.refreshIndex()
    if (r.added || r.updated || r.removed) win.webContents.send('app:files-changed')
  } catch (err) {
    bootLog(`파일 다시 읽기 실패: ${String(err)}`)
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    frame: false,
    backgroundColor: '#F5F4EE',
    title: 'Opus',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  // 혹시 ready-to-show가 오지 않아도 창이 보이게 한다
  setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      bootLog('ready-to-show가 오지 않아 창을 강제로 표시')
      win.show()
    }
  }, 4000)
  win.webContents.on('did-fail-load', (_e, code, desc) => bootLog(`did-fail-load ${code} ${desc}`))
  bootLog('창 생성')
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:/i.test(url)) void shell.openExternal(url)
    }
  })
  setupCloseFlush(win)
  // 집·회사 PC가 Google Drive 폴더를 같이 쓰면, 창으로 돌아올 때(그리고 1분마다) 바뀐 메모 파일을 다시 읽는다
  win.on('focus', checkFilesChanged)
  const syncTimer = setInterval(() => {
    if (win?.isFocused()) checkFilesChanged()
  }, 60_000)
  win.on('closed', () => clearInterval(syncTimer))

  loadRenderer(win)

  if (process.env['LD_SHOT_DIR']) win.webContents.once('did-finish-load', () => void runShots(win!))
}

/** 화면 확인용: 지정한 동작을 차례로 실행하며 스크린샷을 저장한다. (개발 전용) */
async function runShots(w: BrowserWindow): Promise<void> {
  const dir = process.env['LD_SHOT_DIR']!
  mkdirSync(dir, { recursive: true })
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
  type Step = { name?: string; js?: string; wait?: number; target?: 'main' | 'scratch' }
  const stepsFile = process.env['LD_SHOT_STEPS']
  const steps: Step[] =
    stepsFile && existsSync(stepsFile) ? JSON.parse(readFileSync(stepsFile, 'utf8')) : [{ name: 'main', wait: 1200 }]
  w.show()
  const log: string[] = []
  for (const s of steps) {
    try {
      const t = s.target === 'scratch' && scratchWin && !scratchWin.isDestroyed() ? scratchWin : w
      if (s.js) {
        const out = await t.webContents.executeJavaScript(s.js)
        if (out !== undefined) log.push(`${s.name ?? 'js'}: ${JSON.stringify(out)}`)
      }
      await sleep(s.wait ?? 400)
      if (s.name) {
        const img = await t.webContents.capturePage()
        writeFileSync(join(dir, `${s.name}.png`), img.toPNG())
      }
    } catch (err) {
      log.push(`오류 ${s.name ?? ''}: ${String(err)}`)
    }
  }
  writeFileSync(join(dir, 'log.txt'), log.join('\n'))
  closing = true
  app.quit()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !process.env['LD_DATA_DIR']) {
  // 이미 켜진 Opus가 있다. 조용히 꺼지면 "실행이 안 된다"로 보이므로 알려 준다.
  void app.whenReady().then(() => {
    dialog.showErrorBox(
      'Opus가 이미 실행 중이에요',
      '이미 켜져 있는 Opus가 있어요. 화면에 안 보이면 작업 관리자(Ctrl+Shift+Esc)에서 Opus를 종료한 뒤 다시 실행해 주세요.'
    )
    app.quit()
  })
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  const reportStartupError = (err: unknown): void => {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
    bootLog(`시작 오류 ${msg}`)
    try {
      writeFileSync(join(app.getPath('userData'), 'startup-error.log'), `${new Date().toISOString()}\n${msg}\n`)
    } catch {
      /* 로그를 못 써도 계속 */
    }
    dialog.showErrorBox('Opus를 시작하지 못했어요', `${msg.slice(0, 600)}\n\n(자세한 내용: ${join(app.getPath('userData'), 'startup-error.log')})`)
    app.quit()
  }

  app.whenReady().then(() => {
   bootLog('ready')
   try {
    state = new AppState({
      settingsFile: join(app.getPath('userData'), 'settings.json'),
      documents: app.getPath('documents'),
      portableDir: process.env['PORTABLE_EXECUTABLE_DIR'],
      envDataDir: process.env['LD_DATA_DIR'],
      version: app.getVersion()
    })
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'"
            ]
          }
        })
      })
    }
    registerIpc()
    state.scratchShortcut = globalShortcut.register(SCRATCH_KEY, toggleScratch) ? SCRATCH_KEY : null
    try {
      state.autoBackup()
    } catch {
      /* 백업 실패가 앱 실행을 막으면 안 된다 */
    }
    createWindow()
    // Drive 자동 백업은 사용자가 켠 공간만, 로컬 저장을 마친 뒤 시도한다.
    const cloudTick = async (): Promise<void> => {
      try {
        const c = cloud()
        const dir = state.dataDir
        if (!c.state().autoBackup) return
        await flushWindows()
        try { await c.mergeAutomatic() } catch { /* 원격 병합 실패여도 내 기록의 백업은 계속한다. */ }
        if (state.dataDir === dir) checkFilesChanged()
        await c.backup(true)
      } catch { /* 네트워크·저장 오류가 앱 실행을 막지 않는다. 설정에서 상태를 확인한다. */ }
    }
    setTimeout(() => void cloudTick(), 10_000)
    setInterval(() => void cloudTick(), 5 * 60_000)
    // Google에 연결돼 있을 때만, 마지막 동기화가 1시간 넘었으면 조용히 갱신한다 (연결 안 했으면 아무 통신도 없다)
    {
      const g = external().state().google
      if (g.connected && (!g.lastSync || Date.now() - new Date(g.lastSync).getTime() > 3600_000)) {
        void external()
          .syncExternal()
          .then(() => notifyInfoChanged())
      }
    }
    // 켜 둔 채로 하루가 지나도 백업되도록 1시간마다 확인
    setInterval(() => {
      try {
        if (state.autoBackup()) notifyInfoChanged()
      } catch {
        /* 무시 */
      }
    }, 60 * 60 * 1000)
   } catch (err) {
    reportStartupError(err)
   }
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.on('window-all-closed', () => {
    state?.close()
    app.quit()
  })
}
