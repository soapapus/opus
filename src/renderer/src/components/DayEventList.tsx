import { useState } from 'react'
import { formatDateLabel } from '../../../shared/calendar'
import type { ExternalEvent, NoteSummary } from '../../../shared/types'
import { startDrag } from '../dnd'
import { IconPlus } from '../icons'

interface Props {
  date: string
  items: NoteSummary[]
  external?: ExternalEvent[]
  selectedId: string | null
  onSelect: (n: NoteSummary) => void
  onQuick: (text: string, kind: 'event' | 'note', time: string | null) => void
  /** 아래 편집 공간을 넓히려고 목록을 작게 */
  compact?: boolean
}

/** "18:30 회사 회식" 처럼 앞에 시간을 적으면 일정 시간으로 읽는다 */
export function parseQuick(text: string): { title: string; time: string | null } {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)\s+(.+)$/.exec(text.trim())
  if (!m) return { title: text.trim(), time: null }
  return { title: m[3].trim(), time: `${m[1].padStart(2, '0')}:${m[2]}` }
}

export function DayEventList({ date, items, external = [], selectedId, onSelect, onQuick, compact }: Props) {
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'event' | 'note'>('event')
  const submit = () => {
    const raw = text.trim()
    if (!raw) return
    setText('')
    if (kind === 'event') {
      const { title, time } = parseQuick(raw)
      onQuick(title, 'event', time)
    } else onQuick(raw, 'note', null)
  }
  return (
    <div className={`card day-card ${compact ? 'compact' : ''}`}>
      <div className="day-head">
        <h2>{formatDateLabel(date)}</h2>
        <span className="n">{items.length + external.length}개</span>
      </div>
      <div className="quick">
        <div className="seg" role="group" aria-label="추가할 종류">
          <button className={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>
            일정
          </button>
          <button className={kind === 'note' ? 'on' : ''} onClick={() => setKind('note')}>
            기록
          </button>
        </div>
        <input
          value={text}
          placeholder={kind === 'event' ? '예) 18:30 회사 회식  (Enter)' : '오늘 있었던 일을 한 줄로  (Enter)'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          }}
        />
        <button className="add" aria-label="추가" onClick={submit}>
          <IconPlus size={18} />
        </button>
      </div>
      <div className="list">
        {items.length + external.length === 0 && <div className="list-empty">이 날은 아직 비어 있어요</div>}
        {external.map((e) => (
          <div key={e.id} className="memo ext" title="외부 캘린더 일정 · 읽기 전용이라 고칠 수 없어요">
            <div className="row">
              <span className="kind-chip ext">{e.provider === 'google' ? 'Google' : '외부'}</span>
              <span className="t wrap">
                {e.time ? `${e.time} ` : ''}
                {e.title}
              </span>
              <span className="lk">읽기 전용</span>
            </div>
          </div>
        ))}
        {items.map((n) => (
          <button
            key={n.id}
            className={`memo ${n.id === selectedId ? 'selected' : ''}`}
            draggable
            onDragStart={(e) => startDrag(e, n)}
            onClick={() => onSelect(n)}
            aria-pressed={n.id === selectedId}
            title="문서 편집기로 끌어다 놓으면 연결된 체크리스트가 만들어져요"
          >
            <div className="row">
              <span className={`kind-chip ${n.kind}`}>{n.kind === 'event' ? n.time ?? '일정' : '기록'}</span>
              <span className="t wrap">{n.title || '제목 없음'}</span>
              {!n.classified && <span className="unc">미분류</span>}
              {n.links.length > 0 && <span className="lk" title="연결된 기록이 있어요">🔗{n.links.length}</span>}
            </div>
            {n.preview && <div className="pv">{n.preview}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}
