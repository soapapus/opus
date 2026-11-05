import type { NoteSummary } from '../../../shared/types'
import { timeOf } from '../../../shared/text'

export function MemoItem({
  note,
  selected,
  onClick,
  showTags = true
}: {
  note: NoteSummary
  selected: boolean
  onClick: () => void
  showTags?: boolean
}) {
  return (
    <button className={`memo ${selected ? 'selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <div className="row">
        <span className="t">{note.title || '제목 없음'}</span>
        <span className="time">{timeOf(note.updated)}</span>
      </div>
      {note.preview && <div className="pv">{note.preview}</div>}
      {showTags && note.tags.length > 0 && (
        <div className="tags">
          {note.tags.map((t) => (
            <span className="chip" key={t}>
              #{t}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}
