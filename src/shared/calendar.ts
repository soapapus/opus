// 달력 계산 (일요일 시작). 날짜 문자열은 항상 YYYY-MM-DD

export interface DayCell {
  date: string
  day: number
  inMonth: boolean
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function toDateStr(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function monthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}

export function todayStr(now: Date = new Date()): string {
  return toDateStr(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

export function parseDateStr(date: string): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number)
  return { year: y, month: m, day: d }
}

export function isDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const { year, month, day } = parseDateStr(value)
  const d = new Date(year, month - 1, day)
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day
}

export function weekdayIndex(date: string): number {
  const { year, month, day } = parseDateStr(date)
  return new Date(year, month - 1, day).getDay()
}

export function weekdayName(index: number): string {
  return WEEKDAYS[index]
}

export function weekdayNames(): string[] {
  return [...WEEKDAYS]
}

/** "11월 5일 (목)" */
export function formatDateLabel(date: string): string {
  const { month, day } = parseDateStr(date)
  return `${month}월 ${day}일 (${WEEKDAYS[weekdayIndex(date)]})`
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

/** 한 달 달력. 5주 또는 6주(35 또는 42칸). 앞뒤 달 날짜도 채운다. */
export function buildMonthGrid(year: number, month: number): DayCell[] {
  const offset = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const rows = Math.ceil((offset + daysInMonth) / 7)
  const cells: DayCell[] = []
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(year, month - 1, 1 - offset + i)
    cells.push({
      date: toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      day: d.getDate(),
      inMonth: d.getMonth() === month - 1
    })
  }
  return cells
}
