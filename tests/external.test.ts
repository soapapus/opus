import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toExternal, SCOPE_READ, SCOPE_WRITE } from '../src/main/external/google'
import { buildIcal } from '../src/main/external/naver'
import { makePkce, startLoopback } from '../src/main/external/oauth'
import { ExternalService, type Vault } from '../src/main/external/service'
import type { Note } from '../src/shared/types'

const vault: Vault = {
  available: () => true,
  encrypt: (s) => Buffer.from(s, 'utf8').reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString('utf8')
}

describe('PKCE·일정 변환·iCal', () => {
  it('PKCE challenge는 RFC 7636 예시와 같다', () => {
    expect(makePkce('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('Google 일정 변환: 종일(끝 날짜는 하루 전), 시간 일정, 취소된 일정', () => {
    const cal = { id: 'c1', name: '내 캘린더' }
    expect(toExternal({ id: 'a', summary: '출장', start: { date: '2026-11-10' }, end: { date: '2026-11-13' } }, cal)).toMatchObject({
      id: 'google:c1:a',
      date: '2026-11-10',
      endDate: '2026-11-12',
      allDay: true,
      time: null
    })
    const t = toExternal({ id: 'b', summary: '회의', start: { dateTime: '2026-11-05T18:30:00+09:00' }, end: { dateTime: '2026-11-05T19:30:00+09:00' } }, cal)!
    expect(t.allDay).toBe(false)
    expect(t.title).toBe('회의')
    expect(toExternal({ id: 'x', status: 'cancelled', start: { date: '2026-11-01' } }, cal)).toBeNull()
    expect(toExternal({ id: 'y', start: { date: '2026-11-01' }, end: { date: '2026-11-02' } }, cal)?.title).toBe('(제목 없음)')
  })

  it('네이버 iCal: 한글·세미콜론 이스케이프, UID의 %는 제거, 종일/시간 형식', () => {
    const timed = buildIcal({ uid: 'a%b', title: '회식; 장소, 강남', date: '2026-11-05', time: '18:30' }, new Date('2026-11-05T00:00:00Z'))
    expect(timed).toContain('UID:ab')
    expect(timed).toContain('SUMMARY:회식\; 장소\\, 강남')
    expect(timed).toContain('DTSTART;TZID=Asia/Seoul:20261105T183000')
    expect(timed).toContain('DTEND;TZID=Asia/Seoul:20261105T193000')
    const allDay = buildIcal({ uid: 'u', title: 't', date: '2026-11-30', time: null })
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261130')
    expect(allDay).toContain('DTEND;VALUE=DATE:20261201')
  })
})

describe('로그인 응답 수신기', () => {
  it('상태값이 다르면 거절한다', async () => {
    const lb = await startLoopback({ path: '/cb', state: 'good' })
    lb.code.catch(() => undefined)
    const res = await fetch(`${lb.redirectUri}?code=abc&state=bad`)
    expect(res.status).toBe(400)
    await expect(lb.code).rejects.toThrow('state')
  })
})

// ---- 가짜 Google / 네이버 서버 ----
interface Fake {
  base: string
  tokenBodies: URLSearchParams[]
  insertBodies: unknown[]
  naverBodies: { auth: string | undefined; form: URLSearchParams }[]
  requests: string[]
  events: Record<string, unknown[]>
  scopeSeen: string[]
  close(): void
}

async function fakeServer(): Promise<Fake> {
  const f: Fake = { base: '', tokenBodies: [], insertBodies: [], naverBodies: [], requests: [], events: {}, scopeSeen: [], close: () => undefined }
  f.events['me@gmail.com'] = [
    { id: 'e1', summary: '팀 회의', start: { dateTime: '2026-11-05T10:00:00+09:00' }, end: { dateTime: '2026-11-05T11:00:00+09:00' } },
    { id: 'e2', summary: '출장', start: { date: '2026-11-10' }, end: { date: '2026-11-13' } }
  ]
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const url = new URL(req.url ?? '/', 'http://x')
      f.requests.push(`${req.method} ${url.pathname}`)
      const json = (o: unknown, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(o))
      if (url.pathname === '/g/token') {
        const form = new URLSearchParams(body)
        f.tokenBodies.push(form)
        const scope = f.scopeSeen[f.scopeSeen.length - 1] ?? SCOPE_READ
        return json({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, scope })
      }
      if (url.pathname === '/g/calendar/v3/users/me/calendarList')
        return json({ items: [{ id: 'me@gmail.com', summary: '내 캘린더', primary: true }, { id: 'team@x.com', summary: '팀 캘린더' }] })
      const evMatch = /^\/g\/calendar\/v3\/calendars\/([^/]+)\/events$/.exec(url.pathname)
      if (evMatch && req.method === 'GET') return json({ items: f.events[decodeURIComponent(evMatch[1])] ?? [] })
      if (evMatch && req.method === 'POST') {
        f.insertBodies.push(JSON.parse(body))
        return json({ id: 'new-event-1' })
      }
      if (url.pathname === '/n/token') {
        f.tokenBodies.push(new URLSearchParams(body))
        return json({ access_token: 'NAT', refresh_token: 'NRT', token_type: 'bearer', expires_in: '3600' })
      }
      if (url.pathname === '/n/create') {
        f.naverBodies.push({ auth: req.headers.authorization, form: new URLSearchParams(body) })
        return json({ result: 'success', returnValue: { processType: 'create' } })
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  f.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  f.close = () => server.close()
  return f
}

let dir: string
let fake: Fake
let clock: number
let authUrls: string[]

function makeService(over: { now?: () => number } = {}): ExternalService {
  return new ExternalService({
    secureFile: join(dir, 'pc', 'secure.bin'),
    cacheFile: join(dir, 'data', 'external-cache.json'),
    vault,
    now: over.now ?? (() => clock),
    googleEndpoints: { auth: `${fake.base}/g/auth`, token: `${fake.base}/g/token`, api: `${fake.base}/g/calendar/v3` },
    naverEndpoints: { auth: `${fake.base}/n/auth`, token: `${fake.base}/n/token`, api: `${fake.base}/n/create` },
    naverPort: 0,
    // "브라우저": 로그인 주소를 열면 곧바로 허용한 것처럼 내 PC의 수신기로 되돌려 보낸다
    openUrl: async (u) => {
      authUrls.push(u)
      const q = new URL(u).searchParams
      const redirect = q.get('redirect_uri')!
      fake.scopeSeen.push(q.get('scope') ?? SCOPE_READ)
      setTimeout(() => void fetch(`${redirect}?code=AUTHCODE&state=${q.get('state')}`), 20)
    }
  })
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'limediary-ext-'))
  fake = await fakeServer()
  clock = new Date('2026-11-05T09:00:00+09:00').getTime()
  authUrls = []
})
afterEach(() => {
  fake.close()
  rmSync(dir, { recursive: true, force: true })
})

const ev = (over: Partial<Note> = {}): Note =>
  ({
    id: 'n1',
    title: '회사 회식',
    kind: 'event',
    date: '2026-11-05',
    time: '18:30',
    body: '',
    tags: [],
    links: [],
    classified: true,
    preview: '',
    created: '',
    updated: '',
    source: 'local',
    ...over
  }) as Note

describe('시나리오 4: 계정을 연결하지 않아도 정상 동작, 외부 호출 없음', () => {
  it('상태 조회·달력용 조회·동기화 시도·내보내기 모두 네트워크를 쓰지 않는다', async () => {
    const svc = makeService()
    expect(svc.state().google).toMatchObject({ configured: false, connected: false })
    expect(svc.state().naver).toMatchObject({ configured: false, connected: false })
    expect(svc.externalByMonth('2026-11')).toEqual([])
    expect((await svc.syncExternal()).google.message).toContain('연결되어 있지 않')
    await expect(svc.exportEvent(ev(), 'google')).rejects.toThrow()
    await expect(svc.exportEvent(ev(), 'naver')).rejects.toThrow()
    expect(svc.networkCalls).toBe(0)
    expect(fake.requests).toEqual([])
  })

  it('키만 저장해도(연결 전) 네트워크는 쓰지 않고, 키는 암호화되어 저장된다', () => {
    const svc = makeService()
    svc.saveKeys('google', 'my-client-id', 'my-secret')
    expect(svc.state().google).toMatchObject({ configured: true, connected: false })
    expect(svc.networkCalls).toBe(0)
    const raw = readFileSync(join(dir, 'pc', 'secure.bin'))
    expect(raw.toString('utf8')).not.toContain('my-client-id')
  })
})

describe('Google: 읽기 연결, 동기화, 누적, 해제', () => {
  it('PKCE로 연결하고(읽기 권한만) 일정을 가져와 달력용으로 펼친다', async () => {
    const svc = makeService()
    svc.saveKeys('google', 'cid', 'csecret')
    const st = await svc.connectGoogle(false)
    expect(st.google.message).toBeUndefined()
    expect(st.google).toMatchObject({ connected: true, writeEnabled: false, account: 'me@gmail.com' })
    // 인증 주소: PKCE(S256)와 읽기 전용 범위만
    const q = new URL(authUrls[0]).searchParams
    expect(q.get('code_challenge_method')).toBe('S256')
    expect(q.get('scope')).toBe(SCOPE_READ)
    // 토큰 교환에 verifier를 보냈고 challenge와 짝이 맞는다
    const form = fake.tokenBodies[0]
    expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(q.get('code_challenge'))
    expect(form.get('code')).toBe('AUTHCODE')
    // 기본으로 내 기본 캘린더만 선택
    expect(st.google.calendars?.filter((c) => c.selected).map((c) => c.id)).toEqual(['me@gmail.com'])
    // 달력용: 3일짜리 종일 일정은 11~12일에 걸쳐 펼쳐진다
    const month = svc.externalByMonth('2026-11')
    expect(month.map((e) => `${e.date}:${e.time ?? '종일'}:${e.title}`)).toEqual([
      '2026-11-05:10:00:팀 회의',
      '2026-11-10:종일:출장',
      '2026-11-11:종일:출장',
      '2026-11-12:종일:출장'
    ])
  })

  it('연결을 해제해도 가져온 일정은 로컬에 남고, 토큰은 사라진다', async () => {
    const svc = makeService()
    svc.saveKeys('google', 'cid', '')
    await svc.connectGoogle(false)
    const st = await svc.disconnect('google')
    expect(st.google).toMatchObject({ connected: false, configured: true })
    expect(st.google.cachedEvents).toBe(2)
    expect(svc.externalByMonth('2026-11')).toHaveLength(4)
    const callsBefore = svc.networkCalls
    expect((await svc.syncExternal()).google.message).toContain('연결되어 있지 않')
    expect(svc.networkCalls).toBe(callsBefore)
  })

  it('동기화 기간보다 옛 일정은 계정이 사라져도 계속 쌓여 있고, 기간 안에서 지워진 일정만 빠진다', async () => {
    const svc = makeService()
    svc.saveKeys('google', 'cid', '')
    fake.events['me@gmail.com'].push({ id: 'old', summary: '작년 일정', start: { date: '2025-03-03' }, end: { date: '2025-03-04' } })
    // 옛 일정은 가져오는 기간 밖이지만 이전에 캐시된 것으로 가정하기 위해, 처음엔 기간 안으로 보이게 시계를 과거로 둔다
    clock = new Date('2025-03-01T09:00:00+09:00').getTime()
    const early = makeService({ now: () => clock })
    early.saveKeys('google', 'cid', '')
    await early.connectGoogle(false)
    expect(early.externalByMonth('2025-03').map((e) => e.title)).toEqual(['작년 일정'])
    // 1년 뒤: 새 동기화는 옛 일정을 가져오지 않지만 캐시에는 남는다
    clock = new Date('2026-11-05T09:00:00+09:00').getTime()
    const later = makeService({ now: () => clock })
    fake.events['me@gmail.com'] = fake.events['me@gmail.com'].filter((e) => (e as { id: string }).id !== 'old')
    fake.events['me@gmail.com'] = fake.events['me@gmail.com'].filter((e) => (e as { id: string }).id !== 'e1')
    await later.syncExternal()
    expect(later.externalByMonth('2025-03').map((e) => e.title)).toEqual(['작년 일정'])
    expect(later.externalByMonth('2026-11').map((e) => e.title)).toEqual(['출장', '출장', '출장']) // 원격에서 지운 '팀 회의'는 빠짐
  })

  it('캘린더 선택을 바꾸면 선택한 캘린더의 일정만 보인다', async () => {
    fake.events['team@x.com'] = [{ id: 't1', summary: '팀 행사', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } }]
    const svc = makeService()
    svc.saveKeys('google', 'cid', '')
    await svc.connectGoogle(false)
    expect(svc.externalByMonth('2026-11').some((e) => e.title === '팀 행사')).toBe(false)
    await svc.setCalendars(['me@gmail.com', 'team@x.com'])
    expect(svc.externalByMonth('2026-11').some((e) => e.title === '팀 행사')).toBe(true)
    await svc.setCalendars(['me@gmail.com'])
    expect(svc.externalByMonth('2026-11').some((e) => e.title === '팀 행사')).toBe(false)
  })

  it('토큰이 만료되면 refresh_token으로 갱신해서 계속 동기화한다', async () => {
    let t = clock
    const svc = makeService({ now: () => t })
    svc.saveKeys('google', 'cid', '')
    await svc.connectGoogle(false)
    t += 2 * 3600 * 1000 // 2시간 뒤
    await svc.syncExternal()
    expect(fake.tokenBodies.some((b) => b.get('grant_type') === 'refresh_token' && b.get('refresh_token') === 'RT1')).toBe(true)
  })

  it('쓰기 권한은 따로 요청하고, 내보내기는 한 번만 되며 읽기 전용이면 거절된다', async () => {
    const svc = makeService()
    svc.saveKeys('google', 'cid', '')
    await svc.connectGoogle(false)
    await expect(svc.exportEvent(ev(), 'google')).rejects.toThrow('쓰기 권한')
    const st = await svc.connectGoogle(true)
    expect(new URL(authUrls[1]).searchParams.get('scope')).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`)
    expect(st.google.writeEnabled).toBe(true)
    await expect(svc.exportEvent(ev(), 'google')).resolves.toContain('Google')
    expect(fake.insertBodies[0]).toMatchObject({ summary: '회사 회식' })
    await expect(svc.exportEvent(ev(), 'google')).rejects.toThrow('이미 내보낸')
    await expect(svc.exportEvent(ev({ kind: 'note' }), 'google')).rejects.toThrow('일정만')
  })

  it('로그인 도중 취소/오류는 메시지로 알려 주고 아무것도 저장하지 않는다', async () => {
    const svc = new ExternalService({
      secureFile: join(dir, 'pc', 'secure.bin'),
      cacheFile: join(dir, 'data', 'external-cache.json'),
      vault,
      now: () => clock,
      googleEndpoints: { auth: `${fake.base}/g/auth`, token: `${fake.base}/g/token`, api: `${fake.base}/g/calendar/v3` },
      openUrl: async (u) => {
        const q = new URL(u).searchParams
        setTimeout(() => void fetch(`${q.get('redirect_uri')}?error=access_denied&state=${q.get('state')}`), 20)
      }
    })
    svc.saveKeys('google', 'cid', '')
    const st = await svc.connectGoogle(false)
    expect(st.google.connected).toBe(false)
    expect(st.google.message).toContain('취소')
    expect(existsSync(join(dir, 'data', 'external-cache.json'))).toBe(false)
  })
})

describe('네이버: 내보내기만', () => {
  it('연결 후 일정 추가를 공식 형식(defaultCalendarId + iCal)으로 보낸다', async () => {
    const svc = makeService()
    svc.saveKeys('naver', 'ncid', 'nsecret')
    const st = await svc.connectNaver()
    expect(st.naver.connected).toBe(true)
    expect(st.naver.capabilities.join(' ')).toContain('양방향')
    await expect(svc.exportEvent(ev(), 'naver')).resolves.toContain('네이버')
    const sent = fake.naverBodies[0]
    expect(sent.auth).toBe('Bearer NAT')
    expect(sent.form.get('calendarId')).toBe('defaultCalendarId')
    expect(sent.form.get('scheduleIcalString')).toContain('SUMMARY:회사 회식')
    await expect(svc.exportEvent(ev(), 'naver')).rejects.toThrow('이미 내보낸')
    // 해제하면 토큰이 사라지고 다시 내보낼 수 없다
    expect((await svc.disconnect('naver')).naver.connected).toBe(false)
  })
})
