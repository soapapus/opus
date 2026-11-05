// Google Calendar: OAuth 2.0 + PKCE, 캘린더 목록, 일정 조회, (선택) 일정 추가.
// 읽기 권한(calendar.readonly)과 쓰기 권한(calendar.events)은 따로 요청한다.
import type { ExternalCalendar, ExternalEvent } from '../../shared/types'
import { postForm, type FetchFn } from './oauth'

export const SCOPE_READ = 'https://www.googleapis.com/auth/calendar.readonly'
export const SCOPE_WRITE = 'https://www.googleapis.com/auth/calendar.events'

export interface GoogleEndpoints {
  auth: string
  token: string
  api: string
}
export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  api: 'https://www.googleapis.com/calendar/v3'
}

export interface Tokens {
  accessToken: string
  refreshToken?: string
  /** 만료 시각 (ms) */
  expiresAt: number
  scope: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
}

const toTokens = (r: TokenResponse, now: number, prev?: Tokens): Tokens => ({
  accessToken: r.access_token,
  refreshToken: r.refresh_token ?? prev?.refreshToken,
  expiresAt: now + (r.expires_in - 60) * 1000,
  scope: r.scope ?? prev?.scope ?? ''
})

export interface RawEvent {
  id: string
  status?: string
  summary?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Google 일정 → 앱 형식. 종일 일정의 끝 날짜는 "다음 날 0시"로 오므로 하루 뺀다. */
export function toExternal(raw: RawEvent, cal: { id: string; name: string }): ExternalEvent | null {
  if (raw.status === 'cancelled' || !raw.start) return null
  let date: string
  let endDate: string
  let time: string | null = null
  let allDay = false
  if (raw.start.date) {
    allDay = true
    date = raw.start.date
    endDate = date
    if (raw.end?.date && raw.end.date > date) {
      const e = new Date(`${raw.end.date}T00:00:00`)
      e.setDate(e.getDate() - 1)
      endDate = localDate(e)
    }
  } else if (raw.start.dateTime) {
    const s = new Date(raw.start.dateTime)
    date = localDate(s)
    time = localTime(s)
    endDate = raw.end?.dateTime ? localDate(new Date(new Date(raw.end.dateTime).getTime() - 1)) : date
    if (endDate < date) endDate = date
  } else return null
  return {
    id: `google:${cal.id}:${raw.id}`,
    provider: 'google',
    calendarId: cal.id,
    calendarName: cal.name,
    title: (raw.summary ?? '').trim() || '(제목 없음)',
    date,
    endDate,
    time,
    allDay
  }
}

export class GoogleClient {
  constructor(
    private cfg: { clientId: string; clientSecret?: string },
    private fetchFn: FetchFn = fetch,
    private ep: GoogleEndpoints = GOOGLE_ENDPOINTS,
    private clock: () => number = Date.now
  ) {}

  buildAuthUrl(p: { redirectUri: string; challenge: string; state: string; write: boolean }): string {
    const q = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: p.redirectUri,
      response_type: 'code',
      scope: p.write ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ,
      code_challenge: p.challenge,
      code_challenge_method: 'S256',
      state: p.state,
      access_type: 'offline',
      prompt: 'consent'
    })
    return `${this.ep.auth}?${q.toString()}`
  }

  async exchangeCode(code: string, verifier: string, redirectUri: string): Promise<Tokens> {
    const r = (await postForm(this.fetchFn, this.ep.token, {
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret || undefined,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri
    })) as TokenResponse
    return toTokens(r, this.clock())
  }

  async refresh(prev: Tokens): Promise<Tokens> {
    if (!prev.refreshToken) throw new Error('다시 연결해 주세요 (갱신 정보가 없어요)')
    const r = (await postForm(this.fetchFn, this.ep.token, {
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret || undefined,
      refresh_token: prev.refreshToken,
      grant_type: 'refresh_token'
    })) as TokenResponse
    return toTokens(r, this.clock(), prev)
  }

  private async get<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
    const url = `${this.ep.api}${path}?${new URLSearchParams(params).toString()}`
    const res = await this.fetchFn(url, { headers: { authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Google 요청 실패 (${res.status})`)
    return (await res.json()) as T
  }

  async listCalendars(token: string): Promise<(ExternalCalendar & { selected: boolean })[]> {
    const out: ExternalCalendar[] = []
    let pageToken: string | undefined
    do {
      const r = await this.get<{
        items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean }[]
        nextPageToken?: string
      }>(token, '/users/me/calendarList', pageToken ? { pageToken } : {})
      for (const c of r.items ?? [])
        out.push({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: !!c.primary, selected: false })
      pageToken = r.nextPageToken
    } while (pageToken)
    return out
  }

  /** 기간 안의 일정(반복 일정은 펼쳐서)을 모두 가져온다 */
  async listEvents(token: string, cal: { id: string; name: string }, timeMin: string, timeMax: string): Promise<ExternalEvent[]> {
    const out: ExternalEvent[] = []
    let pageToken: string | undefined
    do {
      const params: Record<string, string> = { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }
      if (pageToken) params.pageToken = pageToken
      const r = await this.get<{ items?: RawEvent[]; nextPageToken?: string }>(
        token,
        `/calendars/${encodeURIComponent(cal.id)}/events`,
        params
      )
      for (const raw of r.items ?? []) {
        const e = toExternal(raw, cal)
        if (e) out.push(e)
      }
      pageToken = r.nextPageToken
    } while (pageToken)
    return out
  }

  /** 일정 추가(내보내기). 쓰기 권한이 있을 때만 호출된다. */
  async insertEvent(
    token: string,
    calendarId: string,
    ev: { title: string; date: string; time: string | null; description?: string }
  ): Promise<string> {
    const body: Record<string, unknown> = { summary: ev.title, description: ev.description }
    if (ev.time) {
      const start = new Date(`${ev.date}T${ev.time}:00`)
      const end = new Date(start.getTime() + 60 * 60 * 1000)
      body.start = { dateTime: start.toISOString() }
      body.end = { dateTime: end.toISOString() }
    } else {
      const next = new Date(`${ev.date}T00:00:00`)
      next.setDate(next.getDate() + 1)
      body.start = { date: ev.date }
      body.end = { date: localDate(next) }
    }
    const res = await this.fetchFn(`${this.ep.api}/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error(`Google 일정 추가 실패 (${res.status})`)
    return ((await res.json()) as { id: string }).id
  }
}
