// 네이버 캘린더: 공식 API는 "일정 추가(createSchedule)" 하나만 공개돼 있다.
// 그래서 가져오기·수정·삭제·양방향 동기화는 만들지 않고, 내 일정을 내보내는 기능만 둔다.
import { postForm, type FetchFn } from './oauth'

export interface NaverEndpoints {
  auth: string
  token: string
  api: string
}
export const NAVER_ENDPOINTS: NaverEndpoints = {
  auth: 'https://nid.naver.com/oauth2.0/authorize',
  token: 'https://nid.naver.com/oauth2.0/token',
  api: 'https://openapi.naver.com/calendar/createSchedule.json'
}

/** 네이버 개발자센터에 미리 등록해 둬야 하는 콜백 주소(포트 고정) */
export const NAVER_CALLBACK_PORT = 53682
export const NAVER_CALLBACK_PATH = '/naver/callback'

const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const compact = (d: string): string => d.replace(/-/g, '')

export function buildIcal(ev: { uid: string; title: string; date: string; time: string | null; description?: string }, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:LimeDiary', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT', `UID:${ev.uid.replace(/%/g, '')}`, `DTSTAMP:${stamp}`]
  if (ev.time) {
    const start = new Date(`${ev.date}T${ev.time}:00`)
    const end = new Date(start.getTime() + 60 * 60 * 1000)
    const fmt = (d: Date): string =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}00`
    lines.push(`DTSTART;TZID=Asia/Seoul:${fmt(start)}`, `DTEND;TZID=Asia/Seoul:${fmt(end)}`)
  } else {
    const next = new Date(`${ev.date}T00:00:00`)
    next.setDate(next.getDate() + 1)
    const nd = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    lines.push(`DTSTART;VALUE=DATE:${compact(ev.date)}`, `DTEND;VALUE=DATE:${compact(nd)}`)
  }
  lines.push(`SUMMARY:${esc(ev.title)}`)
  if (ev.description) lines.push(`DESCRIPTION:${esc(ev.description)}`)
  lines.push('END:VEVENT', 'END:VCALENDAR')
  return lines.join('\r\n')
}

export class NaverClient {
  constructor(
    private cfg: { clientId: string; clientSecret: string },
    private fetchFn: FetchFn = fetch,
    private ep: NaverEndpoints = NAVER_ENDPOINTS
  ) {}

  buildAuthUrl(p: { redirectUri: string; state: string }): string {
    const q = new URLSearchParams({ response_type: 'code', client_id: this.cfg.clientId, redirect_uri: p.redirectUri, state: p.state })
    return `${this.ep.auth}?${q.toString()}`
  }

  async exchangeCode(code: string, state: string): Promise<{ accessToken: string; refreshToken?: string }> {
    const r = (await postForm(this.fetchFn, this.ep.token, {
      grant_type: 'authorization_code',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code,
      state
    })) as { access_token?: string; refresh_token?: string; error_description?: string }
    if (!r.access_token) throw new Error(r.error_description ?? '네이버 토큰을 받지 못했어요')
    return { accessToken: r.access_token, refreshToken: r.refresh_token }
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const r = (await postForm(this.fetchFn, this.ep.token, {
      grant_type: 'refresh_token',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      refresh_token: refreshToken
    })) as { access_token?: string; error_description?: string }
    if (!r.access_token) throw new Error(r.error_description ?? '네이버 토큰을 갱신하지 못했어요')
    return { accessToken: r.access_token, refreshToken }
  }

  /** 공식 문서 기준: POST createSchedule.json, calendarId=defaultCalendarId, scheduleIcalString=iCalendar */
  async createSchedule(accessToken: string, ev: { uid: string; title: string; date: string; time: string | null; description?: string }): Promise<void> {
    const r = (await postForm(
      this.fetchFn,
      this.ep.api,
      { calendarId: 'defaultCalendarId', scheduleIcalString: buildIcal(ev) },
      { authorization: `Bearer ${accessToken}` }
    )) as { result?: string; message?: string }
    if (r.result !== 'success') throw new Error(`네이버 일정 추가 실패: ${r.message ?? '알 수 없는 오류'}`)
  }
}
