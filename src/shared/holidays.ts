// 한국 공휴일. 인터넷 없이도 나오도록 앱에 계산식을 넣어 두고,
// Google 공개 한국 공휴일 달력(ICS)을 받으면 그 해는 그쪽을 따른다(임시공휴일·법 개정 반영).

export interface Holiday {
  date: string // YYYY-MM-DD
  name: string
  /** holiday: 쉬는 날, substitute: 대체공휴일, observance: 기념일(쉬지 않음) */
  kind: 'holiday' | 'substitute' | 'observance'
}

/** 음력 설날·부처님오신날·추석(당일)의 양력 날짜 (korean_lunar_calendar로 계산해 넣은 값) */
const LUNAR: Record<number, [string, string, string]> = {
  2024: ['02-10', '05-15', '09-17'],
  2025: ['01-29', '05-05', '10-06'],
  2026: ['02-17', '05-24', '09-25'],
  2027: ['02-07', '05-13', '09-15'],
  2028: ['01-27', '05-02', '10-03'],
  2029: ['02-13', '05-20', '09-22'],
  2030: ['02-03', '05-09', '09-12'],
  2031: ['01-23', '05-28', '10-01'],
  2032: ['02-11', '05-16', '09-19'],
  2033: ['01-31', '05-06', '09-08'],
  2034: ['02-19', '05-25', '09-27'],
  2035: ['02-08', '05-15', '09-16']
}

/** 선거일 등 법으로 정해진 쉬는 날 */
const EXTRA: Holiday[] = [
  { date: '2024-04-10', name: '국회의원 선거일', kind: 'holiday' },
  { date: '2025-06-03', name: '대통령 선거일', kind: 'holiday' },
  { date: '2026-06-03', name: '지방선거일', kind: 'holiday' },
  { date: '2028-04-12', name: '국회의원 선거일', kind: 'holiday' },
  { date: '2030-06-12', name: '지방선거일', kind: 'holiday' }
]

const pad = (n: number) => String(n).padStart(2, '0')
function add(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d + n)
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}
function dow(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** 앱에 넣어 둔 규칙으로 계산한 공휴일 (2024~2035, 그 밖의 해는 양력 공휴일만) */
export function builtinHolidays(year: number): Holiday[] {
  type Group = { days: string[]; name: string; sub: 'none' | 'sunday' | 'weekend' }
  const groups: Group[] = [
    { days: [`${year}-01-01`], name: '신정', sub: 'none' },
    { days: [`${year}-03-01`], name: '삼일절', sub: 'weekend' },
    { days: [`${year}-05-05`], name: '어린이날', sub: 'weekend' },
    { days: [`${year}-06-06`], name: '현충일', sub: 'none' },
    { days: [`${year}-08-15`], name: '광복절', sub: 'weekend' },
    { days: [`${year}-10-03`], name: '개천절', sub: 'weekend' },
    { days: [`${year}-10-09`], name: '한글날', sub: 'weekend' },
    { days: [`${year}-12-25`], name: '기독탄신일', sub: 'weekend' }
  ]
  const lunar = LUNAR[year]
  if (lunar) {
    const seol = `${year}-${lunar[0]}`
    const chu = `${year}-${lunar[2]}`
    groups.push({ days: [add(seol, -1), seol, add(seol, 1)], name: '설날', sub: 'sunday' })
    groups.push({ days: [`${year}-${lunar[1]}`], name: '부처님오신날', sub: 'weekend' })
    groups.push({ days: [add(chu, -1), chu, add(chu, 1)], name: '추석', sub: 'sunday' })
  }
  const extra = EXTRA.filter((e) => e.date.startsWith(`${year}-`))

  const names = new Map<string, string[]>()
  for (const g of groups) for (const d of g.days) names.set(d, [...(names.get(d) ?? []), g.name])
  for (const e of extra) names.set(e.date, [...(names.get(e.date) ?? []), e.name])

  // 대체공휴일: 겹치거나(설·추석은 일요일, 나머지는 주말) 걸리면 그 뒤 첫 평일
  const off = new Set(names.keys())
  const usedTrigger = new Set<string>()
  const subs: Holiday[] = []
  const sorted = [...groups].filter((g) => g.sub !== 'none').sort((a, b) => a.days[0].localeCompare(b.days[0]))
  for (const g of sorted) {
    const trigger = g.days.find((d) => {
      if (usedTrigger.has(d)) return false
      const w = dow(d)
      const weekend = g.sub === 'weekend' ? w === 0 || w === 6 : w === 0
      const overlap = (names.get(d)?.length ?? 0) > 1
      return weekend || overlap
    })
    if (!trigger) continue
    usedTrigger.add(trigger)
    let d = add(g.days[g.days.length - 1], 1)
    while (dow(d) === 0 || dow(d) === 6 || off.has(d)) d = add(d, 1)
    off.add(d)
    subs.push({ date: d, name: `대체공휴일(${g.name})`, kind: 'substitute' })
  }

  const out: Holiday[] = []
  for (const g of groups) for (const d of g.days) out.push({ date: d, name: g.name, kind: 'holiday' })
  out.push(...extra, ...subs)
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Google 공개 공휴일 달력(.ics) 읽기 */
export function parseHolidayIcs(text: string): Holiday[] {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const out: Holiday[] = []
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0]
    const get = (key: string) => {
      const m = new RegExp(`^${key}(?:;[^:\\r\\n]*)?:(.*)$`, 'm').exec(body)
      return m ? m[1].trim() : ''
    }
    const start = get('DTSTART').slice(0, 8)
    const endRaw = get('DTEND').slice(0, 8)
    const name = get('SUMMARY').replace(/\\,/g, ',').replace(/\\n/g, ' ')
    if (!/^\d{8}$/.test(start) || !name) continue
    const desc = get('DESCRIPTION')
    const observance = /기념일|Observance/i.test(desc)
    const kind: Holiday['kind'] = observance ? 'observance' : /대체/.test(name) ? 'substitute' : 'holiday'
    let d = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`
    const end = /^\d{8}$/.test(endRaw) ? `${endRaw.slice(0, 4)}-${endRaw.slice(4, 6)}-${endRaw.slice(6, 8)}` : add(d, 1)
    for (let i = 0; i < 10 && d < end; i++) {
      out.push({ date: d, name, kind })
      d = add(d, 1)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** 한 해의 공휴일: Google 달력에 그 해 쉬는 날이 있으면 그것을, 없으면 내장 규칙을 쓴다 */
export function holidaysForYear(year: number, fromIcs: Holiday[] | null): Holiday[] {
  const ics = (fromIcs ?? []).filter((h) => h.date.startsWith(`${year}-`))
  if (ics.some((h) => h.kind !== 'observance')) return ics
  return builtinHolidays(year)
}
