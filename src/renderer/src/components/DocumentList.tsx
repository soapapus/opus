import { Fragment } from 'react'
import type { NoteSummary, TagCount } from '../../../shared/types'
import { startDrag } from '../dnd'
import { IconPlus } from '../icons'

function monthLabel(iso: string): string {
  return `${iso.slice(0, 4)}년 ${Number(iso.slice(5, 7))}월`
}

interface Props {
  docs: NoteSummary[]
  tags: TagCount[]
  tagFilter: string | null
  selectedId: string | null
  onSelect: (n: NoteSummary) => void
  onTag: (tag: string | null) => void
  onNew: () => void
}

/** 모든 메모 = 독립 문서 목록. 달력 기록·일정은 여기 나오지 않는다. */
export function DocumentList({ docs, tags, tagFilter, selectedId, onSelect, onTag, onNew }: Props) {
  const sorted = [...docs].sort((a, b) => b.updated.localeCompare(a.updated))
  return (
    <div className="card day-card fill">
      <div className="day-head">
        <h2>{tagFilter ? `#${tagFilter}` : '모든 메모'}</h2>
        <span className="n">문서 {docs.length}개</span>
        <span className="spacer" />
        <button className="btn primary sm" onClick={onNew}>
          <IconPlus size={15} /> 새 문서
        </button>
      </div>
      {tags.length > 0 && (
        <div className="filter-row">
          <button className={`filter-chip ${!tagFilter ? 'on' : ''}`} onClick={() => onTag(null)}>
            전체
          </button>
          {tags.map((t) => (
            <button
              key={t.tag}
              className={`filter-chip ${tagFilter === t.tag ? 'on' : ''}`}
              onClick={() => onTag(t.tag)}
            >
              #{t.tag} {t.count}
            </button>
          ))}
        </div>
      )}
      <div className="list">
        {docs.length === 0 && (
          <div className="list-empty">
            아직 문서가 없어요.
            <br />
            달력의 기록은 여기에 자동으로 나오지 않아요.
          </div>
        )}
        {sorted.map((n, i) => (
          <Fragment key={n.id}>
            {(i === 0 || monthLabel(sorted[i - 1].updated) !== monthLabel(n.updated)) && (
              <div className="date-sep">{monthLabel(n.updated)}</div>
            )}
            <button
              className={`memo ${n.id === selectedId ? 'selected' : ''}`}
              draggable
              onDragStart={(e) => startDrag(e, n)}
              onClick={() => onSelect(n)}
              aria-pressed={n.id === selectedId}
              title="달력 날짜로 끌어다 놓으면 일정이 만들어져요"
            >
              <div className="row">
                <span className="t wrap">{n.title || '제목 없음'}</span>
                {n.links.length > 0 && <span className="lk">🔗{n.links.length}</span>}
              </div>
              {n.preview && <div className="pv">{n.preview}</div>}
              {n.tags.length > 0 && (
                <div className="tags">
                  {n.tags.map((t) => (
                    <span className="chip" key={t}>
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </Fragment>
        ))}
      </div>
    </div>
  )
}
