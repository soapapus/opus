import { useMemo, useState, type DragEvent } from 'react'
import { buildMonthGrid } from '../../../shared/calendar'
import type { ExternalEvent, NoteSummary } from '../../../shared/types'
import { hasLimeDrag, readDrag, type DragPayload } from '../dnd'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

interface Props {
  year: number
  month: number
  today: string
  selected: string
  /** 이 달의 일정과 달력 기록 (문서는 들어오지 않는다) */
  items: NoteSummary[]
  /** 외부 캘린더 일정 (읽기 전용) */
  external?: ExternalEvent[]
  onSelect: (date: string) => void
  /** 무언가를 날짜 칸에 끌어다 놓았을 때 */
  onDropOnDate: (date: string, payload: DragPayload) => void
}

export function MonthCalendar({ year, month, today, selected, items, external = [], onSelect, onDropOnDate }: Props) {
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])
  const [over, setOver] = useState<string | null>(null)
  const byDate = useMemo(() => {
    const map = new Map<string, NoteSummary[]>()
    for (const n of items) {
      const arr = map.get(n.date) ?? []
      arr.push(n) // 일정(시간순) → 기록 순서는 저장소가 정해서 준다
      map.set(n.date, arr)
    }
    return map
  }, [items])
  const extByDate = useMemo(() => {
    const map = new Map<string, ExternalEvent[]>()
    for (const e of external) map.set(e.date, [...(map.get(e.date) ?? []), e])
    return map
  }, [external])
  const rows = grid.length / 7

  const onDragOver = (e: DragEvent, date: string, inMonth: boolean) => {
    if (!inMonth || !hasLimeDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (over !== date) setOver(date)
  }
  const onDrop = (e: DragEvent, date: string, inMonth: boolean) => {
    setOver(null)
    if (!inMonth) return
    const payload = readDrag(e)
    if (!payload) return
    e.preventDefault()
    onDropOnDate(date, payload)
  }

  return (
    <div className="card cal">
      <div className="cal-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="cal-grid" style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {grid.map((c, i) => {
          const list = c.inMonth ? (byDate.get(c.date) ?? []) : []
          const ext = c.inMonth ? (extByDate.get(c.date) ?? []) : []
          const total = list.length + ext.length
          const cls = [
            'cell',
            c.inMonth ? '' : 'other',
            i % 7 === 0 ? 'sun' : '',
            c.date === today ? 'today' : '',
            c.date === selected && c.inMonth ? 'selected' : '',
            over === c.date ? 'drop' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={c.date}
              className={cls}
              disabled={!c.inMonth}
              onClick={() => onSelect(c.date)}
              onDragOver={(e) => onDragOver(e, c.date, c.inMonth)}
              onDragLeave={() => setOver((o) => (o === c.date ? null : o))}
              onDrop={(e) => onDrop(e, c.date, c.inMonth)}
              aria-label={`${c.date}${total ? `, 항목 ${total}개` : ''}`}
              aria-pressed={c.date === selected}
            >
              <span className="num">{c.day}</span>
              <span className="pills">
                {list.slice(0, 2).map((n) => (
                  <span className={`pill ${n.kind}`} key={n.id} title={n.title}>
                    <span>
                      {n.time && <b>{n.time}</b>} {n.title || '제목 없음'}
                    </span>
                  </span>
                ))}
                {ext.slice(0, Math.max(0, 2 - list.length)).map((e) => (
                  <span className="pill external" key={e.id} title={`${e.calendarName} (읽기 전용)`}>
                    <span>
                      {e.time && <b>{e.time}</b>} {e.title}
                    </span>
                  </span>
                ))}
                {total > 2 && <span className="more">+{total - 2}개 더</span>}
              </span>
              {total > 0 && (
                <span className="dots" aria-hidden="true">
                  {list.slice(0, 4).map((n) => (
                    <i key={n.id} className={n.kind} />
                  ))}
                  {ext.slice(0, 2).map((e) => (
                    <i key={e.id} className="external" />
                  ))}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
