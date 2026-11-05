import type { NoteSummary } from '../../../shared/types'
import { startDrag } from '../dnd'
import { IconPlus } from '../icons'

/** 달력 화면에서 문서를 고르고, 날짜로 끌어다 놓을 수 있는 작은 목록 */
export function DocPicker({
  docs,
  selectedId,
  onSelect,
  onNew
}: {
  docs: NoteSummary[]
  selectedId: string | null
  onSelect: (n: NoteSummary) => void
  onNew: () => void
}) {
  return (
    <div className="picker">
      <div className="picker-list">
        {docs.length === 0 && <span className="muted">아직 문서가 없어요</span>}
        {docs.map((n) => (
          <button
            key={n.id}
            className={`pick ${n.id === selectedId ? 'on' : ''}`}
            draggable
            onDragStart={(e) => startDrag(e, n)}
            onClick={() => onSelect(n)}
            title="달력 날짜로 끌어다 놓으면 일정이 만들어져요"
          >
            {n.title || '제목 없음'}
          </button>
        ))}
      </div>
      <button className="btn sm" onClick={onNew}>
        <IconPlus size={14} /> 새 문서
      </button>
    </div>
  )
}
