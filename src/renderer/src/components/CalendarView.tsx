import { useEffect, useMemo, useState } from 'react'
import { buildMonthGrid, parseDateStr, toDateStr, todayStr } from '../../../shared/calendar'
import type { Holiday } from '../../../shared/holidays'
import type { ExternalEvent, NoteSummary } from '../../../shared/types'
import { IconLeft, IconPlus, IconRight } from '../icons'
import type { CalView, Prefs } from '../prefs'
import { SearchBox } from './SearchBox'

export type CalFilter = 'all' | 'event' | 'note' | 'google'

const WD = ['일', '월', '화', '수', '목', '금', '토']
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function addDays(date: string, n: number): string {
  const { year, month, day } = parseDateStr(date)
  const d = new Date(year, month - 1, day + n)
  return toDateStr(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
export function weekStart(date: string): string {
  const { year, month, day } = parseDateStr(date)
  return addDays(date, -new Date(year, month - 1, day).getDay())
}
function wd(date: string): number {
  const { year, month, day } = parseDateStr(date)
  return new Date(year, month - 1, day).getDay()
}

/** 화면에 보이는 날짜 범위 (월 보기는 앞뒤 달 칸까지) */
export function visibleRange(view: CalView, date: string): { start: string; end: string } {
  if (view === 'day') return { start: date, end: date }
  if (view === 'week') {
    const s = weekStart(date)
    return { start: s, end: addDays(s, 6) }
  }
  const { year, month } = parseDateStr(date)
  const g = buildMonthGrid(year, month)
  return { start: g[0].date, end: g[g.length - 1].date }
}

/** 하나로 보여 주기 위한 칩 */
export interface Chip {
  key: string
  date: string
  time: string | null
  title: string
  type: 'event' | 'note' | 'google'
  sub?: string
  note?: NoteSummary
}

export function toChips(items: NoteSummary[], external: ExternalEvent[], filter: CalFilter, showGoogle: boolean): Chip[] {
  const out: Chip[] = []
  if (filter === 'all' || filter === 'event' || filter === 'note') {
    for (const n of items) {
      if (n.kind === 'document') continue
      const type = n.kind === 'event' ? 'event' : 'note'
      if (filter !== 'all' && filter !== type) continue
      out.push({ key: n.id, date: n.date, time: n.time, title: n.title || '제목 없음', type, note: n })
    }
  }
  if (showGoogle && (filter === 'all' || filter === 'google')) {
    for (const e of external) {
      // 여러 날짜에 걸친 종일 일정은 칸마다 보여 준다
      let d = e.date
      for (let i = 0; i < 62 && d <= (e.endDate || e.date); i++) {
        out.push({ key: `${e.id}:${d}`, date: d, time: e.allDay ? null : e.time, title: e.title, type: 'google', sub: e.calendarName })
        d = addDays(d, 1)
      }
    }
  }
  const rank = (c: Chip) => (c.time ? `1${c.time}` : c.type === 'google' ? '0' : '2')
  return out.sort((a, b) => (a.date === b.date ? rank(a).localeCompare(rank(b)) : a.date.localeCompare(b.date)))
}

function byDate(chips: Chip[]): Map<string, Chip[]> {
  const m = new Map<string, Chip[]>()
  for (const c of chips) m.set(c.date, [...(m.get(c.date) ?? []), c])
  return m
}

function ChipView({ c, selectedId, onOpen, full }: { c: Chip; selectedId: string | null; onOpen: (c: Chip) => void; full?: boolean }) {
  const on = c.note && c.note.id === selectedId
  return (
    <span
      role="button"
      tabIndex={0}
      className={`chip2 ${c.type} ${on ? 'on' : ''} ${full ? 'full' : ''}`}
      title={c.type === 'google' ? `${c.title} · ${c.sub ?? 'Google'} (읽기 전용)` : c.title}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(c)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.stopPropagation()
          onOpen(c)
        }
      }}
    >
      <span className="ct">{c.title}</span>
      {c.time && <span className="cm">{c.time}</span>}
    </span>
  )
}

interface Props {
  prefs: Prefs
  view: CalView
  filter: CalFilter
  today: string
  selected: string
  selectedId: string | null
  items: NoteSummary[]
  external: ExternalEvent[]
  googleOn: boolean
  onView: (v: CalView) => void
  onFilter: (f: CalFilter) => void
  onSelect: (date: string) => void
  onOpen: (c: Chip) => void
  onShift: (dir: -1 | 1) => void
  onToday: () => void
  onAdd: (input: { title: string; date: string; time: string | null; kind: 'event' | 'note' }) => void
  onSearchPick: (n: NoteSummary) => void
  addRequest: number
  /** 날짜별 공휴일 */
  holidays: Map<string, Holiday[]>
  dayOpen: boolean
  onToggleDay: () => void
}

/** 그 날의 공휴일 표시 (쉬는 날이면 off=true) */
export function holidayOf(map: Map<string, Holiday[]>, date: string): { label: string; off: boolean } | null {
  const list = map.get(date)
  if (!list || list.length === 0) return null
  const off = list.some((h) => h.kind !== 'observance')
  const names = [...new Set(list.filter((h) => !off || h.kind !== 'observance').map((h) => h.name))]
  return { label: names.join(' · '), off }
}

function IconPanel({ open }: { open: boolean }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M15 4v16" />
      {open && <path d="M17.5 9v6" />}
    </svg>
  )
}

export function CalendarView(p: Props) {
  const chips = useMemo(() => toChips(p.items, p.external, p.filter, p.prefs.showGoogle), [p.items, p.external, p.filter, p.prefs.showGoogle])
  const map = useMemo(() => byDate(chips), [chips])
  const [adding, setAdding] = useState<string | null>(null)
  useEffect(() => {
    if (p.addRequest > 0) setAdding(p.selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.addRequest])

  const sel = parseDateStr(p.selected)
  const range = visibleRange(p.view, p.selected)
  let title = `${sel.year}년 ${sel.month}월`
  let sub = ''
  if (p.view === 'month') {
    const last = new Date(sel.year, sel.month, 0).getDate()
    sub = `${sel.month}월 1일 – ${sel.month}월 ${last}일`
  } else if (p.view === 'week') {
    const a = parseDateStr(range.start)
    const b = parseDateStr(range.end)
    title = `${a.month}월 ${a.day}일 – ${a.month === b.month ? '' : `${b.month}월 `}${b.day}일`
    sub = `${a.year}년 · ${Math.ceil(a.day / 7)}째 주`
  } else {
    title = `${sel.month}월 ${sel.day}일 ${WD[wd(p.selected)]}요일`
    sub = `${sel.year}년`
  }
  const count = chips.filter((c) => c.date >= range.start && c.date <= range.end).length
  const counts = {
    all: toChips(p.items, p.external, 'all', p.prefs.showGoogle).filter((c) => c.date >= range.start && c.date <= range.end).length
  }

  const filters: { k: CalFilter; label: string }[] = [
    { k: 'all', label: '전체' },
    { k: 'event', label: '내 일정' },
    { k: 'note', label: '기록' }
  ]
  if (p.prefs.showGoogle) filters.push({ k: 'google', label: 'Google' })

  return (
    <section className="calv cardp">
      <header className="cardp-h calv-head">
        <div className="datebadge" aria-hidden="true">
          <span>{MON[sel.month - 1]}</span>
          <b>{sel.day}</b>
        </div>
        <div className="calv-title">
          <h1>{title}</h1>
          <div className="sub">
            {sub} · 항목 {count}개
          </div>
        </div>
        <span className="spacer" />
        <SearchBox onPick={p.onSearchPick} />
        <button className="btn-accent" onClick={() => setAdding(p.selected)} title="일정 추가 (Ctrl+N)">
          <IconPlus size={15} /> 일정 추가
        </button>
        <button
          className={`icon-btn ghost ${p.dayOpen ? 'on' : ''}`}
          aria-label={p.dayOpen ? '오른쪽 패널 접기' : '오른쪽 패널 펴기'}
          title={`${p.dayOpen ? '오른쪽 패널 접기' : '오른쪽 패널 펴기'} (Ctrl+.)`}
          onClick={p.onToggleDay}
        >
          <IconPanel open={p.dayOpen} />
        </button>
      </header>

      <div className="calv-bar">
        <div className="tabs2" role="tablist">
          {filters.map((f) => (
            <button key={f.k} role="tab" aria-selected={p.filter === f.k} className={p.filter === f.k ? 'on' : ''} onClick={() => p.onFilter(f.k)}>
              {f.label}
              {f.k === 'all' && <span className="n">{counts.all}</span>}
              {f.k === 'google' && <span className={`sig ${p.googleOn ? 'g' : 'off'}`} />}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <div className="navgrp">
          <button className="icon-btn" aria-label="이전" onClick={() => p.onShift(-1)}>
            <IconLeft size={16} />
          </button>
          <button className="today2" onClick={p.onToday}>
            오늘
          </button>
          <button className="icon-btn" aria-label="다음" onClick={() => p.onShift(1)}>
            <IconRight size={16} />
          </button>
        </div>
        <div className="seg2 views" role="group" aria-label="보기">
          {(['month', 'week', 'day'] as CalView[]).map((v) => (
            <button key={v} className={p.view === v ? 'on' : ''} onClick={() => p.onView(v)}>
              {v === 'month' ? '월' : v === 'week' ? '주' : '일'}
            </button>
          ))}
        </div>
      </div>

      {p.view === 'month' && <MonthGrid {...p} map={map} onAddAt={setAdding} />}
      {p.view === 'week' && <WeekGrid {...p} map={map} start={range.start} />}
      {p.view === 'day' && <DayGrid {...p} list={map.get(p.selected) ?? []} />}

      {adding && (
        <AddDialog
          date={adding}
          onCancel={() => setAdding(null)}
          onSave={(v) => {
            setAdding(null)
            p.onAdd(v)
          }}
        />
      )}
    </section>
  )
}

function MonthGrid(p: Props & { map: Map<string, Chip[]>; onAddAt: (d: string) => void }) {
  const { year, month } = parseDateStr(p.selected)
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])
  const max = p.prefs.calChipsPerCell
  return (
    <div className="mgrid">
      <div className="mgrid-wd">
        {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
          <div key={w} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>
            {w}
          </div>
        ))}
      </div>
      <div className="mgrid-cells" style={{ gridTemplateRows: `repeat(${grid.length / 7}, minmax(0, 1fr))` }}>
        {grid.map((c) => {
          const list = p.map.get(c.date) ?? []
          const hol = holidayOf(p.holidays, c.date)
          const w = wd(c.date)
          const cls = [
            'mcell',
            c.inMonth ? '' : 'other',
            c.date === p.today ? 'today' : '',
            c.date === p.selected ? 'sel' : '',
            hol?.off || w === 0 ? 'red' : w === 6 ? 'blue' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <div
              key={c.date}
              className={cls}
              role="button"
              tabIndex={0}
              aria-label={`${c.date} 항목 ${list.length}개`}
              onClick={() => p.onSelect(c.date)}
              onDoubleClick={() => p.onAddAt(c.date)}
              onKeyDown={(e) => e.key === 'Enter' && p.onSelect(c.date)}
            >
              <div className="mtop">
                <span className="dn">{c.day}</span>
                {hol && (
                  <span className={`hol ${hol.off ? '' : 'obs'}`} title={hol.label}>
                    {hol.label}
                  </span>
                )}
              </div>
              <div className="chips">
                {list.slice(0, max).map((x) => (
                  <ChipView key={x.key} c={x} selectedId={p.selectedId} onOpen={p.onOpen} />
                ))}
                {list.length > max && <span className="more2">{list.length - max}개 더…</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekGrid(p: Props & { map: Map<string, Chip[]>; start: string }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(p.start, i))
  return (
    <div className="wgrid">
      {days.map((d, i) => {
        const list = p.map.get(d) ?? []
        const { day } = parseDateStr(d)
        const hol = holidayOf(p.holidays, d)
        return (
          <div
            key={d}
            className={`wcol ${d === p.today ? 'today' : ''} ${d === p.selected ? 'sel' : ''}`}
            onClick={() => p.onSelect(d)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && p.onSelect(d)}
          >
            <div className="wh">
              <span className={i === 0 || hol?.off ? 'sun' : i === 6 ? 'sat' : ''}>{WD[i]}</span>
              <b className={hol?.off ? 'red' : ''}>{day}</b>
              {hol && <em className={`hol ${hol.off ? '' : 'obs'}`}>{hol.label}</em>}
            </div>
            <div className="wl">
              {list.length === 0 && <span className="wempty">비어 있음</span>}
              {list.map((x) => (
                <ChipView key={x.key} c={x} selectedId={p.selectedId} onOpen={p.onOpen} full />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayGrid(p: Props & { list: Chip[] }) {
  const untimed = p.list.filter((c) => !c.time)
  const hours = Array.from({ length: 17 }, (_, i) => i + 7)
  const at = (h: number) => p.list.filter((c) => c.time && Number(c.time.slice(0, 2)) === h)
  const early = p.list.filter((c) => c.time && Number(c.time.slice(0, 2)) < 7)
  const hol = holidayOf(p.holidays, p.selected)
  return (
    <div className="dgrid">
      {hol && <div className={`dhol ${hol.off ? '' : 'obs'}`}>{hol.label}</div>}
      <div className="drow allday">
        <span className="dh">종일</span>
        <div className="dl">
          {untimed.length === 0 && <span className="wempty">—</span>}
          {untimed.map((x) => (
            <ChipView key={x.key} c={x} selectedId={p.selectedId} onOpen={p.onOpen} full />
          ))}
        </div>
      </div>
      {early.length > 0 && (
        <div className="drow">
          <span className="dh">~07</span>
          <div className="dl">
            {early.map((x) => (
              <ChipView key={x.key} c={x} selectedId={p.selectedId} onOpen={p.onOpen} full />
            ))}
          </div>
        </div>
      )}
      {hours.map((h) => (
        <div className="drow" key={h}>
          <span className="dh">{String(h).padStart(2, '0')}:00</span>
          <div className="dl">
            {at(h).map((x) => (
              <ChipView key={x.key} c={x} selectedId={p.selectedId} onOpen={p.onOpen} full />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function AddDialog({
  date,
  onSave,
  onCancel
}: {
  date: string
  onSave: (v: { title: string; date: string; time: string | null; kind: 'event' | 'note' }) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [d, setD] = useState(date || todayStr())
  const [time, setTime] = useState('')
  const [kind, setKind] = useState<'event' | 'note'>('event')
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onCancel])
  const save = () => onSave({ title: title.trim() || (kind === 'event' ? '새 일정' : '새 기록'), date: d, time: kind === 'event' && time ? time : null, kind })
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="dialog add-dlg" role="dialog" aria-label="일정 추가" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{kind === 'event' ? '일정 추가' : '기록 추가'}</h2>
        <div className="seg2" role="group" aria-label="종류">
          <button className={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>
            일정
          </button>
          <button className={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>
            기록
          </button>
        </div>
        <label className="fld">
          제목
          <input
            autoFocus
            value={title}
            placeholder={kind === 'event' ? '예) 생산 주간회의' : '예) 오늘 있었던 일'}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && save()}
          />
        </label>
        <div className="fld-row">
          <label className="fld">
            날짜
            <input type="date" value={d} onChange={(e) => setD(e.target.value)} />
          </label>
          {kind === 'event' && (
            <label className="fld">
              시간 (선택)
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
        </div>
        <div className="actions">
          <button className="btn" onClick={onCancel}>
            취소
          </button>
          <button className="btn-accent" disabled={!d} onClick={save}>
            추가
          </button>
        </div>
      </div>
    </div>
  )
}

export function MiniMonth({
  date,
  today,
  marks,
  holidays,
  onPick
}: {
  date: string
  today: string
  marks?: Set<string>
  holidays?: Map<string, Holiday[]>
  onPick: (d: string) => void
}) {
  const { year, month } = parseDateStr(date)
  const grid = buildMonthGrid(year, month)
  return (
    <div className="mini">
      <div className="mini-h">
        {year}년 {month}월
      </div>
      <div className="mini-g">
        {WD.map((w) => (
          <span key={w} className="mw">
            {w}
          </span>
        ))}
        {grid.map((c) => (
          <button
            key={c.date}
            className={`md ${c.inMonth ? '' : 'other'} ${c.date === today ? 'today' : ''} ${c.date === date ? 'sel' : ''} ${marks?.has(c.date) ? 'mk' : ''} ${(holidays && holidayOf(holidays, c.date)?.off) || wd(c.date) === 0 ? 'red' : ''}`}
            title={holidays ? holidayOf(holidays, c.date)?.label : undefined}
              data-date={c.date}
              aria-label={c.date}
            onClick={() => onPick(c.date)}
          >
            {c.day}
          </button>
        ))}
      </div>
    </div>
  )
}
