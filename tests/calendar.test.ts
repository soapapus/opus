import { describe, expect, it } from 'vitest'
import {
  buildMonthGrid,
  formatDateLabel,
  isDateStr,
  monthKey,
  shiftMonth,
  todayStr,
  weekdayIndex
} from '../src/shared/calendar'

describe('달력 계산', () => {
  it('2026년 11월은 일요일에 시작해서 5주(35칸)이다', () => {
    const grid = buildMonthGrid(2026, 11)
    expect(grid).toHaveLength(35)
    expect(grid[0]).toEqual({ date: '2026-11-01', day: 1, inMonth: true })
    expect(grid[29]).toEqual({ date: '2026-11-30', day: 30, inMonth: true })
    expect(grid[30]).toEqual({ date: '2026-12-01', day: 1, inMonth: false })
    expect(grid[34].date).toBe('2026-12-05')
  })

  it('앞 달 날짜로 시작 칸을 채우고, 6주가 필요한 달은 42칸이다', () => {
    // 2026년 8월 1일은 토요일, 31일까지 → 6주
    const grid = buildMonthGrid(2026, 8)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toEqual({ date: '2026-07-26', day: 26, inMonth: false })
    expect(grid[6]).toEqual({ date: '2026-08-01', day: 1, inMonth: true })
    expect(grid.filter((c) => c.inMonth)).toHaveLength(31)
  })

  it('2월(윤년 아님)이 일요일에 시작하면 4주(28칸)이다', () => {
    // 2026년 2월 1일은 일요일
    expect(buildMonthGrid(2026, 2)).toHaveLength(28)
  })

  it('모든 칸의 요일이 열과 맞는다', () => {
    const grid = buildMonthGrid(2026, 11)
    grid.forEach((cell, i) => {
      expect(weekdayIndex(cell.date)).toBe(i % 7)
    })
  })

  it('날짜 문자열 도우미', () => {
    expect(todayStr(new Date(2026, 10, 5))).toBe('2026-11-05')
    expect(monthKey(2026, 3)).toBe('2026-03')
    expect(formatDateLabel('2026-11-05')).toBe('11월 5일 (목)')
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(isDateStr('2026-02-30')).toBe(false)
    expect(isDateStr('2026-11-05')).toBe(true)
    expect(isDateStr('hello')).toBe(false)
  })
})
