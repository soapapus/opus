import { app, BrowserWindow, dialog, globalShortcut, ipcMain, net, safeStorage, screen, shell, session } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { holidaysForYear, parseHolidayIcs, type Holiday } from '../shared/holidays'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppState } from './app'
import type { CreateNoteInput, NoteKind, Provider, SaveNoteInput, WindowAction } from '../shared/types'
import { ExternalService, type Vault } from './external/service'

// 설정 폴더는 %APPDATA%\\Opus. 예전 라임 다이어리를 쓰던 PC면 처음 한 번 설정·연결 키를 복사해 온다.
// (예전 폴더를 그대로 쓰면 라임 다이어리가 켜져 있을 때 Opus가 '이미 실행 중'으로 막힌다)
{
  const opusDir = join(app.getPath('appData'), 'Opus')
  const oldDir = join(app.getPath('appData'), 'LimeDiary')
  try {
    if (!existsSync(join(opusDir, 'settings.json')) && existsSync(join(oldDir, 'settings.json'))) {
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

/** 외부 캘린더 서비스. 가져온 일정 캐시는 데이터 폴더 안에 두어 함께 옮겨지고 백업된다. */
function external(): ExternalService {
  if (!ext || extDir !== state.dataDir) {
    extDir = state.dataDir
    ext = new ExternalService({
      secureFile: join(app.getPath('userData'), 'secure.bin'),
      cacheFile: join(state.dataDir, 'personal', 'external', 'cache.json'),
      vault,
      openUrl: (u) => shell.openExternal(u)
    })
  }
  return ext
}
const SCRATCH_KEY = 'CommandOrControl+Shift+Space'

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']

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
    ipcMain.handle(`ld:${name}`, (_e, ...args) => fn(...args))
  }
  h('info', () => state.info())
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
  w.on('close', (e) => {
    if (closing) return
    e.preventDefault()
    closing = true
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      w.destroy()
      scratchWin?.destroy()
      app.quit()
    }
    ipcMain.once('app:flushed', finish)
    setTimeout(finish, 2500)
    try {
      w.webContents.send('app:flush')
    } catch {
      finish()
    }
  })
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
