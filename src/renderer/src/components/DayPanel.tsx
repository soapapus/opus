import { useState, type ReactNode } from 'react'
import { parseDateStr } from '../../../shared/calendar'
import { IconPlus } from '../icons'
import type { Chip } from './CalendarView'
import { parseQuick } from './DayEventList'

const WD = ['일', '월', '화', '수', '목', '금', '토']

/** 캘린더 오른쪽: 고른 날의 일정 목록 + 고른 일정의 메모 */
export function DayPanel({
  date,
  chips,
  selectedId,
  memoLabel,
  holiday,
  onOpen,
  onQuick,
  children
}: {
  date: string
  chips: Chip[]
  selectedId: string | null
  memoLabel: string
  holiday: { label: string; off: boolean } | null
  onOpen: (c: Chip) => void
  onQuick: (title: string, time: string | null) => void
  children: ReactNode
}) {
  const [text, setText] = useState('')
  const { year, month, day } = parseDateStr(date)
  const w = WD[new Date(year, month - 1, day).getDay()]
  const submit = () => {
    const raw = text.trim()
    if (!raw) return
    setText('')
    const q = parseQuick(raw)
    onQuick(q.title, q.time)
  }
  return (
    <aside className="dayp cardp">
      <div className="cardp-h dayp-h">
        <div>
          <h2 className={holiday?.off || w === '일' ? 'red' : ''}>
            {month}월 {day}일 {w}요일
          </h2>
          {holiday && <div className={`dayp-hol ${holiday.off ? '' : 'obs'}`}>{holiday.label}</div>}
        </div>
        <span className="n">{chips.length}개</span>
      </div>
      <div className="dayp-body">
      <div className="dayp-list">
        {chips.length === 0 && <div className="dayp-empty">이 날은 비어 있어요</div>}
        {chips.map((c) => (
          <button
            key={c.key}
            className={`ev ${c.type} ${c.note && c.note.id === selectedId ? 'on' : ''}`}
            onClick={() => onOpen(c)}
            title={c.type === 'google' ? '외부 캘린더 일정 · 읽기 전용' : undefined}
          >
            <span className="bar" />
            <span className="ev-b">
              <b>
                {c.time ? `${c.time} ` : ''}
                {c.title}
              </b>
              <small>
                {c.type === 'google' ? `Google Calendar · ${c.sub ?? ''} · 읽기 전용` : c.type === 'event' ? '내 일정' : '기록'}
                {c.note && c.note.links.length > 0 ? ` · 연결 ${c.note.links.length}` : ''}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="dayp-quick">
        <input
          value={text}
          placeholder="예) 14:00 생산 주간회의  (Enter)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        />
        <button aria-label="이 날에 일정 추가" onClick={submit}>
          <IconPlus size={16} />
        </button>
      </div>
      <div className="dayp-memo-h">{memoLabel}</div>
      <div className="dayp-memo">{children}</div>
      </div>
    </aside>
  )
}
