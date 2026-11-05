// 화면 설정. 모든 설정은 설정 화면 한곳에서 바꾸고, settings.json(prefs)에 저장된다.
import { useCallback, useEffect, useState } from 'react'

export type CalView = 'month' | 'week' | 'day'
export type MenuKey = 'calendar' | 'memo' | 'scratch' | 'settings'

export interface Prefs {
  /** 강조색 (#RRGGBB) */
  accent: string
  /** 강조색을 어디까지 쓸지: soft = 버튼·선택만, bold = 오늘·칩까지 진하게 */
  accentMode: 'soft' | 'bold'
  /** 글자 크기 */
  fontScale: 'sm' | 'md' | 'lg'
  /** 메뉴 이름 (비우면 기본값) */
  menuNames: Partial<Record<MenuKey, string>>
  calDefaultView: CalView
  /** 월 보기 한 칸에 보여 줄 일정 수 */
  calChipsPerCell: number
  showGoogle: boolean
  /** 칩 색 */
  colorEvent: string
  colorNote: string
  colorGoogle: string
  /** 메모장 '진행 중'에 올린 메모 id */
  pinned: string[]
  /** 오른쪽 날짜 패널 메모 칸의 이름 */
  dayMemoLabel: string
  /** 한국 공휴일 */
  showHolidays: boolean
  showObservances: boolean
  /** Google 공개 공휴일 달력을 받아 쓰기 (끄면 앱에 넣어 둔 규칙만) */
  holidayOnline: boolean
  /** 패널 너비·열림 */
  wsWidth: number
  dayWidth: number
  sideWidth: number
  wsOpen: boolean
  dayOpen: boolean
}

export const DEFAULT_PREFS: Prefs = {
  accent: '#C7F12D',
  accentMode: 'soft',
  fontScale: 'md',
  menuNames: {},
  calDefaultView: 'month',
  calChipsPerCell: 3,
  showGoogle: true,
  colorEvent: '#C7F12D',
  colorNote: '#E9EAE5',
  colorGoogle: '#B9D7F2',
  pinned: [],
  dayMemoLabel: '회의 메모',
  showHolidays: true,
  showObservances: false,
  holidayOnline: true,
  wsWidth: 220,
  dayWidth: 340,
  sideWidth: 260,
  wsOpen: true,
  dayOpen: true
}

/** 강조색 고르기에 보여 줄 옵션. 기본은 Lime */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Lime', hex: '#C7F12D' },
  { name: 'Mint', hex: '#8EE6B8' },
  { name: 'Sky', hex: '#9ED3F7' },
  { name: 'Butter', hex: '#F6DD5C' },
  { name: 'Peach', hex: '#FFB896' },
  { name: 'Lilac', hex: '#C9B8FF' },
  { name: 'Graphite', hex: '#222621' }
]

export const MENU_DEFAULT: Record<MenuKey, string> = {
  calendar: '캘린더',
  memo: '메모',
  scratch: '빠른 메모',
  settings: '설정'
}

export function menuName(p: Prefs, k: MenuKey): string {
  return (p.menuNames[k] ?? '').trim() || MENU_DEFAULT[k]
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** 배경색 위에 올릴 글자색 (밝으면 Graphite, 어두우면 Paper) */
export function inkOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.35 ? '#222621' : '#F5F4EE'
}

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)
}

/** 끌어서 바꿀 수 있는 패널 너비 범위 */
export const WIDTH = {
  ws: { min: 180, max: 320, def: 220 },
  day: { min: 280, max: 560, def: 340 },
  side: { min: 220, max: 380, def: 260 }
}
export function clamp(v: number, r: { min: number; max: number; def: number }): number {
  return Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v))) : r.def
}

function merge(raw: Record<string, unknown>): Prefs {
  const p = { ...DEFAULT_PREFS } as Record<string, unknown>
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in DEFAULT_PREFS)) continue
    const def = (DEFAULT_PREFS as unknown as Record<string, unknown>)[k]
    if (Array.isArray(def) ? Array.isArray(v) : typeof v === typeof def) p[k] = v
  }
  const out = p as unknown as Prefs
  if (!isHex(out.accent)) out.accent = DEFAULT_PREFS.accent
  out.calChipsPerCell = Math.min(5, Math.max(1, Math.round(out.calChipsPerCell)))
  out.wsWidth = clamp(out.wsWidth, WIDTH.ws)
  out.dayWidth = clamp(out.dayWidth, WIDTH.day)
  out.sideWidth = clamp(out.sideWidth, WIDTH.side)
  return out
}

export function applyTheme(p: Prefs): void {
  const r = document.documentElement
  r.style.setProperty('--accent', p.accent)
  r.style.setProperty('--accent-ink', inkOn(p.accent))
  // 어두운 바탕(Graphite) 위에 올릴 강조색: 강조색이 어두우면 Paper로 대신
  r.style.setProperty('--accent-on-dark', inkOn(p.accent) === '#F5F4EE' ? '#F5F4EE' : p.accent)
  r.style.setProperty('--c-event', p.colorEvent)
  r.style.setProperty('--c-event-ink', inkOn(p.colorEvent))
  r.style.setProperty('--c-note', p.colorNote)
  r.style.setProperty('--c-note-ink', inkOn(p.colorNote))
  r.style.setProperty('--c-google', p.colorGoogle)
  r.style.setProperty('--c-google-ink', inkOn(p.colorGoogle))
  r.dataset.accentMode = p.accentMode
  r.style.fontSize = p.fontScale === 'sm' ? '13px' : p.fontScale === 'lg' ? '15.5px' : '14px'
}

export function usePrefs(): [Prefs, (patch: Partial<Prefs>) => void, boolean] {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void window.api
      .prefsGet()
      .then((raw) => setPrefs(merge(raw ?? {})))
      .catch(() => undefined)
      .finally(() => setReady(true))
  }, [])
  useEffect(() => applyTheme(prefs), [prefs])
  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((cur) => ({ ...cur, ...patch }))
    void window.api.prefsSet(patch as Record<string, unknown>).catch(() => undefined)
  }, [])
  return [prefs, update, ready]
}
