import { describe, expect, it } from 'vitest'
import { builtinHolidays, holidaysForYear, parseHolidayIcs } from '../src/shared/holidays'

const days = (y: number) => builtinHolidays(y).map((h) => `${h.date} ${h.name}`)

describe('한국 공휴일 (내장 규칙)', () => {
  it('2025: 어린이날·부처님오신날 겹침, 삼일절 토요일, 추석 일요일 대체', () => {
    const d = days(2025)
    expect(d).toContain('2025-01-28 설날')
    expect(d).toContain('2025-01-30 설날')
    expect(d).toContain('2025-03-03 대체공휴일(삼일절)')
    expect(d).toContain('2025-05-06 대체공휴일(어린이날)')
    expect(d.filter((x) => x.startsWith('2025-05-06'))).toHaveLength(1)
    expect(d).toContain('2025-06-03 대통령 선거일')
    expect(d).toContain('2025-10-08 대체공휴일(추석)')
  })
  it('2026: 삼일절·부처님오신날·광복절·개천절 대체, 추석 토요일은 대체 없음', () => {
    const d = days(2026)
    expect(d).toContain('2026-02-16 설날')
    expect(d).toContain('2026-03-02 대체공휴일(삼일절)')
    expect(d).toContain('2026-05-25 대체공휴일(부처님오신날)')
    expect(d).toContain('2026-06-03 지방선거일')
    expect(d).toContain('2026-08-17 대체공휴일(광복절)')
    expect(d).toContain('2026-10-05 대체공휴일(개천절)')
    expect(d.some((x) => x.includes('대체공휴일(추석)'))).toBe(false)
  })
  it('2027: 설날 일요일 → 2/9, 성탄절 토요일 → 12/27', () => {
    const d = days(2027)
    expect(d).toContain('2027-02-09 대체공휴일(설날)')
    expect(d).toContain('2027-08-16 대체공휴일(광복절)')
    expect(d).toContain('2027-10-04 대체공휴일(개천절)')
    expect(d).toContain('2027-10-11 대체공휴일(한글날)')
    expect(d).toContain('2027-12-27 대체공휴일(기독탄신일)')
  })
})

describe('Google 공휴일 달력', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260717',
    'DTEND;VALUE=DATE:20260718',
    'SUMMARY:제헌절',
    'DESCRIPTION:공휴일',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260508',
    'DTEND;VALUE=DATE:20260509',
    'SUMMARY:어버이날',
    'DESCRIPTION:기념일\\n기념일을 숨기려면 Google Calendar 설정',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')
  it('읽고, 그 해는 Google 쪽을 따른다', () => {
    const parsed = parseHolidayIcs(ics)
    expect(parsed).toEqual([
      { date: '2026-05-08', name: '어버이날', kind: 'observance' },
      { date: '2026-07-17', name: '제헌절', kind: 'holiday' }
    ])
    expect(holidaysForYear(2026, parsed).map((h) => h.name)).toEqual(['어버이날', '제헌절'])
    expect(holidaysForYear(2027, parsed).length).toBeGreaterThan(10)
  })
})
