import { useEffect, useState, type ReactNode } from 'react'
import { parseDateStr, shiftMonth } from '../../../shared/calendar'
import type { Holiday } from '../../../shared/holidays'
import type { NoteSummary } from '../../../shared/types'
import { IconCalendar, IconPlus, IconTrash } from '../icons'
import { ConfirmDialog } from './Dialogs'
import { MiniMonth } from './CalendarView'
import { SearchBox } from './SearchBox'
import { TASK_DRAG_TYPE } from './EditorCommands'
import '../memo.css'

export type MemoFilter = { mode: 'pinned' | 'today' | 'all' } | { mode: 'tag'; tag: string }

const WD = ['일', '월', '화', '수', '목', '금', '토']
const NO_PROJECT = '분류 없음'

export function filterLabel(f: MemoFilter): string {
  if (f.mode === 'tag') return f.tag
  return f.mode === 'pinned' ? '진행 중' : f.mode === 'today' ? '오늘' : '모든 메모'
}

/** "오늘 14:00", "어제 09:10", "수요일 14:00", "10/21" */
export function when(iso: string, today: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const t = parseDateStr(today)
  const t0 = new Date(t.year, t.month - 1, t.day).getTime()
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diff = Math.round((t0 - d0) / 86400000)
  if (diff === 0) return `오늘 ${hm}`
  if (diff === 1) return `어제 ${hm}`
  if (diff > 1 && diff < 7) return `${WD[d.getDay()]}요일 ${hm}`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function applyMemoFilter(docs: NoteSummary[], f: MemoFilter, pinned: string[], today: string): NoteSummary[] {
  if (f.mode === 'pinned') return docs.filter((d) => pinned.includes(d.id))
  if (f.mode === 'today') return docs.filter((d) => d.updated.slice(0, 10) === today || d.created.slice(0, 10) === today)
  if (f.mode === 'tag') return docs.filter((d) => d.tags.includes(f.tag))
  return docs
}

function groups(list: NoteSummary[], f: MemoFilter): [string, NoteSummary[]][] {
  if (f.mode === 'tag') return [[f.tag, list]]
  const m = new Map<string, NoteSummary[]>()
  for (const d of list) {
    const g = d.tags[0] ?? NO_PROJECT
    m.set(g, [...(m.get(g) ?? []), d])
  }
  return [...m.entries()].sort((a, b) => (a[0] === NO_PROJECT ? 1 : b[0] === NO_PROJECT ? -1 : a[0].localeCompare(b[0], 'ko')))
}

export function MemoView({ filter, list, today, pinned, selectedId, editor, recent, related, marks, holidays,
  onSelect, onNew, onPin, onSearchPick, onPickDate, onScheduleTask, onDeleteSelected }: {
  filter: MemoFilter; list: NoteSummary[]; today: string; pinned: string[]; selectedId: string | null
  editor: ReactNode; recent: NoteSummary[]; related: NoteSummary[]; marks: Set<string>
  holidays: Map<string, Holiday[]>
  onSelect: (n: NoteSummary) => void; onNew: (tag?: string) => void; onPin: (id: string) => void
  onSearchPick: (n: NoteSummary) => void; onPickDate: (d: string) => void
  onScheduleTask: (id: string, title: string, date: string) => Promise<void>
  onDeleteSelected: (ids: string[]) => Promise<string[]>
}) {
  const [checked, setChecked] = useState<string[]>([])
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const filterKey = filter.mode === 'tag' ? `tag:${filter.tag}` : filter.mode
  useEffect(() => { setChecked([]); setConfirmBulk(false); setDeleteError('') }, [filterKey])
  const visibleIds = new Set(list.map(n => n.id))
  const checkedIds = checked.filter(id => visibleIds.has(id))
  const deleteChecked = async () => {
    if (deleting || !checkedIds.length) return
    setDeleting(true)
    setDeleteError('')
    try {
      const removed = await onDeleteSelected(checkedIds)
      setChecked(ids => ids.filter(id => !removed.includes(id)))
      setConfirmBulk(false)
      if (removed.length < checkedIds.length) setDeleteError('일부 메모를 지우지 못했어요. 선택을 유지했으니 다시 시도해 주세요.')
    } catch { setDeleteError('저장 상태를 확인해 주세요. 메모를 지우지 않았어요.'); setConfirmBulk(false) }
    finally { setDeleting(false) }
  }
  const [drawer, setDrawer] = useState(false)
  const [month, setMonth] = useState(today)
  const [scheduling, setScheduling] = useState(false)
  const [scheduleMessage, setScheduleMessage] = useState('')
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        event.preventDefault(); setDrawer(v => !v)
      } else if (event.key === 'Escape') setDrawer(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const moveMonth = (dir: number) => {
    const d = parseDateStr(month)
    const next = shiftMonth(d.year, d.month, dir)
    setMonth(`${next.year}-${String(next.month).padStart(2, '0')}-01`)
  }
  return (
    <section className="memov memo-split">
      <div className="memov-main cardp memo-list">
        <header className="cardp-h memov-head">
          <b>{filterLabel(filter)}</b><small>{list.length}개</small><span className="spacer" />
          <button className="icon-btn memo-bulk-delete" aria-label="선택한 메모 삭제" title={checkedIds.length ? `선택한 메모 ${checkedIds.length}개 삭제` : '메모를 체크한 뒤 지울 수 있어요'} disabled={!checkedIds.length || deleting} onClick={() => setConfirmBulk(true)}><IconTrash size={16} /></button>
          <button className="round-add" aria-label="새 메모" title="새 메모 (Ctrl+N)" onClick={() => onNew(filter.mode === 'tag' ? filter.tag : undefined)}><IconPlus size={16} /></button>
        </header>
        <div className="memo-list-search"><SearchBox onPick={onSearchPick} /></div>
        {checkedIds.length > 0 && <div className="memo-selection"><span>{checkedIds.length}개 선택</span><button onClick={() => setChecked([])} disabled={deleting}>선택 해제</button></div>}
        {deleteError && <p className="memo-delete-error" role="alert">{deleteError}</p>}
        <div className="memov-scroll" aria-label="메모 목록">
          {list.length === 0 && <div className="memov-empty">{filter.mode === 'pinned' ? '진행 중인 메모가 없어요.' : '아직 메모가 없어요. + 로 새 메모를 만들어 보세요.'}</div>}
          {groups(list, filter).map(([name, docs]) => <section className="agroup" key={name}>
            <h3>{name}<span className="n">{docs.length}</span></h3>
            {docs.map(d => <div className={`arow ${d.id === selectedId ? 'selected' : ''}`} key={d.id}>
              <input className="memo-check" type="checkbox" aria-label={`${d.title || '제목 없음'} 선택`} checked={checkedIds.includes(d.id)} disabled={deleting} onChange={e => setChecked(ids => e.target.checked ? [...ids, d.id] : ids.filter(id => id !== d.id))} />
              <button className={`pin ${pinned.includes(d.id) ? 'on' : ''}`} aria-label={pinned.includes(d.id) ? '진행 중에서 내리기' : '진행 중으로 올리기'} onClick={() => onPin(d.id)} />
              <button className="arow-b" aria-current={d.id === selectedId ? 'true' : undefined} onClick={() => onSelect(d)}>
                <span className="at">{d.title || '제목 없음'}</span>
                <span className="ap">{d.preview || '내용 없음'}</span>
                <span className="aw">{when(d.updated, today)}</span>
              </button>
            </div>)}
          </section>)}
        </div>
      </div>
      <div className="memo-canvas cardp">
        <header className="cardp-h memo-canvas-head"><small>메모</small><span className="spacer" />
          <button className="icon-btn" aria-label="캘린더 패널" aria-expanded={drawer} aria-controls="memo-calendar-drawer" title="캘린더 (Ctrl+Shift+C)" onClick={() => setDrawer(v => !v)}><IconCalendar size={17} /></button>
        </header>
        <div className="agenda-open memo-editor-slot">
          {editor || <div className="memo-canvas-empty"><b>메모를 선택해 주세요</b><p>목록에서 고르거나 새 메모를 만들어 보세요.</p><button className="btn" onClick={() => onNew()}>새 메모</button></div>}
        </div>
      </div>
      {confirmBulk && <ConfirmDialog title={`선택한 메모 ${checkedIds.length}개를 지울까요?`} message="선택한 메모만 보관 폴더의 .trash로 옮겨요. 선택하지 않은 메모와 연결된 일정은 그대로 남아요." confirmLabel="선택한 메모 지우기" busy={deleting} onConfirm={() => void deleteChecked()} onCancel={() => { if (!deleting) setConfirmBulk(false) }} />}
      {drawer && <aside className="memov-side cardp memo-drawer" id="memo-calendar-drawer" aria-label="캘린더와 관련 메모">
        <header className="cardp-h side-h"><b>캘린더 · 관련 메모</b><span className="spacer" /><button className="icon-btn" aria-label="캘린더 닫기" onClick={() => setDrawer(false)}>×</button></header>
        <div className="side-body">
          <div className="mini-nav"><button aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button><button onClick={() => setMonth(today)}>오늘</button><button aria-label="다음 달" onClick={() => moveMonth(1)}>›</button></div>
          <div className="task-calendar" onDragOver={e => {
            if (Array.from(e.dataTransfer.types).includes(TASK_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
          }} onDrop={async e => {
            e.preventDefault()
            const date = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]')?.dataset.date
            if (!date || scheduling) return
            try {
              const task = JSON.parse(e.dataTransfer.getData(TASK_DRAG_TYPE))
              if (typeof task.noteId !== 'string' || typeof task.title !== 'string' || !task.title.trim()) return
              setScheduling(true)
              await onScheduleTask(task.noteId, task.title.trim(), date)
              setScheduleMessage(`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일에 일정을 만들었어요`)
            } catch { setScheduleMessage('일정을 만들지 못했어요. 다시 시도해 주세요') }
            finally { setScheduling(false) }
          }}><MiniMonth date={month} today={today} marks={marks} holidays={holidays} onPick={onPickDate} /></div>
          <p className="small muted">체크리스트의 ⠿ 핸들을 날짜로 끌어 일정을 만드세요. 원문은 그대로 남아요.</p>
          <p className="small" role="status">{scheduleMessage}</p>
          <div className="side-sec"><h4>관련 메모</h4>
            {related.length === 0 && <p className="muted small">연결된 메모가 없어요</p>}
            {related.map(n => <button className="side-item" key={n.id} onClick={() => onSelect(n)}>{n.title || '제목 없음'}</button>)}
          </div>
          <div className="side-sec"><h4>최근 수정한 메모</h4>
            {recent.map(n => <button className="side-item" key={n.id} onClick={() => onSelect(n)}>{n.title || '제목 없음'}</button>)}
          </div>
        </div>
      </aside>}
    </section>
  )
}
