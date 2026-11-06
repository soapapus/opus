// 외부 캘린더 연결을 한곳에서 관리한다.
// 원칙: 연결하지 않았으면 어떤 네트워크 호출도 하지 않는다. 연결을 해제해도 가져온 일정과 내 기록은 지우지 않는다.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ConnectionsState, ExternalCalendar, ExternalEvent, Note, Provider, ProviderState } from '../../shared/types'
import { GOOGLE_ENDPOINTS, GoogleClient, SCOPE_WRITE, SCOPE_DRIVE, type GoogleEndpoints, type Tokens } from './google'
import { NAVER_CALLBACK_PATH, NAVER_CALLBACK_PORT, NAVER_ENDPOINTS, NaverClient, type NaverEndpoints } from './naver'
import { makePkce, randomString, startLoopback, type FetchFn } from './oauth'

/** 키·토큰을 PC의 안전 저장소로 암호화하는 도구 (Electron의 safeStorage를 끼워 넣는다) */
export interface Vault {
  available(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

interface Secure {
  google?: { clientId?: string; clientSecret?: string; tokens?: Tokens }
  naver?: { clientId?: string; clientSecret?: string; accessToken?: string; refreshToken?: string }
}

interface Cache {
  google: {
    account?: string
    calendars: ExternalCalendar[]
    events: ExternalEvent[]
    syncedAt?: string
    writeEnabled?: boolean
    exported: Record<string, string>
  }
  naver: { exported: Record<string, string> }
}

const emptyCache = (): Cache => ({ google: { calendars: [], events: [], exported: {} }, naver: { exported: {} } })

/** 가져올 기간: 지난 30일 ~ 앞으로 180일. 이 밖의 옛 일정은 캐시에 그대로 쌓아 둔다. */
const PAST_DAYS = 30
const FUTURE_DAYS = 180

export interface ExternalDeps {
  /** 암호화된 키·토큰 파일 (PC 설정 폴더, 이동식 데이터 폴더 밖) */
  secureFile: string
  /** 가져온 일정 캐시 (데이터 폴더 안: 함께 옮겨 다니고 백업된다) */
  cacheFile: string
  vault: Vault
  openUrl: (url: string) => void | Promise<void>
  fetch?: FetchFn
  googleEndpoints?: GoogleEndpoints
  naverEndpoints?: NaverEndpoints
  naverPort?: number
  now?: () => number
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export class ExternalService {
  private messages: Partial<Record<Provider, string>> = {}
  private busy = new Set<Provider>()
  /** 네트워크 호출 횟수 (연결 전에는 0이어야 한다. 테스트용) */
  networkCalls = 0

  constructor(private d: ExternalDeps) {}

  private get now(): number {
    return (this.d.now ?? Date.now)()
  }

  private get fetchFn(): FetchFn {
    const base = this.d.fetch ?? fetch
    return ((...args: Parameters<FetchFn>) => {
      this.networkCalls++
      return base(...args)
    }) as FetchFn
  }

  // ---------- 저장소 ----------
  private readSecure(): Secure {
    try {
      if (!existsSync(this.d.secureFile)) return {}
      return JSON.parse(this.d.vault.decrypt(readFileSync(this.d.secureFile))) as Secure
    } catch {
      return {}
    }
  }

  private writeSecure(s: Secure): void {
    if (!this.d.vault.available()) throw new Error('이 PC에서는 키를 안전하게 저장할 수 없어서 연결할 수 없어요')
    mkdirSync(dirname(this.d.secureFile), { recursive: true })
    writeFileSync(this.d.secureFile, this.d.vault.encrypt(JSON.stringify(s)))
  }

  private readCache(): Cache {
    try {
      if (!existsSync(this.d.cacheFile)) return emptyCache()
      const c = JSON.parse(readFileSync(this.d.cacheFile, 'utf8')) as Partial<Cache>
      const e = emptyCache()
      return { google: { ...e.google, ...c.google }, naver: { ...e.naver, ...c.naver } }
    } catch {
      return emptyCache()
    }
  }

  private writeCache(c: Cache): void {
    mkdirSync(dirname(this.d.cacheFile), { recursive: true })
    const tmp = `${this.d.cacheFile}.tmp`
    writeFileSync(tmp, JSON.stringify(c, null, 1), 'utf8')
    renameSync(tmp, this.d.cacheFile)
  }

  // ---------- 상태 ----------
  state(): ConnectionsState {
    const sec = this.readSecure()
    const cache = this.readCache()
    const google: ProviderState = {
      provider: 'google',
      configured: !!sec.google?.clientId,
      connected: !!sec.google?.tokens,
      account: cache.google.account,
      writeEnabled: !!sec.google?.tokens && !!cache.google.writeEnabled,
      lastSync: cache.google.syncedAt,
      calendars: cache.google.calendars,
      cachedEvents: cache.google.events.length,
      message: this.messages.google,
      capabilities: ['일정 읽어오기 (읽기 권한)', '내 일정 내보내기 (쓰기 권한을 따로 허용했을 때만)']
    }
    const naver: ProviderState = {
      provider: 'naver',
      configured: !!sec.naver?.clientId,
      connected: !!sec.naver?.refreshToken || !!sec.naver?.accessToken,
      message: this.messages.naver,
      capabilities: ['내 일정 내보내기(추가)만 공식 지원', '읽어오기·수정·삭제·양방향 동기화는 네이버가 제공하지 않아요']
    }
    return { google, naver }
  }

  saveKeys(provider: Provider, clientId: string, clientSecret: string): ConnectionsState {
    const sec = this.readSecure()
    const prev = sec[provider] ?? {}
    const keep = prev.clientId === clientId.trim() ? prev : {}
    sec[provider] = { ...keep, clientId: clientId.trim(), clientSecret: clientSecret.trim() } as never
    this.writeSecure(sec)
    delete this.messages[provider]
    return this.state()
  }

  private async guard(provider: Provider, work: () => Promise<void>): Promise<ConnectionsState> {
    if (this.busy.has(provider)) {
      this.messages[provider] = '이미 진행 중이에요'
      return this.state()
    }
    this.busy.add(provider)
    delete this.messages[provider]
    try {
      await work()
    } catch (e) {
      this.messages[provider] = e instanceof Error ? e.message : String(e)
    } finally {
      this.busy.delete(provider)
    }
    return this.state()
  }

  // ---------- Google ----------
  private googleClient(): GoogleClient {
    const k = this.readSecure().google
    if (!k?.clientId) throw new Error('먼저 Google 클라이언트 ID를 입력해 주세요')
    return new GoogleClient({ clientId: k.clientId, clientSecret: k.clientSecret }, this.fetchFn, this.d.googleEndpoints ?? GOOGLE_ENDPOINTS, () => this.now)
  }

  private async googleToken(): Promise<string> {
    const sec = this.readSecure()
    const t = sec.google?.tokens
    if (!t) throw new Error('Google에 연결되어 있지 않아요')
    if (t.expiresAt > this.now) return t.accessToken
    const next = await this.googleClient().refresh(t)
    sec.google = { ...sec.google, tokens: next }
    this.writeSecure(sec)
    return next.accessToken
  }

  hasDriveAccess(): boolean {
    return !!this.readSecure().google?.tokens?.scope.split(' ').includes(SCOPE_DRIVE)
  }

  async driveToken(): Promise<string> {
    if (!this.hasDriveAccess()) throw new Error('설정에서 Google Drive 권한을 선택하고 다시 연결해 주세요')
    return this.googleToken()
  }

  connectGoogle(write = false, drive = false): Promise<ConnectionsState> {
    return this.guard('google', async () => {
      const client = this.googleClient()
      const { verifier, challenge } = makePkce()
      const state = randomString(24)
      const lb = await startLoopback({ path: '/oauth/google', state })
      try {
        await this.d.openUrl(client.buildAuthUrl({ redirectUri: lb.redirectUri, challenge, state, write, drive }))
        const code = await lb.code
        const tokens = await client.exchangeCode(code, verifier, lb.redirectUri)
        const sec = this.readSecure()
        sec.google = { ...sec.google, tokens }
        const cache = this.readCache()
        const list = await client.listCalendars(tokens.accessToken)
        const primary = list.find((c) => c.primary)
        if (!primary?.id) throw new Error('연결 계정을 확인하지 못했어요. 기본 캘린더 권한을 확인해 주세요')
        const keep = new Map(cache.google.calendars.map((c) => [c.id, c.selected]))
        cache.google.calendars = list.map((c) => ({ ...c, selected: keep.get(c.id) ?? c.primary }))
        cache.google.account = primary?.id ?? cache.google.account
        cache.google.writeEnabled = tokens.scope.split(' ').includes(SCOPE_WRITE)
        this.writeCache(cache)
        this.writeSecure(sec)
      } finally {
        lb.close()
      }
      await this.syncGoogle()
    })
  }

  private async syncGoogle(): Promise<void> {
    const cache = this.readCache()
    const token = await this.googleToken()
    const client = this.googleClient()
    const winStart = new Date(this.now - PAST_DAYS * 86400000)
    const winEnd = new Date(this.now + FUTURE_DAYS * 86400000)
    const [from, to] = [ymd(winStart), ymd(winEnd)]
    for (const cal of cache.google.calendars.filter((c) => c.selected)) {
      const fresh = await client.listEvents(token, cal, winStart.toISOString(), winEnd.toISOString())
      // 가져온 기간 안의 같은 캘린더 일정은 새 결과로 바꾸고, 그보다 옛 일정은 그대로 쌓아 둔다
      cache.google.events = cache.google.events.filter((e) => e.calendarId !== cal.id || e.date < from || e.date > to).concat(fresh)
    }
    cache.google.syncedAt = new Date(this.now).toISOString()
    this.writeCache(cache)
  }

  syncExternal(): Promise<ConnectionsState> {
    return this.guard('google', async () => {
      if (!this.readSecure().google?.tokens) throw new Error('Google에 연결되어 있지 않아요')
      await this.syncGoogle()
    })
  }

  setCalendars(ids: string[]): Promise<ConnectionsState> {
    return this.guard('google', async () => {
      const cache = this.readCache()
      cache.google.calendars = cache.google.calendars.map((c) => ({ ...c, selected: ids.includes(c.id) }))
      this.writeCache(cache)
      if (this.readSecure().google?.tokens) await this.syncGoogle()
    })
  }

  // ---------- 네이버 (내보내기 전용) ----------
  private naverClient(): NaverClient {
    const k = this.readSecure().naver
    if (!k?.clientId || !k.clientSecret) throw new Error('먼저 네이버 Client ID와 Secret을 입력해 주세요')
    return new NaverClient({ clientId: k.clientId, clientSecret: k.clientSecret }, this.fetchFn, this.d.naverEndpoints ?? NAVER_ENDPOINTS)
  }

  connectNaver(): Promise<ConnectionsState> {
    return this.guard('naver', async () => {
      const client = this.naverClient()
      const state = randomString(24)
      const lb = await startLoopback({ path: NAVER_CALLBACK_PATH, state, port: this.d.naverPort ?? NAVER_CALLBACK_PORT })
      try {
        await this.d.openUrl(client.buildAuthUrl({ redirectUri: lb.redirectUri, state }))
        const code = await lb.code
        const t = await client.exchangeCode(code, state)
        const sec = this.readSecure()
        sec.naver = { ...sec.naver, accessToken: t.accessToken, refreshToken: t.refreshToken }
        this.writeSecure(sec)
      } finally {
        lb.close()
      }
    })
  }

  // ---------- 연결 해제 (로컬 데이터는 그대로) ----------
  async disconnect(provider: Provider): Promise<ConnectionsState> {
    const sec = this.readSecure()
    if (provider === 'google' && sec.google) {
      delete sec.google.tokens
      const cache = this.readCache()
      cache.google.writeEnabled = false
      this.writeCache(cache) // 가져온 일정 캐시는 남긴다
    }
    if (provider === 'naver' && sec.naver) {
      delete sec.naver.accessToken
      delete sec.naver.refreshToken
    }
    this.writeSecure(sec)
    delete this.messages[provider]
    return this.state()
  }

  // ---------- 달력에 보여 줄 외부 일정 (캐시만 읽는다. 네트워크 없음) ----------
  externalByMonth(month: string): ExternalEvent[] {
    if (!/^\d{4}-\d{2}$/.test(month)) return []
    const cache = this.readCache()
    const selected = new Set(cache.google.calendars.filter((c) => c.selected).map((c) => c.id))
    const first = `${month}-01`
    const last = `${month}-31`
    const out: ExternalEvent[] = []
    for (const e of cache.google.events) {
      if (!selected.has(e.calendarId) || e.endDate < first || e.date > last) continue
      const cur = new Date(`${e.date < first ? first : e.date}T00:00:00`)
      const end = new Date(`${e.endDate}T00:00:00`)
      for (let guard = 0; cur <= end && guard < 62; guard++, cur.setDate(cur.getDate() + 1)) {
        const day = ymd(cur)
        if (day.startsWith(month)) out.push({ ...e, id: `${e.id}:${day}`, date: day })
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
  }

  // ---------- 내보내기: 내 일정을 외부 캘린더에 추가 ----------
  async exportEvent(note: Note, provider: Provider): Promise<string> {
    if (note.kind !== 'event') throw new Error('일정만 내보낼 수 있어요')
    const cache = this.readCache()
    if (cache[provider].exported[note.id]) throw new Error('이미 내보낸 일정이에요')
    const payload = { title: note.title || '(제목 없음)', date: note.date, time: note.time, description: note.body || undefined }
    if (provider === 'google') {
      if (!cache.google.writeEnabled || !this.readSecure().google?.tokens) throw new Error('Google 쓰기 권한이 허용되어 있지 않아요')
      const calId = cache.google.account ?? 'primary'
      const id = await this.googleClient().insertEvent(await this.googleToken(), calId, payload)
      cache.google.exported[note.id] = id
      this.writeCache(cache)
      return 'Google 캘린더에 추가했어요'
    }
    const sec = this.readSecure()
    if (!sec.naver?.refreshToken && !sec.naver?.accessToken) throw new Error('네이버에 연결되어 있지 않아요')
    const client = this.naverClient()
    let access = sec.naver.accessToken
    if (sec.naver.refreshToken) access = (await client.refresh(sec.naver.refreshToken)).accessToken
    await client.createSchedule(access as string, { uid: `limediary-${note.id}`, ...payload })
    cache.naver.exported[note.id] = new Date(this.now).toISOString()
    this.writeCache(cache)
    return '네이버 캘린더에 추가했어요'
  }
}
